/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { resolve } from 'node:path';
import { buildVaultIndex, VaultIndexRootError } from '../vault/vaultIndex.ts';

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
    return runIndex(resolveVaultRoot(rest), streams);
  }

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}

function resolveVaultRoot(args: readonly string[]): string {
  const defaultData = resolve(process.cwd(), 'data');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return defaultData;
      }
      return resolve(process.cwd(), v);
    }
    if (a?.startsWith('--vault=')) {
      return resolve(process.cwd(), a.slice('--vault='.length));
    }
  }
  return defaultData;
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
    throw e;
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
  return '0.0.0';
}
