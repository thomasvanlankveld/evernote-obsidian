import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { unknownSubcommandFlagError } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import {
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

export function parseIndexArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; path: string } | { ok: false; message: string } {
  let vaultState = createVaultDirFlagState();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    const applied = applyVaultDirFlag(a, args, i, cwd, vaultState);
    if (applied.kind === 'error') {
      return { ok: false, message: applied.message };
    }
    if (applied.kind === 'handled') {
      vaultState = applied.state;
      i = applied.nextIndex;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('index', a) };
  }
  return { ok: true, path: resolveVaultRootFromState(vaultState, cwd) };
}

export async function runIndex(vaultRoot: string, streams: MainStreams): Promise<number> {
  try {
    const result = await buildVaultIndex(vaultRoot);
    if (!result.ok) {
      streams.stderr.write(
        `${JSON.stringify(
          { ok: false, collisions: result.collisions, guidCollisions: result.guidCollisions },
          null,
          2,
        )}\n`,
      );
      return 1;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, vault: vaultRoot, count: result.entries.length }, null, 2)}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`index: ${msg}\n`);
    return 2;
  }
}
