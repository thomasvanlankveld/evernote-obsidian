/**
 * Public library entry for vault indexing, Evernote metadata, link extraction, correlation, and rewrite.
 */

export type {
  CorrelateResult,
  DuplicateTargetPath,
  EvernoteTitleCollision,
  InvalidOverride,
  UnmatchedNote,
  VaultIndexForCorrelation,
} from './correlation/correlate.ts';
export {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from './correlation/correlate.ts';
export type { LinkMapFile } from './correlation/linkMapFile.ts';
export {
  buildLinkMapFile,
  LinkMapParseError,
  parseLinkMapJson,
} from './correlation/linkMapFile.ts';
export { parseCorrelationOverridesJson } from './correlation/overridesFile.ts';
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
  MergedEvernoteUrlSpan,
  ScanEvernoteLinksOptions,
} from './vault/extractEvernoteLinks.ts';
export {
  classifyEvernoteUrl,
  extractEvernoteLinksFromMarkdown,
  mergeEvernoteUrlSpans,
  scanVaultForEvernoteLinks,
  tryParseNoteGuidFromUrl,
} from './vault/extractEvernoteLinks.ts';
export type { RewriteMarkdownResult } from './vault/rewriteEvernoteLinks.ts';
export { rewriteMarkdownWithGuidMap } from './vault/rewriteEvernoteLinks.ts';
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
