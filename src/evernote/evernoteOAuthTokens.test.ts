import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  defaultEvernoteOAuthTokenPath,
  isEvernoteOAuthAccessLikelyExpired,
  parseEdamOAuthAccessResults,
  readEvernoteOAuthTokenFile,
  resolveEvernoteOAuthTokenPath,
  writeEvernoteOAuthTokenFile,
} from './evernoteOAuthTokens.ts';

describe('evernoteOAuthTokens', () => {
  it('parseEdamOAuthAccessResults reads Evernote fields', () => {
    const r = parseEdamOAuthAccessResults({
      edam_noteStoreUrl: 'https://www.evernote.com/shard/s1/notestore',
      edam_expires: '1700000000000',
    });
    assert.equal(r.noteStoreUrl, 'https://www.evernote.com/shard/s1/notestore');
    assert.equal(r.expiresAtMs, 1_700_000_000_000);
  });

  it('isEvernoteOAuthAccessLikelyExpired respects skew', () => {
    assert.equal(isEvernoteOAuthAccessLikelyExpired(undefined), false);
    const soon = Date.now() + 30_000;
    assert.equal(isEvernoteOAuthAccessLikelyExpired(soon, 60_000), true);
    const future = Date.now() + 120_000;
    assert.equal(isEvernoteOAuthAccessLikelyExpired(future, 60_000), false);
  });

  it('resolveEvernoteOAuthTokenPath honors EVERNOTE_OAUTH_TOKEN_PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-path-'));
    const prev = process.env.EVERNOTE_OAUTH_TOKEN_PATH;
    process.env.EVERNOTE_OAUTH_TOKEN_PATH = join('sub', 't.json');
    try {
      const p = resolveEvernoteOAuthTokenPath(dir);
      assert.equal(p, join(dir, 'sub', 't.json'));
    } finally {
      if (prev === undefined) {
        delete process.env.EVERNOTE_OAUTH_TOKEN_PATH;
      } else {
        process.env.EVERNOTE_OAUTH_TOKEN_PATH = prev;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaultEvernoteOAuthTokenPath lives under out/', () => {
    assert.match(defaultEvernoteOAuthTokenPath('/tmp/x'), /evernote-oauth\.json$/);
  });

  it('writeEvernoteOAuthTokenFile round-trips via read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-write-'));
    const path = join(dir, 'tok.json');
    try {
      await writeEvernoteOAuthTokenFile(path, {
        serviceHost: 'www.evernote.com',
        accessToken: 'S=demo',
        noteStoreUrl: 'https://example/notestore',
        expiresAtMs: 9,
      });
      const raw = await readFile(path, 'utf8');
      assert.match(raw, /"version": 1/);
      const got = await readEvernoteOAuthTokenFile(path);
      assert.ok(got);
      assert.equal(got?.accessToken, 'S=demo');
      assert.equal(got?.serviceHost, 'www.evernote.com');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
