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
    CREATE TABLE notebooks(
      guid TEXT PRIMARY KEY,
      name TEXT,
      stack TEXT
    );
    INSERT INTO notebooks(guid, name, stack) VALUES
      ('nb-a', 'Notebook A', 'Stack One'),
      ('nb-b', 'Notebook B', NULL);
    INSERT INTO notes(guid, title, notebook_guid, is_active) VALUES
      ('g-trash', 'Trashed', 'nb-a', 0),
      ('g-a', 'Alpha', 'nb-a', 1),
      ('g-b', 'Beta', 'nb-b', 1),
      ('g-null', 'Pending', NULL, NULL);
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
      assert.deepEqual(records[0]?.notebook, { name: 'Notebook A', stack: 'Stack One' });
      assert.deepEqual(records[1]?.notebook, { name: 'Notebook B' });
      assert.equal(records[2]?.notebook, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lowercases GUIDs from SQLite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-backup-read-'));
    const dbPath = join(dir, 'upper.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(guid TEXT PRIMARY KEY, title TEXT, is_active BOOLEAN);
      INSERT INTO notes(guid, title, is_active) VALUES
        ('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', 'Upper GUID', 1);
    `);
    db.close();
    try {
      const { records } = readNoteRecordsFromEvernoteBackupDb(dbPath);
      assert.equal(records.length, 1);
      assert.equal(records[0]?.guid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
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
