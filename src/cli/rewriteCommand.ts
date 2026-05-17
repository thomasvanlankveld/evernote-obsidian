import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  assertLinkMapVaultRootMatches,
  LinkMapParseError,
  LinkMapVaultRootMismatchError,
  parseLinkMapJson,
} from '../correlation/linkMapFile.ts';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import { readVaultMarkdownFile } from '../vault/readVaultMarkdownFile.ts';
import { rewriteMarkdownWithGuidMap } from '../vault/rewriteEvernoteLinks.ts';
import { VaultIndexRootError, walkVaultMarkdownFiles } from '../vault/vaultIndex.ts';
import {
  pathFlagHandler,
  rewriteOutputModeArgHandlers,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import { createRewriteOutputScanState, finalizeRewriteOutputMode } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { emitStepProgress, type StepInvokeContext, type StepInvokeResult } from './pipelineStep.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface RewriteCliOk {
  vaultRoot: string;
  mapPath: string;
  mode: 'dry-run' | 'out-dir' | 'in-place';
  outDir?: string | undefined;
  backup?: boolean | undefined;
  /** When set, read Markdown from this mirror before the vault file (chained `--out-dir`). */
  overlayReadRoot?: string | undefined;
}

export function parseRewriteArgs(
  args: readonly string[],
  cwd: string,
  options?: { subcommand?: string | undefined },
): { ok: true; rewrite: RewriteCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'rewrite';
  let mapPath: string | undefined;
  const rewriteOutput = createRewriteOutputScanState();

  const scanned = scanArgv(args, cwd, {
    subcommand,
    handlers: [
      vaultDirArgHandler(),
      pathFlagHandler('map', './out/link-map.json', (path) => {
        mapPath = path;
      }),
      ...rewriteOutputModeArgHandlers(rewriteOutput),
    ],
  });
  if (!scanned.ok) {
    return scanned;
  }

  if (mapPath === undefined) {
    return {
      ok: false,
      message:
        'error: rewrite requires --map <path> (link map JSON from correlate, e.g. ./out/link-map.json)',
    };
  }

  const modeParsed = finalizeRewriteOutputMode(rewriteOutput);
  if (!modeParsed.ok) {
    return modeParsed;
  }

  return {
    ok: true,
    rewrite: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      mapPath,
      mode: modeParsed.mode,
      outDir: modeParsed.outDir,
      backup: modeParsed.backup,
    },
  };
}

export async function runRewrite(
  parsed: RewriteCliOk,
  streams: MainStreams,
  invoke?: StepInvokeContext,
): Promise<StepInvokeResult> {
  try {
    emitStepProgress(invoke, 'rewrite: loading link map…');
    const rawMap = await readFile(parsed.mapPath, 'utf8');
    const linkMap = parseLinkMapJson(rawMap);
    assertLinkMapVaultRootMatches(linkMap, parsed.vaultRoot);
    const guidToPath = new Map<string, string>(Object.entries(linkMap.guidToPath));

    emitStepProgress(invoke, 'rewrite: scanning vault…');
    const files = await walkVaultMarkdownFiles(parsed.vaultRoot);
    let filesScanned = 0;
    let filesChanged = 0;
    let replacements = 0;
    let skippedUnmapped = 0;

    for (const abs of files) {
      filesScanned++;
      const content = await readVaultMarkdownFile(abs, parsed.vaultRoot, {
        overlayRoot: parsed.overlayReadRoot,
      });
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
          return { exitCode: 2 };
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

    const summary = {
      ok: true,
      mode: parsed.mode,
      vault: parsed.vaultRoot,
      map: parsed.mapPath,
      filesScanned,
      filesChanged,
      replacements,
      skippedUnmapped,
      wroteFiles: parsed.mode !== 'dry-run',
    };
    emitStepProgress(
      invoke,
      `rewrite: ${filesChanged} file${filesChanged === 1 ? '' : 's'} changed, ${replacements} replacement${replacements === 1 ? '' : 's'}`,
    );
    if (invoke?.quiet !== true) {
      streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    return { exitCode: 0, summary };
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return { exitCode: 2 };
    }
    if (e instanceof LinkMapParseError) {
      streams.stderr.write(`rewrite: ${e.message}\n`);
      return { exitCode: 2 };
    }
    if (e instanceof LinkMapVaultRootMismatchError) {
      streams.stderr.write(`rewrite: ${e.message}\n`);
      return { exitCode: 2 };
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`rewrite: ${msg}\n`);
    return { exitCode: 2 };
  }
}
