#!/usr/bin/env node
// Attribution check for outcome feedback: a synthetic transcript where we know
// whether a correction really targets the injected note. This measures the
// heuristic's precision/recall, not end-to-end retrieval quality.
//
// Run: node tools/outcome-eval.mjs [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { maybeRecordCorrection } from '../src/outcome.js';

const NOTES = {
  codename: '# 项目代号\n\n项目代号是青鸟，发布前确认一遍。',
  release: '# 发版流程\n\n发版走 tag 加 CI，不手动上传 npm。',
  pnpm: '# 包管理器\n\n前端项目统一用 pnpm，不用 npm。',
  archive: '# 临时产物\n\n一次性脚本统一放 archive，不放仓库根目录。',
  timezone: '# 时区\n\n团队时间统一按 Asia/Shanghai。',
  backup: '# 变更前\n\n线上数据变更前先备份，再操作。',
};

const CASES = [
  // positive: correction clearly revisits the injected note's topic
  ['codename', '不对，项目代号不是青鸟，是白鹭。', true],
  ['codename', '项目代号记错了，应该是白鹭。', true],
  ['release', '不是手动上传 npm 吗？你写错了，应该走 tag 加 CI。', true],
  ['release', '发版流程不对，改成 tag 加 CI。', true],
  ['pnpm', '不对，前端项目都用 npm，不是 pnpm。', true],
  ['pnpm', '包管理器弄错了，应该统一用 pnpm。', true],
  ['archive', '临时产物放错地方了，应该统一放 archive。', true],
  ['archive', '不对，一次性脚本不放仓库根目录，放 archive。', true],
  ['timezone', '时区搞错了，团队时间不是 Asia/Shanghai。', true],
  ['timezone', '不对，团队时间统一按 UTC。', true],
  ['backup', '变更前备份这条记错了，应该是先备份再操作。', true],
  ['backup', '不对，线上数据变更前必须先备份。', true],
  // negative: unrelated correction, or a different memory entirely
  ['codename', '不对，这个目录应该放 archive。', false],
  ['codename', '刚才那段翻译错了，重新翻一遍。', false],
  ['release', '不对，晚饭应该吃面。', false],
  ['release', '这个函数名写错了，改成 parseConfig。', false],
  ['pnpm', '不对，今天天气不是晴。', false],
  ['pnpm', '测试用例写错了，应该断言两次。', false],
  ['archive', '不对，会议改到周三了。', false],
  ['archive', '刚才的报错应该是网络问题。', false],
  ['timezone', '不对，这个数字应该是 42。', false],
  ['timezone', '表格列宽弄错了，改窄一点。', false],
  ['backup', '不对，颜色不是这个。', false],
  ['backup', '刚才那句话翻译错了。', false],
  // near miss: shares a single token, not enough for attribution
  ['codename', '不对，这个项目的截止时间记错了。', false],
  ['release', '不对，这个版本号应该是 0.20.0。', false],
  ['pnpm', '不对，这个包应该升级。', false],
  ['archive', '不对，这个文件应该删掉。', false],
  ['timezone', '不对，这个时间点太晚了。', false],
  ['backup', '不对，这个操作太危险。', false],
  // adversarial: same topic, different aspect — must not blame the note
  ['codename', '不对，青鸟项目的会议改到周三了。', false],
  ['release', '不对，发版这次先推迟，等测试环境好了再说。', false],
  ['timezone', '不对，这个团队会议在下午三点。', false],
  ['backup', '不对，线上数据这次只改一条。', false],
  ['archive', '不对，archive 目录的权限太宽了。', false],
  ['pnpm', '不对，pnpm 的版本太旧了。', false],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-outcome-eval-'));
const store = openStore(dir);
const ids = new Map();
for (const [key, body] of Object.entries(NOTES)) {
  const got = remember(store, { content: body });
  if (!got.ok) throw new Error('failed to seed note ' + key + ': ' + JSON.stringify(got));
  ids.set(key, got.id);
}

let tp = 0;
let fp = 0;
let fn = 0;
let tn = 0;
const misses = [];
const falseAlarms = [];
for (const [noteKey, text, gold] of CASES) {
  const state = { injectedIds: [ids.get(noteKey)], injectedAt: Date.now(), injectedQuery: 'test' };
  let recorded = false;
  try {
    recorded = Boolean(maybeRecordCorrection({ store, state, text }));
  } catch {
    recorded = false;
  }
  if (recorded && gold) tp += 1;
  else if (recorded) {
    fp += 1;
    falseAlarms.push(text);
  } else if (gold) {
    fn += 1;
    misses.push(text);
  } else tn += 1;
}
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
const out = {
  cases: CASES.length,
  tp,
  fp,
  fn,
  tn,
  precision: Number(precision.toFixed(3)),
  recall: Number(recall.toFixed(3)),
  falseAlarms,
  misses,
};
fs.rmSync(dir, { recursive: true, force: true });
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`outcome attribution: ${out.cases} cases, P=${out.precision} R=${out.recall} (tp ${tp} fp ${fp} fn ${fn} tn ${tn})`);
  if (falseAlarms.length) console.log('false alarms:', falseAlarms.join(' | '));
  if (misses.length) console.log('misses:', misses.join(' | '));
}
