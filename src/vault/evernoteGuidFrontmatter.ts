import { normalizeEvernoteGuid } from '../evernote/noteRecord.ts';
import { EVERNOTE_GUID_FRONTMATTER_KEY, parseFrontmatterEvernoteGuid } from './vaultIndex.ts';

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export type GuidBackfillPlanItem =
  | { kind: 'would-update'; path: string; guid: string }
  | { kind: 'skip-matching'; path: string; guid: string }
  | { kind: 'conflict'; path: string; expectedGuid: string; existingGuid: string };

export interface GuidBackfillPlan {
  items: GuidBackfillPlanItem[];
  wouldUpdate: string[];
  skipped: string[];
  conflicts: Array<{ path: string; expectedGuid: string; existingGuid: string }>;
}

/**
 * Insert `evernote-guid:` into Markdown when absent. Caller must ensure no existing key
 * (use {@link planGuidBackfillItem} first). Preserves a leading BOM and CRLF when present.
 */
export function insertEvernoteGuidIntoContent(content: string, guid: string): string {
  const normalized = normalizeEvernoteGuid(guid);
  const guidLine = `${EVERNOTE_GUID_FRONTMATTER_KEY}: ${normalized}`;

  const hasBom = content.startsWith('\uFEFF');
  const body = hasBom ? content.slice(1) : content;
  const bomPrefix = hasBom ? '\uFEFF' : '';

  const existing = parseFrontmatterEvernoteGuid(content);
  if (existing !== undefined) {
    throw new Error('insertEvernoteGuidIntoContent: evernote-guid already present');
  }

  const match = FRONTMATTER_BLOCK_RE.exec(body);
  if (match === null) {
    return `${bomPrefix}---\n${guidLine}\n---\n\n${body}`;
  }

  const inner = match[1] ?? '';
  const rest = body.slice(match[0].length);
  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n';
  const innerBlock = inner === '' ? guidLine : `${guidLine}${lineEnding}${inner}`;
  return `${bomPrefix}---${lineEnding}${innerBlock}${lineEnding}---${lineEnding}${rest}`;
}

export function planGuidBackfillItem(
  content: string,
  guid: string,
  path: string,
): GuidBackfillPlanItem {
  const expectedGuid = normalizeEvernoteGuid(guid);
  const existingGuid = parseFrontmatterEvernoteGuid(content);
  if (existingGuid === undefined) {
    return { kind: 'would-update', path, guid: expectedGuid };
  }
  if (existingGuid === expectedGuid) {
    return { kind: 'skip-matching', path, guid: expectedGuid };
  }
  return { kind: 'conflict', path, expectedGuid, existingGuid };
}

export function buildGuidBackfillPlan(
  guidToPath: ReadonlyMap<string, string>,
  fileContentsByPath: ReadonlyMap<string, string>,
): GuidBackfillPlan {
  const items: GuidBackfillPlanItem[] = [];
  const wouldUpdate: string[] = [];
  const skipped: string[] = [];
  const conflicts: GuidBackfillPlan['conflicts'] = [];

  const paths = [...guidToPath.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [guid, path] of paths) {
    const content = fileContentsByPath.get(path);
    if (content === undefined) {
      throw new Error(`buildGuidBackfillPlan: missing content for ${path}`);
    }
    const item = planGuidBackfillItem(content, guid, path);
    items.push(item);
    if (item.kind === 'would-update') {
      wouldUpdate.push(path);
    } else if (item.kind === 'skip-matching') {
      skipped.push(path);
    } else {
      conflicts.push({
        path: item.path,
        expectedGuid: item.expectedGuid,
        existingGuid: item.existingGuid,
      });
    }
  }

  return { items, wouldUpdate, skipped, conflicts };
}
