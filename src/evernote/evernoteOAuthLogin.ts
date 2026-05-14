import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import evernoteImport from 'evernote';
import { evernoteClientOptionsFromHost } from './evernoteHost.ts';
import { parseEdamOAuthAccessResults, writeEvernoteOAuthTokenFile } from './evernoteOAuthTokens.ts';

const DEFAULT_CALLBACK = 'http://127.0.0.1:8765/callback';

export function defaultEvernoteOAuthCallbackUrl(): string {
  return process.env.EVERNOTE_OAUTH_CALLBACK_URL?.trim() || DEFAULT_CALLBACK;
}

/** Ensure the callback URL is a local http URL the CLI can bind for OAuth redirect. */
export function assertLocalhostOAuthCallbackUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid OAuth callback URL: ${raw}`);
  }
  if (u.protocol !== 'http:') {
    throw new Error('OAuth callback URL must use http: (the CLI runs a local http listener)');
  }
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    throw new Error('OAuth callback URL host must be 127.0.0.1 or localhost');
  }
  return u;
}

export interface EvernoteOAuthClientLike {
  getRequestToken(
    callbackUrl: string,
    callback: (err: unknown, oauthToken?: string, oauthTokenSecret?: string) => void,
  ): void;
  getAuthorizeUrl(oauthToken: string): string;
  getAccessToken(
    oauthToken: string,
    oauthTokenSecret: string,
    oauthVerifier: string,
    callback: (
      err: unknown,
      accessToken?: string,
      accessSecret?: string,
      results?: unknown,
    ) => void,
  ): void;
}

interface EvernoteSdkRoot {
  Client: new (o: {
    consumerKey: string;
    consumerSecret: string;
    sandbox: boolean;
    china: boolean;
    serviceHost: string;
  }) => EvernoteOAuthClientLike;
}

function coerceEvernoteRoot(mod: unknown): EvernoteSdkRoot {
  const m = mod as { default?: unknown };
  return (m.default ?? mod) as EvernoteSdkRoot;
}

export function createEvernoteOAuthClient(
  consumerKey: string,
  consumerSecret: string,
  hostEnv?: string | undefined,
): { client: EvernoteOAuthClientLike; serviceHost: string } {
  const EN = coerceEvernoteRoot(evernoteImport);
  const clientOpts = evernoteClientOptionsFromHost(hostEnv);
  const client = new EN.Client({
    consumerKey,
    consumerSecret,
    sandbox: clientOpts.sandbox,
    china: clientOpts.china,
    serviceHost: clientOpts.serviceHost,
  });
  return { client, serviceHost: clientOpts.serviceHost };
}

function promisifyRequestToken(
  client: EvernoteOAuthClientLike,
  callbackUrl: string,
): Promise<{ oauthToken: string; oauthTokenSecret: string }> {
  return new Promise((resolve, reject) => {
    client.getRequestToken(
      callbackUrl,
      (err: unknown, oauthToken?: string, oauthTokenSecret?: string) => {
        if (err) {
          reject(normalizeNodeError(err));
          return;
        }
        if (oauthToken === undefined || oauthTokenSecret === undefined) {
          reject(
            new Error('Evernote request token response missing oauth_token or oauth_token_secret'),
          );
          return;
        }
        resolve({ oauthToken, oauthTokenSecret });
      },
    );
  });
}

function promisifyGetAccessToken(
  client: EvernoteOAuthClientLike,
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string,
): Promise<{ accessToken: string; results: unknown }> {
  return new Promise((resolve, reject) => {
    client.getAccessToken(
      oauthToken,
      oauthTokenSecret,
      oauthVerifier,
      (err: unknown, accessToken?: string, _accessSecret?: string, results?: unknown) => {
        if (err) {
          reject(normalizeNodeError(err));
          return;
        }
        if (accessToken === undefined) {
          reject(new Error('Evernote access token response missing oauth_token'));
          return;
        }
        resolve({ accessToken, results });
      },
    );
  });
}

function normalizeNodeError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  if (err && typeof err === 'object' && 'statusCode' in err && 'data' in err) {
    const o = err as { statusCode?: unknown; data?: unknown };
    return new Error(
      `Evernote OAuth HTTP error: status=${String(o.statusCode)} body=${String(o.data)}`,
    );
  }
  return new Error(String(err));
}

export function openUrlInDefaultBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function listenHttpServer(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface RunEvernoteOAuthLoginOptions {
  consumerKey: string;
  consumerSecret: string;
  hostEnv?: string | undefined;
  /** Full callback URL registered for your Evernote API key (default `http://127.0.0.1:8765/callback`). */
  callbackUrl: string;
  tokenOutPath: string;
  timeoutMs: number;
  /** When true, try to open the authorize URL in the system default browser. */
  openBrowser: boolean;
}

export interface RunEvernoteOAuthLoginResult {
  authorizeUrl: string;
  tokenPath: string;
  serviceHost: string;
}

/**
 * Run Evernote OAuth 1 browser login and persist the access token to disk.
 */
export async function runEvernoteOAuthLogin(
  opts: RunEvernoteOAuthLoginOptions,
): Promise<RunEvernoteOAuthLoginResult> {
  assertLocalhostOAuthCallbackUrl(opts.callbackUrl);
  const parsed = new URL(opts.callbackUrl);
  const port = parsed.port === '' ? 80 : Number(parsed.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port in OAuth callback URL: ${opts.callbackUrl}`);
  }
  const listenHost = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;

  const { client, serviceHost } = createEvernoteOAuthClient(
    opts.consumerKey,
    opts.consumerSecret,
    opts.hostEnv,
  );

  let expectedRequestToken: string | undefined;
  const verifierGate = createDeferred<string>();
  let settled = false;

  function settleVerifier(kind: 'ok', value: string): void;
  function settleVerifier(kind: 'err', error: Error): void;
  function settleVerifier(kind: 'ok' | 'err', value?: string | Error): void {
    if (settled) {
      return;
    }
    settled = true;
    if (kind === 'ok' && typeof value === 'string') {
      verifierGate.resolve(value);
    } else if (kind === 'err' && value instanceof Error) {
      verifierGate.reject(value);
    }
  }

  const server = createServer((req, res) => {
    if (!req.url || req.method !== 'GET') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const ru = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
    const token = ru.searchParams.get('oauth_token');
    const verifier = ru.searchParams.get('oauth_verifier');

    if (expectedRequestToken === undefined) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OAuth is still starting; try again in a second.');
      return;
    }

    if (token !== expectedRequestToken) {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (!verifier) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<p>Authorization was not completed (no oauth_verifier). You can close this tab.</p>',
      );
      settleVerifier(
        'err',
        new Error('Evernote authorization was denied or incomplete (no oauth_verifier)'),
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p>Success. You can close this tab and return to the terminal.</p>');
    settleVerifier('ok', verifier);
  });

  const timeoutTimer = setTimeout(() => {
    settleVerifier('err', new Error(`OAuth login timed out after ${opts.timeoutMs}ms`));
    server.closeAllConnections?.();
  }, opts.timeoutMs);

  await listenHttpServer(server, port, listenHost);

  try {
    const { oauthToken, oauthTokenSecret } = await promisifyRequestToken(client, opts.callbackUrl);
    expectedRequestToken = oauthToken;

    const authorizeUrl = client.getAuthorizeUrl(oauthToken);
    if (opts.openBrowser) {
      openUrlInDefaultBrowser(authorizeUrl);
    }

    const verifier = await verifierGate.promise;

    const { accessToken, results } = await promisifyGetAccessToken(
      client,
      oauthToken,
      oauthTokenSecret,
      verifier,
    );
    const edam = parseEdamOAuthAccessResults(results);

    await mkdir(dirname(opts.tokenOutPath), { recursive: true });
    await writeEvernoteOAuthTokenFile(opts.tokenOutPath, {
      serviceHost,
      accessToken,
      noteStoreUrl: edam.noteStoreUrl,
      expiresAtMs: edam.expiresAtMs,
    });

    return { authorizeUrl, tokenPath: opts.tokenOutPath, serviceHost };
  } finally {
    clearTimeout(timeoutTimer);
    expectedRequestToken = undefined;
    await closeServer(server);
  }
}
