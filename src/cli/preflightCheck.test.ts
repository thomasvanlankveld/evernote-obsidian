import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPreflightWarnings,
  formatPreflightHuman,
  PREFLIGHT_COUNT_DELTA_THRESHOLD,
} from './preflightCheck.ts';

describe('preflightCheck', () => {
  it('emits no warnings when counts are within threshold', () => {
    assert.deepEqual(buildPreflightWarnings(100, 103), []);
    assert.deepEqual(buildPreflightWarnings(100, 95), []);
  });

  it('warns when Evernote count exceeds vault by more than threshold', () => {
    const warnings = buildPreflightWarnings(10, 10 + PREFLIGHT_COUNT_DELTA_THRESHOLD + 1);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'evernote_more_than_vault');
  });

  it('warns when vault count exceeds Evernote by more than threshold', () => {
    const warnings = buildPreflightWarnings(10 + PREFLIGHT_COUNT_DELTA_THRESHOLD + 1, 10);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'vault_more_than_evernote');
  });

  it('formats human output with counts and hints', () => {
    const text = formatPreflightHuman({
      vaultRoot: './data',
      vaultMarkdown: 3,
      evernoteNotes: 2,
      evernoteLabel: './out/evernote-notes.json',
      warnings: buildPreflightWarnings(3, 2),
    });
    assert.match(text, /Vault:\s+3 markdown/);
    assert.match(text, /Evernote:\s+2 note/);
    assert.match(text, /hints only/);
  });
});
