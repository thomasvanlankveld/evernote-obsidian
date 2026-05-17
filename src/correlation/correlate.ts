import { type NoteRecord, normalizeEvernoteGuid } from '../evernote/noteRecord.ts';
import { normalizeTitle } from '../vault/vaultIndex.ts';

export interface EvernoteTitleCollision {
  normalizedTitle: string;
  guids: string[];
}

export interface UnmatchedNote {
  guid: string;
  title: string;
  normalizedTitle: string;
}

export interface InvalidOverride {
  guid: string;
  path: string;
  reason: 'unknown_path' | 'empty_path';
}

export interface DuplicateTargetPath {
  path: string;
  guids: string[];
}

export interface GuidTitleMismatch {
  guid: string;
  title: string;
  reason: 'paths_differ' | 'vault_guid_differs';
  guidPath?: string | undefined;
  titlePath?: string | undefined;
  vaultGuid?: string | undefined;
}

/** Snapshot row matched via Importer-truncated vault filename stem (prefix of normalized title). */
export interface TruncatedTitleMatch {
  guid: string;
  title: string;
  normalizedTitle: string;
  vaultNormalizedStem: string;
  path: string;
}

/** Two or more vault stems qualify as a prefix of the same snapshot normalized title. */
export interface TruncatedPrefixCollision {
  guid: string;
  title: string;
  normalizedTitle: string;
  candidateStems: string[];
  candidatePaths: string[];
}

/**
 * Minimum normalized stem length for truncated-prefix correlate.
 * Avoids spurious matches on very short shared prefixes when the vault file is missing.
 */
export const MIN_TRUNCATED_PREFIX_STEM_LENGTH = 12;

export type CorrelateResult =
  | { ok: true; guidToPath: ReadonlyMap<string, string>; truncatedMatches: TruncatedTitleMatch[] }
  | {
      ok: false;
      evernoteTitleCollisions: EvernoteTitleCollision[];
      unmatched: UnmatchedNote[];
      invalidOverrides: InvalidOverride[];
      duplicateTargetPaths: DuplicateTargetPath[];
      guidTitleMismatches: GuidTitleMismatch[];
      truncatedPrefixCollisions: TruncatedPrefixCollision[];
    };

export interface VaultIndexForCorrelation {
  byNormalizedTitle: ReadonlyMap<string, string>;
  byEvernoteGuid: ReadonlyMap<string, string>;
  /** Vault-relative path → lowercase Evernote GUID when frontmatter declares one */
  pathToEvernoteGuid: ReadonlyMap<string, string>;
  indexedPaths: ReadonlySet<string>;
}

export function vaultIndexResultToCorrelationInput(
  byNormalizedTitle: ReadonlyMap<string, string>,
  paths: readonly string[],
  byEvernoteGuid: ReadonlyMap<string, string> = new Map(),
  pathToEvernoteGuid: ReadonlyMap<string, string> = new Map(),
): VaultIndexForCorrelation {
  return {
    byNormalizedTitle,
    byEvernoteGuid,
    pathToEvernoteGuid,
    indexedPaths: new Set(paths),
  };
}

export type TruncatedPrefixLookup =
  | { kind: 'none' }
  | { kind: 'unique'; stem: string; path: string }
  | { kind: 'ambiguous'; stems: string[]; paths: string[] };

/**
 * Find a unique vault file whose normalized stem is a strict prefix of `snapshotNormTitle`
 * (Importer/OS filename truncation). Fails closed when zero or multiple candidates qualify.
 */
export function findTruncatedPrefixMatch(
  snapshotNormTitle: string,
  byNormalizedTitle: ReadonlyMap<string, string>,
  minStemLength: number = MIN_TRUNCATED_PREFIX_STEM_LENGTH,
): TruncatedPrefixLookup {
  if (snapshotNormTitle.length === 0) {
    return { kind: 'none' };
  }

  let unique: { stem: string; path: string } | undefined;
  const ambiguousStems: string[] = [];
  const ambiguousPaths: string[] = [];

  for (const [stem, path] of byNormalizedTitle) {
    if (stem.length < minStemLength || stem.length >= snapshotNormTitle.length) {
      continue;
    }
    if (!snapshotNormTitle.startsWith(stem)) {
      continue;
    }
    if (unique === undefined && ambiguousStems.length === 0) {
      unique = { stem, path };
      continue;
    }
    if (unique !== undefined) {
      ambiguousStems.push(unique.stem, stem);
      ambiguousPaths.push(unique.path, path);
      unique = undefined;
      continue;
    }
    ambiguousStems.push(stem);
    ambiguousPaths.push(path);
  }

  if (ambiguousStems.length > 0) {
    const stems = [...new Set(ambiguousStems)].sort();
    const paths = [...new Set(ambiguousPaths)].sort();
    return { kind: 'ambiguous', stems, paths };
  }
  if (unique !== undefined) {
    return { kind: 'unique', stem: unique.stem, path: unique.path };
  }
  return { kind: 'none' };
}

/**
 * Join Evernote snapshot rows to vault paths: **GUID from vault frontmatter** when present,
 * else {@link normalizeTitle} (Importer-aware) on note titles, with optional per-GUID overrides.
 */
export function correlateSnapshotToGuidPaths(
  notes: readonly NoteRecord[],
  vault: VaultIndexForCorrelation,
  overridesByGuid: ReadonlyMap<string, string> = new Map(),
): CorrelateResult {
  const overrides = new Map<string, string>();
  for (const [guid, path] of overridesByGuid) {
    overrides.set(normalizeEvernoteGuid(guid), path);
  }

  const evernoteTitleCollisions: EvernoteTitleCollision[] = [];
  const unmatched: UnmatchedNote[] = [];
  const invalidOverrides: InvalidOverride[] = [];
  const guidTitleMismatches: GuidTitleMismatch[] = [];
  const truncatedPrefixCollisions: TruncatedPrefixCollision[] = [];
  const truncatedMatches: TruncatedTitleMatch[] = [];
  const guidToPath = new Map<string, string>();

  const resolvePath = (guid: string, rel: string): string | undefined => {
    const normGuid = normalizeEvernoteGuid(guid);
    const path = rel.split('\\').join('/').trim();
    if (path === '') {
      invalidOverrides.push({ guid: normGuid, path: rel, reason: 'empty_path' });
      return undefined;
    }
    if (!vault.indexedPaths.has(path)) {
      invalidOverrides.push({ guid: normGuid, path, reason: 'unknown_path' });
      return undefined;
    }
    return path;
  };

  const titleBuckets = new Map<string, NoteRecord[]>();
  for (const n of notes) {
    const key = normalizeTitle(n.title);
    const list = titleBuckets.get(key);
    if (list) {
      list.push(n);
    } else {
      titleBuckets.set(key, [n]);
    }
  }

  const needsTitleOnlyResolution = (n: NoteRecord): boolean => {
    const guid = normalizeEvernoteGuid(n.guid);
    if (overrides.has(guid)) {
      return false;
    }
    if (vault.byEvernoteGuid.has(guid)) {
      return false;
    }
    return true;
  };

  for (const [, group] of titleBuckets) {
    const titleOnlyPending = group.filter(needsTitleOnlyResolution);
    if (titleOnlyPending.length > 1) {
      const head = titleOnlyPending[0];
      if (head === undefined) {
        continue;
      }
      evernoteTitleCollisions.push({
        normalizedTitle: normalizeTitle(head.title),
        guids: titleOnlyPending.map((n) => normalizeEvernoteGuid(n.guid)).sort(),
      });
    }
  }

  const blockedTitleCollisionGuids = new Set(evernoteTitleCollisions.flatMap((c) => c.guids));

  for (const n of notes) {
    const guid = normalizeEvernoteGuid(n.guid);
    const nt = normalizeTitle(n.title);

    if (blockedTitleCollisionGuids.has(guid)) {
      continue;
    }

    const fromOverride = overrides.get(guid);
    if (fromOverride !== undefined) {
      const p = resolvePath(guid, fromOverride);
      if (p !== undefined) {
        guidToPath.set(guid, p);
      }
      continue;
    }

    const guidPath = vault.byEvernoteGuid.get(guid);
    const titlePath = vault.byNormalizedTitle.get(nt);

    if (guidPath !== undefined && titlePath !== undefined && guidPath !== titlePath) {
      guidTitleMismatches.push({
        guid,
        title: n.title,
        reason: 'paths_differ',
        guidPath,
        titlePath,
      });
      continue;
    }

    if (guidPath !== undefined) {
      guidToPath.set(guid, guidPath);
      continue;
    }

    if (titlePath !== undefined) {
      const vaultGuid = vault.pathToEvernoteGuid.get(titlePath);
      if (vaultGuid !== undefined && vaultGuid !== guid) {
        guidTitleMismatches.push({
          guid,
          title: n.title,
          reason: 'vault_guid_differs',
          titlePath,
          vaultGuid,
        });
        continue;
      }
      guidToPath.set(guid, titlePath);
      continue;
    }

    const prefixLookup = findTruncatedPrefixMatch(nt, vault.byNormalizedTitle);
    if (prefixLookup.kind === 'ambiguous') {
      truncatedPrefixCollisions.push({
        guid,
        title: n.title,
        normalizedTitle: nt,
        candidateStems: prefixLookup.stems,
        candidatePaths: prefixLookup.paths,
      });
      continue;
    }
    if (prefixLookup.kind === 'unique') {
      const vaultGuid = vault.pathToEvernoteGuid.get(prefixLookup.path);
      if (vaultGuid !== undefined && vaultGuid !== guid) {
        guidTitleMismatches.push({
          guid,
          title: n.title,
          reason: 'vault_guid_differs',
          titlePath: prefixLookup.path,
          vaultGuid,
        });
        continue;
      }
      truncatedMatches.push({
        guid,
        title: n.title,
        normalizedTitle: nt,
        vaultNormalizedStem: prefixLookup.stem,
        path: prefixLookup.path,
      });
      guidToPath.set(guid, prefixLookup.path);
      continue;
    }

    unmatched.push({ guid, title: n.title, normalizedTitle: nt });
  }

  const incompleteMapping = guidToPath.size !== notes.length;

  if (
    evernoteTitleCollisions.length > 0 ||
    unmatched.length > 0 ||
    invalidOverrides.length > 0 ||
    guidTitleMismatches.length > 0 ||
    truncatedPrefixCollisions.length > 0 ||
    incompleteMapping
  ) {
    evernoteTitleCollisions.sort((a, b) => a.normalizedTitle.localeCompare(b.normalizedTitle));
    unmatched.sort((a, b) => a.guid.localeCompare(b.guid));
    invalidOverrides.sort((a, b) => a.guid.localeCompare(b.guid));
    guidTitleMismatches.sort((a, b) => a.guid.localeCompare(b.guid));
    truncatedPrefixCollisions.sort((a, b) => a.guid.localeCompare(b.guid));
    return {
      ok: false,
      evernoteTitleCollisions,
      unmatched,
      invalidOverrides,
      duplicateTargetPaths: [],
      guidTitleMismatches,
      truncatedPrefixCollisions,
    };
  }

  const byPath = new Map<string, string[]>();
  for (const [g, p] of guidToPath) {
    const list = byPath.get(p);
    if (list) {
      list.push(g);
    } else {
      byPath.set(p, [g]);
    }
  }
  const duplicateTargetPaths: DuplicateTargetPath[] = [];
  for (const [path, guids] of byPath) {
    if (guids.length > 1) {
      duplicateTargetPaths.push({ path, guids: [...guids].sort() });
    }
  }
  if (duplicateTargetPaths.length > 0) {
    duplicateTargetPaths.sort((a, b) => a.path.localeCompare(b.path));
    return {
      ok: false,
      evernoteTitleCollisions: [],
      unmatched: [],
      invalidOverrides: [],
      duplicateTargetPaths,
      guidTitleMismatches: [],
      truncatedPrefixCollisions: [],
    };
  }

  truncatedMatches.sort((a, b) => a.guid.localeCompare(b.guid));
  return { ok: true, guidToPath, truncatedMatches };
}
