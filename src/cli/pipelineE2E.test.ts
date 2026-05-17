/**
 * End-to-end wiring: evernote-backup SQLite → snapshot JSON → correlate link-map → rewrite.
 *
 * Complements `goldenVaultRewrite.test.ts` (rewrite edge cases with a committed map) by
 * verifying each CLI phase hands off to the next. Fails if snapshot shape or correlate
 * output drifts in a way that breaks rewrite on vault titles from the snapshot.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { type MainStreams, main } from './main.ts';

const TARGET_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeStreams(): { streams: MainStreams; out: () => string; err: () => string } {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return {
    streams: { stdout, stderr },
    out: () => Buffer.concat(outChunks).toString('utf8'),
    err: () => Buffer.concat(errChunks).toString('utf8'),
  };
}

function createMinimalBackupDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE notes(
      guid TEXT PRIMARY KEY,
      title TEXT,
      notebook_guid TEXT,
      is_active BOOLEAN,
      raw_note BLOB
    );
    INSERT INTO notes(guid, title, is_active) VALUES
      ('${TARGET_GUID}', 'Target Note', 1);
  `);
  db.close();
}

async function seedPipelineVault(vaultRoot: string): Promise<void> {
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(
    join(vaultRoot, 'target note.md'),
    '# Target\n\nDestination for the Evernote link.\n',
    'utf8',
  );
  await writeFile(
    join(vaultRoot, 'links.md'),
    [
      '---',
      'title: Source Page',
      '---',
      '',
      `See [My alias](https://www.evernote.com/shard/s308/n/${TARGET_GUID}/title-slug).`,
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('pipeline snapshot → correlate → rewrite', () => {
  it('rewrites Evernote URLs using a link map produced from snapshot titles', async () => {
    const work = await mkdtemp(join(tmpdir(), 'eo-pipeline-e2e-'));
    const vaultRoot = join(work, 'vault');
    const dbPath = join(work, 'en.db');
    const snapshotPath = join(work, 'out', 'evernote-notes.json');
    const mapPath = join(work, 'out', 'link-map.json');
    const outVault = join(work, 'out', 'rewritten-vault');

    try {
      createMinimalBackupDb(dbPath);
      await seedPipelineVault(vaultRoot);

      const snapStreams = makeStreams();
      const snapCode = await main(
        ['snapshot', '--db', dbPath, '--out', snapshotPath],
        snapStreams.streams,
        { cwd: work },
      );
      assert.equal(snapCode, 0, snapStreams.err());
      const snapSummary = JSON.parse(snapStreams.out()) as { ok: boolean; count: number };
      assert.equal(snapSummary.ok, true);
      assert.equal(snapSummary.count, 1);

      const corrStreams = makeStreams();
      const corrCode = await main(
        ['correlate', '--vault-dir', vaultRoot, '--snapshot', snapshotPath, '--out', mapPath],
        corrStreams.streams,
        { cwd: work },
      );
      assert.equal(corrCode, 0, corrStreams.err());
      const corrSummary = JSON.parse(corrStreams.out()) as { ok: boolean; count: number };
      assert.equal(corrSummary.ok, true);
      assert.equal(corrSummary.count, 1);

      const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
        guidToPath: Record<string, string>;
      };
      assert.equal(map.guidToPath[TARGET_GUID], 'target note.md');

      const rewriteStreams = makeStreams();
      const rewriteCode = await main(
        ['rewrite', '--vault-dir', vaultRoot, '--map', mapPath, '--out-dir', outVault],
        rewriteStreams.streams,
        { cwd: work },
      );
      assert.equal(rewriteCode, 0, rewriteStreams.err());
      const rewriteSummary = JSON.parse(rewriteStreams.out()) as {
        filesChanged: number;
        replacements: number;
      };
      assert.equal(rewriteSummary.filesChanged, 1);
      assert.equal(rewriteSummary.replacements, 1);

      const rewritten = await readFile(join(outVault, 'links.md'), 'utf8');
      assert.match(rewritten, /\[\[target note\.md\|My alias\]\]/);
      assert.doesNotMatch(rewritten, /evernote\.com/);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
