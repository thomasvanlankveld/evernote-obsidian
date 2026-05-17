import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import {
  collectResourceEmbedLineChanges,
  rewriteImporterResourceEmbeds,
} from '../vault/rewriteImporterResourceEmbeds.ts';
import { VaultIndexRootError, walkVaultMarkdownFiles } from '../vault/vaultIndex.ts';
import { rewriteOutputModeArgHandlers, scanArgv, vaultDirArgHandler } from './argvScan.ts';
import { createRewriteOutputScanState, finalizeRewriteOutputMode } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { emitStepProgress, type StepInvokeContext, type StepInvokeResult } from './pipelineStep.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

export interface FixResourcesCliOk {
  vaultRoot: string;
  mode: 'dry-run' | 'out-dir' | 'in-place';
  outDir?: string | undefined;
  backup?: boolean | undefined;
}

export interface FixResourcesFileChange {
  file: string;
  line: number;
  before: string;
  after: string;
}

/** When using `--out-dir`, prefer a mirrored file from a prior `rewrite` step if present. */
export async function readMarkdownSourceForFixResources(
  vaultAbs: string,
  rel: string,
  parsed: FixResourcesCliOk,
): Promise<string> {
  if (parsed.mode === 'out-dir' && parsed.outDir !== undefined && parsed.outDir !== '') {
    const mirrored = join(parsed.outDir, rel);
    try {
      return await readFile(mirrored, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw e;
      }
    }
  }
  return readFile(vaultAbs, 'utf8');
}

export function parseFixResourcesArgs(
  args: readonly string[],
  cwd: string,
  options?: { subcommand?: string | undefined },
): { ok: true; fixResources: FixResourcesCliOk } | { ok: false; message: string } {
  const subcommand = options?.subcommand ?? 'fix-resources';
  const rewriteOutput = createRewriteOutputScanState();

  const scanned = scanArgv(args, cwd, {
    subcommand,
    handlers: [vaultDirArgHandler(), ...rewriteOutputModeArgHandlers(rewriteOutput)],
  });
  if (!scanned.ok) {
    return scanned;
  }

  const modeParsed = finalizeRewriteOutputMode(rewriteOutput);
  if (!modeParsed.ok) {
    return modeParsed;
  }

  return {
    ok: true,
    fixResources: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      mode: modeParsed.mode,
      outDir: modeParsed.outDir,
      backup: modeParsed.backup,
    },
  };
}

export async function runFixResources(
  parsed: FixResourcesCliOk,
  streams: MainStreams,
  invoke?: StepInvokeContext,
): Promise<StepInvokeResult> {
  try {
    emitStepProgress(invoke, 'fix-resources: scanning vault…');
    const files = await walkVaultMarkdownFiles(parsed.vaultRoot);
    let filesScanned = 0;
    let filesChanged = 0;
    let replacements = 0;
    const changes: FixResourcesFileChange[] = [];

    for (const abs of files) {
      filesScanned++;
      const rel = relative(parsed.vaultRoot, abs).split('\\').join('/');
      const content = await readMarkdownSourceForFixResources(abs, rel, parsed);
      for (const lineChange of collectResourceEmbedLineChanges(content)) {
        changes.push({ file: rel, ...lineChange });
      }

      const { content: next, replacements: n } = rewriteImporterResourceEmbeds(content);
      replacements += n;
      if (next === content) {
        continue;
      }
      filesChanged++;

      if (parsed.mode === 'dry-run') {
        continue;
      }

      if (parsed.mode === 'out-dir') {
        const outRoot = parsed.outDir;
        if (outRoot === undefined || outRoot === '') {
          streams.stderr.write('fix-resources: --out-dir requires a non-empty path\n');
          return { exitCode: 2 };
        }
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
      filesScanned,
      filesChanged,
      replacements,
      wroteFiles: parsed.mode !== 'dry-run',
      changes: parsed.mode === 'dry-run' ? changes : undefined,
    };
    emitStepProgress(
      invoke,
      `fix-resources: ${filesChanged} file${filesChanged === 1 ? '' : 's'} changed, ${replacements} replacement${replacements === 1 ? '' : 's'}`,
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
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`fix-resources: ${msg}\n`);
    return { exitCode: 2 };
  }
}
