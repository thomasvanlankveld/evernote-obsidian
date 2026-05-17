import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NoteRecord } from '../evernote/noteRecord.ts';
import { rewriteMarkdownWithGuidMap } from '../vault/rewriteEvernoteLinks.ts';
import { correlateSnapshotToGuidPaths, vaultIndexResultToCorrelationInput } from './correlate.ts';

const vaultPaths = ['first.md', 'sub/second note.md', 'third.md'] as const;

function makeVault(extra?: {
  byEvernoteGuid?: Map<string, string>;
  pathToEvernoteGuid?: Map<string, string>;
}) {
  return vaultIndexResultToCorrelationInput(
    new Map([
      ['first', 'first.md'],
      ['second note', 'sub/second note.md'],
      ['quoted title', 'third.md'],
    ]),
    vaultPaths,
    extra?.byEvernoteGuid ?? new Map(),
    extra?.pathToEvernoteGuid ?? new Map(),
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

  it('correlates Evernote titles to Importer-sanitized vault stems and collapses whitespace', () => {
    const vault = vaultIndexResultToCorrelationInput(
      new Map([['hello world (v2)', 'Hello World (v2).md']]),
      ['Hello World (v2).md'],
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
      assert.equal(r.guidToPath.get('g-punct'), 'Hello World (v2).md');
    }
  });

  it('matches snapshot titles to vault paths when strict punctuation would fail', () => {
    const vaultPaths = [
      'Coming Down to Earth What if….md',
      'Everybody Loves Zombies  Running The Game - YouTube.md',
      'Lydian & Mixolydian Scales - Modes.md',
      'LMoPh Leeuwenschild Koster (…).md',
    ] as const;
    const vault = vaultIndexResultToCorrelationInput(
      new Map([
        ['coming down to earth what if…', vaultPaths[0]],
        ['everybody loves zombies running the game - youtube', vaultPaths[1]],
        ['lydian & mixolydian scales - modes', vaultPaths[2]],
        ['lmoph leeuwenschild koster (…)', vaultPaths[3]],
      ]),
      vaultPaths,
    );
    const notes: NoteRecord[] = [
      {
        guid: 'g-colon',
        title: 'Coming Down to Earth: What if…',
        updated: '1970-01-01T00:00:00.000Z',
      },
      {
        guid: 'g-pipe',
        title: 'Everybody Loves Zombies | Running The Game - YouTube',
        updated: '1970-01-01T00:00:00.000Z',
      },
      {
        guid: 'g-slash',
        title: 'Lydian & Mixolydian Scales / Modes',
        updated: '1970-01-01T00:00:00.000Z',
      },
      {
        guid: 'g-prefix',
        title: 'LMoPh: Leeuwenschild Koster (…)',
        updated: '1970-01-01T00:00:00.000Z',
      },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g-colon'), vaultPaths[0]);
      assert.equal(r.guidToPath.get('g-pipe'), vaultPaths[1]);
      assert.equal(r.guidToPath.get('g-slash'), vaultPaths[2]);
      assert.equal(r.guidToPath.get('g-prefix'), vaultPaths[3]);
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

  it('lowercases guidToPath keys when snapshot GUIDs are uppercase', () => {
    const notes: NoteRecord[] = [
      {
        guid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        title: 'First',
        updated: '1970-01-01T00:00:00.000Z',
      },
    ];
    const r = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'first.md');
    }
  });

  it('correlate + rewrite succeeds with uppercase snapshot GUID and lowercase URL', () => {
    const notes: NoteRecord[] = [
      {
        guid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        title: 'First',
        updated: '1970-01-01T00:00:00.000Z',
      },
    ];
    const correlated = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(correlated.ok, true);
    if (!correlated.ok) {
      return;
    }
    const src = '[x](https://www.evernote.com/shard/s308/n/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/y)';
    const { content, replaced, skippedUnmapped } = rewriteMarkdownWithGuidMap(
      src,
      correlated.guidToPath,
    );
    assert.equal(replaced, 1);
    assert.equal(skippedUnmapped, 0);
    assert.equal(content, '[[first.md|x]]');
  });

  it('matches by vault evernote-guid when title differs from snapshot', () => {
    const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const vault = vaultIndexResultToCorrelationInput(
      new Map([['renamed in vault', 'tagged.md']]),
      ['tagged.md'],
      new Map([[guid, 'tagged.md']]),
      new Map([['tagged.md', guid]]),
    );
    const notes: NoteRecord[] = [
      { guid, title: 'Original Evernote Title', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get(guid), 'tagged.md');
    }
  });

  it('falls back to title when vault file has no evernote-guid', () => {
    const notes: NoteRecord[] = [
      { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, makeVault());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('g1'), 'first.md');
    }
  });

  it('still maps GUID-resolved notes when duplicate titles need title-only resolution', () => {
    const vault = vaultIndexResultToCorrelationInput(
      new Map([
        ['note a', 'a.md'],
        ['same', 'ambiguous.md'],
      ]),
      ['a.md', 'ambiguous.md'],
      new Map([['guid-a', 'a.md']]),
      new Map([['a.md', 'guid-a']]),
    );
    const notes: NoteRecord[] = [
      { guid: 'guid-a', title: 'Same', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'guid-b', title: 'same', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'guid-c', title: 'SAME', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.evernoteTitleCollisions.length, 1);
      assert.deepEqual(r.evernoteTitleCollisions[0]?.guids.sort(), ['guid-b', 'guid-c']);
    }
  });

  it('resolves duplicate Evernote titles when vault files have distinct evernote-guids', () => {
    const vault = vaultIndexResultToCorrelationInput(
      new Map([
        ['note a', 'a.md'],
        ['note b', 'b.md'],
      ]),
      ['a.md', 'b.md'],
      new Map([
        ['guid-a', 'a.md'],
        ['guid-b', 'b.md'],
      ]),
      new Map([
        ['a.md', 'guid-a'],
        ['b.md', 'guid-b'],
      ]),
    );
    const notes: NoteRecord[] = [
      { guid: 'guid-a', title: 'Same', updated: '1970-01-01T00:00:00.000Z' },
      { guid: 'guid-b', title: 'same', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.guidToPath.get('guid-a'), 'a.md');
      assert.equal(r.guidToPath.get('guid-b'), 'b.md');
    }
  });

  it('reports guid/title path mismatch when frontmatter guid and title disagree', () => {
    const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const vault = vaultIndexResultToCorrelationInput(
      new Map([
        ['vault a', 'by-guid.md'],
        ['snapshot title', 'by-title.md'],
      ]),
      ['by-guid.md', 'by-title.md'],
      new Map([[guid, 'by-guid.md']]),
      new Map([['by-guid.md', guid]]),
    );
    const notes: NoteRecord[] = [
      { guid, title: 'Snapshot Title', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.guidTitleMismatches.length, 1);
      assert.equal(r.guidTitleMismatches[0]?.reason, 'paths_differ');
    }
  });

  it('reports vault_guid_differs when title match file claims another guid', () => {
    const vault = vaultIndexResultToCorrelationInput(
      new Map([['first', 'first.md']]),
      ['first.md'],
      new Map(),
      new Map([['first.md', 'other-guid']]),
    );
    const notes: NoteRecord[] = [
      { guid: 'g1', title: 'First', updated: '1970-01-01T00:00:00.000Z' },
    ];
    const r = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.guidTitleMismatches.length, 1);
      assert.equal(r.guidTitleMismatches[0]?.reason, 'vault_guid_differs');
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
