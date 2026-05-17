import type { MainStreams } from './cliTypes.ts';

export interface RunOutputFlags {
  json: boolean;
  jsonSteps: boolean;
  quiet: boolean;
  progress: boolean;
}

export interface ResolvedRunOutput {
  mode: 'human' | 'json' | 'json-steps';
  quiet: boolean;
  progress: boolean;
}

export function isStdoutTty(streams: MainStreams): boolean {
  return 'isTTY' in streams.stdout && streams.stdout.isTTY === true;
}

export function resolveRunOutput(flags: RunOutputFlags, streams: MainStreams): ResolvedRunOutput {
  const tty = isStdoutTty(streams);
  if (flags.jsonSteps) {
    return { mode: 'json-steps', quiet: false, progress: flags.progress || tty };
  }
  if (flags.json || !tty) {
    return { mode: 'json', quiet: flags.quiet, progress: flags.progress || tty };
  }
  return { mode: 'human', quiet: flags.quiet, progress: flags.progress || tty };
}
