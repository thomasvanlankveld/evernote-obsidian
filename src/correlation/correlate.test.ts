import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NoteRecord } from '../evernote/noteRecord.ts';
import { correlateSnapshotToGuidPaths, vaultIndexResultToCorrelationInput } from './correlate.ts';

const vaultPaths = ['first.md', 'sub/second note.md', 'third.md'] as const;

function makeVault() {
  return vaultIndexResultToCorrelationInput(
    new Map([
      ['first', 'first.md'],
      ['second note', 'sub/second note.md'],
      ['quoted title', 'third.md'],
    ]),
    vaultPaths,
  );
}

describe('correlateSnapshotToGuidPaths', () => {
  it('maps notes by normalized title', () => {
    const notes: NoteRecord[] = [
      { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'g2', title: 'Second Note', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'g3', title: 'Quoted Title', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g1'), 'first.md');
      assert.equal(r.guidToPath.get('g2'), 'sub/second note.md');
      assert.equal(r.guidToPath.get('g3'), 'third.md');
    }
  });

  it('matches Evernote titles in NFD to vault entries indexed with NFC unicode', () => {
    const vault = vaultIndexResultToCorrelationInput(new Map([['café', 'café.md']]), ['café.md']);
    const nfdTitle = `caf\u0065\u0301`;
    const notes: NoteRecord[] = [
      { guid: 'g-cafe', title: nfdTitle, updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g-cafe'), 'café.md');
    }
  });

  it('correlates titles containing punctuation and collapses Evernote title whitespace', () => {
    const vault = vaultIndexResultToCorrelationInput(
      new Map([['hello: world (v2)', 'Hello: World (v2).md']]),
      ['Hello: World (v2).md'],
    );
    const notes: NoteRecord[] = [
      {
        guid: 'g-punct',
        title: '  Hello:   World (v2)  ',
        updated: '1970-01-01T00:00:00.000Z',
      },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g-punct'), 'Hello: World (v2).md');
    }
  });

  it('reports unmatched when title is missing from vault index', () => {
    const notes: NoteRecord[] = [
      { guid: 'gx', title: 'Nobody has this title', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.unmatched.length, 1);
      assert.equal(r.unmatched[0]?.guid, 'gx');
    }
  });

  it('requires overrides when multiple Evernote notes share a normalized title', () => {
    const notes: NoteRecord[] = [
      { guid: 'a', title: 'Same', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'b', title: 'same', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.evernoteTitleCollisions.length, 1);
      assert.deepEqual(r.evernoteTitleCollisions[0]?.guids.sort(), ['a', 'b']);
    }
  });

  it('resolves duplicate Evernote titles via per-GUID overrides', () => {
    const notes: NoteRecord[] = [
      { guid: 'a', title: 'Same', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'b', title: 'same', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const overrides = new Map<string, string>([
      ['a', 'first.md'],
      ['b', 'third.md'],
    ]);
    const r = correlateSnapshotToGuidPaths(notes, makeVault(), overrides);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('a'), 'first.md');
      assert.equal(r.guidToPath.get('b'), 'third.md');
    }
  });

  it('rejects override paths that are not indexed in the vault', () => {
    const notes: NoteRecord[] = [
      { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const overrides = new Map([['g1', 'nope.md']]);
    const r = correlateSnapshotToGuidPaths(notes, makeVault(), overrides);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.invalidOverrides.length, 1);
      assert.equal(r.invalidOverrides[0]?.reason, 'unknown_path');
    }
  });

  it('rejects two GUIDs mapping to the same vault path', () => {
    const notes: NoteRecord[] = [
      { guid: 'x', title: 'A', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'y', title: 'B', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const vault = vaultIndexResultToCorrelationInput(
      new Map([
        ['a', 'first.md'],
        ['b', 'second.md'],
      ]),
      ['first.md', 'second.md'],
    );
    const overrides = new Map([
      ['x', 'first.md'],
      ['y', 'first.md'],
    ]);
    const r = correlateSnapshotToGuidPaths(notes, vault, overrides);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.duplicateTargetPaths.length, 1);
      assert.deepEqual(r.duplicateTargetPaths[0]?.guids.sort(), ['x', 'y']);
    }
  });

  it('prefers override over automatic title match for a single note', () => {
    const notes: NoteRecord[] = [
      { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const overrides = new Map([['g1', 'third.md']]);
    const r = correlateSnapshotToGuidPaths(notes, makeVault(), overrides);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g1'), 'third.md');
    }
  });
});
