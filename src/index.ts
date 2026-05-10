/**
 * Public library entry for vault indexing, Evernote metadata, link extraction, correlation, and rewrite.
 */

export type { EvernoteClientOptionsFromHost } from './evernote/evernoteHost.ts';
export { evernoteClientOptionsFromHost } from './evernote/evernoteHost.ts';
export { type FetchNoteRecordsOptions, fetchAllNoteRecords } from './evernote/fetchNoteRecords.ts';
export type { EvernoteNoteSnapshot, NoteRecord } from './evernote/noteRecord.ts';
export {
  buildSnapshotEnvelope,
  parseSnapshotJson,
  readSnapshotFile,
  writeSnapshotFile,
} from './evernote/snapshotFile.ts';
export type {
  VaultIndexCollision,
  VaultIndexEntry,
  VaultIndexResult,
} from './vault/vaultIndex.ts';
export {
  buildVaultIndex,
  normalizeTitle,
  parseFrontmatterTitle,
  VaultIndexRootError,
} from './vault/vaultIndex.ts';
