import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRunArgs } from './runCommand.ts';

describe('parseRunArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('sets snapshotOutPath and mapOutPath from --out', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--out', './snap.json', '--map-out', './map.json'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.snapshotOutPath, `${cwd}/snap.json`);
      assert.equal(parsed.run.mapOutPath, `${cwd}/map.json`);
    }
  });

  it('sets snapshotOutPath from --out when map-out is omitted', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--out', './snap.json'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.snapshotOutPath, `${cwd}/snap.json`);
      assert.equal(parsed.run.mapOutPath, `${cwd}/snap.json`);
    }
  });

  it('lets --map-out override mapOutPath after --out', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--out', './both.json', '--map-out', './map.json'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.snapshotOutPath, `${cwd}/both.json`);
      assert.equal(parsed.run.mapOutPath, `${cwd}/map.json`);
    }
  });

  it('lets --out override mapOutPath when it appears after --map-out', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--map-out', './map.json', '--out', './both.json'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.snapshotOutPath, `${cwd}/both.json`);
      assert.equal(parsed.run.mapOutPath, `${cwd}/both.json`);
    }
  });
});
