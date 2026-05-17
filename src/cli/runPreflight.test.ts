import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunCliOk } from './runCommand.ts';
import { resolveEvernoteSourceForRun } from './runPreflight.ts';

function minimalRun(overrides: Partial<RunCliOk>): RunCliOk {
  return {
    vaultRoot: '/vault',
    snapshotOutPath: '/out/evernote-notes.json',
    mapOutPath: '/out/link-map.json',
    correlateReportPath: '/out/correlate-report.json',
    correlateReportPathDisplay: './out/correlate-report.json',
    correlateVerbose: false,
    skipUnescapeLinks: false,
    rewrite: { mode: 'dry-run', backup: false },
    output: { json: false, jsonSteps: false, quiet: false, progress: false },
    ...overrides,
  };
}

describe('runPreflight', () => {
  it('resolveEvernoteSourceForRun prefers snapshot over db', () => {
    const source = resolveEvernoteSourceForRun(
      minimalRun({ snapshotPath: '/snap.json', dbPath: '/db' }),
    );
    assert.deepEqual(source, { snapshotPath: '/snap.json', maxRecords: undefined });
  });

  it('resolveEvernoteSourceForRun uses db when no snapshot', () => {
    const source = resolveEvernoteSourceForRun(minimalRun({ dbPath: '/db' }));
    assert.deepEqual(source, { dbPath: '/db', maxRecords: undefined });
  });

  it('resolveEvernoteSourceForRun returns null when only map is provided', () => {
    const source = resolveEvernoteSourceForRun(minimalRun({ mapPath: '/map.json' }));
    assert.equal(source, null);
  });

  it('resolveEvernoteSourceForRun returns null when --map is set without --snapshot', () => {
    const source = resolveEvernoteSourceForRun(minimalRun({ dbPath: '/db', mapPath: '/map.json' }));
    assert.equal(source, null);
  });
});
