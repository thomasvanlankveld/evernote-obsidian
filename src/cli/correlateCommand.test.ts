import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCorrelateArgs } from './correlateCommand.ts';

describe('parseCorrelateArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('requires --snapshot', () => {
    const parsed = parseCorrelateArgs(['--vault-dir', './v'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--snapshot/);
    }
  });

  it('rejects --map', () => {
    const parsed = parseCorrelateArgs(
      ['--vault-dir', './v', '--snapshot', './snap.json', '--map', './map.json'],
      cwd,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /correlate does not accept --map/);
    }
  });

  it('parses vault, snapshot, and default out path', () => {
    const parsed = parseCorrelateArgs(['--vault-dir', './v', '--snapshot', './snap.json'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.correlate.vaultRoot, `${cwd}/v`);
      assert.equal(parsed.correlate.snapshotPath, `${cwd}/snap.json`);
      assert.equal(parsed.correlate.outPath, `${cwd}/out/link-map.json`);
    }
  });

  it('rejects unknown flags', () => {
    const parsed = parseCorrelateArgs(
      ['--vault-dir', './v', '--snapshot', './snap.json', '--nope'],
      cwd,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /unknown correlate flag/);
    }
  });
});
