import { resolve } from 'node:path';

export const VAULT_DIR_DEPRECATION_WARNING =
  'warning: --vault is deprecated; use --vault-dir instead';

export interface VaultDirFlagState {
  explicitPath?: string | undefined;
  usedDeprecatedAlias: boolean;
}

export function createVaultDirFlagState(): VaultDirFlagState {
  return { usedDeprecatedAlias: false };
}

export type VaultDirFlagApplyResult =
  | { kind: 'handled'; nextIndex: number; state: VaultDirFlagState }
  | { kind: 'error'; message: string }
  | { kind: 'not-vault-flag' };

export function applyVaultDirFlag(
  arg: string,
  args: readonly string[],
  index: number,
  cwd: string,
  state: VaultDirFlagState,
): VaultDirFlagApplyResult {
  if (arg === '--vault-dir') {
    const v = args[index + 1];
    if (v === undefined || v.startsWith('-')) {
      return {
        kind: 'error',
        message: 'error: --vault-dir requires a path (e.g. --vault-dir ./data)',
      };
    }
    return {
      kind: 'handled',
      nextIndex: index + 1,
      state: { explicitPath: resolve(cwd, v), usedDeprecatedAlias: state.usedDeprecatedAlias },
    };
  }
  if (arg.startsWith('--vault-dir=')) {
    const tail = arg.slice('--vault-dir='.length);
    if (tail === '') {
      return { kind: 'error', message: 'error: --vault-dir= requires a non-empty path' };
    }
    return {
      kind: 'handled',
      nextIndex: index,
      state: { explicitPath: resolve(cwd, tail), usedDeprecatedAlias: state.usedDeprecatedAlias },
    };
  }
  if (arg === '--vault') {
    const v = args[index + 1];
    if (v === undefined || v.startsWith('-')) {
      return {
        kind: 'error',
        message: 'error: --vault requires a path (e.g. --vault ./data)',
      };
    }
    return {
      kind: 'handled',
      nextIndex: index + 1,
      state: { explicitPath: resolve(cwd, v), usedDeprecatedAlias: true },
    };
  }
  if (arg.startsWith('--vault=')) {
    const tail = arg.slice('--vault='.length);
    if (tail === '') {
      return { kind: 'error', message: 'error: --vault= requires a non-empty path' };
    }
    return {
      kind: 'handled',
      nextIndex: index,
      state: { explicitPath: resolve(cwd, tail), usedDeprecatedAlias: true },
    };
  }
  return { kind: 'not-vault-flag' };
}

export function resolveVaultRootFromState(state: VaultDirFlagState, cwd: string): string {
  const defaultData = resolve(cwd, 'data');
  return state.explicitPath ?? defaultData;
}

export function writeVaultDeprecatedWarning(streams: { stderr: NodeJS.WritableStream }): void {
  streams.stderr.write(`${VAULT_DIR_DEPRECATION_WARNING}\n`);
}
