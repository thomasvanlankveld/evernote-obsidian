import { assertKnownRunFlags, hasExplicitVaultArg } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { parseCorrelateArgs, runCorrelate } from './correlateCommand.ts';
import { parseRewriteArgs, type RewriteCliOk, runRewrite } from './rewriteCommand.ts';
import { parseSnapshotArgs, runSnapshot } from './snapshotCommand.ts';

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
  if (!hasExplicitVaultArg(args)) {
    return {
      ok: false,
      message: 'error: run requires --vault-dir <path> (or --vault)',
    };
  }

  const knownFlags = assertKnownRunFlags(args);
  if (!knownFlags.ok) {
    return knownFlags;
  }

  const runOpts = { permissive: true, subcommand: 'run' } as const;
  const snapshotParsed = parseSnapshotArgs(args, cwd, runOpts);
  if (!snapshotParsed.ok) {
    return snapshotParsed;
  }
  const correlateParsed = parseCorrelateArgs(args, cwd, runOpts);
  if (!correlateParsed.ok) {
    return correlateParsed;
  }
  const rewriteParsed = parseRewriteArgs(args, cwd, runOpts);
  if (!rewriteParsed.ok) {
    return rewriteParsed;
  }

  const snap = snapshotParsed.snapshot;
  const corr = correlateParsed.correlate;
  const inputSnapshot = snap.inputSnapshotPath ?? corr.snapshotPath;
  if (
    inputSnapshot === undefined &&
    snap.dbPath === undefined &&
    corr.existingMapPath === undefined
  ) {
    return {
      ok: false,
      message:
        'error: run requires --db <path> unless reusing an existing snapshot via --snapshot and/or --map',
    };
  }

  return {
    ok: true,
    run: {
      vaultRoot: rewriteParsed.rewrite.vaultRoot,
      dbPath: snap.dbPath,
      snapshotPath: inputSnapshot,
      snapshotOutPath: snap.outPath,
      mapPath: corr.existingMapPath,
      mapOutPath: corr.outPath,
      overridesPath: corr.overridesPath,
      maxRecords: snap.maxRecords,
      rewrite: {
        mode: rewriteParsed.rewrite.mode,
        outDir: rewriteParsed.rewrite.outDir,
        backup: rewriteParsed.rewrite.backup,
      },
    },
  };
}

export async function runRun(parsed: RunCliOk, streams: MainStreams): Promise<number> {
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
