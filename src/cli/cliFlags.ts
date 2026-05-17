import { resolve } from 'node:path';

export type ParseFail = { ok: false; message: string };

export type RewriteOutputMode = 'dry-run' | 'out-dir' | 'in-place';

export type RewriteOutputModeOk = {
  ok: true;
  mode: RewriteOutputMode;
  outDir?: string | undefined;
  backup?: boolean | undefined;
};

export function hasExplicitVaultArg(args: readonly string[]): boolean {
  return args.some(
    (a) =>
      a === '--vault-dir' ||
      a === '--vault' ||
      a.startsWith('--vault-dir=') ||
      a.startsWith('--vault='),
  );
}

const RUN_FLAG_PREFIXES = [
  '--vault-dir',
  '--vault',
  '--db',
  '--snapshot',
  '--snapshot-out',
  '--map',
  '--map-out',
  '--out',
  '--overrides',
  '--max-notes',
  '--dry-run',
  '--out-dir',
  '--in-place',
  '--backup',
] as const;

function isRunFlagToken(arg: string): boolean {
  return RUN_FLAG_PREFIXES.some((p) => arg === p || arg.startsWith(`${p}=`));
}

const RUN_FLAGS_WITH_VALUE = new Set([
  '--vault-dir',
  '--vault',
  '--db',
  '--snapshot',
  '--snapshot-out',
  '--map',
  '--map-out',
  '--out',
  '--overrides',
  '--max-notes',
  '--out-dir',
]);

/** Reject flags that no pipeline step understands (`run` composes permissive parsers). */
export function assertKnownRunFlags(args: readonly string[]): ParseFail | { ok: true } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || !a.startsWith('-')) {
      continue;
    }
    if (isRunFlagToken(a)) {
      if (RUN_FLAGS_WITH_VALUE.has(a)) {
        i++;
      }
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('run', a) };
  }
  return { ok: true };
}

/** Parse rewrite output mode flags shared by `rewrite` and `run`. */
export function parseRewriteOutputMode(
  args: readonly string[],
  cwd: string,
): RewriteOutputModeOk | ParseFail {
  let explicitDryRun = false;
  let outDir: string | undefined;
  let inPlace = false;
  let backup = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    if (a === '--dry-run') {
      explicitDryRun = true;
      continue;
    }
    if (a === '--in-place') {
      inPlace = true;
      continue;
    }
    if (a === '--backup') {
      backup = true;
      continue;
    }
    const outDirApplied = applyPathFlag(a, args, i, cwd, 'out-dir', './out/rewritten-vault');
    if (outDirApplied.kind === 'error') {
      return { ok: false, message: outDirApplied.message };
    }
    if (outDirApplied.kind === 'handled') {
      outDir = outDirApplied.path;
      i = outDirApplied.nextIndex;
    }
  }

  if (inPlace && outDir !== undefined) {
    return { ok: false, message: 'error: use only one of --in-place or --out-dir' };
  }

  if (explicitDryRun && (inPlace || outDir !== undefined)) {
    return {
      ok: false,
      message: 'error: --dry-run cannot be combined with --in-place or --out-dir',
    };
  }

  if (backup && !inPlace) {
    return { ok: false, message: `error: --backup is only valid with --in-place` };
  }

  let mode: RewriteOutputMode;
  if (inPlace) {
    mode = 'in-place';
  } else if (outDir !== undefined) {
    mode = 'out-dir';
  } else {
    mode = 'dry-run';
  }

  return {
    ok: true,
    mode,
    outDir: mode === 'out-dir' ? outDir : undefined,
    backup: backup ? true : undefined,
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
