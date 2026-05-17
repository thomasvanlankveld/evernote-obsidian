import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyEvernoteUrl,
  extractEvernoteLinksFromMarkdown,
  scanMarkdownInlineLinks,
  scanVaultForEvernoteLinks,
  tryParseNoteGuidFromUrl,
} from './extractEvernoteLinks.ts';

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__/links');

describe('tryParseNoteGuidFromUrl', () => {
  it('parses shard /n/ GUID', () => {
    const g = tryParseNoteGuidFromUrl(
      'https://www.evernote.com/shard/s308/n/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/foo',
    );
    assert.equal(g, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('parses shard /sh/ GUID', () => {
    const g = tryParseNoteGuidFromUrl(
      'https://www.evernote.com/shard/s1/sh/key/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/',
    );
    assert.equal(g, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('parses percent-encoded hex digits in shard /n/ paths', () => {
    const g = tryParseNoteGuidFromUrl(
      'https://www.evernote.com/shard/s308/n/%63%63%63%63%63%63%63%63-%63%63%63%63-%63%63%63%63-%63%63%63%63-%63%63%63%63%63%63%63%63%63%63%63%63',
    );
    assert.equal(g, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('parses evernote:///view style', () => {
    const g = tryParseNoteGuidFromUrl(
      'evernote:///view/153/s308/cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    assert.equal(g, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('parses evernote://view style (host segment)', () => {
    const g = tryParseNoteGuidFromUrl(
      'evernote://view/153/s308/dddddddd-dddd-dddd-dddd-dddddddddddd',
    );
    assert.equal(g, 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  });

  it('returns null for non-shard www URL', () => {
    assert.equal(tryParseNoteGuidFromUrl('https://www.evernote.com/client/web'), null);
  });
});

describe('classifyEvernoteUrl', () => {
  it('classifies evernote scheme as note', () => {
    assert.equal(classifyEvernoteUrl('evernote:///x'), 'note');
  });
  it('classifies shard as note', () => {
    assert.equal(classifyEvernoteUrl('https://www.evernote.com/shard/s1/n/guid-here'), 'note');
  });
  it('classifies blog as other', () => {
    assert.equal(classifyEvernoteUrl('https://blog.evernote.com/p'), 'other-evernote');
  });
  it('returns null for unrelated https', () => {
    assert.equal(classifyEvernoteUrl('https://example.com/'), null);
  });
});

describe('extractEvernoteLinksFromMarkdown', () => {
  it('extracts from fixture file shape', async () => {
    const md = await readFile(join(fixtureDir, 'mixed.md'), 'utf8');
    const links = extractEvernoteLinksFromMarkdown(md, 'mixed.md');
    const guids = new Set(links.filter((l) => l.parsedGuid).map((l) => l.parsedGuid as string));
    assert.ok(guids.has('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    assert.ok(guids.has('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    assert.ok(guids.has('cccccccc-cccc-cccc-cccc-cccccccccccc'));
    const other = links.filter((l) => l.kind === 'other-evernote');
    assert.equal(other.length, 1);
    assert.match(other[0]?.rawUrl ?? '', /blog\.evernote\.com/);
  });

  it('captures markdown link alias', () => {
    const s = '[Display text](evernote:///view/a/b/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee)';
    const links = extractEvernoteLinksFromMarkdown(s, 'x.md');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.alias, 'Display text');
    assert.equal(links[0]?.parsedGuid, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  });

  it('captures wikilink pipe alias', () => {
    const s = '[[evernote:///view/1/2/ffffffff-ffff-ffff-ffff-ffffffffffff|Shown name]]';
    const links = extractEvernoteLinksFromMarkdown(s, 'x.md');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.alias, 'Shown name');
    assert.equal(links[0]?.parsedGuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  });

  it('captures markdown link text containing ] before ](', () => {
    const guid = '99999999-9999-9999-9999-999999999999';
    const s = `[See section [2]](evernote:///view/153/s308/${guid})`;
    const links = extractEvernoteLinksFromMarkdown(s, 'x.md');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.alias, 'See section [2]');
    assert.equal(links[0]?.parsedGuid, guid);
  });

  it('captures link text when an early ] is not followed by (', () => {
    const guid = '88888888-8888-8888-8888-888888888888';
    const s = `[Bracket] test](https://www.evernote.com/shard/s308/n/${guid}/slug)`;
    const links = extractEvernoteLinksFromMarkdown(s, 'x.md');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.alias, 'Bracket] test');
    assert.equal(links[0]?.parsedGuid, guid);
  });
});

describe('scanMarkdownInlineLinks', () => {
  it('parses simple links', () => {
    const links = [...scanMarkdownInlineLinks('[simple](https://example.com/a)')];
    assert.equal(links.length, 1);
    assert.equal(links[0]?.text, 'simple');
    assert.equal(links[0]?.url, 'https://example.com/a');
  });
});

describe('scanVaultForEvernoteLinks', () => {
  it('honors skipOtherEvernoteHosts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-links-scan-'));
    try {
      await writeFile(join(dir, 'a.md'), 'https://blog.evernote.com/x\n', 'utf8');
      await writeFile(
        join(dir, 'b.md'),
        'https://www.evernote.com/shard/s/n/11111111-1111-1111-1111-111111111111/\n',
        'utf8',
      );
      const all = await scanVaultForEvernoteLinks(dir);
      const skipped = await scanVaultForEvernoteLinks(dir, { skipOtherEvernoteHosts: true });
      assert.ok(all.some((l) => l.kind === 'other-evernote'));
      assert.equal(
        skipped.some((l) => l.kind === 'other-evernote'),
        false,
      );
      assert.ok(skipped.some((l) => l.parsedGuid === '11111111-1111-1111-1111-111111111111'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
