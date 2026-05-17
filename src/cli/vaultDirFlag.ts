import { resolve } from 'node:path';

export interface VaultDirFlagState {
  explicitPath?: string | undefined;
}

export function createVaultDirFlagState(): VaultDirFlagState {
  return {};
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
  _state: VaultDirFlagState,
): VaultDirFlagApplyResult {
  if (arg === '--vault-dir' || arg === '--vault') {
    const v = args[index + 1];
    if (v === undefined || v.startsWith('-')) {
      const flag = arg === '--vault-dir' ? '--vault-dir' : '--vault';
      return {
        kind: 'error',
        message: `error: ${flag} requires a path (e.g. ${flag} ./data)`,
      };
    }
    return {
      kind: 'handled',
      nextIndex: index + 1,
      state: { explicitPath: resolve(cwd, v) },
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
      state: { explicitPath: resolve(cwd, tail) },
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
      state: { explicitPath: resolve(cwd, tail) },
    };
  }
  return { kind: 'not-vault-flag' };
}

export function resolveVaultRootFromState(state: VaultDirFlagState, cwd: string): string {
  const defaultData = resolve(cwd, 'data');
  return state.explicitPath ?? defaultData;
}

/** Resolve `--vault-dir` / `--vault` from argv (last flag wins). */
export function parseVaultRootFromArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; vaultRoot: string } | { ok: false; message: string } {
  let vaultState = createVaultDirFlagState();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    const vaultApplied = applyVaultDirFlag(a, args, i, cwd, vaultState);
    if (vaultApplied.kind === 'error') {
      return { ok: false, message: vaultApplied.message };
    }
    if (vaultApplied.kind === 'handled') {
      vaultState = vaultApplied.state;
      i = vaultApplied.nextIndex;
    }
  }
  return { ok: true, vaultRoot: resolveVaultRootFromState(vaultState, cwd) };
}
