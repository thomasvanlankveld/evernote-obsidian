import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { type NoteRecord, normalizeEvernoteGuid } from './noteRecord.ts';

const UPDATED_UNKNOWN = '1970-01-01T00:00:00.000Z';

export interface ReadEvernoteBackupDbOptions {
  /** When set, only the first N rows (after ordering by title) are returned. */
  maxRecords?: number | undefined;
}

/**
 * Read note metadata from an [evernote-backup](https://github.com/vzhd1701/evernote-backup) SQLite file.
 *
 * The backup stores `updated` only inside pickled `raw_note` blobs (Python); this reader uses SQL only,
 * so `updated` is filled with a documented sentinel {@link UPDATED_UNKNOWN_ISO_SENTINEL}.
 */
export const UPDATED_UNKNOWN_ISO_SENTINEL = UPDATED_UNKNOWN;

/**
 * @param dbPath Absolute or cwd-relative path to the `.db` file (e.g. from `evernote-backup init-db`).
 */
export interface ReadEvernoteBackupDbResult {
  records: NoteRecord[];
  /** Rows matching the active-note filter (before --max-notes cap). */
  sourceRowCount: number;
}

/**
 * @param dbPath Absolute or cwd-relative path to the `.db` file (e.g. from `evernote-backup init-db`).
 */
export function readNoteRecordsFromEvernoteBackupDb(
  dbPath: string,
  opts?: ReadEvernoteBackupDbOptions,
): ReadEvernoteBackupDbResult {
  if (!existsSync(dbPath)) {
    throw new Error(`evernote-backup database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'")
      .get();
    if (!tableCheck) {
      throw new Error(
        'evernote-backup database: missing `notes` table (is this an evernote-backup SQLite file?)',
      );
    }

    const where = [
      'WHERE COALESCE(is_active, 1) != 0',
      "AND guid IS NOT NULL AND guid != ''",
      'AND title IS NOT NULL',
    ].join(' ');

    const countRow = db.prepare(`SELECT COUNT(*) as c FROM notes ${where}`).get() as { c: number };
    const sourceRowCount = Number(countRow.c);

    const sql = ['SELECT guid, title FROM notes', where, 'ORDER BY title COLLATE NOCASE'].join(' ');

    const stmt = db.prepare(sql);
    const rows = stmt.all() as { guid: string; title: string }[];

    const out: NoteRecord[] = [];
    for (const row of rows) {
      out.push({
        guid: normalizeEvernoteGuid(row.guid),
        title: row.title,
        updated: UPDATED_UNKNOWN,
      });
      if (opts?.maxRecords !== undefined && out.length >= opts.maxRecords) {
        break;
      }
    }
    return { records: out, sourceRowCount };
  } finally {
    db.close();
  }
}
