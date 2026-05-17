import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGuidBackfillArgs } from './guidBackfillCommand.ts';

describe('parseGuidBackfillArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('requires --snapshot', () => {
    const parsed = parseGuidBackfillArgs(['--vault-dir', './v'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--snapshot/);
    }
  });

  it('defaults to dry-run', () => {
    const parsed = parseGuidBackfillArgs(['--vault-dir', './v', '--snapshot', './snap.json'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.guidBackfill.mode, 'dry-run');
    }
  });

  it('parses --in-place', () => {
    const parsed = parseGuidBackfillArgs(
      ['--vault-dir', './v', '--snapshot', './snap.json', '--in-place'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.guidBackfill.mode, 'in-place');
    }
  });

  it('rejects --out-dir', () => {
    const parsed = parseGuidBackfillArgs(
      ['--vault-dir', './v', '--snapshot', './snap.json', '--out-dir', './out'],
      cwd,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /does not accept --out-dir/);
    }
  });

  it('rejects unknown flags', () => {
    const parsed = parseGuidBackfillArgs(
      ['--vault-dir', './v', '--snapshot', './snap.json', '--nope'],
      cwd,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /unknown guid-backfill flag/);
    }
  });
});
