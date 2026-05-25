import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCorrelationFailureSummary,
  correlationFailureCounts,
  correlationFailureFromCorrelateResult,
  correlationHintForRun,
  formatCorrelateRunDetail,
  formatCorrelationFailureHint,
  formatCorrelationFailureNextSteps,
} from './correlateFailureReport.ts';

describe('correlateFailureReport', () => {
  it('builds compact counts from a correlation failure report', () => {
    const report = correlationFailureFromCorrelateResult({
      ok: false,
      matchedCount: 7,
      evernoteTitleCollisions: [{ normalizedTitle: 'x', guids: ['a', 'b'] }],
      unmatched: [
        { guid: 'g1', title: 'A', normalizedTitle: 'a' },
        { guid: 'g2', title: 'B', normalizedTitle: 'b' },
      ],
      invalidOverrides: [],
      duplicateTargetPaths: [],
      guidTitleMismatches: [],
      truncatedPrefixCollisions: [],
    });
    const counts = correlationFailureCounts(report);
    assert.equal(counts.unmatched, 2);
    assert.equal(counts.evernoteTitleCollisions, 1);

    const summary = buildCorrelationFailureSummary(report, './out/correlate-report.json', 10, {
      matchedCount: 7,
      vault: { vaultMarkdownCount: 100, vaultWithGuidCount: 5 },
    });
    assert.equal(summary.snapshotNotes, 10);
    assert.equal(summary.counts.unmatched, 2);
    assert.equal(summary.matchedCount, 7);
    assert.match(
      formatCorrelationFailureHint(summary),
      /10 Evernote notes → vault: 7 matched, 2 unmatched/,
    );
    assert.match(formatCorrelationFailureHint(summary), /correlate-report\.json/);
    const withMd = buildCorrelationFailureSummary(report, './out/correlate-report.json', 10, {
      matchedCount: 7,
      reportMarkdownPath: './out/correlate-report.md',
    });
    const hintMd = formatCorrelationFailureHint(withMd);
    assert.match(hintMd, /correlate-report\.md/);
    assert.match(hintMd, /correlate-report\.json for JSON/);
    assert.equal(
      formatCorrelateRunDetail(summary),
      '10 Evernote notes → vault: 7 matched, 2 unmatched, 1 Evernote title collision(s)',
    );
  });

  it('correlationHintForRun strips correlate prefix and report path', () => {
    const hint =
      'correlate: 10 Evernote notes → vault: 7 matched, 2 unmatched — see ./out/correlate-report.json\n';
    assert.equal(correlationHintForRun(hint), '10 Evernote notes → vault: 7 matched, 2 unmatched');
  });

  it('next steps suggest guid-backfill when many vault files lack evernote-guid', () => {
    const report = correlationFailureFromCorrelateResult({
      ok: false,
      matchedCount: 0,
      evernoteTitleCollisions: [],
      unmatched: [{ guid: 'g1', title: 'A', normalizedTitle: 'a' }],
      invalidOverrides: [],
      duplicateTargetPaths: [],
      guidTitleMismatches: [],
      truncatedPrefixCollisions: [],
    });
    const summary = buildCorrelationFailureSummary(report, './out/correlate-report.json', 1, {
      matchedCount: 0,
      vault: { vaultMarkdownCount: 10, vaultWithGuidCount: 0 },
    });
    const steps = formatCorrelationFailureNextSteps(summary, report, {
      snapshotPath: './out/evernote-notes.json',
      vaultDir: './vault',
    });
    assert.match(steps, /guid-backfill/);
    assert.match(steps, /unmatched/);
  });
});
