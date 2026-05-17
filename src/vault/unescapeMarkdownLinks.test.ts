import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isExternalMarkdownLinkUrl,
  unescapeMarkdownLinksInContent,
} from './unescapeMarkdownLinks.ts';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/unescape');

describe('isExternalMarkdownLinkUrl', () => {
  it('accepts http(s) and mailto', () => {
    assert.equal(isExternalMarkdownLinkUrl('https://www.dndbeyond.com/monsters/x'), true);
    assert.equal(isExternalMarkdownLinkUrl('http://example.com'), true);
    assert.equal(isExternalMarkdownLinkUrl('mailto:a@b.c'), true);
  });

  it('rejects empty and relative paths', () => {
    assert.equal(isExternalMarkdownLinkUrl(''), false);
    assert.equal(isExternalMarkdownLinkUrl('notes/target.md'), false);
    assert.equal(isExternalMarkdownLinkUrl('[[wikilink]]'), false);
  });
});

describe('unescapeMarkdownLinksInContent', () => {
  it('unwraps escaped external markdown links', () => {
    const input = String.raw`* \[[Mormesk the Wraith - CR 3](https://www.dndbeyond.com/monsters/mormesk)\]`;
    const { content, replacements } = unescapeMarkdownLinksInContent(input);
    assert.equal(
      content,
      '* [Mormesk the Wraith - CR 3](https://www.dndbeyond.com/monsters/mormesk)',
    );
    assert.equal(replacements, 1);
  });

  it('leaves normal links and non-http destinations unchanged', () => {
    const input = 'See [note](other.md) and [web](https://x.com)';
    const { content, replacements } = unescapeMarkdownLinksInContent(input);
    assert.equal(content, input);
    assert.equal(replacements, 0);
  });

  it('handles ] inside link text', () => {
    const input = String.raw`\[[Stat block with ] bracket](https://www.dndbeyond.com/monsters/example)\]`;
    const { content, replacements } = unescapeMarkdownLinksInContent(input);
    assert.equal(
      content,
      '[Stat block with ] bracket](https://www.dndbeyond.com/monsters/example)',
    );
    assert.equal(replacements, 1);
  });

  it('does not unwrap when only the opening bracket is escaped', () => {
    const input = String.raw`\[[text](https://example.com) without closing escape`;
    const { content, replacements } = unescapeMarkdownLinksInContent(input);
    assert.equal(content, input);
    assert.equal(replacements, 0);
  });

  it('skips links inside fenced code blocks', () => {
    const input = '```\n\\[[x](https://example.com)\\]\n```';
    const { content, replacements } = unescapeMarkdownLinksInContent(input);
    assert.equal(content, input);
    assert.equal(replacements, 0);
  });

  it('transforms campaign fixture samples', async () => {
    const raw = await readFile(join(fixtureDir, 'campaign-sample.md'), 'utf8');
    const { content, replacements } = unescapeMarkdownLinksInContent(raw);
    assert.equal(replacements, 2);
    assert.match(content, /^\* \[Mormesk the Wraith/m);
    assert.match(content, /^\* \[Stat block with \] bracket\]/m);
    assert.ok(content.includes(String.raw`\* \[[not a link]`));
    assert.ok(
      content.includes(
        String.raw`\[[Mormesk the Wraith](https://www.dndbeyond.com/monsters/mormesk)`,
      ),
    );
  });
});
