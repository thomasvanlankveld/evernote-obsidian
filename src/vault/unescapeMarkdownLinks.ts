import {
  collectCodeVerbatimMaskRanges,
  type MarkdownInlineLinkSpan,
} from './extractEvernoteLinks.ts';

export interface UnescapeMarkdownLinkChange {
  /** Start offset of the removed `\[` wrapper (inclusive). */
  start: number;
  /** End offset after the removed `\]` wrapper (exclusive). */
  end: number;
}

export interface UnescapeMarkdownLinksResult {
  content: string;
  replacements: number;
  changes: UnescapeMarkdownLinkChange[];
}

/**
 * True when `url` looks like an external hyperlink destination (not a relative wiki path).
 * Tightens matching so escaped `[[wikilink]]` wrappers are not stripped.
 */
export function isExternalMarkdownLinkUrl(url: string): boolean {
  const t = url.trim();
  if (t === '') {
    return false;
  }
  if (/^(https?|mailto|ftp):/i.test(t)) {
    return true;
  }
  return t.includes('://');
}

function isInsideRanges(offset: number, ranges: readonly [number, number][]): boolean {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) {
      return true;
    }
  }
  return false;
}

/** Parse `[text](url)` when `open` points at the opening `[` (same rules as {@link scanMarkdownInlineLinks}). */
function parseMarkdownInlineLinkAt(content: string, open: number): MarkdownInlineLinkSpan | null {
  if (content[open] !== '[') {
    return null;
  }

  let j = open + 1;
  let closeBracket = -1;
  while (j < content.length) {
    const ch = content[j];
    if (ch === '\\' && j + 1 < content.length) {
      j += 2;
      continue;
    }
    if (ch === ']' && content[j + 1] === '(') {
      closeBracket = j;
      break;
    }
    j++;
  }
  if (closeBracket === -1) {
    return null;
  }

  const urlStart = closeBracket + 2;
  let k = urlStart;
  while (k < content.length) {
    const ch = content[k];
    if (ch === ')' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      break;
    }
    k++;
  }
  const url = content.slice(urlStart, k);
  if (url.length === 0 || k >= content.length || content[k] !== ')') {
    return null;
  }

  return {
    fullStart: open,
    fullEnd: k + 1,
    text: content.slice(open + 1, closeBracket),
    url,
    urlStart,
    urlEnd: k,
  };
}

/**
 * Remove Evernote-importer escapes around inline `[text](url)` links:
 * `\[` … `[text](https://…)` … `\]` → `[text](https://…)`.
 *
 * Only matches when both wrappers are present and the URL is {@link isExternalMarkdownLinkUrl}.
 * Skips fenced / inline code (same mask as `links` / `rewrite`).
 *
 * **False positives:** intentional `\[` + external link + `\]` in prose is rare; wikilinks and
 * non-URL destinations are ignored. Literal backslash-bracket before a link without a closing
 * `\]` is left unchanged.
 */
export function unescapeMarkdownLinksInContent(content: string): UnescapeMarkdownLinksResult {
  const codeMask = collectCodeVerbatimMaskRanges(content);
  const ops: { start: number; end: number }[] = [];

  let i = 0;
  while (i < content.length) {
    if (content[i] !== '\\' || content[i + 1] !== '[') {
      i++;
      continue;
    }
    const wrapStart = i;
    const linkOpen = i + 2;
    if (content[linkOpen] !== '[') {
      i++;
      continue;
    }
    if (isInsideRanges(wrapStart, codeMask)) {
      i++;
      continue;
    }
    const link = parseMarkdownInlineLinkAt(content, linkOpen);
    if (link === null || !isExternalMarkdownLinkUrl(link.url)) {
      i++;
      continue;
    }
    const wrapEnd = link.fullEnd + 2;
    if (content[link.fullEnd] !== '\\' || content[link.fullEnd + 1] !== ']') {
      i++;
      continue;
    }
    ops.push({ start: wrapStart, end: wrapEnd });
    i = wrapEnd;
  }

  ops.sort((a, b) => b.start - a.start);
  let out = content;
  const changes: UnescapeMarkdownLinkChange[] = [];
  for (const op of ops) {
    const inner = content.slice(op.start + 2, op.end - 2);
    changes.push({ start: op.start, end: op.end });
    out = `${out.slice(0, op.start)}${inner}${out.slice(op.end)}`;
  }

  return { content: out, replacements: changes.length, changes };
}
