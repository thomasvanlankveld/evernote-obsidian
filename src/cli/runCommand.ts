import { resolve } from 'node:path';
import {
  pathFlagHandler,
  positiveIntFlagHandler,
  rewriteOutputModeArgHandlers,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import { createRewriteOutputScanState, finalizeRewriteOutputMode } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { runCorrelate } from './correlateCommand.ts';
import { type RewriteCliOk, runRewrite } from './rewriteCommand.ts';
import { runSnapshot } from './snapshotCommand.ts';

export interface RunCliOk {
  vaultRoot: string;
  dbPath?: string | undefined;
  snapshotPath?: string | undefined;
  snapshotOutPath: string;
  mapPath?: string | undefined;
  mapOutPath: string;
  overridesPath?: string | undefined;
  maxRecords?: number | undefined;
  rewrite: Omit<RewriteCliOk, 'mapPath' | 'vaultRoot'>;
}

export function parseRunArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; run: RunCliOk } | { ok: false; message: string } {
  const snapshotOutDefault = resolve(cwd, 'out', 'evernote-notes.json');
  const mapOutDefault = resolve(cwd, 'out', 'link-map.json');
  let dbPath: string | undefined;
  let inputSnapshotPath: string | undefined;
  let snapshotOutPath = snapshotOutDefault;
  let existingMapPath: string | undefined;
  let mapOutPath = mapOutDefault;
  let overridesPath: string | undefined;
  let maxRecords: number | undefined;
  const rewriteOutput = createRewriteOutputScanState();

  const scanned = scanArgv(args, cwd, {
    subcommand: 'run',
    handlers: [
      vaultDirArgHandler(),
      pathFlagHandler('db', './en_backup.db', (path) => {
        dbPath = path;
      }),
      pathFlagHandler('snapshot', './out/evernote-notes.json', (path) => {
        inputSnapshotPath = path;
      }),
      pathFlagHandler('out', './out/evernote-notes.json', (path) => {
        snapshotOutPath = path;
        mapOutPath = path;
      }),
      pathFlagHandler('snapshot-out', './out/evernote-notes.json', (path) => {
        snapshotOutPath = path;
      }),
      pathFlagHandler('map', './out/link-map.json', (path) => {
        existingMapPath = path;
      }),
      pathFlagHandler('map-out', './out/link-map.json', (path) => {
        mapOutPath = path;
      }),
      pathFlagHandler('overrides', './out/correlation-overrides.json', (path) => {
        overridesPath = path;
      }),
      positiveIntFlagHandler('max-notes', (value) => {
        maxRecords = value;
      }),
      ...rewriteOutputModeArgHandlers(rewriteOutput),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  if (scanned.vaultState.explicitPath === undefined) {
    return {
      ok: false,
      message: 'error: run requires --vault-dir <path> (or --vault)',
    };
  }

  const vaultRoot = scanned.vaultState.explicitPath;
  const inputSnapshot = inputSnapshotPath;
  if (inputSnapshot === undefined && dbPath === undefined && existingMapPath === undefined) {
    return {
      ok: false,
      message:
        'error: run requires --db <path> unless reusing an existing snapshot via --snapshot and/or --map',
    };
  }

  const modeParsed = finalizeRewriteOutputMode(rewriteOutput);
  if (!modeParsed.ok) {
    return modeParsed;
  }

  return {
    ok: true,
    run: {
      vaultRoot,
      dbPath,
      snapshotPath: inputSnapshot,
      snapshotOutPath,
      mapPath: existingMapPath,
      mapOutPath,
      overridesPath,
      maxRecords,
      rewrite: {
        mode: modeParsed.mode,
        outDir: modeParsed.outDir,
        backup: modeParsed.backup,
      },
    },
  };
}

export async function runRun(parsed: RunCliOk, streams: MainStreams): Promise<number> {
  if (
    parsed.dbPath !== undefined &&
    parsed.mapPath !== undefined &&
    parsed.snapshotPath === undefined
  ) {
    streams.stderr.write('run: warning: --map skips the snapshot step; --db is ignored\n');
  }

  // --map (or an explicit --snapshot) skips generating a snapshot from --db.
  let snapshotPath = parsed.snapshotPath;
  if (snapshotPath === undefined && parsed.mapPath === undefined) {
    const code = await runSnapshot(
      {
        dbPath: parsed.dbPath as string,
        outPath: parsed.snapshotOutPath,
        maxRecords: parsed.maxRecords,
      },
      streams,
    );
    if (code !== 0) {
      return code;
    }
    snapshotPath = parsed.snapshotOutPath;
  }

  let mapPath = parsed.mapPath;
  if (mapPath === undefined) {
    const code = await runCorrelate(
      {
        vaultRoot: parsed.vaultRoot,
        snapshotPath,
        overridesPath: parsed.overridesPath,
        outPath: parsed.mapOutPath,
      },
      streams,
    );
    if (code !== 0) {
      return code;
    }
    mapPath = parsed.mapOutPath;
  }

  return runRewrite(
    {
      vaultRoot: parsed.vaultRoot,
      mapPath,
      mode: parsed.rewrite.mode,
      outDir: parsed.rewrite.outDir,
      backup: parsed.rewrite.backup,
    },
    streams,
  );
}
