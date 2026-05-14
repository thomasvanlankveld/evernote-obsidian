/**
 * Public library entry for vault indexing, Evernote metadata, link extraction, correlation, and rewrite.
 */

export type { EvernoteNoteSnapshot, NoteRecord } from './evernote/noteRecord.ts';
export {
  type ReadEvernoteBackupDbOptions,
  type ReadEvernoteBackupDbResult,
  readNoteRecordsFromEvernoteBackupDb,
  UPDATED_UNKNOWN_ISO_SENTINEL,
} from './evernote/readEvernoteBackupDb.ts';
export {
  buildSnapshotEnvelope,
  parseSnapshotJson,
  readSnapshotFile,
  writeSnapshotFile,
} from './evernote/snapshotFile.ts';
export type {
  BrokenLink,
  ScanEvernoteLinksOptions,
} from './vault/extractEvernoteLinks.ts';
export {
  classifyEvernoteUrl,
  extractEvernoteLinksFromMarkdown,
  scanVaultForEvernoteLinks,
  tryParseNoteGuidFromUrl,
} from './vault/extractEvernoteLinks.ts';
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
  walkVaultMarkdownFiles,
} from './vault/vaultIndex.ts';
