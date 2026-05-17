import {
  applyPathFlag,
  applyPositiveIntFlag,
  type RewriteOutputScanState,
  unknownSubcommandFlagError,
} from './cliFlags.ts';
import {
  applyVaultDirFlag,
  createVaultDirFlagState,
  type VaultDirFlagState,
} from './vaultDirFlag.ts';

export type ArgApplyResult =
  | { kind: 'handled'; nextIndex: number }
  | { kind: 'error'; message: string }
  | { kind: 'not-matched' };

export type ScanContext = {
  cwd: string;
  vaultState: VaultDirFlagState;
  /** When set, vault flags are recognized but do not update vaultState. */
  presetVaultRoot?: string | undefined;
};

export type ArgHandler = (
  arg: string,
  args: readonly string[],
  index: number,
  ctx: ScanContext,
) => ArgApplyResult;

export type ScanArgvOptions = {
  handlers: readonly ArgHandler[];
  permissive?: boolean | undefined;
  subcommand?: string | undefined;
  initialVaultState?: VaultDirFlagState | undefined;
  presetVaultRoot?: string | undefined;
};

export type ScanArgvOk = {
  ok: true;
  vaultState: VaultDirFlagState;
};

export function scanArgv(
  args: readonly string[],
  cwd: string,
  options: ScanArgvOptions,
): ScanArgvOk | { ok: false; message: string } {
  const ctx: ScanContext = {
    cwd,
    vaultState: options.initialVaultState ?? createVaultDirFlagState(),
    presetVaultRoot: options.presetVaultRoot,
  };
  const permissive = options.permissive === true;
  const subcommand = options.subcommand ?? 'command';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    let handled = false;
    for (const handler of options.handlers) {
      const result = handler(a, args, i, ctx);
      if (result.kind === 'error') {
        return { ok: false, message: result.message };
      }
      if (result.kind === 'handled') {
        i = result.nextIndex;
        handled = true;
        break;
      }
    }
    if (!handled && a.startsWith('-')) {
      if (permissive) {
        continue;
      }
      return { ok: false, message: unknownSubcommandFlagError(subcommand, a) };
    }
  }

  return { ok: true, vaultState: ctx.vaultState };
}

export function vaultDirArgHandler(): ArgHandler {
  return (arg, args, index, ctx) => {
    const applied = applyVaultDirFlag(arg, args, index, ctx.cwd, ctx.vaultState);
    if (applied.kind === 'error') {
      return { kind: 'error', message: applied.message };
    }
    if (applied.kind === 'handled') {
      if (ctx.presetVaultRoot === undefined) {
        ctx.vaultState = applied.state;
      }
      return { kind: 'handled', nextIndex: applied.nextIndex };
    }
    return { kind: 'not-matched' };
  };
}

export function pathFlagHandler(
  flag: string,
  examplePath: string,
  assign: (path: string) => void,
): ArgHandler {
  return (arg, args, index, ctx) => {
    const applied = applyPathFlag(arg, args, index, ctx.cwd, flag, examplePath);
    if (applied.kind === 'error') {
      return { kind: 'error', message: applied.message };
    }
    if (applied.kind === 'handled') {
      assign(applied.path);
      return { kind: 'handled', nextIndex: applied.nextIndex };
    }
    return { kind: 'not-matched' };
  };
}

export function positiveIntFlagHandler(flag: string, assign: (value: number) => void): ArgHandler {
  return (arg, args, index) => {
    const applied = applyPositiveIntFlag(arg, args, index, flag);
    if (applied.kind === 'error') {
      return { kind: 'error', message: applied.message };
    }
    if (applied.kind === 'handled') {
      assign(applied.value);
      return { kind: 'handled', nextIndex: applied.nextIndex };
    }
    return { kind: 'not-matched' };
  };
}

export function exactFlagHandler(flag: string, onMatch: () => void): ArgHandler {
  return (arg, _args, index) => {
    if (arg === flag) {
      onMatch();
      return { kind: 'handled', nextIndex: index };
    }
    return { kind: 'not-matched' };
  };
}

export function rewriteOutputModeArgHandlers(state: RewriteOutputScanState): ArgHandler[] {
  return [
    exactFlagHandler('--dry-run', () => {
      state.explicitDryRun = true;
    }),
    exactFlagHandler('--in-place', () => {
      state.inPlace = true;
    }),
    exactFlagHandler('--backup', () => {
      state.backup = true;
    }),
    pathFlagHandler('out-dir', './out/rewritten-vault', (path) => {
      state.outDir = path;
    }),
  ];
}
