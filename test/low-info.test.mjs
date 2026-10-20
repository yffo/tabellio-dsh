import test from 'node:test';
import assert from 'node:assert/strict';
import { isLowInformationQuery } from '../src/messages.js';
import { normalizeConfig, DEFAULTS } from '../src/config.js';

test('short vague queries are low information; concrete tokens are not', () => {
  assert.equal(isLowInformationQuery('上次召回', 6), true);
  assert.equal(isLowInformationQuery('继续。', 6), true);
  assert.equal(isLowInformationQuery('阈值多少？', 6), true);

  assert.equal(isLowInformationQuery('我们上次说的项目代号是什么？', 6), false);
  assert.equal(isLowInformationQuery('v0.1.12 的阈值多少', 6), false);
  assert.equal(isLowInformationQuery('青鸟计划是什么', 6), false);
  assert.equal(isLowInformationQuery('「青鸟」', 6), false);
  assert.equal(isLowInformationQuery('上次召回', 0), false, 'zero disables the gate');
});

test('judgeMinChars is normalized and defaults to 8', () => {
  assert.equal(DEFAULTS.judgeMinChars, 6);
  assert.equal(normalizeConfig({}).judgeMinChars, 6);
  assert.equal(normalizeConfig({ judgeMinChars: 0 }).judgeMinChars, 0);
  assert.equal(normalizeConfig({ judgeMinChars: 99 }).judgeMinChars, 40);
  assert.equal(normalizeConfig({ judgeMinChars: -3 }).judgeMinChars, 0);
});
