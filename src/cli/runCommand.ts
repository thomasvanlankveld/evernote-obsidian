import { resolve } from 'node:path';
import {
  exactFlagHandler,
  pathFlagHandler,
  positiveIntFlagHandler,
  rewriteOutputModeArgHandlers,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import { createRewriteOutputScanState, finalizeRewriteOutputMode } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import {
  correlateOutputArgHandlers,
  reportPathForDisplay,
  runCorrelate,
} from './correlateCommand.ts';
import { runFixResources } from './fixResourcesCommand.ts';
import {
  type PipelineStepResult,
  type StepInvokeContext,
  type StepInvokeResult,
  stepStatusFromExitCode,
} from './pipelineStep.ts';
import { type RewriteCliOk, runRewrite } from './rewriteCommand.ts';
import { type RunOutputFlags, resolveRunOutput } from './runOutput.ts';
import { resolveEvernoteSourceForRun, runPreflightAtStart } from './runPreflight.ts';
import { emitRunReport, pipelineExitCode } from './runReport.ts';
import { runSnapshot } from './snapshotCommand.ts';
import { runUnescapeLinks } from './unescapeLinksCommand.ts';

export interface RunCliOk {
  vaultRoot: string;
  dbPath?: string | undefined;
  snapshotPath?: string | undefined;
  snapshotOutPath: string;
  mapPath?: string | undefined;
  mapOutPath: string;
  overridesPath?: string | undefined;
  maxRecords?: number | undefined;
  correlateReportPath: string;
  correlateReportPathDisplay: string;
  correlateVerbose: boolean;
  skipUnescapeLinks: boolean;
  rewrite: Omit<RewriteCliOk, 'mapPath' | 'vaultRoot'>;
  output: RunOutputFlags;
}

function stepFromResult(
  id: PipelineStepResult['id'],
  result: StepInvokeResult,
): PipelineStepResult {
  return {
    id,
    status: stepStatusFromExitCode(result.exitCode),
    exitCode: result.exitCode,
    summary: result.summary,
    humanDetail: result.humanDetail,
  };
}

function skippedStep(id: PipelineStepResult['id']): PipelineStepResult {
  return { id, status: 'skipped', exitCode: 0 };
}

export function parseRunArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; run: RunCliOk } | { ok: false; message: string } {
  const snapshotOutDefault = resolve(cwd, 'out', 'evernote-notes.json');
  const mapOutDefault = resolve(cwd, 'out', 'link-map.json');
  const correlateReportDefault = resolve(cwd, 'out', 'correlate-report.json');
  let dbPath: string | undefined;
  let inputSnapshotPath: string | undefined;
  let snapshotOutPath = snapshotOutDefault;
  let existingMapPath: string | undefined;
  let mapOutPath = mapOutDefault;
  let overridesPath: string | undefined;
  let maxRecords: number | undefined;
  const rewriteOutput = createRewriteOutputScanState();
  const correlateOutput: { reportPath?: string | undefined; verbose: boolean } = { verbose: false };
  let skipUnescapeLinks = false;
  const output: RunOutputFlags = {
    json: false,
    jsonSteps: false,
    quiet: false,
    progress: false,
  };

  const scanned = scanArgv(args, cwd, {
    subcommand: 'run',
    handlers: [
      vaultDirArgHandler(),
      exactFlagHandler('--skip-unescape-links', () => {
        skipUnescapeLinks = true;
      }),
      exactFlagHandler('--json', () => {
        output.json = true;
      }),
      exactFlagHandler('--json-steps', () => {
        output.jsonSteps = true;
      }),
      exactFlagHandler('--quiet', () => {
        output.quiet = true;
      }),
      exactFlagHandler('-q', () => {
        output.quiet = true;
      }),
      exactFlagHandler('--progress', () => {
        output.progress = true;
      }),
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
      ...correlateOutputArgHandlers(correlateOutput),
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

  const correlateReportPath = correlateOutput.reportPath ?? correlateReportDefault;

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
      correlateReportPath,
      correlateReportPathDisplay: reportPathForDisplay(correlateReportPath, cwd),
      correlateVerbose: correlateOutput.verbose,
      skipUnescapeLinks,
      rewrite: {
        mode: modeParsed.mode,
        outDir: modeParsed.outDir,
        backup: modeParsed.backup,
      },
      output,
    },
  };
}

export async function runRun(
  parsed: RunCliOk,
  streams: MainStreams,
  options?: { cwd?: string | undefined },
): Promise<number> {
  const cwd = options?.cwd ?? process.cwd();
  const resolvedOutput = resolveRunOutput(parsed.output, streams);
  const quietSteps = resolvedOutput.mode !== 'json-steps';

  const steps: PipelineStepResult[] = [];

  const preflightExit = await runPreflightAtStart(parsed, streams, cwd);
  if (preflightExit !== null) {
    return preflightExit;
  }

  const invokeBase: StepInvokeContext = {
    cwd,
    quiet: quietSteps,
    interactive: resolvedOutput.mode === 'human',
    progress: resolvedOutput.progress,
    skipVaultCorrelateContext: resolveEvernoteSourceForRun(parsed) !== null,
    onProgress: (line) => {
      streams.stderr.write(line);
    },
  };

  if (
    parsed.dbPath !== undefined &&
    parsed.mapPath !== undefined &&
    parsed.snapshotPath === undefined
  ) {
    streams.stderr.write('run: warning: --map skips the snapshot step; --db is ignored\n');
  }

  let snapshotPath = parsed.snapshotPath;
  if (parsed.mapPath !== undefined) {
    steps.push(skippedStep('snapshot'));
  } else if (snapshotPath !== undefined) {
    steps.push(skippedStep('snapshot'));
  } else {
    const result = await runSnapshot(
      {
        dbPath: parsed.dbPath as string,
        outPath: parsed.snapshotOutPath,
        maxRecords: parsed.maxRecords,
      },
      streams,
      invokeBase,
    );
    steps.push(stepFromResult('snapshot', result));
    if (result.exitCode !== 0) {
      emitRunReport(steps, streams, { ...resolvedOutput, cwd });
      return pipelineExitCode(steps);
    }
    snapshotPath = parsed.snapshotOutPath;
  }

  let mapPath = parsed.mapPath;
  if (mapPath === undefined) {
    const result = await runCorrelate(
      {
        vaultRoot: parsed.vaultRoot,
        snapshotPath,
        overridesPath: parsed.overridesPath,
        outPath: parsed.mapOutPath,
        reportPath: parsed.correlateReportPath,
        reportPathDisplay: parsed.correlateReportPathDisplay,
        verbose: parsed.correlateVerbose,
      },
      streams,
      invokeBase,
    );
    steps.push(stepFromResult('correlate', result));
    if (result.exitCode !== 0) {
      emitRunReport(steps, streams, { ...resolvedOutput, cwd });
      return pipelineExitCode(steps);
    }
    mapPath = parsed.mapOutPath;
  } else {
    steps.push(skippedStep('correlate'));
  }

  if (!parsed.skipUnescapeLinks) {
    const result = await runUnescapeLinks(
      {
        vaultRoot: parsed.vaultRoot,
        mode: parsed.rewrite.mode,
        outDir: parsed.rewrite.outDir,
        backup: parsed.rewrite.backup,
        onlyPrefixes: [],
      },
      streams,
      invokeBase,
    );
    steps.push(stepFromResult('unescape-links', result));
    if (result.exitCode !== 0) {
      emitRunReport(steps, streams, { ...resolvedOutput, cwd });
      return pipelineExitCode(steps);
    }
  } else {
    steps.push(skippedStep('unescape-links'));
  }

  const overlayReadRoot =
    parsed.rewrite.mode === 'out-dir' && !parsed.skipUnescapeLinks
      ? parsed.rewrite.outDir
      : undefined;

  const rewriteResult = await runRewrite(
    {
      vaultRoot: parsed.vaultRoot,
      mapPath,
      mode: parsed.rewrite.mode,
      outDir: parsed.rewrite.outDir,
      backup: parsed.rewrite.backup,
      overlayReadRoot,
    },
    streams,
    invokeBase,
  );
  steps.push(stepFromResult('rewrite', rewriteResult));
  if (rewriteResult.exitCode !== 0) {
    emitRunReport(steps, streams, { ...resolvedOutput, cwd });
    return pipelineExitCode(steps);
  }

  const fixResult = await runFixResources(
    {
      vaultRoot: parsed.vaultRoot,
      mode: parsed.rewrite.mode,
      outDir: parsed.rewrite.outDir,
      backup: parsed.rewrite.backup,
    },
    streams,
    invokeBase,
  );
  steps.push(stepFromResult('fix-resources', fixResult));

  emitRunReport(steps, streams, { ...resolvedOutput, cwd });
  return pipelineExitCode(steps);
}
