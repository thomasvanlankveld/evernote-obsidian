import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readNoteRecordsFromEvernoteBackupDb } from '../evernote/readEvernoteBackupDb.ts';
import { buildSnapshotEnvelope, writeSnapshotFile } from '../evernote/snapshotFile.ts';
import { pathFlagHandler, positiveIntFlagHandler, scanArgv } from './argvScan.ts';
import type { MainStreams } from './cliTypes.ts';

const SNAPSHOT_METADATA_HOST = 'evernote-backup';

export interface SnapshotCliOk {
  dbPath?: string | undefined;
  outPath: string;
  /** Reuse an existing snapshot file instead of reading --db. */
  inputSnapshotPath?: string | undefined;
  /** When set, stop after this many notes (ordered by title). */
  maxRecords?: number | undefined;
}

export function parseSnapshotArgs(
  args: readonly string[],
  cwd: string,
  options?: { subcommand?: string | undefined },
): { ok: true; snapshot: SnapshotCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'snapshot';
  const defaultOut = resolve(cwd, 'out', 'evernote-notes.json');
  let outPath = defaultOut;
  let dbPath: string | undefined;
  let inputSnapshotPath: string | undefined;
  let maxRecords: number | undefined;

  const scanned = scanArgv(args, cwd, {
    subcommand,
    handlers: [
      pathFlagHandler('db', './en_backup.db', (path) => {
        dbPath = path;
      }),
      pathFlagHandler('snapshot', './out/evernote-notes.json', (path) => {
        inputSnapshotPath = path;
      }),
      pathFlagHandler('out', './out/evernote-notes.json', (path) => {
        outPath = path;
      }),
      pathFlagHandler('snapshot-out', './out/evernote-notes.json', (path) => {
        outPath = path;
      }),
      positiveIntFlagHandler('max-notes', (value) => {
        maxRecords = value;
      }),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  if (dbPath === undefined) {
    return {
      ok: false,
      message:
        'error: snapshot requires --db <path> (evernote-backup SQLite file, e.g. en_backup.db)',
    };
  }

  return { ok: true, snapshot: { dbPath, outPath, inputSnapshotPath, maxRecords } };
}

export async function runSnapshot(parsed: SnapshotCliOk, streams: MainStreams): Promise<number> {
  if (parsed.dbPath === undefined) {
    streams.stderr.write('snapshot: missing --db path\n');
    return 2;
  }
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
