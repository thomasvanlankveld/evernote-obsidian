import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  readNoteRecordsFromEvernoteBackupDb,
  UPDATED_UNKNOWN_ISO_SENTINEL,
} from './readEvernoteBackupDb.ts';

function createBackupDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE notes(
      guid TEXT PRIMARY KEY,
      title TEXT,
      notebook_guid TEXT,
      is_active BOOLEAN,
      raw_note BLOB
    );
    INSERT INTO notes(guid, title, is_active) VALUES
      ('g-trash', 'Trashed', 0),
      ('g-a', 'Alpha', 1),
      ('g-b', 'Beta', 1),
      ('g-null', 'Pending', NULL);
  `);
  db.close();
}

describe('readNoteRecordsFromEvernoteBackupDb', () => {
  it('reads active and pending notes, excludes trash, orders by title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-backup-read-'));
    const dbPath = join(dir, 'en.db');
    try {
      createBackupDb(dbPath);
      const { records, sourceRowCount } = readNoteRecordsFromEvernoteBackupDb(dbPath);
      assert.equal(sourceRowCount, 3);
      assert.equal(records.length, 3);
      assert.deepEqual(
        records.map((r) => r.guid),
        ['g-a', 'g-b', 'g-null'],
      );
      for (const r of records) {
        assert.equal(r.updated, UPDATED_UNKNOWN_ISO_SENTINEL);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('respects maxRecords', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-backup-read-'));
    const dbPath = join(dir, 'en2.db');
    try {
      createBackupDb(dbPath);
      const { records, sourceRowCount } = readNoteRecordsFromEvernoteBackupDb(dbPath, {
        maxRecords: 2,
      });
      assert.equal(sourceRowCount, 3);
      assert.equal(records.length, 2);
      assert.deepEqual(
        records.map((r) => r.guid),
        ['g-a', 'g-b'],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when notes table is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-backup-read-'));
    const dbPath = join(dir, 'wrong.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE other(x INT);');
    db.close();
    try {
      assert.throws(() => readNoteRecordsFromEvernoteBackupDb(dbPath), /missing `notes` table/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
