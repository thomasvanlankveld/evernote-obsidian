import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from '../correlation/correlate.ts';
import { buildLinkMapFile } from '../correlation/linkMapFile.ts';
import { parseCorrelationOverridesJson } from '../correlation/overridesFile.ts';
import { readSnapshotFile } from '../evernote/snapshotFile.ts';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import {
  type ArgHandler,
  exactFlagHandler,
  pathFlagHandler,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import type { MainStreams } from './cliTypes.ts';
import {
  buildCorrelationFailureSummary,
  type CorrelationVaultContext,
  correlationFailureFromCorrelateResult,
  correlationFailureFromVaultIndex,
  emitCorrelateFailure,
  formatCorrelateRunDetail,
  formatVaultCorrelateContext,
} from './correlateFailureReport.ts';
import { emitStepProgress, type StepInvokeContext, type StepInvokeResult } from './pipelineStep.ts';
import { isStdoutTty } from './runOutput.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface CorrelateCliOk {
  vaultRoot: string;
  snapshotPath?: string | undefined;
  overridesPath?: string | undefined;
  outPath: string;
  reportPath: string;
  reportPathDisplay: string;
  verbose: boolean;
}

export function reportPathForDisplay(absPath: string, cwd: string): string {
  const rel = relative(cwd, absPath);
  if (rel === '') {
    return absPath;
  }
  if (rel.startsWith('..')) {
    return absPath;
  }
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function vaultContextFromIndex(
  entries: readonly { evernoteGuid?: string | undefined }[],
): CorrelationVaultContext {
  let vaultWithGuidCount = 0;
  for (const e of entries) {
    if (e.evernoteGuid !== undefined) {
      vaultWithGuidCount++;
    }
  }
  return { vaultMarkdownCount: entries.length, vaultWithGuidCount };
}

export function correlateOutputArgHandlers(state: {
  reportPath?: string | undefined;
  verbose: boolean;
}): ArgHandler[] {
  return [
    pathFlagHandler('report', './out/correlate-report.json', (path) => {
      state.reportPath = path;
    }),
    exactFlagHandler('--verbose', () => {
      state.verbose = true;
    }),
    exactFlagHandler('--report-stdout', () => {
      state.verbose = true;
    }),
  ];
}

export function parseCorrelateArgs(
  args: readonly string[],
  cwd: string,
  options?: { subcommand?: string | undefined },
): { ok: true; correlate: CorrelateCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'correlate';
  const defaultOut = resolve(cwd, 'out', 'link-map.json');
  const defaultReport = resolve(cwd, 'out', 'correlate-report.json');
  let snapshotPath: string | undefined;
  let mapPath: string | undefined;
  let overridesPath: string | undefined;
  let outPath = defaultOut;
  const outputState: { reportPath?: string | undefined; verbose: boolean } = { verbose: false };

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
      ...correlateOutputArgHandlers(outputState),
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

  const reportPath = outputState.reportPath ?? defaultReport;

  return {
    ok: true,
    correlate: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      snapshotPath,
      overridesPath,
      outPath,
      reportPath,
      reportPathDisplay: reportPathForDisplay(reportPath, cwd),
      verbose: outputState.verbose,
    },
  };
}

function correlateFailureOptions(
  parsed: CorrelateCliOk,
  invoke: StepInvokeContext | undefined,
  streams: MainStreams,
  options: {
    snapshotNotes: number;
    vault?: CorrelationVaultContext;
    matchedCount?: number;
  },
) {
  const cwd = invoke?.cwd ?? process.cwd();
  const interactive =
    invoke?.interactive === true || (invoke === undefined && isStdoutTty(streams));
  return {
    reportPath: parsed.reportPath,
    reportPathDisplay: parsed.reportPathDisplay,
    snapshotNotes: options.snapshotNotes,
    matchedCount: options.matchedCount,
    vault: options.vault,
    snapshotPath:
      parsed.snapshotPath !== undefined
        ? reportPathForDisplay(parsed.snapshotPath, cwd)
        : undefined,
    vaultDir: reportPathForDisplay(parsed.vaultRoot, cwd),
    verbose: parsed.verbose,
    quiet: invoke?.quiet,
    interactive,
  };
}

export async function runCorrelate(
  parsed: CorrelateCliOk,
  streams: MainStreams,
  invoke?: StepInvokeContext,
): Promise<StepInvokeResult> {
  if (parsed.snapshotPath === undefined) {
    streams.stderr.write('correlate: missing --snapshot path\n');
    return { exitCode: 2 };
  }
  const cwd = invoke?.cwd ?? process.cwd();
  const vaultDisplay = reportPathForDisplay(parsed.vaultRoot, cwd);
  try {
    emitStepProgress(invoke, `correlate: scanning vault (${vaultDisplay})…`);
    const index = await buildVaultIndex(parsed.vaultRoot);
    const vaultCtx = vaultContextFromIndex(index.ok ? index.entries : []);
    if (!index.ok) {
      const report = correlationFailureFromVaultIndex(index.collisions, index.guidCollisions);
      if (vaultCtx.vaultMarkdownCount > 0) {
        streams.stderr.write(formatVaultCorrelateContext(vaultDisplay, vaultCtx, 0));
      }
      await emitCorrelateFailure(
        streams,
        report,
        correlateFailureOptions(parsed, invoke, streams, { snapshotNotes: 0, vault: vaultCtx }),
      );
      const failureSummary = buildCorrelationFailureSummary(report, parsed.reportPathDisplay, 0, {
        vault: vaultCtx,
      });
      return {
        exitCode: 1,
        summary: failureSummary as unknown as Record<string, unknown>,
        humanDetail: formatCorrelateRunDetail(failureSummary),
      };
    }

    const snapshot = await readSnapshotFile(parsed.snapshotPath);
    if (invoke?.skipVaultCorrelateContext !== true) {
      streams.stderr.write(
        formatVaultCorrelateContext(vaultDisplay, vaultCtx, snapshot.notes.length),
      );
    }
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
    emitStepProgress(
      invoke,
      `correlate: matching ${snapshot.notes.length} Evernote note${snapshot.notes.length === 1 ? '' : 's'} to vault files…`,
    );
    const result = correlateSnapshotToGuidPaths(snapshot.notes, vaultInput, overrides);
    if (!result.ok) {
      const report = correlationFailureFromCorrelateResult(result);
      await emitCorrelateFailure(
        streams,
        report,
        correlateFailureOptions(parsed, invoke, streams, {
          snapshotNotes: snapshot.notes.length,
          vault: vaultCtx,
          matchedCount: result.matchedCount,
        }),
      );
      const failureSummary = buildCorrelationFailureSummary(
        report,
        parsed.reportPathDisplay,
        snapshot.notes.length,
        { matchedCount: result.matchedCount, vault: vaultCtx },
      );
      return {
        exitCode: 1,
        summary: failureSummary as unknown as Record<string, unknown>,
        humanDetail: formatCorrelateRunDetail(failureSummary),
      };
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
    if (invoke?.quiet !== true) {
      streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    return { exitCode: 0, summary };
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return { exitCode: 2 };
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`correlate: ${msg}\n`);
    return { exitCode: 2 };
  }
}
