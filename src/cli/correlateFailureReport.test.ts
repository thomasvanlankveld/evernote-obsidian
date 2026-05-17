import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCorrelationFailureSummary,
  correlationFailureCounts,
  correlationFailureFromCorrelateResult,
  formatCorrelationFailureHint,
} from './correlateFailureReport.ts';

describe('correlateFailureReport', () => {
  it('builds compact counts from a correlation failure report', () => {
    const report = correlationFailureFromCorrelateResult({
      ok: false,
      evernoteTitleCollisions: [{ normalizedTitle: 'x', guids: ['a', 'b'] }],
      unmatched: [
        { guid: 'g1', title: 'A', normalizedTitle: 'a' },
        { guid: 'g2', title: 'B', normalizedTitle: 'b' },
      ],
      invalidOverrides: [],
      duplicateTargetPaths: [],
      guidTitleMismatches: [],
    });
    const counts = correlationFailureCounts(report);
    assert.equal(counts.unmatched, 2);
    assert.equal(counts.evernoteTitleCollisions, 1);

    const summary = buildCorrelationFailureSummary(report, './out/correlate-report.json', 10);
    assert.equal(summary.snapshotNotes, 10);
    assert.equal(summary.counts.unmatched, 2);
    assert.match(formatCorrelationFailureHint(summary), /10 snapshot notes, 2 unmatched/);
    assert.match(formatCorrelationFailureHint(summary), /correlate-report\.json/);
  });
});
