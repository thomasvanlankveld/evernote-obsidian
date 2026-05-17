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
import { describe, it } from 'node:test';
import { makeStreams, parseJsonOutputs } from './cliTestHelpers.ts';
import { main } from './main.ts';

const TARGET_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TARGET_GUID_UPPER = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

function createMinimalBackupDb(dbPath: string, guidInDb = TARGET_GUID): void {
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
      ('${guidInDb}', 'Target Note', 1);
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

async function assertPipelineArtifacts(
  snapshotPath: string,
  mapPath: string,
  outVault: string,
  label: string,
): Promise<void> {
  const snap = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
    version: number;
    notes: { guid: string; title: string }[];
  };
  assert.equal(snap.version, 1, `${label}: snapshot version`);
  assert.equal(snap.notes[0]?.guid, TARGET_GUID, `${label}: snapshot guid`);
  assert.equal(snap.notes[0]?.title, 'Target Note', `${label}: snapshot title`);

  const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
    guidToPath: Record<string, string>;
  };
  assert.equal(map.guidToPath[TARGET_GUID], 'target note.md', `${label}: guidToPath`);

  const rewritten = await readFile(join(outVault, 'links.md'), 'utf8');
  assert.match(rewritten, /\[\[target note\.md\|My alias\]\]/, `${label}: rewritten wikilink`);
  assert.doesNotMatch(rewritten, /evernote\.com/, `${label}: no evernote.com in output`);
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
      assert.equal(snapStreams.err(), '');
      const snapSummary = JSON.parse(snapStreams.out()) as { ok: boolean; count: number };
      assert.equal(snapSummary.ok, true);
      assert.equal(snapSummary.count, 1);

      const snap = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
        version: number;
        notes: { guid: string; title: string }[];
      };
      assert.equal(snap.version, 1);
      assert.equal(snap.notes[0]?.guid, TARGET_GUID);
      assert.equal(snap.notes[0]?.title, 'Target Note');

      const corrStreams = makeStreams();
      const corrCode = await main(
        ['correlate', '--vault-dir', vaultRoot, '--snapshot', snapshotPath, '--out', mapPath],
        corrStreams.streams,
        { cwd: work },
      );
      assert.equal(corrCode, 0, corrStreams.err());
      assert.equal(corrStreams.err(), '');
      const corrSummary = JSON.parse(corrStreams.out()) as { ok: boolean; count: number };
      assert.equal(corrSummary.ok, true);
      assert.equal(corrSummary.count, 1);

      const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
        guidToPath: Record<string, string>;
      };
      assert.equal(map.guidToPath[TARGET_GUID], 'target note.md', 'step-by-step: guidToPath');

      const rewriteStreams = makeStreams();
      const rewriteCode = await main(
        ['rewrite', '--vault-dir', vaultRoot, '--map', mapPath, '--out-dir', outVault],
        rewriteStreams.streams,
        { cwd: work },
      );
      assert.equal(rewriteCode, 0, `step-by-step rewrite: ${rewriteStreams.err()}`);
      assert.equal(rewriteStreams.err(), '', 'step-by-step rewrite: stderr');
      const rewriteSummary = JSON.parse(rewriteStreams.out()) as {
        filesChanged: number;
        replacements: number;
      };
      assert.equal(rewriteSummary.filesChanged, 1, 'step-by-step rewrite: filesChanged');
      assert.equal(rewriteSummary.replacements, 1, 'step-by-step rewrite: replacements');

      await assertPipelineArtifacts(snapshotPath, mapPath, outVault, 'step-by-step');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('run subcommand rewrites Evernote URLs in one invocation', async () => {
    const work = await mkdtemp(join(tmpdir(), 'eo-pipeline-e2e-run-'));
    const vaultRoot = join(work, 'vault');
    const dbPath = join(work, 'en.db');
    const snapshotPath = join(work, 'out', 'evernote-notes.json');
    const mapPath = join(work, 'out', 'link-map.json');
    const outVault = join(work, 'out', 'rewritten-vault');

    try {
      createMinimalBackupDb(dbPath);
      await seedPipelineVault(vaultRoot);

      const runStreams = makeStreams();
      const runCode = await main(
        [
          'run',
          '--vault-dir',
          vaultRoot,
          '--db',
          dbPath,
          '--out',
          snapshotPath,
          '--map-out',
          mapPath,
          '--out-dir',
          outVault,
        ],
        runStreams.streams,
        { cwd: work },
      );
      assert.equal(runCode, 0, `run subcommand: ${runStreams.err()}`);
      assert.equal(runStreams.err(), '', 'run subcommand: stderr');

      const summaries = parseJsonOutputs(runStreams.out());
      assert.equal(summaries.length, 3, 'run subcommand: stdout JSON summary count');
      const snapSummary = summaries[0] as { ok: boolean; count: number };
      const corrSummary = summaries[1] as { ok: boolean; count: number };
      const rewriteSummary = summaries[2] as {
        mode: string;
        filesChanged: number;
        replacements: number;
        wroteFiles: boolean;
      };
      assert.equal(snapSummary.ok, true, 'run subcommand: snapshot summary ok');
      assert.equal(snapSummary.count, 1, 'run subcommand: snapshot count');
      assert.equal(corrSummary.ok, true, 'run subcommand: correlate summary ok');
      assert.equal(corrSummary.count, 1, 'run subcommand: correlate count');
      assert.equal(rewriteSummary.mode, 'out-dir', 'run subcommand: rewrite mode');
      assert.equal(rewriteSummary.wroteFiles, true, 'run subcommand: wroteFiles');
      assert.equal(rewriteSummary.filesChanged, 1, 'run subcommand: filesChanged');
      assert.equal(rewriteSummary.replacements, 1, 'run subcommand: replacements');

      await assertPipelineArtifacts(snapshotPath, mapPath, outVault, 'run subcommand');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('run subcommand normalizes uppercase GUID from backup DB through rewrite', async () => {
    const work = await mkdtemp(join(tmpdir(), 'eo-pipeline-e2e-upper-guid-'));
    const vaultRoot = join(work, 'vault');
    const dbPath = join(work, 'en.db');
    const snapshotPath = join(work, 'out', 'evernote-notes.json');
    const mapPath = join(work, 'out', 'link-map.json');
    const outVault = join(work, 'out', 'rewritten-vault');

    try {
      createMinimalBackupDb(dbPath, TARGET_GUID_UPPER);
      await seedPipelineVault(vaultRoot);

      const runStreams = makeStreams();
      const runCode = await main(
        [
          'run',
          '--vault-dir',
          vaultRoot,
          '--db',
          dbPath,
          '--out',
          snapshotPath,
          '--map-out',
          mapPath,
          '--out-dir',
          outVault,
        ],
        runStreams.streams,
        { cwd: work },
      );
      assert.equal(runCode, 0, `run uppercase guid: ${runStreams.err()}`);
      assert.equal(runStreams.err(), '', 'run uppercase guid: stderr');

      const summaries = parseJsonOutputs(runStreams.out());
      assert.equal(summaries.length, 3);
      const rewriteSummary = summaries[2] as { replacements: number };
      assert.equal(rewriteSummary.replacements, 1, 'run uppercase guid: replacements');

      await assertPipelineArtifacts(snapshotPath, mapPath, outVault, 'run uppercase guid');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
