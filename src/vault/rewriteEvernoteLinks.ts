import { mergeEvernoteUrlSpans, tryParseNoteGuidFromUrl } from './extractEvernoteLinks.ts';

export interface RewriteMarkdownResult {
  content: string;
  replaced: number;
  skippedUnmapped: number;
}

function buildWikilink(targetPath: string, alias: string | null): string {
  const path = targetPath.trim();
  if (alias !== null && alias.length > 0) {
    return `[[${path}|${alias}]]`;
  }
  return `[[${path}]]`;
}

/**
 * Replace Evernote **note** URL spans with `[[vault-relative-path|alias]]` using `guidToPath`.
 * Non-note URLs (e.g. blog.evernote.com) and note URLs whose GUID is absent from the map are left unchanged.
 */
export function rewriteMarkdownWithGuidMap(
  content: string,
  guidToPath: ReadonlyMap<string, string>,
): RewriteMarkdownResult {
  const spans = mergeEvernoteUrlSpans(content);
  const ops: { replaceStart: number; replaceEnd: number; text: string }[] = [];
  let skippedUnmapped = 0;

  for (const s of spans) {
    if (s.kind !== 'note') {
      continue;
    }
    const g = tryParseNoteGuidFromUrl(s.rawUrl);
    if (g === null) {
      skippedUnmapped++;
      continue;
    }
    const targetPath = guidToPath.get(g);
    if (targetPath === undefined) {
      skippedUnmapped++;
      continue;
    }
    const alias = s.alias !== null && s.alias.trim() !== '' ? s.alias.trim() : null;
    ops.push({
      replaceStart: s.replaceStart,
      replaceEnd: s.replaceEnd,
      text: buildWikilink(targetPath, alias),
    });
  }

  ops.sort((a, b) => b.replaceStart - a.replaceStart);
  let out = content;
  const replaced = ops.length;
  for (const op of ops) {
    out = `${out.slice(0, op.replaceStart)}${op.text}${out.slice(op.replaceEnd)}`;
  }

  return { content: out, replaced, skippedUnmapped };
}
