import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readNoteRecordsFromEvernoteBackupDb } from '../evernote/readEvernoteBackupDb.ts';
import { readSnapshotFile } from '../evernote/snapshotFile.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import {
  exactFlagHandler,
  pathFlagHandler,
  positiveIntFlagHandler,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import type { MainStreams } from './cliTypes.ts';
import { reportPathForDisplay } from './correlateCommand.ts';
import {
  buildPreflightWarnings,
  formatPreflightHuman,
  type PreflightWarning,
} from './preflightCheck.ts';
import { isStdoutTty } from './runOutput.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface CheckCliOk {
  vaultRoot: string;
  snapshotPath?: string | undefined;
  dbPath?: string | undefined;
  maxRecords?: number | undefined;
  json: boolean;
}

const DEFAULT_SNAPSHOT_REL = './out/evernote-notes.json';

export function parseCheckArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; check: CheckCliOk } | { ok: false; message: string } {
  let snapshotPath: string | undefined;
  let dbPath: string | undefined;
  let maxRecords: number | undefined;
  let json = false;

  const scanned = scanArgv(args, cwd, {
    subcommand: 'check',
    handlers: [
      vaultDirArgHandler(),
      pathFlagHandler('snapshot', DEFAULT_SNAPSHOT_REL, (path) => {
        snapshotPath = path;
      }),
      pathFlagHandler('db', './en_backup.db', (path) => {
        dbPath = path;
      }),
      positiveIntFlagHandler('max-notes', (value) => {
        maxRecords = value;
      }),
      exactFlagHandler('--json', () => {
        json = true;
      }),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  const vaultRoot = resolveVaultRootFromState(scanned.vaultState, cwd);

  if (dbPath !== undefined && snapshotPath !== undefined) {
    return {
      ok: false,
      message: 'error: check accepts only one of --snapshot or --db (not both)',
    };
  }

  if (dbPath === undefined && snapshotPath === undefined) {
    const defaultSnapshot = resolve(cwd, 'out', 'evernote-notes.json');
    if (existsSync(defaultSnapshot)) {
      snapshotPath = defaultSnapshot;
    }
  }

  if (dbPath === undefined && snapshotPath === undefined) {
    return {
      ok: false,
      message:
        'error: check requires --snapshot <path> or --db <path> (or an existing ./out/evernote-notes.json)',
    };
  }

  return {
    ok: true,
    check: { vaultRoot, snapshotPath, dbPath, maxRecords, json },
  };
}

export interface CheckEvernoteSource {
  count: number;
  source: 'snapshot' | 'db';
  path: string;
  sourceRowCount?: number | undefined;
  truncated?: boolean | undefined;
}

export interface EvernoteCountSource {
  snapshotPath?: string | undefined;
  dbPath?: string | undefined;
  maxRecords?: number | undefined;
}

export async function readEvernoteCount(source: EvernoteCountSource): Promise<CheckEvernoteSource> {
  if (source.dbPath !== undefined) {
    const readOpts =
      source.maxRecords !== undefined ? { maxRecords: source.maxRecords } : undefined;
    const { records, sourceRowCount } = readNoteRecordsFromEvernoteBackupDb(
      source.dbPath,
      readOpts,
    );
    return {
      count: records.length,
      source: 'db',
      path: source.dbPath,
      sourceRowCount,
      truncated:
        source.maxRecords !== undefined && records.length < sourceRowCount ? true : undefined,
    };
  }
  const snapshotPath = source.snapshotPath;
  if (snapshotPath === undefined) {
    throw new Error('check: internal error: missing Evernote source');
  }
  const snapshot = await readSnapshotFile(snapshotPath);
  return {
    count: snapshot.notes.length,
    source: 'snapshot',
    path: snapshotPath,
  };
}

export interface CheckSuccessPayload {
  ok: true;
  vault: string;
  vaultMarkdown: number;
  evernote: CheckEvernoteSource;
  warnings: PreflightWarning[];
}

export interface CheckVaultCollisionPayload {
  ok: false;
  reason: 'vault_index_collisions';
  vault: string;
  vaultMarkdown: number;
  evernote: CheckEvernoteSource;
  warnings: PreflightWarning[];
  collisions: { normalizedTitle: string; paths: string[] }[];
  guidCollisions: { evernoteGuid: string; paths: string[] }[];
}

export type CheckResultPayload = CheckSuccessPayload | CheckVaultCollisionPayload;

export function buildCheckResultPayload(
  vaultRoot: string,
  vaultMarkdown: number,
  evernote: CheckEvernoteSource,
  vaultIndexOk: boolean,
  collisions: { normalizedTitle: string; paths: string[] }[],
  guidCollisions: { evernoteGuid: string; paths: string[] }[],
): CheckResultPayload {
  const warnings = buildPreflightWarnings(vaultMarkdown, evernote.count);
  if (!vaultIndexOk) {
    return {
      ok: false,
      reason: 'vault_index_collisions',
      vault: vaultRoot,
      vaultMarkdown,
      evernote,
      warnings,
      collisions,
      guidCollisions,
    };
  }
  return {
    ok: true,
    vault: vaultRoot,
    vaultMarkdown,
    evernote,
    warnings,
  };
}

function evernoteLabelForHuman(evernote: CheckEvernoteSource, cwd: string): string {
  return reportPathForDisplay(evernote.path, cwd);
}

export async function runCheck(
  parsed: CheckCliOk,
  streams: MainStreams,
  cwd: string = process.cwd(),
): Promise<number> {
  const human = !parsed.json && isStdoutTty(streams);

  try {
    const evernote = await readEvernoteCount({
      snapshotPath: parsed.snapshotPath,
      dbPath: parsed.dbPath,
      maxRecords: parsed.maxRecords,
    });
    const indexResult = await buildVaultIndex(parsed.vaultRoot);
    const vaultMarkdown = indexResult.ok ? indexResult.entries.length : 0;
    const payload = buildCheckResultPayload(
      parsed.vaultRoot,
      vaultMarkdown,
      evernote,
      indexResult.ok,
      indexResult.ok ? [] : indexResult.collisions,
      indexResult.ok ? [] : indexResult.guidCollisions,
    );

    if (human) {
      streams.stdout.write(
        formatPreflightHuman({
          vaultRoot: reportPathForDisplay(parsed.vaultRoot, cwd),
          vaultMarkdown,
          evernoteNotes: evernote.count,
          evernoteLabel: evernoteLabelForHuman(evernote, cwd),
          warnings: payload.warnings,
        }),
      );
      for (const w of payload.warnings) {
        streams.stderr.write(`${w.message}\n`);
      }
      if (!payload.ok) {
        const titleCollisions = payload.collisions.length;
        const guidCollisions = payload.guidCollisions.length;
        streams.stderr.write(
          `check: vault index collision(s) (${titleCollisions} title, ${guidCollisions} evernote-guid) — correlation cannot proceed until resolved (see \`evernote-obsidian index\`).\n`,
        );
      }
      return payload.ok ? 0 : 1;
    }

    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`check: ${msg}\n`);
    return 2;
  }
}
