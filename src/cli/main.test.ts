import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
      assert.equal(err(), '');
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

  it('correlate exits 1 when a snapshot title has no vault match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-correlate-unmatched-'));
    const snapPath = join(dir, 'evernote-notes.json');
    const outPath = join(dir, 'link-map.json');
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
        ['correlate', '--vault-dir', uniqueFixtureVault, '--snapshot', snapPath, '--out', outPath],
        streams,
        { cwd: dir },
      );
      assert.equal(code, 1);
      assert.equal(out(), '');
      const j = JSON.parse(err()) as { ok: boolean; unmatched: { guid: string }[] };
      assert.equal(j.ok, false);
      assert.equal(j.unmatched.length, 1);
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
      assert.equal(err(), '');

      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 3);
      const snapSummary = summaries[0] as { ok: boolean; count: number };
      const corrSummary = summaries[1] as { ok: boolean; count: number };
      const rewriteSummary = summaries[2] as { mode: string; wroteFiles: boolean };
      assert.equal(snapSummary.ok, true);
      assert.equal(snapSummary.count, 3);
      assert.equal(corrSummary.ok, true);
      assert.equal(corrSummary.count, 3);
      assert.equal(rewriteSummary.mode, 'dry-run');
      assert.equal(rewriteSummary.wroteFiles, false);

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
      assert.equal(err(), '');
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 2);
      const corrSummary = summaries[0] as { ok: boolean };
      assert.equal(corrSummary.ok, true);
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
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 1);
      const rewriteSummary = summaries[0] as {
        mode: string;
        replacements: number;
        filesChanged: number;
      };
      assert.equal(rewriteSummary.mode, 'dry-run');
      assert.ok(rewriteSummary.replacements >= 3);
      assert.ok(rewriteSummary.filesChanged >= 1);
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
      assert.equal(err(), '');
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 1);
      assert.equal((summaries[0] as { mode: string }).mode, 'dry-run');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 2 when snapshot step fails (missing db file)', async () => {
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
      assert.match(err(), /^snapshot:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 1 when correlate finds unmatched snapshot titles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evernote-obs-run-unmatched-'));
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
      const { streams, out, err } = makeStreams();
      const code = await main(['run', '--vault-dir', uniqueFixtureVault, '--db', dbPath], streams, {
        cwd: dir,
      });
      assert.equal(code, 1);
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 1);
      const j = JSON.parse(err()) as { ok: boolean; reason: string };
      assert.equal(j.ok, false);
      assert.equal(j.reason, 'correlation_failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run exits 1 when vault has title collisions (correlate step)', async () => {
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
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 1);
      const j = JSON.parse(err()) as { ok: boolean; reason: string };
      assert.equal(j.ok, false);
      assert.equal(j.reason, 'vault_index_collisions');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('run --help documents run in usage', async () => {
    const { streams, out } = makeStreams();
    const code = await main([], streams);
    assert.equal(code, 0);
    assert.match(out(), /\brun\b/);
    assert.match(out(), /snapshot → correlate → rewrite/);
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
      const summaries = parseJsonOutputs(out());
      assert.equal(summaries.length, 1);
      const summary = summaries[0] as { mode: string; wroteFiles: boolean };
      assert.equal(summary.mode, 'out-dir');
      assert.equal(summary.wroteFiles, true);
      const mixed = await readFile(join(outVault, 'mixed.md'), 'utf8');
      assert.match(mixed, /\[\[other\.md\|My note alias\]\]/);
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
