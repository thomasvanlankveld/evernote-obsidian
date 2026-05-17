import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSnapshotArgs } from './snapshotCommand.ts';

describe('parseSnapshotArgs', () => {
  const cwd = '/tmp/test-cwd';

  it('requires --db', () => {
    const parsed = parseSnapshotArgs([], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /--db/);
    }
  });

  it('parses --db and default --out path', () => {
    const parsed = parseSnapshotArgs(['--db', './backup.db'], cwd);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.snapshot.dbPath, `${cwd}/backup.db`);
      assert.equal(parsed.snapshot.outPath, `${cwd}/out/evernote-notes.json`);
    }
  });

  it('parses --out and --max-notes', () => {
    const parsed = parseSnapshotArgs(
      ['--db', './backup.db', '--out', './custom.json', '--max-notes', '10'],
      cwd,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.snapshot.outPath, `${cwd}/custom.json`);
      assert.equal(parsed.snapshot.maxRecords, 10);
    }
  });

  it('rejects unknown flags', () => {
    const parsed = parseSnapshotArgs(['--db', './backup.db', '--nope'], cwd);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.message, /unknown snapshot flag/);
    }
  });
});
