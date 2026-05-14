/**
 * Optional JSON overrides for Phase 5 correlation (GUID → vault path, disambiguation).
 */

export interface CorrelationOverridesFile {
  version: 1;
  /** Evernote note GUID → vault-relative path (POSIX separators, must exist in the vault index). */
  byGuid?: Record<string, string> | undefined;
}

export function parseCorrelationOverridesJson(raw: string): Map<string, string> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('overrides: root must be an object');
  }
  const o = parsed as Record<string, unknown>;
  if (o.version !== 1) {
    throw new Error('overrides: unsupported or missing version (expected 1)');
  }
  if (o.byGuid === undefined) {
    return new Map();
  }
  if (!o.byGuid || typeof o.byGuid !== 'object' || Array.isArray(o.byGuid)) {
    throw new Error('overrides: byGuid must be an object when present');
  }
  const out = new Map<string, string>();
  for (const [guid, p] of Object.entries(o.byGuid as Record<string, unknown>)) {
    if (typeof p !== 'string') {
      throw new Error(`overrides: byGuid["${guid}"] must be a string path`);
    }
    const trimmed = p.trim();
    if (trimmed === '') {
      throw new Error(`overrides: byGuid["${guid}"] path must be non-empty`);
    }
    out.set(guid, trimmed.split('\\').join('/'));
  }
  return out;
}
