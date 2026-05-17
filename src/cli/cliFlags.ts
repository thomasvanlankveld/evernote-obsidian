import { resolve } from 'node:path';

export type ParseFail = { ok: false; message: string };

export type RewriteOutputMode = 'dry-run' | 'out-dir' | 'in-place';

export type RewriteOutputModeOk = {
  ok: true;
  mode: RewriteOutputMode;
  outDir?: string | undefined;
  backup?: boolean | undefined;
};

export type RewriteOutputScanState = {
  explicitDryRun: boolean;
  outDir?: string | undefined;
  inPlace: boolean;
  backup: boolean;
};

export function createRewriteOutputScanState(): RewriteOutputScanState {
  return { explicitDryRun: false, inPlace: false, backup: false };
}

/** Validate rewrite output flags collected during argv scan. */
export function finalizeRewriteOutputMode(
  state: RewriteOutputScanState,
): RewriteOutputModeOk | ParseFail {
  if (state.inPlace && state.outDir !== undefined) {
    return { ok: false, message: 'error: use only one of --in-place or --out-dir' };
  }

  if (state.explicitDryRun && (state.inPlace || state.outDir !== undefined)) {
    return {
      ok: false,
      message: 'error: --dry-run cannot be combined with --in-place or --out-dir',
    };
  }

  if (state.backup && !state.inPlace) {
    return { ok: false, message: `error: --backup is only valid with --in-place` };
  }

  let mode: RewriteOutputMode;
  if (state.inPlace) {
    mode = 'in-place';
  } else if (state.outDir !== undefined) {
    mode = 'out-dir';
  } else {
    mode = 'dry-run';
  }

  return {
    ok: true,
    mode,
    outDir: mode === 'out-dir' ? state.outDir : undefined,
    backup: state.backup ? true : undefined,
  };
}

export function unknownSubcommandFlagError(subcommand: string, token: string): string {
  return `error: unknown ${subcommand} flag: ${token}`;
}

export type PathFlagApplyResult =
  | { kind: 'handled'; path: string; nextIndex: number }
  | { kind: 'not-path-flag' }
  | { kind: 'error'; message: string };

/** Parse `--name path` or `--name=path` (resolved against cwd). */
export function applyPathFlag(
  arg: string,
  args: readonly string[],
  index: number,
  cwd: string,
  flag: string,
  examplePath = './path',
): PathFlagApplyResult {
  const spaced = `--${flag}`;
  const eqPrefix = `${spaced}=`;
  if (arg === spaced) {
    const v = args[index + 1];
    if (v === undefined || v.startsWith('-')) {
      return {
        kind: 'error',
        message: `error: --${flag} requires a path (e.g. --${flag} ${examplePath})`,
      };
    }
    return { kind: 'handled', path: resolve(cwd, v), nextIndex: index + 1 };
  }
  if (arg.startsWith(eqPrefix)) {
    const tail = arg.slice(eqPrefix.length);
    if (tail === '') {
      return { kind: 'error', message: `error: --${flag}= requires a non-empty path` };
    }
    return { kind: 'handled', path: resolve(cwd, tail), nextIndex: index };
  }
  return { kind: 'not-path-flag' };
}

export type PositiveIntFlagApplyResult =
  | { kind: 'handled'; value: number; nextIndex: number }
  | { kind: 'not-int-flag' }
  | { kind: 'error'; message: string };

/** Parse `--name N` or `--name=N` (positive integer). */
export function applyPositiveIntFlag(
  arg: string,
  args: readonly string[],
  index: number,
  flag: string,
): PositiveIntFlagApplyResult {
  const spaced = `--${flag}`;
  const eqPrefix = `${spaced}=`;
  if (arg === spaced) {
    const v = args[index + 1];
    const n = v !== undefined ? Number.parseInt(v, 10) : Number.NaN;
    if (!Number.isFinite(n) || n < 1) {
      return {
        kind: 'error',
        message: `error: --${flag} must be a positive integer`,
      };
    }
    return { kind: 'handled', value: n, nextIndex: index + 1 };
  }
  if (arg.startsWith(eqPrefix)) {
    const tail = arg.slice(eqPrefix.length);
    const n = Number.parseInt(tail, 10);
    if (!Number.isFinite(n) || n < 1) {
      return {
        kind: 'error',
        message: `error: --${flag} must be a positive integer`,
      };
    }
    return { kind: 'handled', value: n, nextIndex: index };
  }
  return { kind: 'not-int-flag' };
}
