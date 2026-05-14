import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type MainStreams, main } from './main.ts';

const cliDir = dirname(fileURLToPath(import.meta.url));
const uniqueFixtureVault = join(cliDir, '../vault/__fixtures__/unique');
const collisionFixtureVault = join(cliDir, '../vault/__fixtures__/collision');
const linksFixtureDir = join(cliDir, '../vault/__fixtures__/links');

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
    const code = await main(['index', '--vault', uniqueFixtureVault], streams);
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as { ok: boolean; count: number };
    assert.equal(j.ok, true);
    assert.equal(j.count, 3);
  });

  it('index exits 1 with collisions JSON on stderr', async () => {
    const { streams, out, err } = makeStreams();
    const code = await main(['index', '--vault', collisionFixtureVault], streams);
    assert.equal(code, 1);
    assert.equal(out(), '');
    const j = JSON.parse(err()) as { ok: boolean; collisions: unknown[] };
    assert.equal(j.ok, false);
    assert.equal(j.collisions.length, 1);
  });

  it('index exits 2 when --vault has no path', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault requires a path/);
  });

  it('index exits 2 when --vault is followed by another flag', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault', '--help'], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault requires a path/);
  });

  it('index exits 2 when --vault= has empty value', async () => {
    const { streams, err } = makeStreams();
    const code = await main(['index', '--vault='], streams);
    assert.equal(code, 2);
    assert.match(err(), /--vault=/);
  });

  it('index exits 2 when vault root is not a directory', async () => {
    const { streams, err } = makeStreams();
    const fileVault = join(cliDir, '../vault/__fixtures__/unique/first.md');
    const code = await main(['index', '--vault', fileVault], streams);
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
    const code = await main(['links', '--vault', linksFixtureDir], streams);
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
});
