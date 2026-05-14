/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readNoteRecordsFromEvernoteBackupDb } from '../evernote/readEvernoteBackupDb.ts';
import { buildSnapshotEnvelope, writeSnapshotFile } from '../evernote/snapshotFile.ts';
import { scanVaultForEvernoteLinks } from '../vault/extractEvernoteLinks.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { readCliPackageVersion } from './packageVersion.ts';

export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution and defaults (tests). */
  cwd?: string | undefined;
}

const SNAPSHOT_METADATA_HOST = 'evernote-backup';

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
    return runSnapshot(parsed.snapshot, streams);
  }

  if (cmd === 'links') {
    const parsed = parseLinksArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runLinks(parsed.links, streams);
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
  dbPath: string;
  outPath: string;
  /** When set, stop after this many notes (ordered by title). */
  maxRecords?: number | undefined;
}

function parseSnapshotArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; snapshot: SnapshotCliOk } | { ok: false; message: string } {
  const defaultOut = resolve(cwd, 'out', 'evernote-notes.json');
  let outPath = defaultOut;
  let dbPath: string | undefined;
  let maxRecords: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--db') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return {
          ok: false,
          message: 'error: --db requires a path (e.g. --db ./en_backup.db)',
        };
      }
      dbPath = resolve(cwd, v);
      i++;
    } else if (a?.startsWith('--db=')) {
      const tail = a.slice('--db='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --db= requires a non-empty path' };
      }
      dbPath = resolve(cwd, tail);
    } else if (a === '--out') {
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
    } else {
      return { ok: false, message: `error: unknown snapshot flag: ${a}` };
    }
  }

  if (dbPath === undefined) {
    return {
      ok: false,
      message:
        'error: snapshot requires --db <path> (evernote-backup SQLite file, e.g. en_backup.db)',
    };
  }

  return { ok: true, snapshot: { dbPath, outPath, maxRecords } };
}

interface LinksCliOk {
  vaultRoot: string;
  skipOtherEvernoteHosts: boolean;
  outPath?: string | undefined;
}

function parseLinksArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; links: LinksCliOk } | { ok: false; message: string } {
  const defaultVault = resolve(cwd, 'data');
  let vaultRoot = defaultVault;
  let skipOtherEvernoteHosts = false;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return { ok: false, message: 'error: --vault requires a path (e.g. --vault ./data)' };
      }
      vaultRoot = resolve(cwd, v);
      i++;
    } else if (a?.startsWith('--vault=')) {
      const tail = a.slice('--vault='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --vault= requires a non-empty path' };
      }
      vaultRoot = resolve(cwd, tail);
    } else if (a === '--skip-other-evernote-hosts') {
      skipOtherEvernoteHosts = true;
    } else if (a === '--out') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return {
          ok: false,
          message: 'error: --out requires a path (e.g. --out ./out/broken-links.json)',
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
    } else {
      return { ok: false, message: `error: unknown links flag: ${a}` };
    }
  }

  return { ok: true, links: { vaultRoot, skipOtherEvernoteHosts, outPath } };
}

async function runLinks(parsed: LinksCliOk, streams: MainStreams): Promise<number> {
  try {
    const links = await scanVaultForEvernoteLinks(parsed.vaultRoot, {
      skipOtherEvernoteHosts: parsed.skipOtherEvernoteHosts,
    });
    const payload = { ok: true as const, vault: parsed.vaultRoot, links };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (parsed.outPath !== undefined) {
      await mkdir(dirname(parsed.outPath), { recursive: true });
      await writeFile(parsed.outPath, text, 'utf8');
      streams.stdout.write(
        `${JSON.stringify({ ok: true, path: parsed.outPath, count: links.length }, null, 2)}\n`,
      );
    } else {
      streams.stdout.write(text);
    }
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`links: ${msg}\n`);
    return 2;
  }
}

async function runSnapshot(parsed: SnapshotCliOk, streams: MainStreams): Promise<number> {
  try {
    const readOpts =
      parsed.maxRecords !== undefined ? { maxRecords: parsed.maxRecords } : undefined;
    const { records, sourceRowCount } = readNoteRecordsFromEvernoteBackupDb(
      parsed.dbPath,
      readOpts,
    );

    const envelope = buildSnapshotEnvelope(SNAPSHOT_METADATA_HOST, records);
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeSnapshotFile(parsed.outPath, envelope);

    const summary: Record<string, unknown> = {
      ok: true,
      path: parsed.outPath,
      db: parsed.dbPath,
      count: records.length,
      host: SNAPSHOT_METADATA_HOST,
      sourceRowCount,
    };
    if (parsed.maxRecords !== undefined && records.length < sourceRowCount) {
      summary.truncated = true;
    }

    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`snapshot: ${msg}\n`);
    streams.stderr.write(
      'snapshot: hint: pass --db to your evernote-backup database (see https://github.com/vzhd1701/evernote-backup).\n',
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
    '  evernote-obsidian snapshot --db <path> [--out <path>] [--max-notes <n>]',
    '  evernote-obsidian links [--vault <path>] [--out <path>] [--skip-other-evernote-hosts]',
    '',
    'Commands:',
    '  index      Build a read-only vault index (normalized titles must be unique).',
    '  snapshot   Read metadata from an evernote-backup SQLite DB and write the JSON snapshot.',
    '  links      Scan Markdown for Evernote note URLs and other evernote.com links (report only).',
    '',
    'Options:',
    '  --vault                        Vault root directory (default: ./data relative to cwd)',
    '  --skip-other-evernote-hosts    Omit non-shard *.evernote.com URLs from the links report',
    '  --db                           Path to evernote-backup SQLite database (required for snapshot)',
    '  --out                          Output path (snapshot default: ./out/evernote-notes.json; links: stdout unless set)',
    '  --max-notes                    Stop after N notes (optional cap; notes ordered by title)',
    '',
    '  evernote-backup: https://github.com/vzhd1701/evernote-backup',
    '',
  ].join('\n');
}

function version(): string {
  return readCliPackageVersion();
}
