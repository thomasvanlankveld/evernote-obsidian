import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PipelineStepResult } from './pipelineStep.ts';
import { formatHumanReport, pipelineOk } from './runReport.ts';

describe('runReport', () => {
  it('formatHumanReport shows success and failure lines', () => {
    const okSteps: PipelineStepResult[] = [
      {
        id: 'snapshot',
        status: 'ok',
        exitCode: 0,
        summary: {
          ok: true,
          count: 2,
          path: '/work/out/evernote-notes.json',
          db: '/work/en_backup.db',
        },
      },
      {
        id: 'correlate',
        status: 'failed',
        exitCode: 1,
        summary: {
          ok: false,
          reportPath: './out/correlate-report.json',
        },
        humanDetail: '2 Evernote notes → vault: 0 matched, 2 unmatched',
      },
    ];
    const text = formatHumanReport(okSteps, '/work');
    assert.match(text, /✓ snapshot \(Evernote export\)/);
    assert.match(text, /2 notes from Evernote DB \(en_backup\.db\)/);
    assert.match(text, /✗ correlate \(vault matching\)/);
    assert.match(text, /2 Evernote notes → vault: 0 matched, 2 unmatched/);
    assert.match(text, /details: \.\/out\/correlate-report\.json/);
    assert.match(text, /Run failed at correlate/);
    assert.equal(pipelineOk(okSteps), false);
  });
});
