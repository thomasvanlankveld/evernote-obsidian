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
import { pathFlagHandler, scanArgv, vaultDirArgHandler } from './argvScan.ts';
import type { MainStreams } from './cliTypes.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface CorrelateCliOk {
  vaultRoot: string;
  snapshotPath?: string | undefined;
  overridesPath?: string | undefined;
  outPath: string;
}

export function parseCorrelateArgs(
  args: readonly string[],
  cwd: string,
  options?: { subcommand?: string | undefined },
): { ok: true; correlate: CorrelateCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'correlate';
  const defaultOut = resolve(cwd, 'out', 'link-map.json');
  let snapshotPath: string | undefined;
  let mapPath: string | undefined;
  let overridesPath: string | undefined;
  let outPath = defaultOut;

  const scanned = scanArgv(args, cwd, {
    subcommand,
    handlers: [
      vaultDirArgHandler(),
      pathFlagHandler('snapshot', './out/evernote-notes.json', (path) => {
        snapshotPath = path;
      }),
      pathFlagHandler('map', './out/link-map.json', (path) => {
        mapPath = path;
      }),
      pathFlagHandler('overrides', './out/correlation-overrides.json', (path) => {
        overridesPath = path;
      }),
      pathFlagHandler('out', './out/link-map.json', (path) => {
        outPath = path;
      }),
      pathFlagHandler('map-out', './out/link-map.json', (path) => {
        outPath = path;
      }),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  if (mapPath !== undefined) {
    return {
      ok: false,
      message:
        'error: correlate does not accept --map (use evernote-obsidian run --map to reuse an existing link map)',
    };
  }

  if (snapshotPath === undefined) {
    return {
      ok: false,
      message:
        'error: correlate requires --snapshot <path> (Evernote JSON snapshot, e.g. ./out/evernote-notes.json)',
    };
  }

  return {
    ok: true,
    correlate: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      snapshotPath,
      overridesPath,
      outPath,
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
