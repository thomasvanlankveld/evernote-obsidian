import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CorrelateResult,
  DuplicateTargetPath,
  EvernoteTitleCollision,
  GuidTitleMismatch,
  InvalidOverride,
  UnmatchedNote,
} from '../correlation/correlate.ts';
import type { VaultIndexCollision, VaultIndexGuidCollision } from '../vault/vaultIndex.ts';

export type CorrelationFailureReason = 'correlation_failed' | 'vault_index_collisions';

export interface CorrelationFailureCounts {
  unmatched: number;
  evernoteTitleCollisions: number;
  invalidOverrides: number;
  duplicateTargetPaths: number;
  guidTitleMismatches: number;
  vaultTitleCollisions: number;
  vaultGuidCollisions: number;
}

export interface CorrelationVaultContext {
  vaultMarkdownCount: number;
  vaultWithGuidCount: number;
}

export interface CorrelationFailureReport {
  ok: false;
  reason: CorrelationFailureReason;
  evernoteTitleCollisions?: EvernoteTitleCollision[] | undefined;
  unmatched?: UnmatchedNote[] | undefined;
  invalidOverrides?: InvalidOverride[] | undefined;
  duplicateTargetPaths?: DuplicateTargetPath[] | undefined;
  guidTitleMismatches?: GuidTitleMismatch[] | undefined;
  collisions?: VaultIndexCollision[] | undefined;
  guidCollisions?: VaultIndexGuidCollision[] | undefined;
}

export interface CorrelationFailureSummary {
  ok: false;
  reason: CorrelationFailureReason;
  reportPath: string;
  snapshotNotes: number;
  matchedCount?: number | undefined;
  counts: CorrelationFailureCounts;
  vault?: CorrelationVaultContext | undefined;
}

export function correlationFailureFromCorrelateResult(
  result: Extract<CorrelateResult, { ok: false }>,
): CorrelationFailureReport {
  return {
    ok: false,
    reason: 'correlation_failed',
    evernoteTitleCollisions: result.evernoteTitleCollisions,
    unmatched: result.unmatched,
    invalidOverrides: result.invalidOverrides,
    duplicateTargetPaths: result.duplicateTargetPaths,
    guidTitleMismatches: result.guidTitleMismatches,
  };
}

export function correlationFailureFromVaultIndex(
  collisions: VaultIndexCollision[],
  guidCollisions: VaultIndexGuidCollision[],
): CorrelationFailureReport {
  return {
    ok: false,
    reason: 'vault_index_collisions',
    collisions,
    guidCollisions,
  };
}

export function correlationFailureCounts(
  report: CorrelationFailureReport,
): CorrelationFailureCounts {
  return {
    unmatched: report.unmatched?.length ?? 0,
    evernoteTitleCollisions: report.evernoteTitleCollisions?.length ?? 0,
    invalidOverrides: report.invalidOverrides?.length ?? 0,
    duplicateTargetPaths: report.duplicateTargetPaths?.length ?? 0,
    guidTitleMismatches: report.guidTitleMismatches?.length ?? 0,
    vaultTitleCollisions: report.collisions?.length ?? 0,
    vaultGuidCollisions: report.guidCollisions?.length ?? 0,
  };
}

export function buildCorrelationFailureSummary(
  report: CorrelationFailureReport,
  reportPath: string,
  snapshotNotes: number,
  options?: {
    matchedCount?: number | undefined;
    vault?: CorrelationVaultContext | undefined;
  },
): CorrelationFailureSummary {
  return {
    ok: false,
    reason: report.reason,
    reportPath,
    snapshotNotes,
    matchedCount: options?.matchedCount,
    counts: correlationFailureCounts(report),
    vault: options?.vault,
  };
}

function formatEvernoteNoteCount(n: number): string {
  return `${n} Evernote note${n === 1 ? '' : 's'}`;
}

function formatCorrelateFailureDetail(summary: CorrelationFailureSummary): string {
  const { counts, snapshotNotes, matchedCount, reason } = summary;
  if (reason === 'vault_index_collisions') {
    const parts: string[] = [];
    if (counts.vaultTitleCollisions > 0) {
      parts.push(`${counts.vaultTitleCollisions} vault title collision(s)`);
    }
    if (counts.vaultGuidCollisions > 0) {
      parts.push(`${counts.vaultGuidCollisions} vault evernote-guid collision(s)`);
    }
    return parts.length > 0 ? parts.join(', ') : 'vault index collisions';
  }

  const parts: string[] = [];
  if (matchedCount !== undefined) {
    parts.push(`${matchedCount} matched`);
  }
  if (counts.unmatched > 0) {
    parts.push(`${counts.unmatched} unmatched`);
  }
  if (counts.evernoteTitleCollisions > 0) {
    parts.push(`${counts.evernoteTitleCollisions} Evernote title collision(s)`);
  }
  if (counts.guidTitleMismatches > 0) {
    parts.push(`${counts.guidTitleMismatches} GUID/title mismatch(es)`);
  }
  if (counts.duplicateTargetPaths > 0) {
    parts.push(`${counts.duplicateTargetPaths} duplicate target path(s)`);
  }
  if (counts.invalidOverrides > 0) {
    parts.push(`${counts.invalidOverrides} invalid override(s)`);
  }
  const breakdown = parts.length > 0 ? parts.join(', ') : 'correlation failed';
  if (snapshotNotes > 0) {
    return `${formatEvernoteNoteCount(snapshotNotes)} → vault: ${breakdown}`;
  }
  return breakdown;
}

export function formatCorrelationFailureHint(summary: CorrelationFailureSummary): string {
  const { reportPath } = summary;
  const detail = formatCorrelateFailureDetail(summary);
  return `correlate: ${detail} — see ${reportPath}\n`;
}

/** Detail line for `run` human summary (no command prefix or report path). */
export function formatCorrelateRunDetail(summary: CorrelationFailureSummary): string {
  return formatCorrelateFailureDetail(summary);
}

/** @deprecated Use {@link formatCorrelateRunDetail}. */
export function correlationHintForRun(hintLine: string): string {
  const trimmed = hintLine.replace(/^correlate:\s*/, '').trim();
  const seeIdx = trimmed.indexOf(' — see ');
  if (seeIdx >= 0) {
    return trimmed.slice(0, seeIdx);
  }
  return trimmed;
}

function shouldSuggestGuidBackfill(summary: CorrelationFailureSummary): boolean {
  const { counts, vault } = summary;
  if (counts.unmatched <= 0 || vault === undefined) {
    return false;
  }
  if (vault.vaultMarkdownCount === 0) {
    return false;
  }
  return vault.vaultWithGuidCount < vault.vaultMarkdownCount * 0.5;
}

export function formatCorrelationFailureNextSteps(
  summary: CorrelationFailureSummary,
  report: CorrelationFailureReport,
  options: { snapshotPath?: string | undefined; vaultDir?: string | undefined },
): string {
  const lines: string[] = ['', 'What failed:'];
  const { counts, reportPath, reason } = summary;

  if (reason === 'vault_index_collisions') {
    if (counts.vaultTitleCollisions > 0) {
      lines.push(
        `  • vault title collisions (${counts.vaultTitleCollisions}): duplicate normalized titles — see report "collisions"`,
      );
    }
    if (counts.vaultGuidCollisions > 0) {
      lines.push(
        `  • vault evernote-guid collisions (${counts.vaultGuidCollisions}): same GUID on multiple files — see report "guidCollisions"`,
      );
    }
    lines.push('', 'Next steps:');
    lines.push('  • Resolve duplicate titles or GUIDs in the vault before correlating.');
    lines.push(`  • Open ${reportPath} for conflicting paths.`);
    return `${lines.join('\n')}\n`;
  }

  if (counts.unmatched > 0) {
    lines.push(
      `  • unmatched (${counts.unmatched}): Evernote notes with no vault file — see report "unmatched"`,
    );
  }
  if (counts.evernoteTitleCollisions > 0) {
    lines.push(
      `  • evernoteTitleCollisions (${counts.evernoteTitleCollisions}): duplicate titles in the snapshot — see report "evernoteTitleCollisions"`,
    );
  }
  if (counts.guidTitleMismatches > 0) {
    lines.push(
      `  • guidTitleMismatches (${counts.guidTitleMismatches}): GUID vs title path conflict — see report "guidTitleMismatches"`,
    );
  }
  if (counts.duplicateTargetPaths > 0) {
    lines.push(
      `  • duplicateTargetPaths (${counts.duplicateTargetPaths}): multiple GUIDs mapped to one path — see report "duplicateTargetPaths"`,
    );
  }
  if (counts.invalidOverrides > 0) {
    lines.push(
      `  • invalidOverrides (${counts.invalidOverrides}): bad --overrides entries — see report "invalidOverrides"`,
    );
  }

  lines.push('', 'Next steps:');
  lines.push('  • Confirm --vault-dir points at your imported Markdown (not the Evernote DB).');
  lines.push(`  • Open ${reportPath} for note titles, GUIDs, and paths.`);

  if (counts.guidTitleMismatches > 0) {
    lines.push(
      '  • For GUID/title conflicts, inspect guidTitleMismatches in the report; use --overrides. guid-backfill will not overwrite existing evernote-guid values.',
    );
  }

  if (shouldSuggestGuidBackfill(summary)) {
    const snap = options.snapshotPath ?? '<snapshot>';
    const vault = options.vaultDir ?? '<vault-dir>';
    lines.push(
      '  • Many vault files lack evernote-guid frontmatter; title-only matching is fragile. Try:',
    );
    lines.push(`      evernote-obsidian guid-backfill --snapshot ${snap} --vault-dir ${vault}`);
    lines.push(
      `      evernote-obsidian guid-backfill --snapshot ${snap} --vault-dir ${vault} --in-place`,
    );
    lines.push('    Then re-run correlate or run.');
  } else if (counts.unmatched > 0) {
    lines.push(
      '  • Unmatched notes may be missing from the vault import or need manual --overrides (backfill only helps when files exist but lack evernote-guid).',
    );
  }

  if (report.invalidOverrides !== undefined && report.invalidOverrides.length > 0) {
    lines.push('  • Fix --overrides paths so each GUID points at an indexed vault file.');
  }

  return `${lines.join('\n')}\n`;
}

export function formatVaultCorrelateContext(
  vaultRootDisplay: string,
  vault: CorrelationVaultContext,
  snapshotNotes: number,
): string {
  const lines = [
    `Vault: ${vault.vaultMarkdownCount} markdown file${vault.vaultMarkdownCount === 1 ? '' : 's'} indexed under ${vaultRootDisplay}`,
    `Evernote: ${snapshotNotes} note${snapshotNotes === 1 ? '' : 's'} in snapshot`,
  ];
  if (vault.vaultMarkdownCount > 0) {
    lines.push(
      `${vault.vaultWithGuidCount} vault file${vault.vaultWithGuidCount === 1 ? '' : 's'} have evernote-guid frontmatter`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function writeCorrelationFailureReport(
  reportPath: string,
  report: CorrelationFailureReport,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export interface CorrelateFailureOutputOptions {
  reportPath: string;
  reportPathDisplay: string;
  snapshotNotes: number;
  matchedCount?: number | undefined;
  vault?: CorrelationVaultContext | undefined;
  snapshotPath?: string | undefined;
  vaultDir?: string | undefined;
  verbose: boolean;
  /** When true, only write the report file (no stderr hint/JSON). */
  quiet?: boolean | undefined;
  /** TTY / human run: hint and next-steps only (no compact summary JSON on stderr). */
  interactive?: boolean | undefined;
}

export async function emitCorrelateFailure(
  streams: { stderr: { write: (chunk: string) => boolean } },
  report: CorrelationFailureReport,
  options: CorrelateFailureOutputOptions,
): Promise<void> {
  await writeCorrelationFailureReport(options.reportPath, report);
  if (options.quiet === true && !options.verbose) {
    return;
  }
  const summary = buildCorrelationFailureSummary(
    report,
    options.reportPathDisplay,
    options.snapshotNotes,
    {
      matchedCount: options.matchedCount,
      vault: options.vault,
    },
  );
  streams.stderr.write(formatCorrelationFailureHint(summary));
  streams.stderr.write(
    formatCorrelationFailureNextSteps(summary, report, {
      snapshotPath: options.snapshotPath,
      vaultDir: options.vaultDir,
    }),
  );
  const emitCompact = options.interactive !== true && !options.quiet;
  if (emitCompact) {
    streams.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
  if (options.verbose) {
    streams.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
