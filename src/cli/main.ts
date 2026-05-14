/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  defaultEvernoteOAuthCallbackUrl,
  runEvernoteOAuthLogin,
} from '../evernote/evernoteOAuthLogin.ts';
import { resolveEvernoteOAuthTokenPath } from '../evernote/evernoteOAuthTokens.ts';
import { fetchAllNoteRecords } from '../evernote/fetchNoteRecords.ts';
import { resolveSnapshotCredential } from '../evernote/resolveSnapshotCredential.ts';
import { buildSnapshotEnvelope, writeSnapshotFile } from '../evernote/snapshotFile.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { loadDotEnvFromCwd } from './loadDotEnv.ts';
import { readCliPackageVersion } from './packageVersion.ts';

export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution, `.env` loading, and defaults (tests). */
  cwd?: string | undefined;
}

export async function main(
  argv: readonly string[],
  streams: MainStreams = { stdout: process.stdout, stderr: process.stderr },
  options?: MainOptions,
): Promise<number> {
  const cwd = options?.cwd ?? process.cwd();
  const [cmd, ...rest] = argv;

  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    streams.stdout.write(usage());
    return 0;
  }

  if (cmd === '--version' || cmd === '-v') {
    streams.stdout.write(`${version()}\n`);
    return 0;
  }

  if (cmd === 'index') {
    const parsed = parseVaultRootForIndex(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runIndex(parsed.path, streams);
  }

  if (cmd === 'snapshot') {
    const parsed = parseSnapshotArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runSnapshot(parsed.snapshot, cwd, streams);
  }

  if (cmd === 'login') {
    const parsed = parseLoginArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runLogin(parsed.login, cwd, streams);
  }

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}

function parseVaultRootForIndex(
  args: readonly string[],
  cwd: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const defaultData = resolve(cwd, 'data');
  let explicit: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return { ok: false, message: 'error: --vault requires a path (e.g. --vault ./data)' };
      }
      explicit = resolve(cwd, v);
      i++;
    } else if (a?.startsWith('--vault=')) {
      const tail = a.slice('--vault='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --vault= requires a non-empty path' };
      }
      explicit = resolve(cwd, tail);
    }
  }
  return { ok: true, path: explicit ?? defaultData };
}

interface SnapshotCliOk {
  outPath: string;
  pageSize: number;
  sleepBetweenPagesMs: number;
  /** When set, stop after this many notes (newest first). */
  maxRecords?: number | undefined;
  /** Resolved absolute path override for OAuth token JSON (optional). */
  oauthTokenPath?: string | undefined;
}

function parseSnapshotArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; snapshot: SnapshotCliOk } | { ok: false; message: string } {
  const defaultOut = resolve(cwd, 'out', 'evernote-notes.json');
  let outPath = defaultOut;
  let pageSize = 250;
  let sleepBetweenPagesMs = 0;
  let maxRecords: number | undefined;
  let oauthTokenPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return {
          ok: false,
          message: 'error: --out requires a path (e.g. --out ./out/evernote-notes.json)',
        };
      }
      outPath = resolve(cwd, v);
      i++;
    } else if (a?.startsWith('--out=')) {
      const tail = a.slice('--out='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --out= requires a non-empty path' };
      }
      outPath = resolve(cwd, tail);
    } else if (a === '--page-size') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 1 || n > 250) {
        return { ok: false, message: 'error: --page-size must be an integer 1–250' };
      }
      pageSize = n;
      i++;
    } else if (a?.startsWith('--page-size=')) {
      const tail = a.slice('--page-size='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 1 || n > 250) {
        return { ok: false, message: 'error: --page-size must be an integer 1–250' };
      }
      pageSize = n;
    } else if (a === '--sleep-ms') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: 'error: --sleep-ms must be a non-negative integer' };
      }
      sleepBetweenPagesMs = n;
      i++;
    } else if (a?.startsWith('--sleep-ms=')) {
      const tail = a.slice('--sleep-ms='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: 'error: --sleep-ms must be a non-negative integer' };
      }
      sleepBetweenPagesMs = n;
    } else if (a === '--max-notes') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, message: 'error: --max-notes must be a positive integer' };
      }
      maxRecords = n;
      i++;
    } else if (a?.startsWith('--max-notes=')) {
      const tail = a.slice('--max-notes='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, message: 'error: --max-notes must be a positive integer' };
      }
      maxRecords = n;
    } else if (a === '--oauth-token-path') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return {
          ok: false,
          message:
            'error: --oauth-token-path requires a path (e.g. --oauth-token-path ./out/evernote-oauth.json)',
        };
      }
      oauthTokenPath = resolve(cwd, v);
      i++;
    } else if (a?.startsWith('--oauth-token-path=')) {
      const tail = a.slice('--oauth-token-path='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --oauth-token-path= requires a non-empty path' };
      }
      oauthTokenPath = resolve(cwd, tail);
    } else {
      return { ok: false, message: `error: unknown snapshot flag: ${a}` };
    }
  }

  return {
    ok: true,
    snapshot: { outPath, pageSize, sleepBetweenPagesMs, maxRecords, oauthTokenPath },
  };
}

interface LoginCliOk {
  tokenPath: string;
  timeoutMs: number;
  openBrowser: boolean;
}

function parseLoginArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; login: LoginCliOk } | { ok: false; message: string } {
  let tokenExplicit: string | undefined;
  let timeoutMs = 300_000;
  let openBrowser = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--token-path') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return { ok: false, message: 'error: --token-path requires a path' };
      }
      tokenExplicit = v;
      i++;
    } else if (a?.startsWith('--token-path=')) {
      const tail = a.slice('--token-path='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --token-path= requires a non-empty path' };
      }
      tokenExplicit = tail;
    } else if (a === '--timeout-ms') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, message: 'error: --timeout-ms must be a positive integer' };
      }
      timeoutMs = n;
      i++;
    } else if (a?.startsWith('--timeout-ms=')) {
      const tail = a.slice('--timeout-ms='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, message: 'error: --timeout-ms must be a positive integer' };
      }
      timeoutMs = n;
    } else if (a === '--no-open') {
      openBrowser = false;
    } else {
      return { ok: false, message: `error: unknown login flag: ${a}` };
    }
  }

  const tokenPath = resolveEvernoteOAuthTokenPath(cwd, tokenExplicit);
  return { ok: true, login: { tokenPath, timeoutMs, openBrowser } };
}

async function runLogin(login: LoginCliOk, cwd: string, streams: MainStreams): Promise<number> {
  await loadDotEnvFromCwd(cwd);
  const consumerKey = process.env.EVERNOTE_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.EVERNOTE_CONSUMER_SECRET?.trim();
  if (!consumerKey || !consumerSecret) {
    streams.stderr.write(
      'login: missing EVERNOTE_CONSUMER_KEY or EVERNOTE_CONSUMER_SECRET (set in environment or .env in cwd)\n',
    );
    return 2;
  }

  const callbackUrl = defaultEvernoteOAuthCallbackUrl();

  try {
    const result = await runEvernoteOAuthLogin({
      consumerKey,
      consumerSecret,
      hostEnv: process.env.EVERNOTE_HOST,
      callbackUrl,
      tokenOutPath: login.tokenPath,
      timeoutMs: login.timeoutMs,
      openBrowser: login.openBrowser,
    });
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          tokenPath: result.tokenPath,
          authorizeUrl: result.authorizeUrl,
          host: result.serviceHost,
          openedBrowser: login.openBrowser,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`login: ${msg}\n`);
    streams.stderr.write(
      'login: hint: register the callback URL on your Evernote API key (see README); default is http://127.0.0.1:8765/callback\n',
    );
    return 2;
  }
}

async function runSnapshot(
  parsed: SnapshotCliOk,
  cwd: string,
  streams: MainStreams,
): Promise<number> {
  await loadDotEnvFromCwd(cwd);
  const resolved = await resolveSnapshotCredential({
    cwd,
    hostEnv: process.env.EVERNOTE_HOST,
    oauthTokenPath: parsed.oauthTokenPath,
  });
  if (!resolved.ok) {
    streams.stderr.write(`snapshot: ${resolved.message}\n`);
    return 2;
  }

  const { token, noteStoreUrl, source } = resolved.credential;

  try {
    const fetchResult = await fetchAllNoteRecords({
      token,
      noteStoreUrl,
      hostEnv: process.env.EVERNOTE_HOST,
      pageSize: parsed.pageSize,
      sleepBetweenPagesMs: parsed.sleepBetweenPagesMs,
      maxRecords: parsed.maxRecords,
    });
    const { records, clientOpts, totalNotesFromApi, truncated } = fetchResult;

    if (!truncated && totalNotesFromApi !== undefined && totalNotesFromApi !== records.length) {
      streams.stderr.write(
        `snapshot: warning: Evernote reported totalNotes=${totalNotesFromApi} but snapshot has count=${records.length} (skipped rows without guid, concurrent edits while paging, or API semantics).\n`,
      );
    }

    const envelope = buildSnapshotEnvelope(clientOpts.serviceHost, records);
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeSnapshotFile(parsed.outPath, envelope);

    const summary: Record<string, unknown> = {
      ok: true,
      path: parsed.outPath,
      count: records.length,
      host: clientOpts.serviceHost,
      auth: source,
    };
    if (totalNotesFromApi !== undefined) {
      summary.totalNotesFromApi = totalNotesFromApi;
    }
    if (truncated) {
      summary.truncated = true;
    }

    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`snapshot: ${msg}\n`);
    streams.stderr.write(
      'snapshot: hint: verify EVERNOTE_DEVELOPER_TOKEN or OAuth token file, EVERNOTE_HOST (production vs sandbox vs Yinxiang), and Evernote rate limits.\n',
    );
    return 2;
  }
}

async function runIndex(vaultRoot: string, streams: MainStreams): Promise<number> {
  try {
    const result = await buildVaultIndex(vaultRoot);
    if (!result.ok) {
      streams.stderr.write(
        `${JSON.stringify({ ok: false, collisions: result.collisions }, null, 2)}\n`,
      );
      return 1;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, vault: vaultRoot, count: result.entries.length }, null, 2)}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`index: ${msg}\n`);
    return 2;
  }
}

function usage(): string {
  return [
    'evernote-obsidian — Evernote → Obsidian link repair',
    '',
    'Usage:',
    '  evernote-obsidian [--help|--version]',
    '  evernote-obsidian index [--vault <path>]',
    '  evernote-obsidian login [--token-path <path>] [--timeout-ms <n>] [--no-open]',
    '  evernote-obsidian snapshot [--out <path>] [--oauth-token-path <path>] [--page-size <n>] [--sleep-ms <n>] [--max-notes <n>]',
    '',
    'Commands:',
    '  index      Build a read-only vault index (normalized titles must be unique).',
    '  login      Evernote OAuth 1 browser login; saves access token JSON (gitignored ./out/ by default).',
    '  snapshot   Fetch Evernote note metadata (GUID, title, updated) and write a JSON snapshot.',
    '',
    'Options:',
    '  --vault              Vault root directory (default: ./data relative to cwd)',
    '  --token-path         OAuth token JSON output path (default: ./out/evernote-oauth.json)',
    '  --timeout-ms         login: max wait for browser redirect (default: 300000)',
    '  --no-open            login: do not try to open the system browser automatically',
    '  --out                Snapshot JSON path (default: ./out/evernote-notes.json)',
    '  --oauth-token-path   snapshot: read OAuth token JSON from this path (default: ./out/evernote-oauth.json)',
    '  --page-size          findNotesMetadata page size, 1–250 (default: 250)',
    '  --sleep-ms           Pause between pages to ease rate limits (default: 0)',
    '  --max-notes          Stop after N newest notes (optional cap for iteration / large accounts)',
    '',
    'Env (snapshot auth): prefer EVERNOTE_DEVELOPER_TOKEN when set; else OAuth token file from `login`.',
    'Env (login): EVERNOTE_CONSUMER_KEY, EVERNOTE_CONSUMER_SECRET, EVERNOTE_HOST (optional), EVERNOTE_OAUTH_CALLBACK_URL (optional).',
    '',
  ].join('\n');
}

function version(): string {
  return readCliPackageVersion();
}
