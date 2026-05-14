import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rewriteMarkdownWithGuidMap } from './rewriteEvernoteLinks.ts';

describe('rewriteMarkdownWithGuidMap', () => {
  it('rewrites markdown link with alias', () => {
    const map = new Map([
      ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'one.md'],
      ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'two.md'],
    ]);
    const src =
      'x [Label](https://www.evernote.com/shard/s308/n/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/x) y';
    const { content, replaced, skippedUnmapped } = rewriteMarkdownWithGuidMap(src, map);
    assert.equal(replaced, 1);
    assert.equal(skippedUnmapped, 0);
    assert.equal(content, 'x [[one.md|Label]] y');
  });

  it('rewrites wikilink and leaves unmapped bare URLs', () => {
    const map = new Map([['ffffffff-ffff-ffff-ffff-ffffffffffff', 'f.md']]);
    const src =
      '[[evernote:///view/1/2/ffffffff-ffff-ffff-ffff-ffffffffffff|Name]] and https://www.evernote.com/shard/s/n/00000000-0000-0000-0000-000000000000/';
    const { content, replaced, skippedUnmapped } = rewriteMarkdownWithGuidMap(src, map);
    assert.equal(replaced, 1);
    assert.equal(skippedUnmapped, 1);
    assert.match(content, /\[\[f\.md\|Name\]\]/);
    assert.match(content, /00000000-0000-0000-0000-000000000000/);
  });

  it('does not rewrite other-evernote hosts', () => {
    const map = new Map<string, string>();
    const src = 'https://blog.evernote.com/hello/';
    const { content, replaced } = rewriteMarkdownWithGuidMap(src, map);
    assert.equal(replaced, 0);
    assert.equal(content, src);
  });
});
