import { evernoteClientOptionsFromHost } from './evernoteHost.ts';
import {
  isEvernoteOAuthAccessLikelyExpired,
  readEvernoteOAuthTokenFile,
  resolveEvernoteOAuthTokenPath,
} from './evernoteOAuthTokens.ts';

export interface SnapshotCredentialResolved {
  /** Authentication token for Evernote Thrift (`Client({ token })`). */
  token: string;
  /** When set, passed to `getNoteStore(url)` (from OAuth access-token response). */
  noteStoreUrl?: string | undefined;
  /** How the token was obtained (for logging / hints). */
  source: 'developer' | 'oauth';
}

export type ResolveSnapshotCredentialResult =
  | { ok: true; credential: SnapshotCredentialResolved }
  | { ok: false; message: string };

export interface ResolveSnapshotCredentialOptions {
  cwd: string;
  hostEnv?: string | undefined;
  oauthTokenPath?: string | undefined;
}

/**
 * Prefer developer token when set; otherwise load a saved OAuth access token file.
 */
export async function resolveSnapshotCredential(
  opts: ResolveSnapshotCredentialOptions,
): Promise<ResolveSnapshotCredentialResult> {
  const dev = process.env.EVERNOTE_DEVELOPER_TOKEN?.trim();
  if (dev) {
    return { ok: true, credential: { token: dev, source: 'developer' } };
  }

  const path = resolveEvernoteOAuthTokenPath(opts.cwd, opts.oauthTokenPath);
  const file = await readEvernoteOAuthTokenFile(path);
  if (!file) {
    return {
      ok: false,
      message: `missing credentials: set EVERNOTE_DEVELOPER_TOKEN or run \`evernote-obsidian login\` (expected OAuth token file at ${path})`,
    };
  }

  const clientOpts = evernoteClientOptionsFromHost(opts.hostEnv);
  if (file.serviceHost !== clientOpts.serviceHost) {
    return {
      ok: false,
      message: `OAuth token file was saved for serviceHost=${file.serviceHost} but EVERNOTE_HOST resolves to ${clientOpts.serviceHost}; fix EVERNOTE_HOST or re-run login`,
    };
  }

  if (isEvernoteOAuthAccessLikelyExpired(file.expiresAtMs)) {
    return {
      ok: false,
      message: `OAuth access token at ${path} appears expired (edam_expires); run \`evernote-obsidian login\` again`,
    };
  }

  return {
    ok: true,
    credential: {
      token: file.accessToken,
      noteStoreUrl: file.noteStoreUrl,
      source: 'oauth',
    },
  };
}
