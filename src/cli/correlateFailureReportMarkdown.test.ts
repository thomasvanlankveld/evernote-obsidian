import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCorrelationFailureSummary,
  correlationFailureFromCorrelateResult,
} from './correlateFailureReport.ts';
import {
  correlationReportMarkdownPath,
  formatCorrelationFailureMarkdown,
  suggestedVaultFileStem,
} from './correlateFailureReportMarkdown.ts';

describe('correlateFailureReportMarkdown', () => {
  it('derives .md path from default JSON report path', () => {
    assert.equal(
      correlationReportMarkdownPath('/tmp/out/correlate-report.json'),
      '/tmp/out/correlate-report.md',
    );
    assert.equal(correlationReportMarkdownPath('/tmp/custom.txt'), '/tmp/custom.txt.md');
  });

  it('suggestedVaultFileStem applies Importer sanitization without lowercasing', () => {
    assert.equal(suggestedVaultFileStem('Hello # World'), 'Hello  World');
    assert.equal(suggestedVaultFileStem('UPPER'), 'UPPER');
  });

  it('renders unmatched table and summary counts', () => {
    const report = correlationFailureFromCorrelateResult({
      ok: false,
      matchedCount: 1,
      evernoteTitleCollisions: [{ normalizedTitle: 'dup', guids: ['a', 'b'] }],
      unmatched: [{ guid: 'g1', title: 'Nope', normalizedTitle: 'nope' }],
      invalidOverrides: [],
      duplicateTargetPaths: [],
      guidTitleMismatches: [],
      truncatedPrefixCollisions: [],
    });
    const summary = buildCorrelationFailureSummary(report, './out/correlate-report.json', 2, {
      matchedCount: 1,
    });
    const md = formatCorrelationFailureMarkdown(report, summary, {
      reportPathDisplay: './out/correlate-report.json',
    });
    assert.match(md, /^# Correlate failure report/);
    assert.match(md, /\| Unmatched \| 1 \|/);
    assert.match(md, /## Unmatched/);
    assert.match(md, /\| Nope \| g1 \| nope \|/);
    assert.match(md, /## Evernote title collisions/);
    assert.match(md, /`dup`/);
    assert.match(md, /"byGuid"/);
    assert.match(md, /## Next steps/);
  });
});
