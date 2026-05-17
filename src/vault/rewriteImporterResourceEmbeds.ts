/** Prefix Obsidian Importer often emits inside wikilinks when assets live under `Writings/_resources/`. */
export const IMPORTER_BAD_RESOURCES_PREFIX = 'Evernote/Writings/_resources/';

/** Vault-relative prefix that resolves from notes under `Writings/`. */
export const VAULT_RESOURCES_PREFIX = '_resources/';

/** `[[` or `![[` immediately followed by {@link IMPORTER_BAD_RESOURCES_PREFIX}. */
export const WIKILINK_BAD_RESOURCES_RE = /(!?\[\[)Evernote\/Writings\/_resources\//g;

export interface ResourceEmbedLineChange {
  line: number;
  before: string;
  after: string;
}

export interface RewriteImporterResourceEmbedsResult {
  content: string;
  replacements: number;
}

/**
 * Rewrite importer wikilinks `![[Evernote/Writings/_resources/…]]` → `![[_resources/…]]`
 * (and the same for non-embed `[[…]]`). Only wikilink openers with the known bad prefix are touched.
 */
export function rewriteImporterResourceEmbeds(
  content: string,
): RewriteImporterResourceEmbedsResult {
  let replacements = 0;
  const next = content.replace(WIKILINK_BAD_RESOURCES_RE, (_match, opener: string) => {
    replacements++;
    return `${opener}${VAULT_RESOURCES_PREFIX}`;
  });
  return { content: next, replacements };
}

/** Per-line before/after snippets for dry-run reporting (wikilink matches only). */
export function collectResourceEmbedLineChanges(content: string): ResourceEmbedLineChange[] {
  const lines = content.split(/\r?\n/);
  const changes: ResourceEmbedLineChange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const re = new RegExp(WIKILINK_BAD_RESOURCES_RE.source, 'g');
    if (!re.test(line)) {
      continue;
    }
    const after = line.replace(WIKILINK_BAD_RESOURCES_RE, `$1${VAULT_RESOURCES_PREFIX}`);
    if (after !== line) {
      changes.push({ line: i + 1, before: line, after });
    }
  }
  return changes;
}
