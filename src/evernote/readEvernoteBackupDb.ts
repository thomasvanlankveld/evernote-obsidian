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
    if (!tableExists(db, 'notes')) {
      throw new Error(
        'evernote-backup database: missing `notes` table (is this an evernote-backup SQLite file?)',
      );
    }
    const hasNotebookJoin =
      tableExists(db, 'notebooks') && tableHasColumn(db, 'notes', 'notebook_guid');

    const where = [
      'WHERE COALESCE(notes.is_active, 1) != 0',
      "AND notes.guid IS NOT NULL AND notes.guid != ''",
      'AND notes.title IS NOT NULL',
    ].join(' ');

    const from = hasNotebookJoin
      ? 'notes LEFT JOIN notebooks ON notebooks.guid = notes.notebook_guid'
      : 'notes';
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM ${from} ${where}`).get() as {
      c: number;
    };
    const sourceRowCount = Number(countRow.c);

    const select = hasNotebookJoin
      ? [
          'SELECT notes.guid, notes.title,',
          'notebooks.name AS notebook_name, notebooks.stack AS notebook_stack',
          `FROM ${from}`,
        ].join(' ')
      : [
          'SELECT notes.guid, notes.title,',
          'NULL AS notebook_name, NULL AS notebook_stack',
          `FROM ${from}`,
        ].join(' ');
    const sqlParts = [select, where, 'ORDER BY notes.title COLLATE NOCASE'];
    if (opts?.maxRecords !== undefined) {
      sqlParts.push('LIMIT ?');
    }
    const sql = sqlParts.join(' ');

    const stmt = db.prepare(sql);
    const rows = (opts?.maxRecords !== undefined ? stmt.all(opts.maxRecords) : stmt.all()) as {
      guid: string;
      title: string;
      notebook_name: string | null;
      notebook_stack: string | null;
    }[];

    const out: NoteRecord[] = rows.map((row) => ({
      guid: normalizeEvernoteGuid(row.guid),
      title: row.title,
      updated: UPDATED_UNKNOWN,
      ...(row.notebook_name !== null && row.notebook_name.trim() !== ''
        ? {
            notebook: {
              name: row.notebook_name,
              ...(row.notebook_stack !== null && row.notebook_stack.trim() !== ''
                ? { stack: row.notebook_stack }
                : {}),
            },
          }
        : {}),
    }));
    return { records: out, sourceRowCount };
  } finally {
    db.close();
  }
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName),
  );
}

function tableHasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return rows.some((row) => row.name === columnName);
}
