import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { normalizeEvernoteGuid } from '../evernote/noteRecord.ts';

export interface VaultIndexEntry {
  /** Path relative to vault root, POSIX separators */
  path: string;
  /** Title from YAML `title` or filename stem */
  title: string;
  normalizedTitle: string;
  /** Lowercase Evernote note GUID from frontmatter `evernote-guid:` when present */
  evernoteGuid?: string | undefined;
}

export interface VaultIndexCollision {
  normalizedTitle: string;
  paths: string[];
}

export interface VaultIndexGuidCollision {
  evernoteGuid: string;
  paths: string[];
}

export type VaultIndexResult =
  | {
      ok: true;
      entries: VaultIndexEntry[];
      byNormalizedTitle: ReadonlyMap<string, string>;
      byEvernoteGuid: ReadonlyMap<string, string>;
    }
  | { ok: false; collisions: VaultIndexCollision[]; guidCollisions: VaultIndexGuidCollision[] };

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.obsidian', '.trash']);

/**
 * Normalize a note title for correlation (v1: NFC, trim, lowercase, collapse whitespace).
 */
export function normalizeTitle(raw: string): string {
  const nfc = raw.trim().normalize('NFC').toLowerCase();
  return nfc.replace(/\s+/g, ' ');
}

/** Frontmatter key for Evernote note GUID correlation (line-based YAML subset). */
export const EVERNOTE_GUID_FRONTMATTER_KEY = 'evernote-guid';

/**
 * If the file starts with YAML frontmatter, return the `title:` value when present.
 * v1 is a **line-based subset** only: first `title:` line with a simple scalar (optional
 * single-line quotes). Not a full YAML parser (no block scalars, aliases, or other keys).
 */
export function parseFrontmatterTitle(content: string): string | undefined {
  const block = parseFrontmatterBlock(content);
  if (block === undefined) {
    return undefined;
  }
  return extractYamlScalar(block, 'title');
}

/**
 * If the file starts with YAML frontmatter, return the `evernote-guid:` value when present.
 * Same line-based scalar rules as {@link parseFrontmatterTitle}. GUIDs are normalized to lowercase.
 */
export function parseFrontmatterEvernoteGuid(content: string): string | undefined {
  const block = parseFrontmatterBlock(content);
  if (block === undefined) {
    return undefined;
  }
  const raw = extractYamlScalar(block, EVERNOTE_GUID_FRONTMATTER_KEY);
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : normalizeEvernoteGuid(trimmed);
}

function parseFrontmatterBlock(content: string): string | undefined {
  const start = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(start);
  return m?.[1];
}

function extractYamlScalar(block: string, key: string): string | undefined {
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const m = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`).exec(line);
    if (!m?.[1]) {
      continue;
    }
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.trim() || undefined;
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toVaultRelative(vaultRoot: string, absoluteFile: string): string {
  const rel = relative(vaultRoot, absoluteFile);
  return rel.split('\\').join('/');
}

/**
 * Absolute paths to every `.md` file under `vaultRoot`, using the same traversal rules as
 * {@link buildVaultIndex} (skip `.git`, `node_modules`, `.obsidian`, `.trash`; no symlinked directories).
 */
export async function walkVaultMarkdownFiles(vaultRoot: string): Promise<string[]> {
  return collectMarkdownFiles(vaultRoot, vaultRoot);
}

async function collectMarkdownFiles(dir: string, vaultRoot: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const name = String(ent.name);
      const full = join(dir, name);
      if (ent.isDirectory()) {
        if (ent.isSymbolicLink()) {
          continue;
        }
        if (SKIP_DIR_NAMES.has(name)) {
          continue;
        }
        out.push(...(await collectMarkdownFiles(full, vaultRoot)));
      } else if (ent.isFile() && name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
    return out;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && dir === vaultRoot) {
      throw new VaultIndexRootError(`Vault root does not exist: ${dir}`, dir);
    }
    throw e;
  }
}

export class VaultIndexRootError extends Error {
  readonly vaultRoot: string;
  constructor(message: string, vaultRoot: string) {
    super(message);
    this.name = 'VaultIndexRootError';
    this.vaultRoot = vaultRoot;
  }
}

function stemFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.md')) {
    return filename.slice(0, -3);
  }
  return filename;
}

/**
 * Walk `vaultRoot`, read Markdown titles (frontmatter `title` or filename stem), and build
 * an unambiguous index keyed by {@link normalizeTitle}. Duplicate normalized titles, or any
 * **empty** normalized title, yield `ok: false` with collision-shaped reports.
 * Skips `.git`, `node_modules`, `.obsidian`, and `.trash` by directory name. Does not recurse into
 * **symlinked directories** (avoids cycles); symlinked `.md` files are still indexed.
 */
export async function buildVaultIndex(vaultRoot: string): Promise<VaultIndexResult> {
  const absoluteFiles = await collectMarkdownFiles(vaultRoot, vaultRoot);
  const entries: VaultIndexEntry[] = [];

  for (const abs of absoluteFiles) {
    const raw = await readFile(abs, 'utf8');
    const fmTitle = parseFrontmatterTitle(raw);
    const rel = toVaultRelative(vaultRoot, abs);
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1] ?? rel;
    const title = fmTitle ?? stemFromFilename(fileName);
    const normalizedTitle = normalizeTitle(title);
    const evernoteGuid = parseFrontmatterEvernoteGuid(raw);
    entries.push({ path: rel, title, normalizedTitle, evernoteGuid });
  }

  const byNorm = new Map<string, string[]>();
  for (const e of entries) {
    const list = byNorm.get(e.normalizedTitle);
    if (list) {
      list.push(e.path);
    } else {
      byNorm.set(e.normalizedTitle, [e.path]);
    }
  }

  const collisions: VaultIndexCollision[] = [];
  for (const [normalizedTitle, paths] of byNorm) {
    if (paths.length > 1 || normalizedTitle === '') {
      collisions.push({ normalizedTitle, paths: [...paths].sort() });
    }
  }

  const byGuid = new Map<string, string[]>();
  for (const e of entries) {
    if (e.evernoteGuid === undefined) {
      continue;
    }
    const list = byGuid.get(e.evernoteGuid);
    if (list) {
      list.push(e.path);
    } else {
      byGuid.set(e.evernoteGuid, [e.path]);
    }
  }

  const guidCollisions: VaultIndexGuidCollision[] = [];
  for (const [evernoteGuid, paths] of byGuid) {
    if (paths.length > 1) {
      guidCollisions.push({ evernoteGuid, paths: [...paths].sort() });
    }
  }

  if (collisions.length > 0 || guidCollisions.length > 0) {
    collisions.sort((a, b) => a.normalizedTitle.localeCompare(b.normalizedTitle));
    guidCollisions.sort((a, b) => a.evernoteGuid.localeCompare(b.evernoteGuid));
    return { ok: false, collisions, guidCollisions };
  }

  const map = new Map<string, string>();
  const guidMap = new Map<string, string>();
  for (const e of entries) {
    map.set(e.normalizedTitle, e.path);
    if (e.evernoteGuid !== undefined) {
      guidMap.set(e.evernoteGuid, e.path);
    }
  }
  return { ok: true, entries, byNormalizedTitle: map, byEvernoteGuid: guidMap };
}
