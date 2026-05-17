/** Canonical Evernote note GUID key shape (lowercase) for maps and lookups. */
export function normalizeEvernoteGuid(guid: string): string {
  return guid.toLowerCase();
}

/**
 * Minimal Evernote note metadata for title ↔ vault correlation (Phase 3+).
 * Content is not stored in the snapshot.
 */
export interface NoteRecord {
  /**
   * Evernote note GUID. Lowercase after any ingestion path (`readNoteRecordsFromEvernoteBackupDb`,
   * `parseSnapshotJson`, `buildSnapshotEnvelope`, etc.); use {@link normalizeEvernoteGuid} for maps.
   */
  guid: string;
  title: string;
  /**
   * ISO 8601 UTC from Evernote when available.
   * Snapshots built from evernote-backup SQLite use the sentinel `1970-01-01T00:00:00.000Z` because `updated`
   * is only stored inside Python-pickled `raw_note` blobs in that database.
   */
  updated: string;
}

/** On-disk JSON envelope for idempotent pipeline steps and rate-limit friendly reruns. */
export interface EvernoteNoteSnapshot {
  version: 1;
  /** When this file was written (ISO 8601 UTC). */
  writtenAt: string;
  /** Metadata origin: e.g. `evernote-backup` for SQLite snapshots, or a former API host string. */
  host: string;
  notes: NoteRecord[];
}
