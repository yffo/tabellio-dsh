// The bundle patch is what a stranger gets on `dsh plugin add tabellio-dsh`.
// DSH replaces the whole config object with it, so a stale value here silently
// pins every new install to an old tuning — which is exactly what happened
// (0.39.x shipped `recallBudgetTokens: 500 / recallMaxNotes: 6 /
// recallMinCoverage: 0.33`, the pre-A/B numbers, while the library default
// answers 76.3% vs 63.7% on the 120-question simulated-user bench).
//
// Rule: the patch may only repeat library defaults, plus a short allowlist of
// product choices (capture mode, delivery). Anything else belongs in
// src/config.js so one edit — and one release — moves every user.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, normalizeConfig } from '../src/config.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Parse the tiny YAML subset the patch uses: `key: scalar` under one config:. */
export function parsePatchConfig(text) {
  const config = {};
  let inConfig = false;
  for (const line of text.split('\n')) {
    if (/^\s{6}config:\s*$/.test(line)) {
      inConfig = true;
      continue;
    }
    if (!inConfig) continue;
    if (/^ {0,7}\S/.test(line)) break; // dedented back to the patch list
    const match = /^ {8}([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    config[match[1]] = parseScalar(match[2]);
  }
  return config;
}

function parseScalar(raw) {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== '');
  }
  return text.replace(/^['"]|['"]$/g, '');
}

// The only keys allowed to differ from src/config.js. They are product
// decisions ("what a fresh install feels like"), not tuning.
const PRODUCT_OVERRIDES = Object.freeze({
  capture: 'assist',
  delivery: 'context',
});

const patchText = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
const config = parsePatchConfig(patchText);

test('bundle patch inserts tabellio-dsh and parses', () => {
  assert.match(patchText, /- insert:/);
  assert.match(patchText, /id: tabellio\b/);
  assert.match(patchText, /name: tabellio-dsh\b/);
  assert.ok(Object.keys(config).length > 0, 'config block must not be empty');
});

test('bundle patch only repeats library defaults or the product allowlist', () => {
  const normalized = normalizeConfig(config);
  for (const [key, value] of Object.entries(config)) {
    assert.ok(key in DEFAULTS, `unknown config key in patch: ${key}`);
    if (key in PRODUCT_OVERRIDES) {
      assert.deepEqual(value, PRODUCT_OVERRIDES[key], `${key} must stay at the product choice`);
      continue;
    }
    assert.deepEqual(
      normalized[key],
      DEFAULTS[key],
      `${key} is pinned to ${JSON.stringify(value)} in cordis.patch.yml but the library default is ` +
        `${JSON.stringify(DEFAULTS[key])}; edit src/config.js instead, or add it to PRODUCT_OVERRIDES if it is a product choice`,
    );
  }
});

test('recall tuning is not pinned by the bundle patch', () => {
  // Named explicitly because this exact drift shipped once: it made every new
  // install answer 63.7% instead of 76.3% on bench/user-sim.
  for (const key of ['recallBudgetTokens', 'recallMaxNotes', 'recallMinCoverage', 'recallMinRelevance', 'recallMinScore', 'recallConfidentRelevance', 'judge']) {
    assert.equal(config[key], undefined, `${key} must not be pinned in cordis.patch.yml`);
  }
});

test('the patch result is the documented fresh-install config', () => {
  // Compare against the same normalizer applied to no config at all, so home
  // expansion and omitted empty keys do not make this a string-equality test.
  const baseline = normalizeConfig({});
  assert.deepEqual(normalizeConfig(config), { ...baseline, ...PRODUCT_OVERRIDES });
});
