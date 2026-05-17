import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advancePastVaultDirFlag,
  applyVaultDirFlag,
  createVaultDirFlagState,
  parseVaultRootFromArgs,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

describe('vaultDirFlag', () => {
  it('resolveVaultRootFromState uses default data directory', () => {
    const path = resolveVaultRootFromState(createVaultDirFlagState(), '/cwd');
    assert.equal(path, '/cwd/data');
  });

  it('applyVaultDirFlag accepts --vault alias', () => {
    const applied = applyVaultDirFlag(
      '--vault',
      ['--vault', './v'],
      0,
      '/cwd',
      createVaultDirFlagState(),
    );
    assert.equal(applied.kind, 'handled');
    if (applied.kind === 'handled') {
      assert.equal(applied.state.explicitPath, '/cwd/v');
    }
  });

  it('applyVaultDirFlag accepts --vault-dir', () => {
    const applied = applyVaultDirFlag(
      '--vault-dir',
      ['--vault-dir', './v'],
      0,
      '/cwd',
      createVaultDirFlagState(),
    );
    assert.equal(applied.kind, 'handled');
    if (applied.kind === 'handled') {
      assert.equal(applied.state.explicitPath, '/cwd/v');
    }
  });

  it('advancePastVaultDirFlag skips spaced and equals vault flags', () => {
    const spaced = advancePastVaultDirFlag('--vault-dir', ['--vault-dir', './v'], 0);
    assert.equal(spaced.kind, 'advanced');
    if (spaced.kind === 'advanced') {
      assert.equal(spaced.nextIndex, 1);
    }
    const alias = advancePastVaultDirFlag('--vault', ['--vault', './v'], 0);
    assert.equal(alias.kind, 'advanced');
    if (alias.kind === 'advanced') {
      assert.equal(alias.nextIndex, 1);
    }
    const eq = advancePastVaultDirFlag('--vault-dir=./v', ['--vault-dir=./v'], 0);
    assert.equal(eq.kind, 'advanced');
    if (eq.kind === 'advanced') {
      assert.equal(eq.nextIndex, 0);
    }
    const other = advancePastVaultDirFlag('--snapshot', ['--snapshot', 's.json'], 0);
    assert.equal(other.kind, 'not-vault-flag');
  });

  it('parseVaultRootFromArgs resolves vault flags once (last wins)', () => {
    const parsed = parseVaultRootFromArgs(
      ['--db', 'x.db', '--vault-dir', './first', '--vault', './second'],
      '/cwd',
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.vaultRoot, '/cwd/second');
    }
  });
});
