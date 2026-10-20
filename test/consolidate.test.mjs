import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CADENCE_MS, consolidateDue, maybeSweep, readLastRun, writeLastRun } from '../src/consolidate.js';
import { normalizeConfig } from '../src/config.js';

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-consolidate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('consolidate due maths honour the cadence', () => {
  assert.equal(consolidateDue(1000, 0, CADENCE_MS.daily), true);
  assert.equal(consolidateDue(5000 + CADENCE_MS.daily - 1, 5000, CADENCE_MS.daily), false);
  assert.equal(consolidateDue(5000 + CADENCE_MS.daily, 5000, CADENCE_MS.daily), true);
  assert.equal(consolidateDue(CADENCE_MS.weekly * 2, CADENCE_MS.weekly, CADENCE_MS.weekly), true);
});

test('last run state survives in the store runs directory', (t) => {
  const dir = temp(t);
  const store = { store: dir };
  assert.equal(readLastRun(store), 0);
  writeLastRun(store, 123456);
  assert.equal(readLastRun(store), 123456);
});

test('maybeSweep is off unless a cadence is configured', async (t) => {
  const dir = temp(t);
  const store = { store: dir };
  assert.equal((await maybeSweep({ getStore: () => store, settings: { consolidate: 'off' } })).ran, false);
});

test('maybeSweep skips a store that ran recently and records the run', async (t) => {
  const dir = temp(t);
  const store = { store: dir };
  const now = Date.parse('2026-10-19T00:00:00Z');
  writeLastRun(store, now - 1000);
  let calls = 0;
  const run = () => { calls += 1; return { created: [1, 2] }; };

  const skipped = await maybeSweep({ getStore: () => store, settings: { consolidate: 'daily' }, now, run });
  assert.equal(skipped.ran, false);
  assert.equal(skipped.reason, 'not_due');
  assert.equal(calls, 0);

  const ran = await maybeSweep({ getStore: () => store, settings: { consolidate: 'daily' }, now: now + CADENCE_MS.daily, run });
  assert.equal(ran.ran, true);
  assert.equal(ran.created, 2);
  assert.equal(calls, 1);
  assert.equal(readLastRun(store), now + CADENCE_MS.daily);
});

test('a failing sweep warns instead of throwing and does not record the run', async (t) => {
  const dir = temp(t);
  const store = { store: dir };
  const warns = [];
  const outcome = await maybeSweep({
    getStore: () => store,
    settings: { consolidate: 'weekly' },
    run: () => { throw new Error('disk full'); },
    logger: { warn: (message) => warns.push(String(message)) },
  });
  assert.equal(outcome.ran, false);
  assert.equal(outcome.reason, 'error');
  assert.equal(readLastRun(store), 0);
  assert.match(warns[0], /disk full/);
});

test('consolidate config fails safe to off and accepts daily/weekly', () => {
  assert.equal(normalizeConfig({}).consolidate, 'off');
  assert.equal(normalizeConfig({ consolidate: 'daily' }).consolidate, 'daily');
  assert.equal(normalizeConfig({ consolidate: 'weekly' }).consolidate, 'weekly');
  assert.equal(normalizeConfig({ consolidate: 'sometimes' }).consolidate, 'off');
  assert.equal(normalizeConfig({ consolidate: true }).consolidate, 'off');
});
