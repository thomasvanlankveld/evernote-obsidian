import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evernoteUpdatedMsToIso } from './fetchNoteRecords.ts';

describe('evernoteUpdatedMsToIso', () => {
  it('returns ISO UTC for finite millisecond timestamps', () => {
    assert.equal(evernoteUpdatedMsToIso(0, 'g1'), '1970-01-01T00:00:00.000Z');
    assert.equal(
      evernoteUpdatedMsToIso(1_700_000_000_000, 'g2'),
      new Date(1_700_000_000_000).toISOString(),
    );
  });

  it('throws when updated is not a finite number', () => {
    assert.throws(() => evernoteUpdatedMsToIso(undefined, 'abc'), /guid=abc/);
    assert.throws(() => evernoteUpdatedMsToIso(Number.NaN, 'abc'), /guid=abc/);
    assert.throws(() => evernoteUpdatedMsToIso('1700000000000', 'abc'), /guid=abc/);
  });
});
