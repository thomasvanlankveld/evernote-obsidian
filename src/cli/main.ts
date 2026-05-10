/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fetchAllNoteRecords } from '../evernote/fetchNoteRecords.ts';
import { buildSnapshotEnvelope, writeSnapshotFile } from '../evernote/snapshotFile.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { loadDotEnvFromCwd } from './loadDotEnv.ts';
import { readCliPackageVersion } from './packageVersion.ts';

export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution, `.env` loading, and defaults (tests). */
  cwd?: string | undefined;
}

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
    return runSnapshot(parsed.snapshot, cwd, streams);
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
  outPath: string;
  pageSize: number;
  sleepBetweenPagesMs: number;
  /** When set, stop after this many notes (newest first). */
  maxRecords?: number | undefined;
}

function parseSnapshotArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; snapshot: SnapshotCliOk } | { ok: false; message: string } {
  const defaultOut = resolve(cwd, 'out', 'evernote-notes.json');
  let outPath = defaultOut;
  let pageSize = 250;
  let sleepBetweenPagesMs = 0;
  let maxRecords: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
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
    } else if (a === '--page-size') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 1 || n > 250) {
        return { ok: false, message: 'error: --page-size must be an integer 1–250' };
      }
      pageSize = n;
      i++;
    } else if (a?.startsWith('--page-size=')) {
      const tail = a.slice('--page-size='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 1 || n > 250) {
        return { ok: false, message: 'error: --page-size must be an integer 1–250' };
      }
      pageSize = n;
    } else if (a === '--sleep-ms') {
      const v = args[i + 1];
      const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: 'error: --sleep-ms must be a non-negative integer' };
      }
      sleepBetweenPagesMs = n;
      i++;
    } else if (a?.startsWith('--sleep-ms=')) {
      const tail = a.slice('--sleep-ms='.length);
      const n = Number.parseInt(tail, 10);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: 'error: --sleep-ms must be a non-negative integer' };
      }
      sleepBetweenPagesMs = n;
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

  return { ok: true, snapshot: { outPath, pageSize, sleepBetweenPagesMs, maxRecords } };
}

async function runSnapshot(
  parsed: SnapshotCliOk,
  cwd: string,
  streams: MainStreams,
): Promise<number> {
  await loadDotEnvFromCwd(cwd);
  const token = process.env.EVERNOTE_DEVELOPER_TOKEN?.trim();
  if (!token) {
    streams.stderr.write(
      'snapshot: missing EVERNOTE_DEVELOPER_TOKEN (set in environment or .env in cwd)\n',
    );
    return 2;
  }

  try {
    const fetchResult = await fetchAllNoteRecords({
      token,
      hostEnv: process.env.EVERNOTE_HOST,
      pageSize: parsed.pageSize,
      sleepBetweenPagesMs: parsed.sleepBetweenPagesMs,
      maxRecords: parsed.maxRecords,
    });
    const { records, clientOpts, totalNotesFromApi, truncated } = fetchResult;

    if (!truncated && totalNotesFromApi !== undefined && totalNotesFromApi !== records.length) {
      streams.stderr.write(
        `snapshot: warning: Evernote reported totalNotes=${totalNotesFromApi} but snapshot has count=${records.length} (skipped rows without guid, concurrent edits while paging, or API semantics).\n`,
      );
    }

    const envelope = buildSnapshotEnvelope(clientOpts.serviceHost, records);
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeSnapshotFile(parsed.outPath, envelope);

    const summary: Record<string, unknown> = {
      ok: true,
      path: parsed.outPath,
      count: records.length,
      host: clientOpts.serviceHost,
    };
    if (totalNotesFromApi !== undefined) {
      summary.totalNotesFromApi = totalNotesFromApi;
    }
    if (truncated) {
      summary.truncated = true;
    }

    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`snapshot: ${msg}\n`);
    streams.stderr.write(
      'snapshot: hint: verify EVERNOTE_DEVELOPER_TOKEN, EVERNOTE_HOST (production vs sandbox vs Yinxiang), and Evernote rate limits.\n',
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
    '  evernote-obsidian snapshot [--out <path>] [--page-size <n>] [--sleep-ms <n>] [--max-notes <n>]',
    '',
    'Commands:',
    '  index      Build a read-only vault index (normalized titles must be unique).',
    '  snapshot   Fetch Evernote note metadata (GUID, title, updated) and write a JSON snapshot.',
    '',
    'Options:',
    '  --vault       Vault root directory (default: ./data relative to cwd)',
    '  --out         Snapshot JSON path (default: ./out/evernote-notes.json)',
    '  --page-size   findNotesMetadata page size, 1–250 (default: 250)',
    '  --sleep-ms    Pause between pages to ease rate limits (default: 0)',
    '  --max-notes   Stop after N newest notes (optional cap for iteration / large accounts)',
    '',
    'Env (snapshot): EVERNOTE_DEVELOPER_TOKEN (required), EVERNOTE_HOST (optional, see .env.example)',
    '',
  ].join('\n');
}

function version(): string {
  return readCliPackageVersion();
}
