import { resolve } from 'node:path';

export type ParseFail = { ok: false; message: string };

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
