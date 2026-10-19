// 定时巩固（“睡觉时整理记忆”）：只产提案，不自动合并。
// 与面板的提案区共用同一套 propose/review 闸门 —— 定时器只负责发现，
// 入库仍然要人点批准。任何异常都只 warn，不影响对话回合。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepConsolidation } from 'tabellio';

export const CADENCE_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};
export const MAX_SWEEP_PROPOSALS = 3;

const stateFile = (store) => join(store.store, 'runs', 'consolidate-state.json');

export function consolidateDue(now, lastRun, cadenceMs) {
  return !lastRun || now - lastRun >= cadenceMs;
}

export function readLastRun(store) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(store), 'utf8'));
    return Number(parsed.lastRun) || 0;
  } catch {
    return 0;
  }
}

export function writeLastRun(store, at) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    writeFileSync(stateFile(store), JSON.stringify({ lastRun: at }) + '\n');
  } catch {
    // 状态文件写不进去只意味着下次可能重复扫一遍，不致命
  }
}

// 生产环境默认的扫描：近重复笔记 → merge 提案（写 notes/proposals/）。
export function sweepNow(store) {
  return sweepConsolidation(store, { maxProposals: MAX_SWEEP_PROPOSALS });
}

export function maybeSweep({ getStore, settings, now = Date.now(), run = sweepNow, logger } = {}) {
  const cadence = CADENCE_MS[settings?.consolidate];
  if (!cadence) return { ran: false, reason: 'off' };
  let store;
  try {
    store = getStore();
  } catch {
    return { ran: false, reason: 'no_store' };
  }
  if (!store) return { ran: false, reason: 'no_store' };
  const last = readLastRun(store);
  if (!consolidateDue(now, last, cadence)) return { ran: false, reason: 'not_due', last };
  try {
    const result = run(store);
    writeLastRun(store, now);
    return { ran: true, created: result?.created?.length ?? 0, result };
  } catch (error) {
    logger?.warn?.('tabellio-dsh: consolidation sweep failed: ' + (error?.message ?? error));
    return { ran: false, reason: 'error' };
  }
}

// 每小时看一次是否到期；首次先等 90 秒，别和宿主的启动流程抢 IO。
export function startConsolidationTimer({ getStore, settings, logger, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  if (!CADENCE_MS[settings?.consolidate]) return null;
  let stopped = false;
  let tick = null;
  const check = () => {
    if (stopped) return;
    const outcome = maybeSweep({ getStore, settings, logger, now: now() });
    if (outcome.ran) {
      logger?.info?.(`tabellio-dsh: consolidation sweep created ${outcome.created} proposal(s)`);
    }
    tick = setTimer(check, 60 * 60 * 1000);
    tick?.unref?.();
  };
  const first = setTimer(check, 90 * 1000);
  first?.unref?.();
  return () => {
    stopped = true;
    clearTimer(first);
    if (tick) clearTimer(tick);
  };
}
