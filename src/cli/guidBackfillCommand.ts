import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from '../correlation/correlate.ts';
import { parseCorrelationOverridesJson } from '../correlation/overridesFile.ts';
import { readSnapshotFile } from '../evernote/snapshotFile.ts';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import {
  buildGuidBackfillPlan,
  insertEvernoteGuidIntoContent,
} from '../vault/evernoteGuidFrontmatter.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { exactFlagHandler, pathFlagHandler, scanArgv, vaultDirArgHandler } from './argvScan.ts';
import {
  createRewriteOutputScanState,
  finalizeRewriteOutputMode,
  type RewriteOutputScanState,
} from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { reportPathForDisplay } from './correlateCommand.ts';
import {
  buildCorrelationFailureSummary,
  correlationFailureFromCorrelateResult,
  correlationFailureFromVaultIndex,
  emitCorrelateFailure,
} from './correlateFailureReport.ts';
import { emitStepProgress, type StepInvokeContext, type StepInvokeResult } from './pipelineStep.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface GuidBackfillCliOk {
  vaultRoot: string;
  snapshotPath: string;
  overridesPath?: string | undefined;
  mode: 'dry-run' | 'in-place';
  reportPath: string;
  reportPathDisplay: string;
  verbose: boolean;
}

function guidBackfillOutputArgHandlers(state: RewriteOutputScanState) {
  return [
    exactFlagHandler('--dry-run', () => {
      state.explicitDryRun = true;
    }),
    exactFlagHandler('--in-place', () => {
      state.inPlace = true;
    }),
  ];
}

export function parseGuidBackfillArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; guidBackfill: GuidBackfillCliOk } | { ok: false; message: string } {
  const defaultReport = join(cwd, 'out', 'guid-backfill-report.json');
  let snapshotPath: string | undefined;
  let overridesPath: string | undefined;
  let outDirRequested = false;
  const outputState = createRewriteOutputScanState();
  const reportState: { reportPath?: string | undefined; verbose: boolean } = { verbose: false };

  const scanned = scanArgv(args, cwd, {
    subcommand: 'guid-backfill',
    handlers: [
      vaultDirArgHandler(),
      pathFlagHandler('snapshot', './out/evernote-notes.json', (path) => {
        snapshotPath = path;
      }),
      pathFlagHandler('overrides', './out/correlation-overrides.json', (path) => {
        overridesPath = path;
      }),
      pathFlagHandler('out-dir', './out/rewritten-vault', () => {
        outDirRequested = true;
      }),
      ...guidBackfillOutputArgHandlers(outputState),
      pathFlagHandler('report', './out/guid-backfill-report.json', (path) => {
        reportState.reportPath = path;
      }),
      exactFlagHandler('--verbose', () => {
        reportState.verbose = true;
      }),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  if (snapshotPath === undefined) {
    return {
      ok: false,
      message:
        'error: guid-backfill requires --snapshot <path> (Evernote JSON snapshot, e.g. ./out/evernote-notes.json)',
    };
  }

  if (outDirRequested) {
    return { ok: false, message: 'error: guid-backfill does not accept --out-dir' };
  }

  const modeParsed = finalizeRewriteOutputMode(outputState);
  if (!modeParsed.ok) {
    return modeParsed;
  }
  if (modeParsed.mode === 'out-dir') {
    return { ok: false, message: 'error: guid-backfill does not accept --out-dir' };
  }

  const reportPath = reportState.reportPath ?? defaultReport;

  return {
    ok: true,
    guidBackfill: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      snapshotPath,
      overridesPath,
      mode: modeParsed.mode,
      reportPath,
      reportPathDisplay: reportPathForDisplay(reportPath, cwd),
      verbose: reportState.verbose,
    },
  };
}

export async function runGuidBackfill(
  parsed: GuidBackfillCliOk,
  streams: MainStreams,
  invoke?: StepInvokeContext,
): Promise<StepInvokeResult> {
  try {
    emitStepProgress(invoke, 'guid-backfill: indexing vault…');
    const index = await buildVaultIndex(parsed.vaultRoot);
    if (!index.ok) {
      const report = correlationFailureFromVaultIndex(index.collisions, index.guidCollisions);
      await emitCorrelateFailure(streams, report, {
        reportPath: parsed.reportPath,
        reportPathDisplay: parsed.reportPathDisplay,
        snapshotNotes: 0,
        verbose: parsed.verbose,
        quiet: invoke?.quiet,
      });
      return { exitCode: 1 };
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

    emitStepProgress(invoke, 'guid-backfill: correlating snapshot…');
    const correlateResult = correlateSnapshotToGuidPaths(snapshot.notes, vaultInput, overrides);
    if (!correlateResult.ok) {
      const report = correlationFailureFromCorrelateResult(correlateResult);
      await emitCorrelateFailure(streams, report, {
        reportPath: parsed.reportPath,
        reportPathDisplay: parsed.reportPathDisplay,
        snapshotNotes: snapshot.notes.length,
        verbose: parsed.verbose,
        quiet: invoke?.quiet,
      });
      const failureSummary = buildCorrelationFailureSummary(
        report,
        parsed.reportPathDisplay,
        snapshot.notes.length,
      );
      return { exitCode: 1, summary: failureSummary as unknown as Record<string, unknown> };
    }

    const fileContentsByPath = new Map<string, string>();
    for (const [, relPath] of correlateResult.guidToPath) {
      const abs = join(parsed.vaultRoot, relPath);
      fileContentsByPath.set(relPath, await readFile(abs, 'utf8'));
    }

    const plan = buildGuidBackfillPlan(correlateResult.guidToPath, fileContentsByPath);
    const guidByPath = new Map<string, string>();
    for (const [guid, path] of correlateResult.guidToPath) {
      guidByPath.set(path, guid);
    }

    if (parsed.mode === 'in-place') {
      for (const path of plan.wouldUpdate) {
        const content = fileContentsByPath.get(path);
        const guid = guidByPath.get(path);
        if (content === undefined || guid === undefined) {
          continue;
        }
        const next = insertEvernoteGuidIntoContent(content, guid);
        await atomicReplaceFile(join(parsed.vaultRoot, path), next);
      }
    }

    const summary = {
      ok: plan.conflicts.length === 0,
      mode: parsed.mode,
      vault: parsed.vaultRoot,
      snapshot: parsed.snapshotPath,
      updated: parsed.mode === 'in-place' ? plan.wouldUpdate.length : 0,
      wouldUpdate: plan.wouldUpdate,
      skipped: plan.skipped.length,
      skippedPaths: plan.skipped,
      conflicts: plan.conflicts.length,
      conflictDetails: plan.conflicts,
      wroteFiles: parsed.mode === 'in-place' && plan.conflicts.length === 0,
    };

    emitStepProgress(
      invoke,
      `guid-backfill: ${plan.wouldUpdate.length} would update, ${plan.skipped.length} skipped, ${plan.conflicts.length} conflict${plan.conflicts.length === 1 ? '' : 's'}`,
    );
    if (invoke?.quiet !== true) {
      streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }

    if (plan.conflicts.length > 0) {
      return { exitCode: 1, summary };
    }
    return { exitCode: 0, summary };
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return { exitCode: 2 };
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`guid-backfill: ${msg}\n`);
    return { exitCode: 2 };
  }
}
