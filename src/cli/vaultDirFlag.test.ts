import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

describe('vaultDirFlag', () => {
  it('resolveVaultRootFromState uses default data directory', () => {
    const path = resolveVaultRootFromState(createVaultDirFlagState(), '/cwd');
    assert.equal(path, '/cwd/data');
  });

  it('applyVaultDirFlag marks --vault as deprecated', () => {
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
      assert.equal(applied.state.usedDeprecatedAlias, true);
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
      assert.equal(applied.state.usedDeprecatedAlias, false);
    }
  });
});
