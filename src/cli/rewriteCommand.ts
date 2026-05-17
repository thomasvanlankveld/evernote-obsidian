import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  assertLinkMapVaultRootMatches,
  LinkMapParseError,
  LinkMapVaultRootMismatchError,
  parseLinkMapJson,
} from '../correlation/linkMapFile.ts';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import { rewriteMarkdownWithGuidMap } from '../vault/rewriteEvernoteLinks.ts';
import { VaultIndexRootError, walkVaultMarkdownFiles } from '../vault/vaultIndex.ts';
import { applyPathFlag, parseRewriteOutputMode, unknownSubcommandFlagError } from './cliFlags.ts';
import type { MainStreams, SubcommandParseOptions } from './cliTypes.ts';
import {
  advancePastVaultDirFlag,
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

export interface RewriteCliOk {
  vaultRoot: string;
  mapPath: string;
  mode: 'dry-run' | 'out-dir' | 'in-place';
  outDir?: string | undefined;
  backup?: boolean | undefined;
}

export function parseRewriteArgs(
  args: readonly string[],
  cwd: string,
  options?: SubcommandParseOptions,
): { ok: true; rewrite: RewriteCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'rewrite';
  const permissive = options?.permissive === true;
  const resolvedVaultRoot = options?.vaultRoot;
  let vaultState = createVaultDirFlagState();
  let mapPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    if (resolvedVaultRoot !== undefined) {
      const vaultSkipped = advancePastVaultDirFlag(a, args, i);
      if (vaultSkipped.kind === 'advanced') {
        i = vaultSkipped.nextIndex;
        continue;
      }
    } else {
      const vaultApplied = applyVaultDirFlag(a, args, i, cwd, vaultState);
      if (vaultApplied.kind === 'error') {
        return { ok: false, message: vaultApplied.message };
      }
      if (vaultApplied.kind === 'handled') {
        vaultState = vaultApplied.state;
        i = vaultApplied.nextIndex;
        continue;
      }
    }
    const mapApplied = applyPathFlag(a, args, i, cwd, 'map', './out/link-map.json');
    if (mapApplied.kind === 'error') {
      return { ok: false, message: mapApplied.message };
    }
    if (mapApplied.kind === 'handled') {
      mapPath = mapApplied.path;
      i = mapApplied.nextIndex;
      continue;
    }
    if (permissive) {
      continue;
    }
    if (a === '--dry-run' || a === '--in-place' || a === '--backup' || a.startsWith('--out-dir=')) {
      continue;
    }
    if (a === '--out-dir') {
      i++;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError(subcommand, a) };
  }

  if (!permissive && mapPath === undefined) {
    return {
      ok: false,
      message:
        'error: rewrite requires --map <path> (link map JSON from correlate, e.g. ./out/link-map.json)',
    };
  }

  const modeParsed = parseRewriteOutputMode(args, cwd);
  if (!modeParsed.ok) {
    return modeParsed;
  }

  return {
    ok: true,
    rewrite: {
      vaultRoot: resolvedVaultRoot ?? resolveVaultRootFromState(vaultState, cwd),
      mapPath: mapPath ?? '',
      mode: modeParsed.mode,
      outDir: modeParsed.outDir,
      backup: modeParsed.backup,
    },
  };
}

export async function runRewrite(parsed: RewriteCliOk, streams: MainStreams): Promise<number> {
  try {
    const rawMap = await readFile(parsed.mapPath, 'utf8');
    const linkMap = parseLinkMapJson(rawMap);
    assertLinkMapVaultRootMatches(linkMap, parsed.vaultRoot);
    const guidToPath = new Map<string, string>(Object.entries(linkMap.guidToPath));

    const files = await walkVaultMarkdownFiles(parsed.vaultRoot);
    let filesScanned = 0;
    let filesChanged = 0;
    let replacements = 0;
    let skippedUnmapped = 0;

    for (const abs of files) {
      filesScanned++;
      const content = await readFile(abs, 'utf8');
      const {
        content: next,
        replaced,
        skippedUnmapped: skipped,
      } = rewriteMarkdownWithGuidMap(content, guidToPath);
      skippedUnmapped += skipped;
      if (next === content) {
        continue;
      }
      filesChanged++;
      replacements += replaced;

      if (parsed.mode === 'dry-run') {
        continue;
      }

      if (parsed.mode === 'out-dir') {
        const outRoot = parsed.outDir;
        if (outRoot === undefined || outRoot === '') {
          streams.stderr.write('rewrite: --out-dir requires a non-empty path\n');
          return 2;
        }
        const rel = relative(parsed.vaultRoot, abs).split('\\').join('/');
        const dest = join(outRoot, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, next, 'utf8');
        continue;
      }

      if (parsed.backup === true) {
        const bak = `${abs}.evernote-obsidian.bak`;
        await writeFile(bak, content, 'utf8');
      }
      await atomicReplaceFile(abs, next);
    }

    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: parsed.mode,
          vault: parsed.vaultRoot,
          map: parsed.mapPath,
          filesScanned,
          filesChanged,
          replacements,
          skippedUnmapped,
          wroteFiles: parsed.mode !== 'dry-run',
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    if (e instanceof LinkMapParseError) {
      streams.stderr.write(`rewrite: ${e.message}\n`);
      return 2;
    }
    if (e instanceof LinkMapVaultRootMismatchError) {
      streams.stderr.write(`rewrite: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`rewrite: ${msg}\n`);
    return 2;
  }
}
