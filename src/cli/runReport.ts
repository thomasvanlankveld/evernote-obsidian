import { relative } from 'node:path';
import type { MainStreams } from './cliTypes.ts';
import type { PipelineStepResult, StepId } from './pipelineStep.ts';
import type { ResolvedRunOutput } from './runOutput.ts';

const STEP_LABELS: Record<StepId, string> = {
  snapshot: 'snapshot',
  correlate: 'correlate',
  'unescape-links': 'unescape-links',
  rewrite: 'rewrite',
  'fix-resources': 'fix-resources',
};

function displayPath(absOrRel: string, cwd: string): string {
  const rel = relative(cwd, absOrRel);
  if (rel === '' || rel.startsWith('..')) {
    return absOrRel;
  }
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function stepIcon(status: PipelineStepResult['status']): string {
  if (status === 'ok') {
    return '✓';
  }
  if (status === 'skipped') {
    return '○';
  }
  return '✗';
}

function formatSnapshotLine(step: PipelineStepResult, cwd: string): string {
  const summary = step.summary;
  const count = typeof summary?.count === 'number' ? summary.count : undefined;
  const path = typeof summary?.path === 'string' ? displayPath(summary.path, cwd) : undefined;
  if (count !== undefined && path !== undefined) {
    return `${count} note${count === 1 ? '' : 's'} → ${path}`;
  }
  if (path !== undefined) {
    return path;
  }
  return step.status === 'skipped' ? 'skipped' : '';
}

function correlateSecondaryLine(step: PipelineStepResult): string | undefined {
  const reportPath = step.summary?.reportPath;
  if (typeof reportPath === 'string' && reportPath !== '') {
    return `see ${reportPath}`;
  }
  return undefined;
}

function formatCorrelateLine(step: PipelineStepResult, cwd: string): string {
  if (step.humanDetail !== undefined && step.humanDetail !== '') {
    return step.humanDetail;
  }
  const summary = step.summary;
  const count = typeof summary?.count === 'number' ? summary.count : undefined;
  const path = typeof summary?.path === 'string' ? displayPath(summary.path, cwd) : undefined;
  if (count !== undefined && path !== undefined) {
    return `${count} mapping${count === 1 ? '' : 's'} → ${path}`;
  }
  if (path !== undefined) {
    return path;
  }
  return '';
}

function formatRewriteLikeLine(step: PipelineStepResult): string {
  const summary = step.summary;
  const mode = typeof summary?.mode === 'string' ? summary.mode : undefined;
  const filesChanged = typeof summary?.filesChanged === 'number' ? summary.filesChanged : undefined;
  const replacements = typeof summary?.replacements === 'number' ? summary.replacements : undefined;
  const parts: string[] = [];
  if (mode !== undefined) {
    parts.push(mode);
  }
  if (filesChanged !== undefined) {
    parts.push(`${filesChanged} file${filesChanged === 1 ? '' : 's'} changed`);
  }
  if (replacements !== undefined) {
    parts.push(`${replacements} replacement${replacements === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function formatStepPrimaryLine(step: PipelineStepResult, cwd: string): string {
  if (step.status === 'skipped') {
    return 'skipped';
  }
  switch (step.id) {
    case 'snapshot':
      return formatSnapshotLine(step, cwd);
    case 'correlate':
      return formatCorrelateLine(step, cwd);
    case 'unescape-links':
    case 'rewrite':
    case 'fix-resources':
      return formatRewriteLikeLine(step);
    default:
      return '';
  }
}

function failedStep(steps: readonly PipelineStepResult[]): StepId | undefined {
  for (const step of steps) {
    if (step.status === 'failed' || step.status === 'error') {
      return step.id;
    }
  }
  return undefined;
}

export function pipelineOk(steps: readonly PipelineStepResult[]): boolean {
  return failedStep(steps) === undefined;
}

export function pipelineExitCode(steps: readonly PipelineStepResult[]): number {
  for (const step of steps) {
    if (step.exitCode !== 0) {
      return step.exitCode;
    }
  }
  return 0;
}

export function formatHumanReport(steps: readonly PipelineStepResult[], cwd: string): string {
  const lines: string[] = ['evernote-obsidian run', ''];
  for (const step of steps) {
    const label = STEP_LABELS[step.id];
    const icon = stepIcon(step.status);
    const detail = formatStepPrimaryLine(step, cwd);
    const pad = ' '.repeat(Math.max(1, 14 - label.length));
    lines.push(`  ${icon} ${label}${pad}${detail}`);
    if (step.id === 'correlate' && (step.status === 'failed' || step.status === 'error')) {
      const secondary = correlateSecondaryLine(step);
      if (secondary !== undefined) {
        lines.push(`               ${secondary}`);
      }
    }
  }
  lines.push('');
  const fail = failedStep(steps);
  if (fail === undefined) {
    lines.push('Run succeeded.');
  } else {
    const failed = steps.find((s) => s.id === fail);
    const code = failed?.exitCode ?? 1;
    lines.push(`Run failed at ${fail} (exit ${code}).`);
  }
  return `${lines.join('\n')}\n`;
}

function buildJsonReport(steps: readonly PipelineStepResult[]): Record<string, unknown> {
  const fail = failedStep(steps);
  return {
    ok: fail === undefined,
    ...(fail !== undefined ? { failedStep: fail } : {}),
    steps: steps.map((step) => ({
      id: step.id,
      status: step.status,
      exitCode: step.exitCode,
      ...(step.summary !== undefined ? { summary: step.summary } : {}),
      ...(step.humanDetail !== undefined ? { humanDetail: step.humanDetail } : {}),
    })),
  };
}

export function emitRunReport(
  steps: readonly PipelineStepResult[],
  streams: MainStreams,
  options: ResolvedRunOutput & { cwd: string },
): void {
  const exitFailed = !pipelineOk(steps);
  const fail = failedStep(steps);

  if (options.mode === 'json-steps') {
    if (exitFailed && fail !== undefined) {
      streams.stderr.write(`\nRun failed at ${fail}.\n`);
    }
    return;
  }

  if (options.mode === 'json') {
    streams.stdout.write(`${JSON.stringify(buildJsonReport(steps), null, 2)}\n`);
    if (exitFailed && !options.quiet && fail !== undefined) {
      streams.stderr.write(`Run failed at ${fail}.\n`);
    }
    return;
  }

  const report = formatHumanReport(steps, options.cwd);
  if (exitFailed) {
    streams.stderr.write(report);
  } else {
    streams.stdout.write(report);
  }
}
