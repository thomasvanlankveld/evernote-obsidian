import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectResourceEmbedLineChanges,
  rewriteImporterResourceEmbeds,
} from './rewriteImporterResourceEmbeds.ts';

describe('rewriteImporterResourceEmbeds', () => {
  it('rewrites embed wikilinks with the importer prefix', () => {
    const before = 'See ![[Evernote/Writings/_resources/photo.png]] here.';
    const { content, replacements } = rewriteImporterResourceEmbeds(before);
    assert.equal(replacements, 1);
    assert.equal(content, 'See ![[_resources/photo.png]] here.');
  });

  it('rewrites non-embed wikilinks and preserves aliases', () => {
    const before = '[[Evernote/Writings/_resources/doc.pdf|attachment]]';
    const { content, replacements } = rewriteImporterResourceEmbeds(before);
    assert.equal(replacements, 1);
    assert.equal(content, '[[_resources/doc.pdf|attachment]]');
  });

  it('rewrites multiple wikilinks on one line', () => {
    const before =
      '![[Evernote/Writings/_resources/a.png]] and [[Evernote/Writings/_resources/b.png]]';
    const { content, replacements } = rewriteImporterResourceEmbeds(before);
    assert.equal(replacements, 2);
    assert.equal(content, '![[_resources/a.png]] and [[_resources/b.png]]');
  });

  it('leaves already-correct and unrelated paths unchanged', () => {
    const before = [
      '![[_resources/ok.png]]',
      'plain Evernote/Writings/_resources/mention',
      '![[Writings/_resources/other.png]]',
    ].join('\n');
    const { content, replacements } = rewriteImporterResourceEmbeds(before);
    assert.equal(replacements, 0);
    assert.equal(content, before);
  });

  it('collectResourceEmbedLineChanges lists line numbers for dry-run', () => {
    const content = ['no change', '![[Evernote/Writings/_resources/x.png]]', 'still fine'].join(
      '\n',
    );
    const changes = collectResourceEmbedLineChanges(content);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.line, 2);
    assert.equal(changes[0]?.before, '![[Evernote/Writings/_resources/x.png]]');
    assert.equal(changes[0]?.after, '![[_resources/x.png]]');
  });
});
