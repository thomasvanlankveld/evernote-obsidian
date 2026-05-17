export type StepId = 'snapshot' | 'correlate' | 'unescape-links' | 'rewrite' | 'fix-resources';

export type StepStatus = 'skipped' | 'ok' | 'failed' | 'error';

export interface PipelineStepResult {
  id: StepId;
  status: StepStatus;
  exitCode: number;
  summary?: Record<string, unknown> | undefined;
  humanDetail?: string | undefined;
}

export interface StepInvokeContext {
  /** Suppress per-step stdout JSON (used by `run`). */
  quiet?: boolean | undefined;
  /** Emit progress lines to stderr when set. */
  progress?: boolean | undefined;
  onProgress?: ((line: string) => void) | undefined;
}

export interface StepInvokeResult {
  exitCode: number;
  summary?: Record<string, unknown> | undefined;
  humanDetail?: string | undefined;
}

export function stepStatusFromExitCode(exitCode: number): StepStatus {
  if (exitCode === 0) {
    return 'ok';
  }
  if (exitCode === 1) {
    return 'failed';
  }
  return 'error';
}

export function emitStepProgress(ctx: StepInvokeContext | undefined, line: string): void {
  if (ctx?.progress !== true) {
    return;
  }
  ctx.onProgress?.(`${line}\n`);
}
