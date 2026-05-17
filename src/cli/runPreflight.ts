import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import {
  buildCheckResultPayload,
  type CheckEvernoteSource,
  type EvernoteCountSource,
  readEvernoteCount,
} from './checkCommand.ts';
import type { MainStreams } from './cliTypes.ts';
import { reportPathForDisplay } from './correlateCommand.ts';
import { formatPreflightHuman } from './preflightCheck.ts';
import type { RunCliOk } from './runCommand.ts';

export function resolveEvernoteSourceForRun(parsed: RunCliOk): EvernoteCountSource | null {
  if (parsed.snapshotPath !== undefined) {
    return {
      snapshotPath: parsed.snapshotPath,
      maxRecords: parsed.maxRecords,
    };
  }
  // When --map is set without --snapshot, the snapshot step (and --db) are skipped.
  if (parsed.dbPath !== undefined && parsed.mapPath === undefined) {
    return {
      dbPath: parsed.dbPath,
      maxRecords: parsed.maxRecords,
    };
  }
  return null;
}

function evernoteLabelForRun(evernote: CheckEvernoteSource, cwd: string): string {
  if (evernote.source === 'db') {
    return `Evernote DB (${reportPathForDisplay(evernote.path, cwd)})`;
  }
  return `snapshot (${reportPathForDisplay(evernote.path, cwd)})`;
}

/**
 * Compare Evernote vs vault counts before the run pipeline.
 * @returns exit code when run must stop (vault collisions or fatal error); `null` to continue.
 */
export async function runPreflightAtStart(
  parsed: RunCliOk,
  streams: MainStreams,
  cwd: string,
): Promise<number | null> {
  const source = resolveEvernoteSourceForRun(parsed);
  if (source === null) {
    return null;
  }

  try {
    const evernote = await readEvernoteCount(source);
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

    streams.stderr.write(
      formatPreflightHuman(
        {
          vaultRoot: reportPathForDisplay(parsed.vaultRoot, cwd),
          vaultMarkdown,
          evernoteNotes: evernote.count,
          evernoteLabel: evernoteLabelForRun(evernote, cwd),
          warnings: payload.warnings,
        },
        'run',
      ),
    );

    if (!payload.ok) {
      const titleCollisions = payload.collisions.length;
      const guidCollisions = payload.guidCollisions.length;
      streams.stderr.write(
        `run: vault index collision(s) (${titleCollisions} title, ${guidCollisions} evernote-guid) — correlation cannot proceed until resolved (see \`evernote-obsidian index\`).\n`,
      );
      return 1;
    }

    return null;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`run: preflight: ${msg}\n`);
    return 2;
  }
}
