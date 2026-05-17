import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRewriteArgs } from './rewriteCommand.ts';

describe('parseRewriteArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('requires --map', () => {
    const parsed = parseRewriteArgs(['--vault-dir', './v'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--map/);
    }
  });

  it('defaults to dry-run mode', () => {
    const parsed = parseRewriteArgs(['--vault-dir', './v', '--map', './map.json'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.rewrite.mode, 'dry-run');
      assert.equal(parsed.rewrite.mapPath, `${cwd}/map.json`);
    }
  });

  it('rejects --dry-run combined with --out-dir', () => {
    const parsed = parseRewriteArgs(
      ['--vault-dir', './v', '--map', './map.json', '--dry-run', '--out-dir', './out'],
      cwd,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--dry-run/);
    }
  });

  it('parses --in-place with --backup', () => {
    const parsed = parseRewriteArgs(
      ['--vault-dir', './v', '--map', './map.json', '--in-place', '--backup'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.rewrite.mode, 'in-place');
      assert.equal(parsed.rewrite.backup, true);
    }
  });
});
