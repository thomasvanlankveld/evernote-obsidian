import type { NoteRecord } from '../evernote/noteRecord.ts';
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

export type CorrelateResult =
  | { ok: true; guidToPath: ReadonlyMap<string, string> }
  | {
      ok: false;
      evernoteTitleCollisions: EvernoteTitleCollision[];
      unmatched: UnmatchedNote[];
      invalidOverrides: InvalidOverride[];
      duplicateTargetPaths: DuplicateTargetPath[];
    };

export interface VaultIndexForCorrelation {
  byNormalizedTitle: ReadonlyMap<string, string>;
  indexedPaths: ReadonlySet<string>;
}

export function vaultIndexResultToCorrelationInput(
  byNormalizedTitle: ReadonlyMap<string, string>,
  paths: readonly string[],
): VaultIndexForCorrelation {
  return { byNormalizedTitle, indexedPaths: new Set(paths) };
}

/**
 * Join Evernote snapshot rows to vault paths by {@link normalizeTitle} on note titles,
 * with optional per-GUID overrides. Multiple Evernote GUIDs sharing the same normalized title
 * require an explicit override for every GUID in that group.
 */
export function correlateSnapshotToGuidPaths(
  notes: readonly NoteRecord[],
  vault: VaultIndexForCorrelation,
  overridesByGuid: ReadonlyMap<string, string> = new Map(),
): CorrelateResult {
  const buckets = new Map<string, NoteRecord[]>();
  for (const n of notes) {
    const key = normalizeTitle(n.title);
    const list = buckets.get(key);
    if (list) {
      list.push(n);
    } else {
      buckets.set(key, [n]);
    }
  }

  const evernoteTitleCollisions: EvernoteTitleCollision[] = [];
  const unmatched: UnmatchedNote[] = [];
  const invalidOverrides: InvalidOverride[] = [];
  const guidToPath = new Map<string, string>();

  const resolvePath = (guid: string, rel: string): string | undefined => {
    const path = rel.split('\\').join('/').trim();
    if (path === '') {
      invalidOverrides.push({ guid, path: rel, reason: 'empty_path' });
      return undefined;
    }
    if (!vault.indexedPaths.has(path)) {
      invalidOverrides.push({ guid, path, reason: 'unknown_path' });
      return undefined;
    }
    return path;
  };

  for (const [, group] of buckets) {
    if (group.length > 1) {
      const withoutOverride = group.filter((n) => !overridesByGuid.has(n.guid));
      if (withoutOverride.length > 0) {
        const head = group[0];
        if (head === undefined) {
          continue;
        }
        evernoteTitleCollisions.push({
          normalizedTitle: normalizeTitle(head.title),
          guids: group.map((n) => n.guid).sort(),
        });
        continue;
      }
      for (const n of group) {
        const raw = overridesByGuid.get(n.guid);
        if (raw === undefined) {
          continue;
        }
        const p = resolvePath(n.guid, raw);
        if (p !== undefined) {
          guidToPath.set(n.guid, p);
        }
      }
      continue;
    }

    const n = group[0];
    if (n === undefined) {
      continue;
    }
    const fromOverride = overridesByGuid.get(n.guid);
    if (fromOverride !== undefined) {
      const p = resolvePath(n.guid, fromOverride);
      if (p !== undefined) {
        guidToPath.set(n.guid, p);
      }
      continue;
    }

    const nt = normalizeTitle(n.title);
    const path = vault.byNormalizedTitle.get(nt);
    if (path === undefined) {
      unmatched.push({ guid: n.guid, title: n.title, normalizedTitle: nt });
    } else {
      guidToPath.set(n.guid, path);
    }
  }

  const incompleteMapping = guidToPath.size !== notes.length;

  if (
    evernoteTitleCollisions.length > 0 ||
    unmatched.length > 0 ||
    invalidOverrides.length > 0 ||
    incompleteMapping
  ) {
    evernoteTitleCollisions.sort((a, b) => a.normalizedTitle.localeCompare(b.normalizedTitle));
    unmatched.sort((a, b) => a.guid.localeCompare(b.guid));
    invalidOverrides.sort((a, b) => a.guid.localeCompare(b.guid));
    return {
      ok: false,
      evernoteTitleCollisions,
      unmatched,
      invalidOverrides,
      duplicateTargetPaths: [],
    };
  }

  const byPath = new Map<string, string[]>();
  for (const [guid, p] of guidToPath) {
    const list = byPath.get(p);
    if (list) {
      list.push(guid);
    } else {
      byPath.set(p, [guid]);
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
    };
  }

  return { ok: true, guidToPath };
}
