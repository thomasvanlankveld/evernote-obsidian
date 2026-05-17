/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */

export type { MainOptions, MainStreams } from './cliTypes.ts';

import type { MainOptions, MainStreams } from './cliTypes.ts';
import { parseCorrelateArgs, runCorrelate } from './correlateCommand.ts';
import { parseIndexArgs, runIndex } from './indexCommand.ts';
import { parseLinksArgs, runLinks } from './linksCommand.ts';
import { parseRewriteArgs, runRewrite } from './rewriteCommand.ts';
import { parseRunArgs, runRun } from './runCommand.ts';
import { parseSnapshotArgs, runSnapshot } from './snapshotCommand.ts';
import { parseUnescapeLinksArgs, runUnescapeLinks } from './unescapeLinksCommand.ts';
import { cliVersion, usage } from './usage.ts';

export async function main(
  argv: readonly string[],
  streams: MainStreams = { stdout: process.stdout, stderr: process.stderr },
  options?: MainOptions,
): Promise<number> {
  const cwd = options?.cwd ?? process.cwd();
  const [cmd, ...rest] = argv;

  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    streams.stdout.write(usage());
    return 0;
  }

  if (cmd === '--version' || cmd === '-v') {
    streams.stdout.write(`${cliVersion()}\n`);
    return 0;
  }

  if (cmd === 'index') {
    const parsed = parseIndexArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runIndex(parsed.path, streams);
  }

  if (cmd === 'snapshot') {
    const parsed = parseSnapshotArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runSnapshot(parsed.snapshot, streams);
  }

  if (cmd === 'links') {
    const parsed = parseLinksArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runLinks(parsed.links, streams);
  }

  if (cmd === 'correlate') {
    const parsed = parseCorrelateArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runCorrelate(parsed.correlate, streams);
  }

  if (cmd === 'rewrite') {
    const parsed = parseRewriteArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runRewrite(parsed.rewrite, streams);
  }

  if (cmd === 'unescape-links') {
    const parsed = parseUnescapeLinksArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runUnescapeLinks(parsed.unescape, streams);
  }

  if (cmd === 'run') {
    const parsed = parseRunArgs(rest, cwd);
    if (!parsed.ok) {
      streams.stderr.write(`${parsed.message}\n\n${usage()}`);
      return 2;
    }
    return runRun(parsed.run, streams);
  }

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}
