import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGE_KEYS, resolveLang, translator } from '../src/lib/i18n.ts';
import { fontStack, isFontId, systemFontId, themeById } from '../src/lib/palette.ts';
import { fileStamp, noteStamp } from '../src/lib/stamp.ts';
import { DEFAULT_UI, normalizeUi } from '../src/lib/ui-settings.ts';

test('missing or broken look settings fall back to the defaults', () => {
  assert.deepEqual(normalizeUi(undefined), DEFAULT_UI);
  assert.deepEqual(normalizeUi('nope'), DEFAULT_UI);
  assert.deepEqual(
    normalizeUi({
      font: 'comic',
      fontSize: 400,
      textColor: 9,
      theme: 'pink',
      penColor: 1.5,
      penSize: 7,
      spellcheck: 'yes',
    }),
    { ...DEFAULT_UI, fontSize: 72 },
  );
});

test('valid look settings are kept', () => {
  const ui = {
    font: systemFontId('Segoe UI'),
    fontSize: 30,
    textColor: 3,
    theme: 'green',
    penColor: 1,
    penSize: 10,
    spellcheck: true,
    escHides: false,
  };
  assert.deepEqual(normalizeUi(ui), ui);
});

test('installed fonts are quoted safely', () => {
  assert.equal(isFontId(systemFontId('My "Fancy", Font')), true);
  assert.equal(isFontId('system:   '), false);
  assert.equal(isFontId('mystery'), false);
  assert.equal(fontStack(systemFontId('My "Fancy", Font')), '"My \\"Fancy\\", Font", system-ui, sans-serif');
  assert.match(fontStack('script'), /^"Caveat"/);
  assert.match(fontStack('unknown'), /^"Patrick Hand"/);
  assert.equal(themeById('unknown').id, 'black');
});

// The type checker already makes sure Italian has every message.
test('both languages use the same placeholders', () => {
  const en = translator('en');
  const it = translator('it');
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.ok(MESSAGE_KEYS.length > 50);
  for (const key of MESSAGE_KEYS) {
    assert.ok(it(key).length > 0, key);
    assert.deepEqual(placeholders(it(key)), placeholders(en(key)), key);
  }
});

test('the interface text avoids long dashes', () => {
  for (const lang of ['en', 'it'] as const) {
    const t = translator(lang);
    for (const key of MESSAGE_KEYS) assert.doesNotMatch(t(key), /—/, `${lang} ${key}`);
  }
});

test('language follows the setting, then the system', () => {
  assert.equal(resolveLang('it', 'en-US'), 'it');
  assert.equal(resolveLang('auto', 'it-CH'), 'it');
  assert.equal(resolveLang('auto', 'fr-FR'), 'en');
  assert.equal(translator('it')('settings.title'), 'Impostazioni');
  assert.equal(translator('en')('tool.pen', { key: 'Ctrl+D' }), 'Draw (Ctrl+D)');
});

test('stamps', () => {
  const date = new Date(2026, 9, 3, 7, 5, 9);
  assert.equal(fileStamp(date), '2026-10-03_07-05-09');
  assert.match(noteStamp(date, 'it-IT'), /03\/10\/26.*07:05/);
});
