import { extname } from 'node:path';
import { sanitizeObsidianImporterFileName } from '../vault/vaultIndex.ts';
import {
  type CorrelationFailureReason,
  type CorrelationFailureReport,
  type CorrelationFailureSummary,
  shouldSuggestGuidBackfill,
} from './correlateFailureReport.ts';

export function correlationReportMarkdownPath(jsonReportPath: string): string {
  const ext = extname(jsonReportPath);
  if (ext.toLowerCase() === '.json') {
    return `${jsonReportPath.slice(0, -ext.length)}.md`;
  }
  return `${jsonReportPath}.md`;
}

/** Importer filename stem before correlate normalization (NFC; not lowercased). */
export function suggestedVaultFileStem(evernoteTitle: string): string {
  const sanitized = sanitizeObsidianImporterFileName(evernoteTitle.trim());
  if (sanitized === '') {
    return '';
  }
  return sanitized.normalize('NFC');
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatMarkdownTable(headers: readonly string[], rows: readonly string[][]): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`).join('\n');
  return `${headerRow}\n${separator}\n${body}`;
}

function summaryMeaning(reason: CorrelationFailureReason): string {
  if (reason === 'vault_index_collisions') {
    return 'The vault has duplicate normalized titles or duplicate `evernote-guid:` values; correlation cannot run until those are fixed.';
  }
  return 'One or more Evernote notes could not be matched to a unique vault file (or overrides/GUID rules failed). No link map was written.';
}

function formatSummarySection(summary: CorrelationFailureSummary): string {
  const { counts, reason, snapshotNotes, matchedCount } = summary;
  const lines = [
    '## Summary',
    '',
    summaryMeaning(reason),
    '',
    '| Metric | Count |',
    '| --- | ---: |',
  ];
  if (reason === 'correlation_failed' && matchedCount !== undefined) {
    lines.push(`| Matched before failure | ${matchedCount} |`);
  }
  if (snapshotNotes > 0) {
    lines.push(`| Evernote notes in snapshot | ${snapshotNotes} |`);
  }
  const countRows: [string, number][] = [
    ['Unmatched', counts.unmatched],
    ['Evernote title collisions', counts.evernoteTitleCollisions],
    ['GUID/title mismatches', counts.guidTitleMismatches],
    ['Duplicate target paths', counts.duplicateTargetPaths],
    ['Invalid overrides', counts.invalidOverrides],
    ['Truncated-prefix collisions', counts.truncatedPrefixCollisions],
    ['Vault title collisions', counts.vaultTitleCollisions],
    ['Vault evernote-guid collisions', counts.vaultGuidCollisions],
  ];
  for (const [label, n] of countRows) {
    if (n > 0) {
      lines.push(`| ${label} | ${n} |`);
    }
  }
  return lines.join('\n');
}

function formatUnmatchedSection(report: CorrelationFailureReport): string | undefined {
  const rows = report.unmatched;
  if (rows === undefined || rows.length === 0) {
    return undefined;
  }
  const table = formatMarkdownTable(
    ['Evernote title', 'GUID', 'normalizedTitle', 'Suggested vault stem'],
    rows.map((u) => [u.title, u.guid, u.normalizedTitle, suggestedVaultFileStem(u.title) || '—']),
  );
  return ['## Unmatched', '', 'Evernote notes with no matching vault file.', '', table].join('\n');
}

function formatEvernoteTitleCollisionsSection(
  report: CorrelationFailureReport,
): string | undefined {
  const collisions = report.evernoteTitleCollisions;
  if (collisions === undefined || collisions.length === 0) {
    return undefined;
  }
  const lines = [
    '## Evernote title collisions',
    '',
    'Multiple snapshot notes share the same normalized title. Add `correlation-overrides.json` entries or rename notes in Evernote.',
    '',
  ];
  const first = collisions[0];
  for (const c of collisions) {
    lines.push(`### \`${c.normalizedTitle}\``, '');
    for (const guid of c.guids) {
      lines.push(`- \`${guid}\``);
    }
    lines.push('');
  }
  if (first !== undefined && first.guids[0] !== undefined) {
    lines.push(
      'Example override (first collision):',
      '',
      '```json',
      JSON.stringify(
        {
          version: 1,
          byGuid: { [first.guids[0]]: 'path/relative/to/vault.md' },
        },
        null,
        2,
      ),
      '```',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

function formatGuidTitleMismatchesSection(report: CorrelationFailureReport): string | undefined {
  const rows = report.guidTitleMismatches;
  if (rows === undefined || rows.length === 0) {
    return undefined;
  }
  const table = formatMarkdownTable(
    ['GUID', 'Title', 'Reason', 'GUID path', 'Title path', 'Vault GUID'],
    rows.map((m) => [
      m.guid,
      m.title,
      m.reason,
      m.guidPath ?? '',
      m.titlePath ?? '',
      m.vaultGuid ?? '',
    ]),
  );
  return ['## GUID/title mismatches', '', table].join('\n');
}

function formatDuplicateTargetPathsSection(report: CorrelationFailureReport): string | undefined {
  const rows = report.duplicateTargetPaths;
  if (rows === undefined || rows.length === 0) {
    return undefined;
  }
  const table = formatMarkdownTable(
    ['Vault path', 'GUIDs'],
    rows.map((d) => [d.path, d.guids.join(', ')]),
  );
  return ['## Duplicate target paths', '', table].join('\n');
}

function formatInvalidOverridesSection(report: CorrelationFailureReport): string | undefined {
  const rows = report.invalidOverrides;
  if (rows === undefined || rows.length === 0) {
    return undefined;
  }
  const table = formatMarkdownTable(
    ['GUID', 'Path', 'Reason'],
    rows.map((o) => [o.guid, o.path, o.reason]),
  );
  return ['## Invalid overrides', '', table].join('\n');
}

function formatTruncatedPrefixCollisionsSection(
  report: CorrelationFailureReport,
): string | undefined {
  const rows = report.truncatedPrefixCollisions;
  if (rows === undefined || rows.length === 0) {
    return undefined;
  }
  const table = formatMarkdownTable(
    ['GUID', 'Title', 'normalizedTitle', 'Candidate stems', 'Candidate paths'],
    rows.map((t) => [
      t.guid,
      t.title,
      t.normalizedTitle,
      t.candidateStems.join(', '),
      t.candidatePaths.join(', '),
    ]),
  );
  return ['## Truncated-prefix collisions', '', table].join('\n');
}

function formatVaultIndexCollisionsSection(report: CorrelationFailureReport): string | undefined {
  const titleCollisions = report.collisions;
  const guidCollisions = report.guidCollisions;
  if (
    (titleCollisions === undefined || titleCollisions.length === 0) &&
    (guidCollisions === undefined || guidCollisions.length === 0)
  ) {
    return undefined;
  }
  const parts: string[] = ['## Vault index collisions', ''];
  if (titleCollisions !== undefined && titleCollisions.length > 0) {
    parts.push(
      '### Duplicate normalized titles',
      '',
      formatMarkdownTable(
        ['normalizedTitle', 'Paths'],
        titleCollisions.map((c) => [c.normalizedTitle, c.paths.join(', ')]),
      ),
      '',
    );
  }
  if (guidCollisions !== undefined && guidCollisions.length > 0) {
    parts.push(
      '### Duplicate evernote-guid values',
      '',
      formatMarkdownTable(
        ['evernote-guid', 'Paths'],
        guidCollisions.map((c) => [c.evernoteGuid, c.paths.join(', ')]),
      ),
    );
  }
  return parts.join('\n').trimEnd();
}

export interface CorrelationFailureMarkdownContext {
  reportPathDisplay: string;
  snapshotPath?: string | undefined;
  vaultDir?: string | undefined;
}

function formatNextStepsFooter(
  summary: CorrelationFailureSummary,
  ctx: CorrelationFailureMarkdownContext,
): string {
  const snap = ctx.snapshotPath ?? '<snapshot>';
  const vault = ctx.vaultDir ?? '<vault-dir>';
  const jsonPath = summary.reportPath;
  const lines = [
    '## Next steps',
    '',
    '- Confirm `--vault-dir` points at imported Markdown (not the Evernote DB).',
    '- Import missing notes into the vault if counts differ (`check` / `run` preflight).',
    '- Add `evernote-guid:` frontmatter where files exist but lack a GUID.',
    '- For Evernote title collisions, create `correlation-overrides.json` (see example above).',
    '- Re-run `correlate` or full `run`.',
    `- Machine-readable detail: \`${jsonPath}\``,
    '- After a **successful** correlate, optionally run `guid-backfill` to add missing frontmatter (see README).',
  ];
  if (shouldSuggestGuidBackfill(summary)) {
    lines.splice(
      6,
      0,
      `- Many vault files lack \`evernote-guid:\`; try \`evernote-obsidian guid-backfill --snapshot ${snap} --vault-dir ${vault}\` (then re-run correlate).`,
    );
  }
  return lines.join('\n');
}

export function formatCorrelationFailureMarkdown(
  report: CorrelationFailureReport,
  summary: CorrelationFailureSummary,
  ctx: CorrelationFailureMarkdownContext,
): string {
  const sections = [
    '# Correlate failure report',
    '',
    formatSummarySection(summary),
    formatUnmatchedSection(report),
    formatEvernoteTitleCollisionsSection(report),
    formatGuidTitleMismatchesSection(report),
    formatDuplicateTargetPathsSection(report),
    formatInvalidOverridesSection(report),
    formatTruncatedPrefixCollisionsSection(report),
    formatVaultIndexCollisionsSection(report),
    formatNextStepsFooter(summary, ctx),
  ].filter((s): s is string => s !== undefined);
  return `${sections.join('\n\n')}\n`;
}

export function formatCorrelationFailureMarkdownHint(reportMarkdownPathDisplay: string): string {
  return `Human-readable details: ${reportMarkdownPathDisplay}\n`;
}
