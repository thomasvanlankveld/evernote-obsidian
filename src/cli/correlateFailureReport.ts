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
  counts: CorrelationFailureCounts;
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
): CorrelationFailureSummary {
  return {
    ok: false,
    reason: report.reason,
    reportPath,
    snapshotNotes,
    counts: correlationFailureCounts(report),
  };
}

export function formatCorrelationFailureHint(summary: CorrelationFailureSummary): string {
  const { counts, snapshotNotes, reportPath, reason } = summary;
  if (reason === 'vault_index_collisions') {
    const parts: string[] = [];
    if (counts.vaultTitleCollisions > 0) {
      parts.push(`${counts.vaultTitleCollisions} vault title collision(s)`);
    }
    if (counts.vaultGuidCollisions > 0) {
      parts.push(`${counts.vaultGuidCollisions} vault evernote-guid collision(s)`);
    }
    const detail = parts.length > 0 ? parts.join(', ') : 'vault index collisions';
    return `correlate: ${detail} — see ${reportPath}\n`;
  }

  const parts: string[] = [];
  if (snapshotNotes > 0) {
    parts.push(`${snapshotNotes} snapshot note${snapshotNotes === 1 ? '' : 's'}`);
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
  const detail = parts.length > 0 ? parts.join(', ') : 'correlation failed';
  return `correlate: ${detail} — see ${reportPath}\n`;
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
  verbose: boolean;
}

export async function emitCorrelateFailure(
  streams: { stderr: { write: (chunk: string) => boolean } },
  report: CorrelationFailureReport,
  options: CorrelateFailureOutputOptions,
): Promise<void> {
  await writeCorrelationFailureReport(options.reportPath, report);
  const summary = buildCorrelationFailureSummary(
    report,
    options.reportPathDisplay,
    options.snapshotNotes,
  );
  streams.stderr.write(formatCorrelationFailureHint(summary));
  streams.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (options.verbose) {
    streams.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
