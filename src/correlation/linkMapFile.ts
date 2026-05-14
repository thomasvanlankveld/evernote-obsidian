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

export function buildLinkMapFile(
  vaultRoot: string,
  snapshotPath: string,
  guidToPath: ReadonlyMap<string, string>,
  overridesPath?: string | undefined,
): LinkMapFile {
  const o: Record<string, string> = {};
  for (const [g, p] of [...guidToPath].sort(([a], [b]) => a.localeCompare(b))) {
    o[g] = p;
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
