import test from 'node:test';
import assert from 'node:assert/strict';
import { configWarnings, DEFAULTS, normalizeConfig } from '../src/config.js';

test('current defaults never warn', () => {
  assert.deepEqual(configWarnings(normalizeConfig({})), []);
  assert.deepEqual(configWarnings(DEFAULTS), []);
});

test('the pre-0.39.0 recall trio warns once, with the new numbers', () => {
  const warnings = configWarnings({ recallBudgetTokens: 500, recallMaxNotes: 6, recallMinCoverage: 0.33 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1200 \/ 8 \/ 0\.2/);
  assert.match(warnings[0], /cordis\.patch\.yml/);
});

test('two old keys are enough, one is not', () => {
  assert.equal(configWarnings({ recallBudgetTokens: 500, recallMaxNotes: 6 }).length, 1);
  assert.equal(configWarnings({ recallMaxNotes: 6 }).length, 0);
  assert.equal(configWarnings({ recallMinCoverage: 0.33 }).length, 0);
});
