import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { walkVaultMarkdownFiles } from './vaultIndex.ts';

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/** One extracted reference (report-only; no vault writes). */
export interface BrokenLink {
  file: string;
  /** 1-based line and column of the start of `rawUrl` in the file */
  location: { line: number; column: number };
  rawUrl: string;
  /** Canonical lowercase GUID when this is a note URL and parsing succeeded */
  parsedGuid: string | null;
  /** Markdown bracket text, `[[url|alias]]` display segment, or null */
  alias: string | null;
  /** `note` = evernote:// or www.evernote.com/shard/…; `other-evernote` = any other *.evernote.com URL */
  kind: 'note' | 'other-evernote';
}

export interface ScanEvernoteLinksOptions {
  /**
   * When true, URLs on Evernote hosts that are not rewrite targets (e.g. blog.evernote.com,
   * or www.evernote.com outside `/shard/…`) are omitted from results.
   */
  skipOtherEvernoteHosts?: boolean | undefined;
}

function toVaultRelative(vaultRoot: string, absoluteFile: string): string {
  const rel = relative(vaultRoot, absoluteFile);
  return rel.split('\\').join('/');
}

function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    const ch = content[i];
    if (ch === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function normalizeGuid(g: string): string {
  return g.toLowerCase();
}

/**
 * Extract a note GUID from `https://www.evernote.com/shard/…` or `evernote://…` URLs.
 * Returns null when the URL targets a note shape but no UUID is found.
 */
export function tryParseNoteGuidFromUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    if (/^evernote:/i.test(trimmed)) {
      const rest = trimmed.replace(/^evernote:/i, '');
      const slashy = rest.startsWith('//') ? `/${rest.replace(/^\/+/, '')}` : `/${rest}`;
      return parseGuidFromPathAndQuery(slashy);
    }
    return null;
  }

  if (u.protocol === 'evernote:') {
    const pseudoPath = `${u.hostname ? `/${u.hostname}` : ''}${u.pathname}${u.search}${u.hash}`;
    return parseGuidFromPathAndQuery(pseudoPath);
  }

  const host = u.hostname.toLowerCase();
  if (host === 'www.evernote.com' && u.pathname.toLowerCase().includes('/shard/')) {
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep encoded */
    }
    return parseGuidFromPathAndQuery(`${path}${u.search}${u.hash}`);
  }

  return null;
}

function parseGuidFromPathAndQuery(fragment: string): string | null {
  const afterN =
    /\/n\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i.exec(
      fragment,
    );
  if (afterN?.[1]) {
    return normalizeGuid(afterN[1]);
  }
  const afterSh =
    /\/sh\/[^/]+\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i.exec(
      fragment,
    );
  if (afterSh?.[1]) {
    return normalizeGuid(afterSh[1]);
  }
  const afterNl =
    /\/nl\/[^/]+\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i.exec(
      fragment,
    );
  if (afterNl?.[1]) {
    return normalizeGuid(afterNl[1]);
  }
  const ms = [...fragment.matchAll(new RegExp(UUID, 'gi'))];
  const last = ms[ms.length - 1];
  const g = last?.[0];
  if (g !== undefined) {
    return normalizeGuid(g);
  }
  return null;
}

/**
 * Classify whether `url` should be reported as an Evernote-related link.
 * Returns `null` when the string is not an Evernote host / scheme URL.
 */
export function classifyEvernoteUrl(url: string): 'note' | 'other-evernote' | null {
  const t = url.trim();
  if (/^evernote:/i.test(t)) {
    return 'note';
  }
  try {
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    const isEvernoteHost = host === 'evernote.com' || host.endsWith('.evernote.com');
    if (!isEvernoteHost) {
      return null;
    }
    if (host === 'www.evernote.com' && u.pathname.toLowerCase().includes('/shard/')) {
      return 'note';
    }
    return 'other-evernote';
  } catch {
    return /^evernote:/i.test(t) ? 'note' : null;
  }
}

interface Span {
  start: number;
  end: number;
  rawUrl: string;
  alias: string | null;
}

function addSpan(spans: Span[], span: Span): void {
  spans.push(span);
}

/** Prefer structured captures (with alias), then longer spans, when ranges overlap. */
function dropOverlappingSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.alias != null && b.alias == null) {
      return -1;
    }
    if (b.alias != null && a.alias == null) {
      return 1;
    }
    return b.end - b.start - (a.end - a.start);
  });
  const kept: Span[] = [];
  outer: for (const s of sorted) {
    for (const k of kept) {
      if (!(s.end <= k.start || s.start >= k.end)) {
        continue outer;
      }
    }
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function maskRanges(content: string, ranges: readonly [number, number][]): string {
  if (ranges.length === 0) {
    return content;
  }
  const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
  let out = content;
  for (const [a, b] of sorted) {
    out = `${out.slice(0, a)}${' '.repeat(b - a)}${out.slice(b)}`;
  }
  return out;
}

const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const AUTOLINK = /<((?:evernote:|https?:\/\/)[^>\s]+)>/gi;
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

const BARE_NOTE = /\b(evernote:[^\s)\]]+|https:\/\/www\.evernote\.com\/shard\/[^\s)\]]+)/gi;

const BARE_OTHER_EVERNOTE = /\bhttps?:\/\/[a-z0-9.-]*evernote\.com(?:\/[^\s)\]]*)?/gi;

/**
 * Scan a single Markdown file for Evernote note URLs and other `*.evernote.com` links.
 */
export function extractEvernoteLinksFromMarkdown(
  content: string,
  fileRelPath: string,
): BrokenLink[] {
  const spans: Span[] = [];

  for (const m of content.matchAll(MD_LINK)) {
    const url = m[2];
    const cls = url !== undefined ? classifyEvernoteUrl(url) : null;
    if (!url || cls === null) {
      continue;
    }
    const start = (m.index ?? 0) + m[0].indexOf(url);
    addSpan(spans, {
      start,
      end: start + url.length,
      rawUrl: url,
      alias: m[1]?.trim() ? m[1] : null,
    });
  }

  for (const m of content.matchAll(WIKILINK)) {
    const rawTarget = m[1];
    const target = rawTarget?.trim();
    if (!rawTarget || !target) {
      continue;
    }
    const cls = classifyEvernoteUrl(target);
    if (cls === null) {
      continue;
    }
    const alias = m[2]?.trim() ? m[2] : null;
    const innerOffset = m[0].indexOf(rawTarget);
    const trimLead = rawTarget.length - rawTarget.trimStart().length;
    const start = (m.index ?? 0) + innerOffset + trimLead;
    addSpan(spans, {
      start,
      end: start + target.length,
      rawUrl: target,
      alias,
    });
  }

  for (const m of content.matchAll(AUTOLINK)) {
    const url = m[1];
    const cls = url !== undefined ? classifyEvernoteUrl(url) : null;
    if (!url || cls === null) {
      continue;
    }
    const start = (m.index ?? 0) + 1;
    addSpan(spans, { start, end: start + url.length, rawUrl: url, alias: null });
  }

  const covered: [number, number][] = spans.map((s) => [s.start, s.end]);
  const masked = maskRanges(content, covered);

  for (const m of masked.matchAll(BARE_NOTE)) {
    const url = m[1];
    if (!url) {
      continue;
    }
    const start = m.index ?? 0;
    addSpan(spans, { start, end: start + url.length, rawUrl: url, alias: null });
  }

  for (const m of masked.matchAll(BARE_OTHER_EVERNOTE)) {
    const url = m[0];
    if (!url || classifyEvernoteUrl(url) !== 'other-evernote') {
      continue;
    }
    const start = m.index ?? 0;
    addSpan(spans, { start, end: start + url.length, rawUrl: url, alias: null });
  }

  const merged = dropOverlappingSpans(spans);

  const out: BrokenLink[] = [];
  for (const s of merged) {
    const kind = classifyEvernoteUrl(s.rawUrl);
    if (kind === null) {
      continue;
    }
    const loc = offsetToLineColumn(content, s.start);
    const parsedGuid = kind === 'note' ? tryParseNoteGuidFromUrl(s.rawUrl) : null;
    out.push({
      file: fileRelPath,
      location: loc,
      rawUrl: s.rawUrl,
      parsedGuid,
      alias: s.alias,
      kind,
    });
  }

  return out;
}

/**
 * Walk the vault (same rules as the index command) and collect {@link BrokenLink} rows.
 */
export async function scanVaultForEvernoteLinks(
  vaultRoot: string,
  options?: ScanEvernoteLinksOptions,
): Promise<BrokenLink[]> {
  const skipOther = options?.skipOtherEvernoteHosts === true;
  const files = await walkVaultMarkdownFiles(vaultRoot);
  const results: BrokenLink[] = [];

  for (const abs of files) {
    const rel = toVaultRelative(vaultRoot, abs);
    const content = await readFile(abs, 'utf8');
    const rows = extractEvernoteLinksFromMarkdown(content, rel);
    for (const r of rows) {
      if (skipOther && r.kind === 'other-evernote') {
        continue;
      }
      results.push(r);
    }
  }

  return results;
}
