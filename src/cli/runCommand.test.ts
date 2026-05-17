import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRunArgs } from './runCommand.ts';

describe('parseRunArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('requires --vault-dir', () => {
    const parsed = parseRunArgs(['--db', './db'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--vault-dir/);
    }
  });

  it('requires --db, --snapshot, or --map', () => {
    const parsed = parseRunArgs(['--vault-dir', './v'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--db/);
    }
  });

  it('accepts --db and --map without --snapshot', () => {
    const parsed = parseRunArgs(['--vault-dir', './v', '--db', './db', '--map', './map.json'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.dbPath, `${cwd}/db`);
      assert.equal(parsed.run.mapPath, `${cwd}/map.json`);
      assert.equal(parsed.run.snapshotPath, undefined);
    }
  });

  it('rejects unknown flags', () => {
    const parsed = parseRunArgs(['--vault-dir', './v', '--db', './db', '--nope'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /unknown run flag/);
    }
  });

  it('parses --skip-unescape-links', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--skip-unescape-links'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.skipUnescapeLinks, true);
    }
  });

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

  it('parses run output flags', () => {
    const parsed = parseRunArgs(
      ['--vault-dir', './v', '--db', './db', '--json', '--quiet', '--progress'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.output.json, true);
      assert.equal(parsed.run.output.quiet, true);
      assert.equal(parsed.run.output.progress, true);
    }
  });

  it('parses --json-steps', () => {
    const parsed = parseRunArgs(['--vault-dir', './v', '--db', './db', '--json-steps'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.run.output.jsonSteps, true);
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
