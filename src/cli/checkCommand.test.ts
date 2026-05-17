import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCheckResultPayload } from './checkCommand.ts';
import { makeStreams } from './cliTestHelpers.ts';
import { main } from './main.ts';

const cliDir = dirname(fileURLToPath(import.meta.url));
const uniqueFixtureVault = join(cliDir, '../vault/__fixtures__/unique');
const collisionFixtureVault = join(cliDir, '../vault/__fixtures__/collision');
const snapshotFixture = join(cliDir, '../evernote/__fixtures__/snapshot.redacted.json');

describe('checkCommand', () => {
  it('buildCheckResultPayload marks vault collisions as not ok', () => {
    const payload = buildCheckResultPayload(
      '/vault',
      2,
      { count: 10, source: 'snapshot', path: '/snap.json' },
      false,
      [{ normalizedTitle: 'dup', paths: ['a.md', 'b.md'] }],
      [],
    );
    assert.equal(payload.ok, false);
    if (!payload.ok) {
      assert.equal(payload.reason, 'vault_index_collisions');
      assert.equal(payload.collisions.length, 1);
    }
  });

  it('check exits 0 with JSON counts for snapshot + unique vault', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(
      ['check', '--vault-dir', uniqueFixtureVault, '--snapshot', snapshotFixture, '--json'],
      streams,
    );
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as {
      ok: boolean;
      vaultMarkdown: number;
      evernote: { count: number; source: string };
      warnings: unknown[];
    };
    assert.equal(j.ok, true);
    assert.equal(j.vaultMarkdown, 3);
    assert.equal(j.evernote.count, 2);
    assert.equal(j.evernote.source, 'snapshot');
    assert.equal(j.warnings.length, 0);
  });

  it('check emits vault-more-than-evernote hint on stderr in TTY mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-check-many-'));
    try {
      const vaultDir = join(dir, 'vault');
      await mkdir(vaultDir);
      for (let i = 0; i < 12; i++) {
        await writeFile(join(vaultDir, `note-${i}.md`), `---\ntitle: Note ${i}\n---\n`);
      }
      const { streams, out, err } = makeStreams({ stdoutTty: true });
      const code = await main(
        ['check', '--vault-dir', vaultDir, '--snapshot', snapshotFixture],
        streams,
      );
      assert.equal(code, 0);
      assert.match(out(), /Vault:\s+12 markdown/);
      assert.match(out(), /Evernote:\s+2 note/);
      assert.match(err(), /Vault has more markdown files than Evernote/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('check exits 1 with vault index collisions', async () => {
    const { streams, out, err } = makeStreams({ stdoutTty: true });
    const code = await main(
      ['check', '--vault-dir', collisionFixtureVault, '--snapshot', snapshotFixture],
      streams,
    );
    assert.equal(code, 1);
    assert.match(err(), /vault index collision/);
    assert.match(out(), /Vault:/);
  });

  it('check uses default snapshot path when file exists in cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-check-'));
    try {
      await cp(uniqueFixtureVault, join(dir, 'vault'), { recursive: true });
      const outDir = join(dir, 'out');
      await mkdir(outDir);
      await writeFile(join(outDir, 'evernote-notes.json'), await readFile(snapshotFixture));
      const { streams, out } = makeStreams();
      const code = await main(['check', '--vault-dir', join(dir, 'vault'), '--json'], streams, {
        cwd: dir,
      });
      assert.equal(code, 0);
      const j = JSON.parse(out()) as { evernote: { count: number } };
      assert.equal(j.evernote.count, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('check exits 2 when neither snapshot nor db is available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-check-empty-'));
    try {
      const { streams, err } = makeStreams();
      const code = await main(['check', '--vault-dir', uniqueFixtureVault], streams, {
        cwd: dir,
      });
      assert.equal(code, 2);
      assert.match(err(), /--snapshot|--db/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('check exits 2 when both --snapshot and --db are passed', async () => {
    const { streams, err } = makeStreams();
    const code = await main(
      [
        'check',
        '--vault-dir',
        uniqueFixtureVault,
        '--snapshot',
        snapshotFixture,
        '--db',
        './en_backup.db',
      ],
      streams,
    );
    assert.equal(code, 2);
    assert.match(err(), /only one of --snapshot or --db/);
  });
});
