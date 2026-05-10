/**
 * Minimal CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 * Phase 1 ships only the scaffold: argument parsing and subcommand routing
 * arrive in later phases.
 */
export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function main(
  argv: readonly string[],
  streams: MainStreams = { stdout: process.stdout, stderr: process.stderr },
): number {
  const [cmd] = argv;

  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    streams.stdout.write(usage());
    return 0;
  }

  if (cmd === '--version' || cmd === '-v') {
    streams.stdout.write(`${version()}\n`);
    return 0;
  }

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}

function usage(): string {
  return [
    'evernote-obsidian — Evernote → Obsidian link repair',
    '',
    'Usage:',
    '  evernote-obsidian [--help|--version]',
    '',
    'Commands land in later phases (vault index, metadata, extract, correlate, rewrite).',
    '',
  ].join('\n');
}

function version(): string {
  return '0.0.0';
}
