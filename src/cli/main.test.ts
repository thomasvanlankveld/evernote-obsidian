import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeStreams, parseJsonOutputs } from './cliTestHelpers.ts';
import { main } from './main.ts';

const cliDir = dirname(fileURLToPath(import.meta.url));
const uniqueFixtureVault = join(cliDir, '../vault/__fixtures__/unique');
const collisionFixtureVault = join(cliDir, '../vault/__fixtures__/collision');
const linksFixtureDir = join(cliDir, '../vault/__fixtures__/links');

describe('cli main', () => {
  it('prints usage and exits 0 with no arguments', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main([], streams);
    assert.equal(code, 0);
    assert.match(out(), /Usage:/);
    assert.equal(err(), '');
  });

  it('prints usage and exits 0 with --help', async () => {
    const { streams, out } = makeStreams();
    const code = await main(['--help'], streams);
    assert.equal(code, 0);
    assert.match(out(), /Usage:/);
  });

  it('prints version and exits 0 with --version', async () => {
    const { streams, out } = makeStreams();
    const code = await main(['--version'], streams);
    assert.equal(code, 0);
    assert.match(out(), /^\d+\.\d+\.\d+/);
  });

  it('exits 2 with unknown command', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['mystery'], streams);
    assert.equal(code, 2);
    assert.match(err(), /Unknown command: mystery/);
  });

  it('index exits 0 and prints JSON for a unique vault', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(['index', '--vault-dir', uniqueFixtureVault], streams);
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as { ok: boolean; count: number };
    assert.equal(j.ok, true);
    assert.equal(j.count, 3);
  });

  it('index exits 1 with collisions JSON on stderr', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(['index', '--vault-dir', collisionFixtureVault], streams);
    assert.equal(code, 1);
    assert.equal(out(), '');
    const j = JSON.parse(err()) as { ok: boolean; collisions: unknown[] };
    assert.equal(j.ok, false);
    assert.equal(j.collisions.length, 1);
  });

  it('index exits 0 with --vault alias', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(['index', '--vault', uniqueFixtureVault], streams);
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as { ok: boolean; count: number };
    assert.equal(j.ok, true);
    assert.equal(j.count, 3);
  });

  it('index exits 2 when --vault-dir has no path', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault-dir'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault-dir requires a path/);
  });

  it('index exits 2 when --vault-dir is followed by another flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault-dir', '--help'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault-dir requires a path/);
  });

  it('index exits 2 when --vault-dir= has empty value', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault-dir='], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault-dir=/);
  });

  it('index exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown index flag: --nope/);
  });

  it('index exits 2 on extra positional arguments', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault-dir', uniqueFixtureVault, 'typo', 'extra'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown index flag: typo/);
  });

  it('index exits 2 when --vault has no path', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault requires a path/);
  });

  it('index exits 2 when vault root is not a directory', async () => {
    const { streams, err } = makeStreams();
    const fileVault = join(cliDir, '../vault/__fixtures__/unique/first.md');
    const code = await main(['index', '--vault-dir', fileVault], streams);
    assert.equal(code, 2);
    assert.match(err(), /^index: /);
  });

  it('snapshot exits 2 when --db is missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['snapshot'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--db/);
  });

  it('snapshot exits 0 and writes JSON envelope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-snapshot-cli-'));
    const dbPath = join(dir, 'en.db');
    const outPath = join(dir, 'evernote-notes.json');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('g1', 'Hello', 1);
    `);
    db.close();
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(['snapshot', '--db', dbPath, '--out', outPath], streams, {
        cwd: dir,
      });
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as { ok: boolean; count: number; host: string };
      assert.equal(summary.ok, true);
      assert.equal(summary.count, 1);
      assert.equal(summary.host, 'evernote-backup');

      const fileJson = JSON.parse(await readFile(outPath, 'utf8')) as {
        version: number;
        host: string;
        notes: { guid: string; title: string }[];
      };
      assert.equal(fileJson.version, 1);
      assert.equal(fileJson.host, 'evernote-backup');
      assert.equal(fileJson.notes.length, 1);
      assert.equal(fileJson.notes[0]?.guid, 'g1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('snapshot exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['snapshot', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown snapshot flag/);
  });

  it('snapshot exits 2 when --max-notes is not a positive integer', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['snapshot', '--max-notes', '0'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--max-notes/);
    assert.match(err(), /positive integer/);
  });

  it('links exits 0 and prints JSON with extracted rows', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(['links', '--vault-dir', linksFixtureDir], streams);
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as { ok: boolean; links: { parsedGuid: string | null }[] };
    assert.equal(j.ok, true);
    assert.ok(j.links.length >= 3);
  });

  it('links exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['links', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown links flag/);
  });

  it('fix-resources dry-run lists importer resource embed changes', async () => {
    const fixture = join(cliDir, '../vault/__fixtures__/resources');
    const { streams, out, err } = makeStreams();
    const code = await main(['fix-resources', '--vault-dir', fixture], streams);
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as {
      ok: boolean;
      mode: string;
      replacements: number;
      changes: { file: string; line: number }[];
    };
    assert.equal(j.ok, true);
    assert.equal(j.mode, 'dry-run');
    assert.equal(j.replacements, 2);
    assert.equal(j.changes.length, 2);
  });

  it('fix-resources exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(
      ['fix-resources', '--vault-dir', uniqueFixtureVault, '--nope'],
      streams,
    );
    assert.equal(code, 2);
    assert.match(err(), /unknown fix-resources flag/);
  });

  it('correlate exits 2 when --snapshot is missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['correlate'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--snapshot/);
  });

  it('correlate exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['correlate', '--snapshot', '/tmp/x.json', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown correlate flag/);
  });

  it('correlate exits 2 when --map is passed', async () => {
    const { streams, err } = makeStreams();
    const code = await main(
      ['correlate', '--snapshot', '/tmp/x.json', '--map', '/tmp/link-map.json'],
      streams,
    );
    assert.equal(code, 2);
    assert.match(err(), /correlate does not accept --map/);
  });

  it('correlate exits 0 and writes link-map.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-cli-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const outPath = join(dir, 'link-map.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [
        { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
        { guid: 'g2', title: 'Second Note', updated: '1970-01-01T00:00:00.000Z' },
        { guid: 'g3', title: 'Quoted Title', updated: '1970-01-01T00:00:00.000Z' },
      ],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['correlate', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath, '--out', outPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /Vault: 3 markdown files/);
      assert.match(err(), /Evernote: 3 notes in snapshot/);
      const summary = JSON.parse(out()) as { ok: boolean; count: number; path: string };
      assert.equal(summary.ok, true);
      assert.equal(summary.count, 3);

      const map = JSON.parse(await readFile(outPath, 'utf8')) as {
        version: number;
        guidToPath: Record<string, string>;
      };
      assert.equal(map.version, 1);
      assert.equal(map.guidToPath.g1, 'first.md');
      assert.equal(map.guidToPath.g2, 'sub/second note.md');
      assert.equal(map.guidToPath.g3, 'third.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('guid-backfill exits 2 when --snapshot is missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['guid-backfill'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--snapshot/);
  });

  it('guid-backfill dry-run lists paths that would be updated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-guid-backfill-dry-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [
        { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
        { guid: 'g2', title: 'Second Note', updated: '1970-01-01T00:00:00.000Z' },
        { guid: 'g3', title: 'Quoted Title', updated: '1970-01-01T00:00:00.000Z' },
      ],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['guid-backfill', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as {
        ok: boolean;
        mode: string;
        wouldUpdate: string[];
        updated: number;
      };
      assert.equal(summary.ok, true);
      assert.equal(summary.mode, 'dry-run');
      assert.equal(summary.updated, 0);
      assert.deepEqual(summary.wouldUpdate.sort(), ['first.md', 'sub/second note.md', 'third.md']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('guid-backfill --in-place writes evernote-guid frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-guid-backfill-inplace-'));
    const vaultDir = join(dir, 'vault');
    await cp(uniqueFixtureVault, vaultDir, { recursive: true });
    const snapPath = join(dir, 'evernote-notes.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out } = makeStreams();
      const code = await main(
        ['guid-backfill', '--vault-dir', vaultDir, '--snapshot', snapPath, '--in-place'],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      const summary = JSON.parse(out()) as { updated: number };
      assert.equal(summary.updated, 1);
      const body = await readFile(join(vaultDir, 'first.md'), 'utf8');
      assert.match(body, /^---\nevernote-guid: g1\n---\n\n# First/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('guid-backfill exits 1 on GUID mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-guid-backfill-conflict-'));
    const vaultDir = join(dir, 'vault');
    const overridesPath = join(dir, 'overrides.json');
    await mkdir(vaultDir, { recursive: true });
    await writeFile(join(vaultDir, 'note.md'), '---\nevernote-guid: other-guid\n---\n\n', 'utf8');
    await writeFile(
      overridesPath,
      `${JSON.stringify({ version: 1, byGuid: { g1: 'note.md' } })}\n`,
      'utf8',
    );
    const snapPath = join(dir, 'evernote-notes.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'g1', title: 'Note', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out } = makeStreams();
      const code = await main(
        [
          'guid-backfill',
          '--vault-dir',
          vaultDir,
          '--snapshot',
          snapPath,
          '--overrides',
          overridesPath,
        ],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      const summary = JSON.parse(out()) as { conflicts: number; conflictDetails: unknown[] };
      assert.equal(summary.conflicts, 1);
      assert.equal(summary.conflictDetails.length, 1);
      const body = await readFile(join(vaultDir, 'note.md'), 'utf8');
      assert.match(body, /evernote-guid: other-guid/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('correlate exits 1 when a snapshot title has no vault match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-unmatched-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const outPath = join(dir, 'link-map.json');
    const reportPath = join(dir, 'correlate-report.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'gx', title: 'Nope Nope', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        [
          'correlate',
          '--vault-dir',
          uniqueFixtureVault,
          '--snapshot',
          snapPath,
          '--out',
          outPath,
          '--report',
          reportPath,
        ],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      assert.equal(out(), '');
      const stderr = err();
      assert.match(stderr, /1 Evernote note.*1 unmatched/);
      assert.match(stderr, /Next steps:/);
      assert.match(stderr, /correlate-report\.json/);
      const stderrObjects = parseJsonOutputs(stderr) as {
        ok: boolean;
        reason?: string;
        counts?: { unmatched: number };
        reportMarkdownPath?: string;
        unmatched?: unknown[];
      }[];
      const summary = stderrObjects.find((o) => o.counts !== undefined);
      assert.equal(summary?.ok, false);
      assert.equal(summary?.reason, 'correlation_failed');
      assert.equal(summary?.counts?.unmatched, 1);
      assert.equal(summary?.reportMarkdownPath, './correlate-report.md');
      assert.equal(
        stderrObjects.some((o) => o.unmatched !== undefined),
        false,
      );

      const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        ok: boolean;
        unmatched: { guid: string }[];
      };
      assert.equal(report.ok, false);
      assert.equal(report.unmatched.length, 1);

      const mdPath = join(dir, 'correlate-report.md');
      const md = await readFile(mdPath, 'utf8');
      assert.match(md, /## Unmatched/);
      assert.match(md, /Nope Nope/);
      assert.match(md, /\| gx \|/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('correlate --no-report-md skips Markdown report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-no-md-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const reportPath = join(dir, 'correlate-report.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'gx', title: 'Nope Nope', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, err } = makeStreams();
      const code = await main(
        [
          'correlate',
          '--vault-dir',
          uniqueFixtureVault,
          '--snapshot',
          snapPath,
          '--report',
          reportPath,
          '--no-report-md',
        ],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      const summary = parseJsonOutputs(err()).find(
        (o) => typeof o === 'object' && o !== null && 'counts' in (o as object),
      ) as { reportMarkdownPath?: string } | undefined;
      assert.equal(summary?.reportMarkdownPath, undefined);
      await assert.rejects(() => readFile(join(dir, 'correlate-report.md'), 'utf8'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('correlate TTY stderr hints at Markdown report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-md-hint-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'gx', title: 'Nope Nope', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, err } = makeStreams({ stdoutTty: true });
      const code = await main(
        ['correlate', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      assert.match(err(), /Human-readable details:.*correlate-report\.md/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('correlate --verbose prints full failure JSON on stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-verbose-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'gx', title: 'Nope Nope', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, err } = makeStreams();
      const code = await main(
        ['correlate', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath, '--verbose'],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      const stderrObjects = parseJsonOutputs(err()) as {
        ok: boolean;
        counts?: { unmatched: number };
        unmatched?: { guid: string }[];
      }[];
      const summary = stderrObjects.find((o) => o.counts !== undefined);
      const full = stderrObjects.find((o) => o.unmatched !== undefined);
      assert.equal(summary?.counts?.unmatched, 1);
      assert.equal(full?.ok, false);
      assert.equal(full?.unmatched?.length, 1);
      assert.equal(full?.unmatched?.[0]?.guid, 'gx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rewrite exits 2 when --map is missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['rewrite'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--map/);
  });

  it('rewrite exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['rewrite', '--map', '/tmp/x.json', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown rewrite flag/);
  });

  it('unescape-links is documented in usage', async () => {
    const { streams, out } = makeStreams();
    const code = await main(['--help'], streams);
    assert.equal(code, 0);
    assert.match(out(), /unescape-links/);
  });

  it('unescape-links exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['unescape-links', '--nope'], streams);
    assert.equal(code, 2);
    assert.match(err(), /unknown unescape-links flag/);
  });

  it('rewrite exits 2 when --dry-run is combined with --out-dir', async () => {
    const { streams, err } = makeStreams();
    const code = await main(
      ['rewrite', '--map', '/tmp/x.json', '--dry-run', '--out-dir', '/tmp/y'],
      streams,
    );
    assert.equal(code, 2);
    assert.match(err(), /--dry-run/);
  });

  it('rewrite exits 0 in dry-run default and reports replacements', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-rewrite-dry-'));
    const mapPath = join(dir, 'link-map.json');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['rewrite', '--vault-dir', linksFixtureDir, '--map', mapPath],
        streams,
        {
          cwd: dir,
        },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as {
        mode: string;
        wroteFiles: boolean;
        filesChanged: number;
        replacements: number;
      };
      assert.equal(summary.mode, 'dry-run');
      assert.equal(summary.wroteFiles, false);
      assert.ok(summary.filesChanged >= 1);
      assert.ok(summary.replacements >= 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rewrite --in-place overwrites vault markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-rewrite-inplace-'));
    const vaultDir = join(dir, 'vault');
    await cp(linksFixtureDir, vaultDir, { recursive: true });
    const mapPath = join(dir, 'link-map.json');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: vaultDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['rewrite', '--vault-dir', vaultDir, '--map', mapPath, '--in-place'],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as { mode: string; wroteFiles: boolean };
      assert.equal(summary.mode, 'in-place');
      assert.equal(summary.wroteFiles, true);
      const mixed = await readFile(join(vaultDir, 'mixed.md'), 'utf8');
      assert.match(mixed, /\[\[other\.md\|My note alias\]\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 2 when --vault-dir is missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['run', '--db', '/tmp/x.db'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault-dir/);
  });

  it('run exits 2 when --vault-dir has no path', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['run', '--vault-dir', '--db', '/tmp/x.db'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault-dir requires a path/);
  });

  it('run exits 2 when --db, --snapshot, and --map are all missing', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['run', '--vault-dir', uniqueFixtureVault], streams);
    assert.equal(code, 2);
    assert.match(err(), /--db/);
    assert.match(err(), /--map/);
  });

  it('run exits 2 on unknown flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(
      ['run', '--vault-dir', uniqueFixtureVault, '--db', '/tmp/x.db', '--nope'],
      streams,
    );
    assert.equal(code, 2);
    assert.match(err(), /unknown run flag/);
  });

  it('run chains snapshot, correlate, and rewrite (dry-run)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-cli-'));
    const dbPath = join(dir, 'en.db');
    const snapOut = join(dir, 'evernote-notes.json');
    const mapOut = join(dir, 'link-map.json');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('g1', 'First', 1);
      INSERT INTO notes(guid, title, is_active) VALUES ('g2', 'Second Note', 1);
      INSERT INTO notes(guid, title, is_active) VALUES ('g3', 'Quoted Title', 1);
    `);
    db.close();
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        [
          'run',
          '--vault-dir',
          uniqueFixtureVault,
          '--db',
          dbPath,
          '--out',
          snapOut,
          '--map-out',
          mapOut,
        ],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /Preflight:/);
      assert.match(err(), /Vault:\s+3 markdown/);
      assert.match(err(), /Evernote:\s+3 notes in Evernote DB/);
      assert.doesNotMatch(err(), /have evernote-guid frontmatter/);

      const report = JSON.parse(out()) as {
        ok: boolean;
        steps: {
          id: string;
          status: string;
          summary?: {
            ok?: boolean;
            count?: number;
            replacements?: number;
            mode?: string;
            wroteFiles?: boolean;
          };
        }[];
      };
      assert.equal(report.ok, true);
      assert.equal(report.steps.length, 5);
      assert.equal(report.steps[0]?.summary?.count, 3);
      assert.equal(report.steps[1]?.summary?.count, 3);
      assert.equal(report.steps[2]?.summary?.replacements, 0);
      assert.equal(report.steps[3]?.summary?.mode, 'dry-run');
      assert.equal(report.steps[3]?.summary?.wroteFiles, false);
      assert.equal(report.steps[4]?.summary?.mode, 'dry-run');
      assert.equal(report.steps[4]?.summary?.wroteFiles, false);

      const snapStat = await stat(snapOut);
      assert.ok(snapStat.isFile());
      const map = JSON.parse(await readFile(mapOut, 'utf8')) as {
        guidToPath: Record<string, string>;
      };
      assert.equal(map.guidToPath.g1, 'first.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run skips snapshot when --snapshot is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-skip-snap-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const mapOut = join(dir, 'link-map.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' }],
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath, '--map-out', mapOut],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /Preflight:/);
      assert.match(err(), /Vault:\s+3 markdown/);
      assert.match(err(), /Evernote:\s+1 note in snapshot/);
      const report = JSON.parse(out()) as {
        ok: boolean;
        steps: { id: string; status: string; summary?: { ok?: boolean } }[];
      };
      assert.equal(report.ok, true);
      assert.equal(report.steps[0]?.status, 'skipped');
      assert.equal(report.steps[1]?.summary?.ok, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run warns when --db and --map are both set without --snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-db-map-warn-'));
    const mapPath = join(dir, 'link-map.json');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', linksFixtureDir, '--map', mapPath, '--db', join(dir, 'unused.db')],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /--map skips the snapshot step/);
      assert.match(err(), /--db is ignored/);
      const report = JSON.parse(out()) as { ok: boolean; steps: { status: string }[] };
      assert.equal(report.ok, true);
      assert.equal(report.steps.filter((s) => s.status === 'skipped').length, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run skips correlate when --map is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-skip-corr-'));
    const mapPath = join(dir, 'link-map.json');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(['run', '--vault-dir', linksFixtureDir, '--map', mapPath], streams, {
        cwd: dir,
      });
      assert.equal(code, 0);
      assert.equal(err(), '');
      const report = JSON.parse(out()) as {
        ok: boolean;
        steps: {
          id: string;
          summary?: { mode?: string; replacements?: number; filesChanged?: number };
        }[];
      };
      assert.equal(report.ok, true);
      const rewriteSummary = report.steps.find((s) => s.id === 'rewrite')?.summary;
      assert.equal(rewriteSummary?.mode, 'dry-run');
      assert.ok((rewriteSummary?.replacements ?? 0) >= 3);
      assert.ok((rewriteSummary?.filesChanged ?? 0) >= 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run skips snapshot and correlate when --snapshot and --map are provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-skip-both-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const mapPath = join(dir, 'link-map.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [{ guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' }],
    };
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: uniqueFixtureVault,
      snapshotPath: snapPath,
      guidToPath: { g1: 'first.md' },
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath, '--map', mapPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /Preflight:/);
      const report = JSON.parse(out()) as {
        ok: boolean;
        steps: { id: string; status: string; summary?: { mode?: string } }[];
      };
      assert.equal(report.ok, true);
      assert.equal(report.steps.filter((s) => s.status === 'skipped').length, 2);
      assert.equal(report.steps.find((s) => s.id === 'rewrite')?.summary?.mode, 'dry-run');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 2 when preflight cannot read --db', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-bad-db-'));
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', uniqueFixtureVault, '--db', join(dir, 'missing.db')],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 2);
      assert.equal(out(), '');
      assert.match(err(), /run: preflight:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 1 when correlate finds unmatched snapshot titles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-unmatched-'));
    const dbPath = join(dir, 'en.db');
    const reportPath = join(dir, 'out', 'correlate-report.json');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('gx', 'Nope Nope', 1);
    `);
    db.close();
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(['run', '--vault-dir', uniqueFixtureVault, '--db', dbPath], streams, {
        cwd: dir,
      });
      assert.equal(code, 1);
      const report = JSON.parse(out()) as {
        ok: boolean;
        failedStep?: string;
        steps: {
          id: string;
          humanDetail?: string;
          summary?: {
            reason?: string;
            counts?: { unmatched: number };
            reportMarkdownPath?: string;
          };
        }[];
      };
      assert.equal(report.ok, false);
      assert.equal(report.failedStep, 'correlate');
      const correlateStep = report.steps.find((s) => s.id === 'correlate');
      assert.match(correlateStep?.humanDetail ?? '', /Evernote note.*unmatched/);
      assert.equal(correlateStep?.summary?.reason, 'correlation_failed');
      assert.equal(correlateStep?.summary?.counts?.unmatched, 1);
      assert.equal(correlateStep?.summary?.reportMarkdownPath, './out/correlate-report.md');
      assert.match(err(), /Run failed at correlate/);
      const correlateReportFile = JSON.parse(await readFile(reportPath, 'utf8')) as {
        unmatched: { guid: string }[];
      };
      assert.equal(correlateReportFile.unmatched.length, 1);
      const correlateMarkdownReport = await readFile(
        join(dir, 'out', 'correlate-report.md'),
        'utf8',
      );
      assert.match(correlateMarkdownReport, /## Unmatched/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run --no-report-md skips correlate Markdown report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-unmatched-no-md-'));
    const dbPath = join(dir, 'en.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('gx', 'Nope Nope', 1);
    `);
    db.close();
    try {
      const { streams, out } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', uniqueFixtureVault, '--db', dbPath, '--no-report-md'],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      const report = JSON.parse(out()) as {
        steps: { id: string; summary?: { reportMarkdownPath?: string } }[];
      };
      const correlateStep = report.steps.find((s) => s.id === 'correlate');
      assert.equal(correlateStep?.summary?.reportMarkdownPath, undefined);
      await assert.rejects(() => readFile(join(dir, 'out', 'correlate-report.md'), 'utf8'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run TTY prints human correlate failure on stderr without stdout JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-unmatched-tty-'));
    const dbPath = join(dir, 'en.db');
    const reportPath = join(dir, 'out', 'correlate-report.json');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('gx', 'Nope Nope', 1);
    `);
    db.close();
    try {
      const { streams, out, err } = makeStreams({ stdoutTty: true });
      const code = await main(['run', '--vault-dir', uniqueFixtureVault, '--db', dbPath], streams, {
        cwd: dir,
      });
      assert.equal(code, 1);
      assert.equal(parseJsonOutputs(out()).length, 0, 'TTY run failure: no stdout JSON');
      assert.match(err(), /evernote-obsidian run/);
      assert.match(err(), /✗ correlate \(vault matching\)/);
      assert.match(err(), /Evernote note.*unmatched/);
      assert.match(err(), /details: .*correlate-report\.json/);
      assert.match(err(), /Run failed at correlate/);
      assert.doesNotMatch(err(), /"ok":\s*false/, 'no duplicate correlate failure JSON on stderr');
      const correlateReportFile = JSON.parse(await readFile(reportPath, 'utf8')) as {
        unmatched: { guid: string }[];
      };
      assert.equal(correlateReportFile.unmatched.length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 1 when vault has title collisions (preflight)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-collision-'));
    const dbPath = join(dir, 'en.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE notes(
        guid TEXT PRIMARY KEY,
        title TEXT,
        notebook_guid TEXT,
        is_active BOOLEAN,
        raw_note BLOB
      );
      INSERT INTO notes(guid, title, is_active) VALUES ('g1', 'Shared', 1);
    `);
    db.close();
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', collisionFixtureVault, '--db', dbPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      assert.equal(out(), '');
      assert.match(err(), /Preflight:/);
      assert.match(err(), /vault index collision/);
      assert.doesNotMatch(err(), /Run failed at/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run continues after count-mismatch preflight hint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-preflight-hint-'));
    const vaultDir = join(dir, 'vault');
    await mkdir(vaultDir);
    for (let i = 0; i < 12; i++) {
      await writeFile(join(vaultDir, `note-${i}.md`), `---\ntitle: Note ${i}\n---\n`);
    }
    const snapPath = join(dir, 'evernote-notes.json');
    const mapPath = join(dir, 'link-map.json');
    const snapshot = {
      version: 1,
      writtenAt: '2026-01-01T00:00:00.000Z',
      host: 'evernote-backup',
      notes: [
        { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
        { guid: 'g2', title: 'Second', updated: '1970-01-01T00:00:00.000Z' },
      ],
    };
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: vaultDir,
      snapshotPath: snapPath,
      guidToPath: { g1: 'note-0.md', g2: 'note-1.md' },
    };
    await writeFile(snapPath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', vaultDir, '--snapshot', snapPath, '--map', mapPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.match(err(), /Vault has more markdown files than Evernote/);
      const report = JSON.parse(out()) as { ok: boolean };
      assert.equal(report.ok, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run --help documents run in usage', async () => {
    const { streams, out } = makeStreams();
    const code = await main([], streams);
    assert.equal(code, 0);
    assert.match(out(), /\brun\b/);
    assert.match(out(), /snapshot → correlate → unescape-links → rewrite → fix-resources/);
    assert.match(out(), /\[--db <path>\]/);
  });

  it('run --out-dir writes mirrored markdown when --map is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-out-dir-'));
    const mapPath = join(dir, 'link-map.json');
    const outVault = join(dir, 'out-vault');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['run', '--vault-dir', linksFixtureDir, '--map', mapPath, '--out-dir', outVault],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const report = JSON.parse(out()) as {
        ok: boolean;
        steps: { id: string; summary?: { mode?: string; wroteFiles?: boolean } }[];
      };
      assert.equal(report.ok, true);
      const rewriteSummary = report.steps.find((s) => s.id === 'rewrite')?.summary;
      assert.equal(rewriteSummary?.mode, 'out-dir');
      assert.equal(rewriteSummary?.wroteFiles, true);
      const mixed = await readFile(join(outVault, 'mixed.md'), 'utf8');
      assert.match(mixed, /\[\[other\.md\|My note alias\]\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rewrite exits 2 when link map vaultRoot does not match --vault-dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-rewrite-vault-mismatch-'));
    const mapPath = join(dir, 'link-map.json');
    const outVault = join(dir, 'out-vault');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    const mixedPath = join(linksFixtureDir, 'mixed.md');
    const before = await readFile(mixedPath, 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['rewrite', '--vault-dir', uniqueFixtureVault, '--map', mapPath, '--dry-run'],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 2);
      assert.equal(out(), '');
      assert.match(err(), /vaultRoot/);
      assert.match(err(), /re-run correlate/);
      assert.match(err(), new RegExp(resolve(linksFixtureDir)));
      assert.match(err(), new RegExp(resolve(uniqueFixtureVault)));
      const after = await readFile(mixedPath, 'utf8');
      assert.equal(after, before);

      const outCode = await main(
        ['rewrite', '--vault-dir', uniqueFixtureVault, '--map', mapPath, '--out-dir', outVault],
        streams,
        { cwd: dir },
      );
      assert.equal(outCode, 2);
      await assert.rejects(stat(outVault));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rewrite --out-dir writes mirrored markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-rewrite-out-'));
    const mapPath = join(dir, 'link-map.json');
    const outVault = join(dir, 'out-vault');
    const map = {
      version: 1,
      writtenAt: 't',
      vaultRoot: linksFixtureDir,
      snapshotPath: '/x',
      guidToPath: {
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'other.md',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'b.md',
        'cccccccc-cccc-cccc-cccc-cccccccccccc': 'c.md',
      },
    };
    await writeFile(mapPath, JSON.stringify(map), 'utf8');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['rewrite', '--vault-dir', linksFixtureDir, '--map', mapPath, '--out-dir', outVault],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as { mode: string; wroteFiles: boolean };
      assert.equal(summary.mode, 'out-dir');
      assert.equal(summary.wroteFiles, true);
      const mixed = await readFile(join(outVault, 'mixed.md'), 'utf8');
      assert.match(mixed, /\[\[other\.md\|My note alias\]\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
