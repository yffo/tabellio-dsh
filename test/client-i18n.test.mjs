// The settings panel renders raw keys when a translation is missing (this
// happened with the header chip), and an undefined palette entry silently
// drops styling (the judge review badges). Both are static properties of
// client.js, so they can be pinned without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

function block(startMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'missing ' + startMarker);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error('unterminated ' + startMarker);
}

const keysIn = (text) => {
  const keys = new Set();
  for (const match of text.matchAll(/(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) keys.add(match[1]);
  return keys;
};

const zh = keysIn(block('const zh = {'));
const en = keysIn(block('const en = {'));
const used = new Set();
for (const match of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(match[1]);

test('every translation used by the panel exists in both dictionaries', () => {
  const missingZh = [...used].filter((key) => !zh.has(key)).sort();
  const missingEn = [...used].filter((key) => !en.has(key)).sort();
  assert.deepEqual(missingZh, [], 'missing zh keys: ' + missingZh.join(', '));
  assert.deepEqual(missingEn, [], 'missing en keys: ' + missingEn.join(', '));
});

test('every palette entry and ui style referenced by the panel is defined', () => {
  const colors = keysIn(block('const COLORS = {'));
  const ui = keysIn(block('const ui = {'));
  const colorRefs = new Set();
  for (const match of src.matchAll(/COLORS\.([A-Za-z0-9_]+)/g)) colorRefs.add(match[1]);
  const uiRefs = new Set();
  for (const match of src.matchAll(/\bui\.([A-Za-z0-9_]+)/g)) uiRefs.add(match[1]);
  const missingColors = [...colorRefs].filter((key) => !colors.has(key)).sort();
  const missingUi = [...uiRefs].filter((key) => !ui.has(key)).sort();
  assert.deepEqual(missingColors, [], 'undefined COLORS: ' + missingColors.join(', '));
  assert.deepEqual(missingUi, [], 'undefined ui styles: ' + missingUi.join(', '));
});
