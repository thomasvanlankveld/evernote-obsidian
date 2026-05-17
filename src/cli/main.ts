/**
 * CLI entrypoint for the Evernote → Obsidian link-repair pipeline.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from '../correlation/correlate.ts';
import {
  buildLinkMapFile,
  LinkMapParseError,
  parseLinkMapJson,
} from '../correlation/linkMapFile.ts';
import { parseCorrelationOverridesJson } from '../correlation/overridesFile.ts';
import { readNoteRecordsFromEvernoteBackupDb } from '../evernote/readEvernoteBackupDb.ts';
import {
  buildSnapshotEnvelope,
  readSnapshotFile,
  writeSnapshotFile,
} from '../evernote/snapshotFile.ts';
import { atomicReplaceFile } from '../fs/atomicReplaceFile.ts';
import { scanVaultForEvernoteLinks } from '../vault/extractEvernoteLinks.ts';
import { rewriteMarkdownWithGuidMap } from '../vault/rewriteEvernoteLinks.ts';
import {
  buildVaultIndex,
  VaultIndexRootError,
  walkVaultMarkdownFiles,
} from '../vault/vaultIndex.ts';
import { applyPathFlag, applyPositiveIntFlag, unknownSubcommandFlagError } from './cliFlags.ts';
import { readCliPackageVersion } from './packageVersion.ts';
import {
  applyVaultDirFlag,
  createVaultDirFlagState,
  resolveVaultRootFromState,
} from './vaultDirFlag.ts';

export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution and defaults (tests). */
  cwd?: string | undefined;
}

const SNAPSHOT_METADATA_HOST = 'evernote-backup';

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
    streams.stdout.write(`${version()}\n`);
    return 0;
  }

  if (cmd === 'index') {
    const parsed = parseVaultRootForIndex(rest, cwd);
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

  streams.stderr.write(`Unknown command: ${cmd}\n\n${usage()}`);
  return 2;
}

function parseVaultRootForIndex(
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

interface SnapshotCliOk {
  dbPath: string;
  outPath: string;
  /** When set, stop after this many notes (ordered by title). */
  maxRecords?: number | undefined;
}

function parseSnapshotArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; snapshot: SnapshotCliOk } | { ok: false; message: string } {
  const defaultOut = resolve(cwd, 'out', 'evernote-notes.json');
  let outPath = defaultOut;
  let dbPath: string | undefined;
  let maxRecords: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) {
      continue;
    }
    const dbApplied = applyPathFlag(a, args, i, cwd, 'db', './en_backup.db');
    if (dbApplied.kind === 'error') {
      return { ok: false, message: dbApplied.message };
    }
    if (dbApplied.kind === 'handled') {
      dbPath = dbApplied.path;
      i = dbApplied.nextIndex;
      continue;
    }
    const outApplied = applyPathFlag(a, args, i, cwd, 'out', './out/evernote-notes.json');
    if (outApplied.kind === 'error') {
      return { ok: false, message: outApplied.message };
    }
    if (outApplied.kind === 'handled') {
      outPath = outApplied.path;
      i = outApplied.nextIndex;
      continue;
    }
    const maxApplied = applyPositiveIntFlag(a, args, i, 'max-notes');
    if (maxApplied.kind === 'error') {
      return { ok: false, message: maxApplied.message };
    }
    if (maxApplied.kind === 'handled') {
      maxRecords = maxApplied.value;
      i = maxApplied.nextIndex;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('snapshot', a) };
  }

  if (dbPath === undefined) {
    return {
      ok: false,
      message:
        'error: snapshot requires --db <path> (evernote-backup SQLite file, e.g. en_backup.db)',
    };
  }

  return { ok: true, snapshot: { dbPath, outPath, maxRecords } };
}

interface LinksCliOk {
  vaultRoot: string;
  skipOtherEvernoteHosts: boolean;
  outPath?: string | undefined;
}

function parseLinksArgs(
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

interface CorrelateCliOk {
  vaultRoot: string;
  snapshotPath: string;
  overridesPath?: string | undefined;
  outPath: string;
}

function parseCorrelateArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; correlate: CorrelateCliOk } | { ok: false; message: string } {
  const defaultOut = resolve(cwd, 'out', 'link-map.json');
  let vaultState = createVaultDirFlagState();
  let snapshotPath: string | undefined;
  let overridesPath: string | undefined;
  let outPath = defaultOut;

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
    const snapshotApplied = applyPathFlag(a, args, i, cwd, 'snapshot', './out/evernote-notes.json');
    if (snapshotApplied.kind === 'error') {
      return { ok: false, message: snapshotApplied.message };
    }
    if (snapshotApplied.kind === 'handled') {
      snapshotPath = snapshotApplied.path;
      i = snapshotApplied.nextIndex;
      continue;
    }
    const overridesApplied = applyPathFlag(
      a,
      args,
      i,
      cwd,
      'overrides',
      './out/correlation-overrides.json',
    );
    if (overridesApplied.kind === 'error') {
      return { ok: false, message: overridesApplied.message };
    }
    if (overridesApplied.kind === 'handled') {
      overridesPath = overridesApplied.path;
      i = overridesApplied.nextIndex;
      continue;
    }
    const outApplied = applyPathFlag(a, args, i, cwd, 'out', './out/link-map.json');
    if (outApplied.kind === 'error') {
      return { ok: false, message: outApplied.message };
    }
    if (outApplied.kind === 'handled') {
      outPath = outApplied.path;
      i = outApplied.nextIndex;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('correlate', a) };
  }

  if (snapshotPath === undefined) {
    return {
      ok: false,
      message:
        'error: correlate requires --snapshot <path> (Evernote JSON snapshot, e.g. ./out/evernote-notes.json)',
    };
  }

  return {
    ok: true,
    correlate: {
      vaultRoot: resolveVaultRootFromState(vaultState, cwd),
      snapshotPath,
      overridesPath,
      outPath,
    },
  };
}

interface RewriteCliOk {
  vaultRoot: string;
  mapPath: string;
  mode: 'dry-run' | 'out-dir' | 'in-place';
  outDir?: string | undefined;
  backup?: boolean | undefined;
}

function parseRewriteArgs(
  args: readonly string[],
  cwd: string,
): { ok: true; rewrite: RewriteCliOk } | { ok: false; message: string } {
  let vaultState = createVaultDirFlagState();
  let mapPath: string | undefined;
  let explicitDryRun = false;
  let outDir: string | undefined;
  let inPlace = false;
  let backup = false;

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
    const mapApplied = applyPathFlag(a, args, i, cwd, 'map', './out/link-map.json');
    if (mapApplied.kind === 'error') {
      return { ok: false, message: mapApplied.message };
    }
    if (mapApplied.kind === 'handled') {
      mapPath = mapApplied.path;
      i = mapApplied.nextIndex;
      continue;
    }
    if (a === '--dry-run') {
      explicitDryRun = true;
      continue;
    }
    const outDirApplied = applyPathFlag(a, args, i, cwd, 'out-dir', './out/rewritten-vault');
    if (outDirApplied.kind === 'error') {
      return { ok: false, message: outDirApplied.message };
    }
    if (outDirApplied.kind === 'handled') {
      outDir = outDirApplied.path;
      i = outDirApplied.nextIndex;
      continue;
    }
    if (a === '--in-place') {
      inPlace = true;
      continue;
    }
    if (a === '--backup') {
      backup = true;
      continue;
    }
    return { ok: false, message: unknownSubcommandFlagError('rewrite', a) };
  }

  if (mapPath === undefined) {
    return {
      ok: false,
      message:
        'error: rewrite requires --map <path> (link map JSON from correlate, e.g. ./out/link-map.json)',
    };
  }

  if (inPlace && outDir !== undefined) {
    return { ok: false, message: 'error: use only one of --in-place or --out-dir' };
  }

  if (explicitDryRun && (inPlace || outDir !== undefined)) {
    return {
      ok: false,
      message: 'error: --dry-run cannot be combined with --in-place or --out-dir',
    };
  }

  if (backup && !inPlace) {
    return { ok: false, message: 'error: --backup is only valid with --in-place' };
  }

  let mode: RewriteCliOk['mode'];
  if (inPlace) {
    mode = 'in-place';
  } else if (outDir !== undefined) {
    mode = 'out-dir';
  } else {
    mode = 'dry-run';
  }

  return {
    ok: true,
    rewrite: {
      vaultRoot: resolveVaultRootFromState(vaultState, cwd),
      mapPath,
      mode,
      outDir: mode === 'out-dir' ? outDir : undefined,
      backup: backup ? true : undefined,
    },
  };
}

async function runCorrelate(parsed: CorrelateCliOk, streams: MainStreams): Promise<number> {
  try {
    const index = await buildVaultIndex(parsed.vaultRoot);
    if (!index.ok) {
      streams.stderr.write(
        `${JSON.stringify({ ok: false, reason: 'vault_index_collisions', collisions: index.collisions }, null, 2)}\n`,
      );
      return 1;
    }

    const snapshot = await readSnapshotFile(parsed.snapshotPath);
    let overrides = new Map<string, string>();
    if (parsed.overridesPath !== undefined) {
      const raw = await readFile(parsed.overridesPath, 'utf8');
      overrides = parseCorrelationOverridesJson(raw);
    }

    const vaultInput = vaultIndexResultToCorrelationInput(
      index.byNormalizedTitle,
      index.entries.map((e) => e.path),
    );
    const result = correlateSnapshotToGuidPaths(snapshot.notes, vaultInput, overrides);
    if (!result.ok) {
      streams.stderr.write(
        `${JSON.stringify(
          {
            ok: false,
            reason: 'correlation_failed',
            evernoteTitleCollisions: result.evernoteTitleCollisions,
            unmatched: result.unmatched,
            invalidOverrides: result.invalidOverrides,
            duplicateTargetPaths: result.duplicateTargetPaths,
          },
          null,
          2,
        )}\n`,
      );
      return 1;
    }

    const linkMap = buildLinkMapFile(
      parsed.vaultRoot,
      parsed.snapshotPath,
      result.guidToPath,
      parsed.overridesPath,
    );
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeFile(parsed.outPath, `${JSON.stringify(linkMap, null, 2)}\n`, 'utf8');

    const summary = {
      ok: true as const,
      path: parsed.outPath,
      vault: parsed.vaultRoot,
      snapshot: parsed.snapshotPath,
      count: result.guidToPath.size,
    };
    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof VaultIndexRootError) {
      streams.stderr.write(`${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`correlate: ${msg}\n`);
    return 2;
  }
}

async function runRewrite(parsed: RewriteCliOk, streams: MainStreams): Promise<number> {
  try {
    const rawMap = await readFile(parsed.mapPath, 'utf8');
    const linkMap = parseLinkMapJson(rawMap);
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
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`rewrite: ${msg}\n`);
    return 2;
  }
}

async function runLinks(parsed: LinksCliOk, streams: MainStreams): Promise<number> {
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

async function runSnapshot(parsed: SnapshotCliOk, streams: MainStreams): Promise<number> {
  try {
    const readOpts =
      parsed.maxRecords !== undefined ? { maxRecords: parsed.maxRecords } : undefined;
    const { records, sourceRowCount } = readNoteRecordsFromEvernoteBackupDb(
      parsed.dbPath,
      readOpts,
    );

    const envelope = buildSnapshotEnvelope(SNAPSHOT_METADATA_HOST, records);
    await mkdir(dirname(parsed.outPath), { recursive: true });
    await writeSnapshotFile(parsed.outPath, envelope);

    const summary: Record<string, unknown> = {
      ok: true,
      path: parsed.outPath,
      db: parsed.dbPath,
      count: records.length,
      host: SNAPSHOT_METADATA_HOST,
      sourceRowCount,
    };
    if (parsed.maxRecords !== undefined && records.length < sourceRowCount) {
      summary.truncated = true;
    }

    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    streams.stderr.write(`snapshot: ${msg}\n`);
    streams.stderr.write(
      'snapshot: hint: pass --db to your evernote-backup database (see https://github.com/vzhd1701/evernote-backup).\n',
    );
    return 2;
  }
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
    '  evernote-obsidian index [--vault-dir <path>]',
    '  evernote-obsidian snapshot --db <path> [--out <path>] [--max-notes <n>]',
    '  evernote-obsidian links [--vault-dir <path>] [--out <path>] [--skip-other-evernote-hosts]',
    '  evernote-obsidian correlate --snapshot <path> [--vault-dir <path>] [--overrides <path>] [--out <path>]',
    '  evernote-obsidian rewrite --map <path> [--vault-dir <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]',
    '',
    'Commands:',
    '  index      Build a read-only vault index (normalized titles must be unique).',
    '  snapshot   Read metadata from an evernote-backup SQLite DB and write the JSON snapshot.',
    '  links      Scan Markdown for Evernote note URLs and other evernote.com links (report only).',
    '  correlate  Join snapshot GUIDs to vault paths by normalized title; optional overrides JSON.',
    '  rewrite    Replace Evernote note URLs with Obsidian wikilinks using link-map.json from correlate.',
    '',
    'Options:',
    '  --vault-dir                    Root directory of Markdown to scan (importer output, a subfolder, or full Obsidian vault; default: ./data)',
    '  --vault                        Alias for --vault-dir',
    '  --map                          Path to link map JSON (required for rewrite)',
    '  --dry-run                      Rewrite preview only (default when neither --out-dir nor --in-place)',
    '  --out-dir                      Write changed Markdown files under this directory (mirrors vault paths)',
    '  --in-place                     Overwrite Markdown in the vault (use with care)',
    '  --backup                       With --in-place, write <file>.evernote-obsidian.bak before overwriting',
    '  --snapshot                     Path to Evernote snapshot JSON (required for correlate)',
    '  --overrides                    Optional JSON file: { "version": 1, "byGuid": { "<guid>": "<path>" } }',
    '  --skip-other-evernote-hosts    Omit non-shard *.evernote.com URLs from the links report',
    '  --db                           Path to evernote-backup SQLite database (required for snapshot)',
    '  --out                          Output path (snapshot default: ./out/evernote-notes.json; correlate: ./out/link-map.json; links: stdout unless set)',
    '  --max-notes                    Stop after N notes (optional cap; notes ordered by title)',
    '',
    '  evernote-backup: https://github.com/vzhd1701/evernote-backup',
    '',
  ].join('\n');
}

function version(): string {
  return readCliPackageVersion();
}
