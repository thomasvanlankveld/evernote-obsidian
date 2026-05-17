import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
