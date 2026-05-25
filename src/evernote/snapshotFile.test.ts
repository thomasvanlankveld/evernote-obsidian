import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSnapshotEnvelope,
  parseSnapshotJson,
  readSnapshotFile,
  writeSnapshotFile,
} from './snapshotFile.ts';

const evernoteDir = dirname(fileURLToPath(import.meta.url));
const redactedFixture = join(evernoteDir, '__fixtures__', 'snapshot.redacted.json');

describe('snapshotFile', () => {
  it('parses redacted fixture', async () => {
    const raw = await readFile(redactedFixture, 'utf8');
    const snap = parseSnapshotJson(raw);
    assert.equal(snap.version, 1);
    assert.equal(snap.host, 'www.evernote.com');
    assert.equal(snap.notes.length, 2);
    assert.equal(snap.notes[0]?.guid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(snap.notes[1]?.title, 'Second title for tests');
  });

  it('readSnapshotFile matches fixture', async () => {
    const snap = await readSnapshotFile(redactedFixture);
    assert.equal(snap.notes.length, 2);
  });

  it('buildSnapshotEnvelope + round-trip write/read', async () => {
    const dir = join(evernoteDir, '__fixtures__', '.tmp-snapshot-test');
    const path = join(dir, 'snap.json');
    await mkdir(dir, { recursive: true });
    const env = buildSnapshotEnvelope('sandbox.evernote.com', [
      { guid: 'g1', title: 'T1', updated: '2026-05-10T00:00:00.000Z' },
    ]);
    try {
      await writeSnapshotFile(path, env);
      const again = await readSnapshotFile(path);
      assert.equal(again.notes.length, 1);
      assert.equal(again.notes[0]?.guid, 'g1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parseSnapshotJson rejects bad version', () => {
    assert.throws(() => parseSnapshotJson('{"version":2,"host":"h","notes":[]}'), /version/);
  });

  it('parseSnapshotJson lowercases note GUIDs', () => {
    const snap = parseSnapshotJson(
      JSON.stringify({
        version: 1,
        host: 'h',
        notes: [
          {
            guid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
            title: 'T',
            updated: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    assert.equal(snap.notes[0]?.guid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('round-trips optional notebook metadata', () => {
    const snap = parseSnapshotJson(
      JSON.stringify({
        version: 1,
        host: 'h',
        notes: [
          {
            guid: 'g1',
            title: 'T',
            updated: '2026-01-01T00:00:00.000Z',
            notebook: { name: 'Notebook A', stack: 'Stack One' },
          },
        ],
      }),
    );
    assert.deepEqual(snap.notes[0]?.notebook, { name: 'Notebook A', stack: 'Stack One' });
  });
});
