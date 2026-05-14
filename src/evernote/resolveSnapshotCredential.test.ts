import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveSnapshotCredential } from './resolveSnapshotCredential.ts';

describe('resolveSnapshotCredential', () => {
  it('loads oauth token file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-snap-oauth-'));
    const path = join(dir, 'oauth.json');
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          serviceHost: 'www.evernote.com',
          accessToken: 'S=file',
          savedAt: new Date().toISOString(),
          expiresAtMs: Date.now() + 86_400_000,
        }),
      );
      const r = await resolveSnapshotCredential({
        cwd: dir,
        hostEnv: 'www.evernote.com',
        oauthTokenPath: path,
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.credential.token, 'S=file');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('errors when oauth token is expired', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-snap-exp-'));
    const path = join(dir, 'oauth.json');
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          serviceHost: 'www.evernote.com',
          accessToken: 'S=old',
          savedAt: new Date().toISOString(),
          expiresAtMs: Date.now() - 86_400_000,
        }),
      );
      const r = await resolveSnapshotCredential({
        cwd: dir,
        hostEnv: 'www.evernote.com',
        oauthTokenPath: path,
      });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.message, /expired/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('errors on serviceHost mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-snap-host-'));
    const path = join(dir, 'oauth.json');
    try {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          serviceHost: 'sandbox.evernote.com',
          accessToken: 'S=x',
          savedAt: new Date().toISOString(),
          expiresAtMs: Date.now() + 86_400_000,
        }),
      );
      const r = await resolveSnapshotCredential({
        cwd: dir,
        hostEnv: 'www.evernote.com',
        oauthTokenPath: path,
      });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.message, /serviceHost/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
