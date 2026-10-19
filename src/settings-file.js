/**
 * Panel-editable settings. These live next to the memory store (not in the
 * host profile) so they are portable with the store and safe to edit without
 * touching host YAML. Plugin config stays the default; this file overrides it.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_FILE = 'panel-settings.json';
export const SETTING_KEYS = ['semantic', 'semanticEndpoint', 'semanticModel', 'judge', 'judgeModel', 'judgeProvider', 'consolidate', 'capture', 'delivery', 'recallMaxNotes'];

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Keep only known keys with the right types; anything else is ignored. */
export function pickPanelSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (raw.semantic === 'off' || raw.semantic === 'local') out.semantic = raw.semantic;
  if (raw.judge === 'off' || raw.judge === 'llm') out.judge = raw.judge;
  if (raw.consolidate === 'off' || raw.consolidate === 'daily' || raw.consolidate === 'weekly') out.consolidate = raw.consolidate;
  if (typeof raw.semanticEndpoint === 'string') out.semanticEndpoint = str(raw.semanticEndpoint, 200);
  if (typeof raw.semanticModel === 'string') out.semanticModel = str(raw.semanticModel, 120);
  if (typeof raw.judgeModel === 'string') out.judgeModel = str(raw.judgeModel, 120);
  if (typeof raw.judgeProvider === 'string') out.judgeProvider = str(raw.judgeProvider, 80);
  if (['off', 'explicit', 'implicit', 'assist'].includes(raw.capture)) out.capture = raw.capture;
  if (raw.delivery === 'notice' || raw.delivery === 'context') out.delivery = raw.delivery;
  if (Number.isInteger(raw.recallMaxNotes) && raw.recallMaxNotes >= 1 && raw.recallMaxNotes <= 20) out.recallMaxNotes = raw.recallMaxNotes;
  return out;
}

export function loadPanelSettings(store) {
  try {
    const file = path.join(store.store, SETTINGS_FILE);
    return pickPanelSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
}

export function savePanelSettings(store, patch) {
  const file = path.join(store.store, SETTINGS_FILE);
  const merged = { ...loadPanelSettings(store), ...pickPanelSettings(patch) };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return merged;
}

export function panelSettingsView(settings) {
  return {
    semantic: { mode: settings.semantic === 'local' ? 'local' : 'off', endpoint: settings.semanticEndpoint, model: settings.semanticModel },
    judge: { mode: settings.judge === 'llm' ? 'llm' : 'off', provider: settings.judgeProvider, model: settings.judgeModel },
    consolidate: { mode: settings.consolidate },
    capture: { mode: settings.capture },
    delivery: { mode: settings.delivery },
    recallMaxNotes: settings.recallMaxNotes,
  };
}
