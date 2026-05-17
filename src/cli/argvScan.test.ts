import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathFlagHandler, scanArgv, vaultDirArgHandler } from './argvScan.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

describe('argvScan', () => {
  it('scanArgv dispatches vault and path flags in one pass', () => {
    let mapPath: string | undefined;
    const scanned = scanArgv(['--vault-dir', './v', '--map', './map.json'], '/cwd', {
      subcommand: 'rewrite',
      handlers: [
        vaultDirArgHandler(),
        pathFlagHandler('map', './out/link-map.json', (path) => {
          mapPath = path;
        }),
      ],
    });
    assert.equal(scanned.ok, true);
    if (scanned.ok) {
      assert.equal(resolveVaultRootFromState(scanned.vaultState, '/cwd'), '/cwd/v');
      assert.equal(mapPath, '/cwd/map.json');
    }
  });

  it('scanArgv rejects unknown flags when not permissive', () => {
    const scanned = scanArgv(['--nope'], '/cwd', {
      subcommand: 'index',
      handlers: [vaultDirArgHandler()],
    });
    assert.equal(scanned.ok, false);
    if (!scanned.ok) {
      assert.match(scanned.message, /unknown index flag/);
    }
  });

  it('scanArgv ignores unknown flags in permissive mode', () => {
    const scanned = scanArgv(['--extra', '--vault', './v'], '/cwd', {
      permissive: true,
      handlers: [vaultDirArgHandler()],
    });
    assert.equal(scanned.ok, true);
    if (scanned.ok) {
      assert.equal(scanned.vaultState.explicitPath, '/cwd/v');
    }
  });
});
