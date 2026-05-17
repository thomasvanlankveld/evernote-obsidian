import { resolve } from 'node:path';
import { normalizeEvernoteGuid } from '../evernote/noteRecord.ts';

/**
 * On-disk link map: Evernote note GUID → vault-relative Markdown path (Phase 5 output).
 */

export interface LinkMapFile {
  version: 1;
  writtenAt: string;
  /** Absolute resolved vault root at correlation time. */
  vaultRoot: string;
  /** Path to the snapshot JSON when provided to the CLI (absolute resolved). */
  snapshotPath: string;
  /** Path to overrides JSON when provided; omitted when absent. */
  overridesPath?: string | undefined;
  /** Evernote note GUID → path relative to vault root (POSIX separators). */
  guidToPath: Record<string, string>;
}

export class LinkMapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkMapParseError';
  }
}

/** Thrown when link-map `vaultRoot` does not match the vault passed to `rewrite`. */
export class LinkMapVaultRootMismatchError extends Error {
  readonly mapVaultRoot: string;
  readonly cliVaultRoot: string;

  constructor(mapVaultRoot: string, cliVaultRoot: string) {
    super(
      `link map vaultRoot (${mapVaultRoot}) does not match --vault (${cliVaultRoot}); re-run correlate with this vault or fix --vault`,
    );
    this.name = 'LinkMapVaultRootMismatchError';
    this.mapVaultRoot = mapVaultRoot;
    this.cliVaultRoot = cliVaultRoot;
  }
}

/**
 * Ensure the link map was built for the same vault as `rewrite --vault-dir`.
 * Compares normalized absolute paths via `resolve()`.
 */
export function assertLinkMapVaultRootMatches(
  linkMap: Pick<LinkMapFile, 'vaultRoot'>,
  cliVaultRoot: string,
): void {
  if (linkMap.vaultRoot === '') {
    throw new LinkMapParseError('link map is missing vaultRoot');
  }
  const mapRoot = resolve(linkMap.vaultRoot);
  const cliRoot = resolve(cliVaultRoot);
  if (mapRoot !== cliRoot) {
    throw new LinkMapVaultRootMismatchError(mapRoot, cliRoot);
  }
}

/**
 * Parse `link-map.json` (Phase 5 output). GUID keys are normalized to lowercase in the returned object.
 */
export function parseLinkMapJson(text: string): LinkMapFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new LinkMapParseError(`invalid JSON: ${m}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LinkMapParseError('expected a JSON object');
  }
  const o = parsed as Record<string, unknown>;
  if (o.version !== 1) {
    throw new LinkMapParseError(`unsupported version: ${String(o.version)}`);
  }
  if (typeof o.guidToPath !== 'object' || o.guidToPath === null || Array.isArray(o.guidToPath)) {
    throw new LinkMapParseError('missing or invalid guidToPath object');
  }
  const gtp = o.guidToPath as Record<string, unknown>;
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(gtp)) {
    if (typeof v !== 'string') {
      throw new LinkMapParseError(`guidToPath[${k}] must be a string`);
    }
    norm[normalizeEvernoteGuid(k)] = v;
  }
  return {
    version: 1,
    writtenAt: typeof o.writtenAt === 'string' ? o.writtenAt : '',
    vaultRoot: typeof o.vaultRoot === 'string' ? o.vaultRoot : '',
    snapshotPath: typeof o.snapshotPath === 'string' ? o.snapshotPath : '',
    overridesPath: typeof o.overridesPath === 'string' ? o.overridesPath : undefined,
    guidToPath: norm,
  };
}

export function buildLinkMapFile(
  vaultRoot: string,
  snapshotPath: string,
  guidToPath: ReadonlyMap<string, string>,
  overridesPath?: string | undefined,
): LinkMapFile {
  const o: Record<string, string> = {};
  for (const [g, p] of [...guidToPath].sort(([a], [b]) => a.localeCompare(b))) {
    o[normalizeEvernoteGuid(g)] = p;
  }
  const base: LinkMapFile = {
    version: 1,
    writtenAt: new Date().toISOString(),
    vaultRoot,
    snapshotPath,
    guidToPath: o,
  };
  if (overridesPath !== undefined) {
    return { ...base, overridesPath };
  }
  return base;
}
