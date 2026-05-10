/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { resolve } from 'node:path';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';
import { readCliPackageVersion } from './packageVersion.ts';

export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function main(
  argv: readonly string[],
  streams: MainStreams = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    streams.stdout.write(usage());
    return 0;
  }

  if (cmd === '--version' || cmd === '-v') {
    streams.stdout.write(`${version()}\n`);
    return 0;
  }

  if (cmd === 'index') {
    const parsed = parseVaultRootForIndex(rest);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runIndex(parsed.path, streams);
  }

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}

function parseVaultRootForIndex(
  args: readonly string[],
): { ok: true; path: string } | { ok: false; message: string } {
  const defaultData = resolve(process.cwd(), 'data');
  let explicit: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return { ok: false, message: 'error: --vault requires a path (e.g. --vault ./data)' };
      }
      explicit = resolve(process.cwd(), v);
      i++;
    } else if (a?.startsWith('--vault=')) {
      const tail = a.slice('--vault='.length);
      if (tail === '') {
        return { ok: false, message: 'error: --vault= requires a non-empty path' };
      }
      explicit = resolve(process.cwd(), tail);
    }
  }
  return { ok: true, path: explicit ?? defaultData };
}

async function runIndex(vaultRoot: string, streams: MainStreams): Promise<number> {
  try {
    const result = await buildVaultIndex(vaultRoot);
    if (!result.ok) {
      streams.stderr.write(
        `${JSON.stringify({ ok: false, collisions: result.collisions }, null, 2)}\n`,
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

function usage(): string {
  return [
    'evernote-obsidian — Evernote → Obsidian link repair',
    '',
    'Usage:',
    '  evernote-obsidian [--help|--version]',
    '  evernote-obsidian index [--vault <path>]',
    '',
    'Commands:',
    '  index   Build a read-only vault index (normalized titles must be unique).',
    '',
    'Options:',
    '  --vault   Vault root directory (default: ./data relative to cwd)',
    '',
  ].join('\n');
}

function version(): string {
  return readCliPackageVersion();
}
