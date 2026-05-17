import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import { readVaultMarkdownFile } from '../vault/readVaultMarkdownFile.ts';
import { unescapeMarkdownLinksInContent } from '../vault/unescapeMarkdownLinks.ts';
import { VaultIndexRootError, walkVaultMarkdownFiles } from '../vault/vaultIndex.ts';
import {
  type ArgHandler,
  rewriteOutputModeArgHandlers,
  scanArgv,
  vaultDirArgHandler,
} from './argvScan.ts';
import { createRewriteOutputScanState, finalizeRewriteOutputMode } from './cliFlags.ts';
import type { MainStreams } from './cliTypes.ts';
import { resolveVaultRootFromState } from './vaultDirFlag.ts';

const MAX_DRY_RUN_SAMPLES = 25;

export interface UnescapeLinksCliOk {
  vaultRoot: string;
  mode: 'dry-run' | 'out-dir' | 'in-place';
  outDir?: string | undefined;
  backup?: boolean | undefined;
  onlyPrefixes: string[];
}

function normalizeOnlyPrefix(raw: string): string {
  return raw.trim().split('\\').join('/').replace(/^\.\//, '');
}

function onlyPrefixArgHandler(prefixes: string[]): ArgHandler {
  return (arg, args, index) => {
    const spaced = '--only';
    const eqPrefix = `${spaced}=`;
    if (arg === spaced) {
      const v = args[index + 1];
      if (v === undefined || v.startsWith('-')) {
        return {
          kind: 'error',
          message: 'error: --only requires a vault-relative path (e.g. --only Campaign/Notes)',
        };
      }
      prefixes.push(normalizeOnlyPrefix(v));
      return { kind: 'handled', nextIndex: index + 1 };
    }
    if (arg.startsWith(eqPrefix)) {
      const tail = arg.slice(eqPrefix.length);
      if (tail === '') {
        return { kind: 'error', message: 'error: --only= requires a non-empty path' };
      }
      prefixes.push(normalizeOnlyPrefix(tail));
      return { kind: 'handled', nextIndex: index };
    }
    return { kind: 'not-matched' };
  };
}

function pathMatchesOnly(relPosix: string, onlyPrefixes: readonly string[]): boolean {
  if (onlyPrefixes.length === 0) {
    return true;
  }
  for (const prefix of onlyPrefixes) {
    const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
    if (relPosix === prefix || relPosix.startsWith(p)) {
      return true;
    }
  }
  return false;
}

function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
    }
  }
  return line;
}

function lineSnippet(content: string, line: number): string {
  const lines = content.split(/\r?\n/);
  return lines[line - 1] ?? '';
}

export function parseUnescapeLinksArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; unescape: UnescapeLinksCliOk } | { ok: false; message: string } {
  const rewriteOutput = createRewriteOutputScanState();
  const onlyPrefixes: string[] = [];

  const scanned = scanArgv(args, cwd, {
    subcommand: 'unescape-links',
    handlers: [
      vaultDirArgHandler(),
      ...rewriteOutputModeArgHandlers(rewriteOutput),
      onlyPrefixArgHandler(onlyPrefixes),
    ],
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
    unescape: {
      vaultRoot: resolveVaultRootFromState(scanned.vaultState, cwd),
      mode: modeParsed.mode,
      outDir: modeParsed.outDir,
      backup: modeParsed.backup,
      onlyPrefixes,
    },
  };
}

export async function runUnescapeLinks(
  parsed: UnescapeLinksCliOk,
  streams: MainStreams,
): Promise<number> {
  try {
    const files = await walkVaultMarkdownFiles(parsed.vaultRoot);
    let filesScanned = 0;
    let filesChanged = 0;
    let replacements = 0;
    const samples: {
      file: string;
      line: number;
      before: string;
      after: string;
    }[] = [];

    for (const abs of files) {
      const rel = relative(parsed.vaultRoot, abs).split('\\').join('/');
      if (!pathMatchesOnly(rel, parsed.onlyPrefixes)) {
        continue;
      }
      filesScanned++;
      const content = await readVaultMarkdownFile(abs, parsed.vaultRoot);
      const result = unescapeMarkdownLinksInContent(content);
      if (result.content === content) {
        continue;
      }
      filesChanged++;
      replacements += result.replacements;

      if (parsed.mode === 'dry-run') {
        for (const ch of result.changes) {
          if (samples.length >= MAX_DRY_RUN_SAMPLES) {
            break;
          }
          const line = offsetToLine(content, ch.start);
          samples.push({
            file: rel,
            line,
            before: lineSnippet(content, line),
            after: lineSnippet(result.content, line),
          });
        }
        continue;
      }

      if (parsed.mode === 'out-dir') {
        const outRoot = parsed.outDir;
        if (outRoot === undefined || outRoot === '') {
          streams.stderr.write('unescape-links: --out-dir requires a non-empty path\n');
          return 2;
        }
        const dest = join(outRoot, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, result.content, 'utf8');
        continue;
      }

      if (parsed.backup === true) {
        const bak = `${abs}.evernote-obsidian.bak`;
        await writeFile(bak, content, 'utf8');
      }
      await atomicReplaceFile(abs, result.content);
    }

    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: parsed.mode,
          vault: parsed.vaultRoot,
          only: parsed.onlyPrefixes.length > 0 ? parsed.onlyPrefixes : undefined,
          filesScanned,
          filesChanged,
          replacements,
          wroteFiles: parsed.mode !== 'dry-run',
          ...(parsed.mode === 'dry-run' && samples.length > 0 ? { samples } : {}),
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
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`unescape-links: ${msg}\n`);
    return 2;
  }
}
