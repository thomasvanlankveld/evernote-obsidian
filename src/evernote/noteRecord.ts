/**
 * Minimal Evernote note metadata for title ↔ vault correlation (Phase 3+).
 * Content is not stored in the snapshot.
 */
export interface NoteRecord {
  guid: string;
  title: string;
  /** ISO 8601 UTC, from Evernote note `updated` (ms) */
  updated: string;
}

/** On-disk JSON envelope for idempotent pipeline steps and rate-limit friendly reruns. */
export interface EvernoteNoteSnapshot {
  version: 1;
  /** When this file was written (ISO 8601 UTC). */
  writtenAt: string;
  /** Service host used for the API (e.g. www.evernote.com). */
  host: string;
  notes: NoteRecord[];
}
