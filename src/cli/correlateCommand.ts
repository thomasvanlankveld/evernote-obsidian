import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from '../correlation/correlate.ts';
import { buildLinkMapFile } from '../correlation/linkMapFile.ts';
import { parseCorrelationOverridesJson } from '../correlation/overridesFile.ts';
import { readSnapshotFile } from '../evernote/snapshotFile.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { applyPathFlag, unknownSubcommandFlagError } from './cliFlags.ts';
import type { MainStreams, SubcommandParseOptions } from './cliTypes.ts';
import {
  advancePastVaultDirFlag,
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

export interface CorrelateCliOk {
  vaultRoot: string;
  snapshotPath?: string | undefined;
  overridesPath?: string | undefined;
  outPath: string;
  /** Set by run when --map skips correlate; not used by standalone correlate. */
  existingMapPath?: string | undefined;
}

export function parseCorrelateArgs(
  args: readonly string[],
  cwd: string,
  options?: SubcommandParseOptions,
): { ok: true; correlate: CorrelateCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'correlate';
  const permissive = options?.permissive === true;
  const resolvedVaultRoot = options?.vaultRoot;
  const defaultOut = resolve(cwd, 'out', 'link-map.json');
  let vaultState = createVaultDirFlagState();
  let snapshotPath: string | undefined;
  let mapPath: string | undefined;
  let overridesPath: string | undefined;
  let outPath = defaultOut;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    if (resolvedVaultRoot !== undefined) {
      const vaultSkipped = advancePastVaultDirFlag(a, args, i);
      if (vaultSkipped.kind === 'advanced') {
        i = vaultSkipped.nextIndex;
        continue;
      }
    } else {
      const vaultApplied = applyVaultDirFlag(a, args, i, cwd, vaultState);
      if (vaultApplied.kind === 'error') {
        return { ok: false, message: vaultApplied.message };
      }
      if (vaultApplied.kind === 'handled') {
        vaultState = vaultApplied.state;
        i = vaultApplied.nextIndex;
        continue;
      }
    }
    const snapshotApplied = applyPathFlag(a, args, i, cwd, 'snapshot', './out/evernote-notes.json');
    if (snapshotApplied.kind === 'error') {
      return { ok: false, message: snapshotApplied.message };
    }
    if (snapshotApplied.kind === 'handled') {
      snapshotPath = snapshotApplied.path;
      i = snapshotApplied.nextIndex;
      continue;
    }
    const mapApplied = applyPathFlag(a, args, i, cwd, 'map', './out/link-map.json');
    if (mapApplied.kind === 'error') {
      return { ok: false, message: mapApplied.message };
    }
    if (mapApplied.kind === 'handled') {
      mapPath = mapApplied.path;
      i = mapApplied.nextIndex;
      continue;
    }
    const overridesApplied = applyPathFlag(
      a,
      args,
      i,
      cwd,
      'overrides',
      './out/correlation-overrides.json',
    );
    if (overridesApplied.kind === 'error') {
      return { ok: false, message: overridesApplied.message };
    }
    if (overridesApplied.kind === 'handled') {
      overridesPath = overridesApplied.path;
      i = overridesApplied.nextIndex;
      continue;
    }
    const outApplied = applyPathFlag(a, args, i, cwd, 'out', './out/link-map.json');
    if (outApplied.kind === 'error') {
      return { ok: false, message: outApplied.message };
    }
    if (outApplied.kind === 'handled') {
      outPath = outApplied.path;
      i = outApplied.nextIndex;
      continue;
    }
    const mapOutApplied = applyPathFlag(a, args, i, cwd, 'map-out', './out/link-map.json');
    if (mapOutApplied.kind === 'error') {
      return { ok: false, message: mapOutApplied.message };
    }
    if (mapOutApplied.kind === 'handled') {
      outPath = mapOutApplied.path;
      i = mapOutApplied.nextIndex;
      continue;
    }
    if (permissive) {
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError(subcommand, a) };
  }

  if (!permissive && mapPath !== undefined) {
    return {
      ok: false,
      message:
        'error: correlate does not accept --map (use evernote-obsidian run --map to reuse an existing link map)',
    };
  }

  if (!permissive && snapshotPath === undefined) {
    return {
      ok: false,
      message:
        'error: correlate requires --snapshot <path> (Evernote JSON snapshot, e.g. ./out/evernote-notes.json)',
    };
  }

  return {
    ok: true,
    correlate: {
      vaultRoot: resolvedVaultRoot ?? resolveVaultRootFromState(vaultState, cwd),
      snapshotPath,
      overridesPath,
      outPath,
      existingMapPath: mapPath,
    },
  };
}

export async function runCorrelate(parsed: CorrelateCliOk, streams: MainStreams): Promise<number> {
  if (parsed.snapshotPath === undefined) {
    streams.stderr.write('correlate: missing --snapshot path\n');
    return 2;
  }
  try {
    const index = await buildVaultIndex(parsed.vaultRoot);
    if (!index.ok) {
      streams.stderr.write(
        `${JSON.stringify(
          {
            ok: false,
            reason: 'vault_index_collisions',
            collisions: index.collisions,
            guidCollisions: index.guidCollisions,
          },
          null,
          2,
        )}\n`,
      );
      return 1;
    }

    const snapshot = await readSnapshotFile(parsed.snapshotPath);
    let overrides = new Map<string, string>();
    if (parsed.overridesPath !== undefined) {
      const raw = await readFile(parsed.overridesPath, 'utf8');
      overrides = parseCorrelationOverridesJson(raw);
    }

    const pathToEvernoteGuid = new Map<string, string>();
    for (const e of index.entries) {
      if (e.evernoteGuid !== undefined) {
        pathToEvernoteGuid.set(e.path, e.evernoteGuid);
      }
    }
    const vaultInput = vaultIndexResultToCorrelationInput(
      index.byNormalizedTitle,
      index.entries.map((e) => e.path),
      index.byEvernoteGuid,
      pathToEvernoteGuid,
    );
    const result = correlateSnapshotToGuidPaths(snapshot.notes, vaultInput, overrides);
    if (!result.ok) {
      streams.stderr.write(
        `${JSON.stringify(
          {
            ok: false,
            reason: 'correlation_failed',
            evernoteTitleCollisions: result.evernoteTitleCollisions,
            unmatched: result.unmatched,
            invalidOverrides: result.invalidOverrides,
            duplicateTargetPaths: result.duplicateTargetPaths,
            guidTitleMismatches: result.guidTitleMismatches,
          },
          null,
          2,
        )}\n`,
      );
      return 1;
    }

    const linkMap = buildLinkMapFile(
      parsed.vaultRoot,
      parsed.snapshotPath,
      result.guidToPath,
      parsed.overridesPath,
    );
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeFile(parsed.outPath, `${JSON.stringify(linkMap, null, 2)}\n`, 'utf8');

    const summary = {
      ok: true as const,
      path: parsed.outPath,
      vault: parsed.vaultRoot,
      snapshot: parsed.snapshotPath,
      count: result.guidToPath.size,
    };
    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`correlate: ${msg}\n`);
    return 2;
  }
}
