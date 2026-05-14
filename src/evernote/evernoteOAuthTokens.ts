import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * Persisted Evernote OAuth 1 access material (classic Cloud API).
 * Evernote does not issue OAuth 2 refresh tokens for this API; re-run `login` after expiry.
 */
export interface EvernoteOAuthTokenFileV1 {
  version: 1;
  /** `serviceHost` from `evernoteClientOptionsFromHost` when the token was saved. */
  serviceHost: string;
  accessToken: string;
  /** From Evernote access-token response; avoids an extra UserStore round-trip. */
  noteStoreUrl?: string | undefined;
  /** Milliseconds since epoch when the access token expires (from `edam_expires`). */
  expiresAtMs?: number | undefined;
  savedAt: string;
}

export function defaultEvernoteOAuthTokenPath(cwd: string): string {
  return resolve(cwd, 'out', 'evernote-oauth.json');
}

/**
 * Resolve path to the OAuth token JSON file (explicit arg > env > default under `./out/`).
 */
export function resolveEvernoteOAuthTokenPath(cwd: string, explicit?: string | undefined): string {
  const raw = explicit?.trim() || process.env.EVERNOTE_OAUTH_TOKEN_PATH?.trim();
  if (!raw) {
    return defaultEvernoteOAuthTokenPath(cwd);
  }
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/** Parse Evernote-specific fields from the OAuth 1 access-token response body. */
export function parseEdamOAuthAccessResults(results: unknown): {
  noteStoreUrl?: string;
  expiresAtMs?: number;
} {
  if (!results || typeof results !== 'object') {
    return {};
  }
  const r = results as Record<string, unknown>;
  const noteStoreUrl = firstQueryValue(r.edam_noteStoreUrl) ?? firstQueryValue(r.edam_notestoreurl);
  const expRaw = firstQueryValue(r.edam_expires);
  let expiresAtMs: number | undefined;
  if (expRaw !== undefined) {
    const n = Number.parseInt(expRaw, 10);
    if (Number.isFinite(n)) {
      expiresAtMs = n;
    }
  }
  const out: { noteStoreUrl?: string; expiresAtMs?: number } = {};
  if (noteStoreUrl !== undefined) {
    out.noteStoreUrl = noteStoreUrl;
  }
  if (expiresAtMs !== undefined) {
    out.expiresAtMs = expiresAtMs;
  }
  return out;
}

function firstQueryValue(v: unknown): string | undefined {
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v) && typeof v[0] === 'string') {
    return v[0];
  }
  return undefined;
}

export function isEvernoteOAuthAccessLikelyExpired(
  expiresAtMs: number | undefined,
  skewMs = 60_000,
): boolean {
  if (expiresAtMs === undefined || !Number.isFinite(expiresAtMs)) {
    return false;
  }
  return Date.now() + skewMs >= expiresAtMs;
}

export async function readEvernoteOAuthTokenFile(
  path: string,
): Promise<EvernoteOAuthTokenFileV1 | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) {
      return undefined;
    }
    const serviceHost = typeof o.serviceHost === 'string' ? o.serviceHost : '';
    const accessToken = typeof o.accessToken === 'string' ? o.accessToken : '';
    if (!serviceHost || !accessToken) {
      return undefined;
    }
    const noteStoreUrl = typeof o.noteStoreUrl === 'string' ? o.noteStoreUrl : undefined;
    const savedAt = typeof o.savedAt === 'string' ? o.savedAt : new Date(0).toISOString();
    let expiresAtMs: number | undefined;
    if (typeof o.expiresAtMs === 'number' && Number.isFinite(o.expiresAtMs)) {
      expiresAtMs = o.expiresAtMs;
    }
    return { version: 1, serviceHost, accessToken, noteStoreUrl, expiresAtMs, savedAt };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}

export async function writeEvernoteOAuthTokenFile(
  path: string,
  data: Omit<EvernoteOAuthTokenFileV1, 'version' | 'savedAt'> & { savedAt?: string },
): Promise<void> {
  const envelope: EvernoteOAuthTokenFileV1 = {
    version: 1,
    serviceHost: data.serviceHost,
    accessToken: data.accessToken,
    noteStoreUrl: data.noteStoreUrl,
    expiresAtMs: data.expiresAtMs,
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
