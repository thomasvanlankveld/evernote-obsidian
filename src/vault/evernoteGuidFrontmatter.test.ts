import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGuidBackfillPlan,
  insertEvernoteGuidIntoContent,
  planGuidBackfillItem,
} from './evernoteGuidFrontmatter.ts';
import { parseFrontmatterEvernoteGuid } from './vaultIndex.ts';

describe('insertEvernoteGuidIntoContent', () => {
  it('prepends frontmatter when the note has none', () => {
    const next = insertEvernoteGuidIntoContent('# Body\n', 'G1-G2-G3-G4-G5');
    assert.equal(parseFrontmatterEvernoteGuid(next), 'g1-g2-g3-g4-g5');
    assert.match(next, /^---\nevernote-guid: g1-g2-g3-g4-g5\n---\n\n# Body\n$/);
  });

  it('inserts evernote-guid into an existing frontmatter block', () => {
    const src = '---\ntitle: Note\n---\n\nBody';
    const next = insertEvernoteGuidIntoContent(src, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(parseFrontmatterEvernoteGuid(next), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.match(
      next,
      /^---\nevernote-guid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\ntitle: Note\n---\n\nBody$/,
    );
  });

  it('preserves CRLF line endings', () => {
    const src = '---\r\ntitle: X\r\n---\r\n\r\n';
    const next = insertEvernoteGuidIntoContent(src, 'g1-g2-g3-g4-g5');
    assert.ok(next.includes('\r\n'));
    assert.equal(parseFrontmatterEvernoteGuid(next), 'g1-g2-g3-g4-g5');
  });
});

describe('planGuidBackfillItem', () => {
  it('plans an update when evernote-guid is missing', () => {
    const item = planGuidBackfillItem('# Hi\n', 'G1-G2-G3-G4-G5', 'a.md');
    assert.deepEqual(item, { kind: 'would-update', path: 'a.md', guid: 'g1-g2-g3-g4-g5' });
  });

  it('skips when the existing GUID matches', () => {
    const body = '---\nevernote-guid: g1-g2-g3-g4-g5\n---\n\n';
    const item = planGuidBackfillItem(body, 'G1-G2-G3-G4-G5', 'a.md');
    assert.deepEqual(item, { kind: 'skip-matching', path: 'a.md', guid: 'g1-g2-g3-g4-g5' });
  });

  it('reports a conflict when the existing GUID differs', () => {
    const body = '---\nevernote-guid: other-guid\n---\n\n';
    const item = planGuidBackfillItem(body, 'g1-g2-g3-g4-g5', 'a.md');
    assert.equal(item.kind, 'conflict');
    if (item.kind === 'conflict') {
      assert.equal(item.path, 'a.md');
      assert.equal(item.expectedGuid, 'g1-g2-g3-g4-g5');
      assert.equal(item.existingGuid, 'other-guid');
    }
  });
});

describe('buildGuidBackfillPlan', () => {
  it('aggregates counts and paths', () => {
    const plan = buildGuidBackfillPlan(
      new Map([
        ['g1', 'a.md'],
        ['g2', 'b.md'],
      ]),
      new Map([
        ['a.md', '# no fm\n'],
        ['b.md', '---\nevernote-guid: g2\n---\n\n'],
      ]),
    );
    assert.deepEqual(plan.wouldUpdate, ['a.md']);
    assert.deepEqual(plan.skipped, ['b.md']);
    assert.equal(plan.conflicts.length, 0);
  });
});
