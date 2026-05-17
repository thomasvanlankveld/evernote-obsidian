import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { scanVaultForEvernoteLinks } from '../vault/extractEvernoteLinks.ts';
import { VaultIndexRootError } from '../vault/vaultIndex.ts';
import { applyPathFlag, unknownSubcommandFlagError } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import {
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

export interface LinksCliOk {
  vaultRoot: string;
  skipOtherEvernoteHosts: boolean;
  outPath?: string | undefined;
}

export function parseLinksArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; links: LinksCliOk } | { ok: false; message: string } {
  let vaultState = createVaultDirFlagState();
  let skipOtherEvernoteHosts = false;
  let outPath: string | undefined;

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
      continue;
    }
    if (a === '--skip-other-evernote-hosts') {
      skipOtherEvernoteHosts = true;
      continue;
    }
    const outApplied = applyPathFlag(a, args, i, cwd, 'out', './out/broken-links.json');
    if (outApplied.kind === 'error') {
      return { ok: false, message: outApplied.message };
    }
    if (outApplied.kind === 'handled') {
      outPath = outApplied.path;
      i = outApplied.nextIndex;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('links', a) };
  }

  return {
    ok: true,
    links: {
      vaultRoot: resolveVaultRootFromState(vaultState, cwd),
      skipOtherEvernoteHosts,
      outPath,
    },
  };
}

export async function runLinks(parsed: LinksCliOk, streams: MainStreams): Promise<number> {
  try {
    const links = await scanVaultForEvernoteLinks(parsed.vaultRoot, {
      skipOtherEvernoteHosts: parsed.skipOtherEvernoteHosts,
    });
    const payload = { ok: true as const, vault: parsed.vaultRoot, links };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (parsed.outPath !== undefined) {
      await mkdir(dirname(parsed.outPath), { recursive: true });
      await writeFile(parsed.outPath, text, 'utf8');
      streams.stdout.write(
        `${JSON.stringify({ ok: true, path: parsed.outPath, count: links.length }, null, 2)}\n`,
      );
    } else {
      streams.stdout.write(text);
    }
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`links: ${msg}\n`);
    return 2;
  }
}
