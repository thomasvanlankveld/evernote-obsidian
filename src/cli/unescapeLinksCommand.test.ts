import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { makeStreams } from './cliTestHelpers.ts';
import { main } from './main.ts';
import { parseUnescapeLinksArgs } from './unescapeLinksCommand.ts';

describe('parseUnescapeLinksArgs', () => {
  it('defaults to dry-run', () => {
    const parsed = parseUnescapeLinksArgs([], '/tmp');
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.unescape.mode, 'dry-run');
      assert.deepEqual(parsed.unescape.onlyPrefixes, []);
    }
  });

  it('parses --only prefixes', () => {
    const parsed = parseUnescapeLinksArgs(['--only', 'Campaign/Notes'], '/tmp');
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.unescape.onlyPrefixes, ['Campaign/Notes']);
    }
  });

  it('rejects unknown flags', () => {
    const parsed = parseUnescapeLinksArgs(['--mystery'], '/tmp');
    assert.equal(parsed.ok, false);
  });
});

describe('unescape-links CLI', () => {
  it('dry-run reports samples and leaves files unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'unescape-cli-'));
    try {
      const note = join(dir, 'note.md');
      await writeFile(note, String.raw`* \[[Example](https://example.com/page)\]`, 'utf8');
      const { streams, out } = makeStreams();
      const code = await main(['unescape-links', '--vault-dir', dir], streams);
      assert.equal(code, 0);
      const j = JSON.parse(out()) as {
        filesChanged: number;
        replacements: number;
        samples?: { before: string; after: string }[];
      };
      assert.equal(j.filesChanged, 1);
      assert.equal(j.replacements, 1);
      assert.equal(j.samples?.[0]?.before, String.raw`* \[[Example](https://example.com/page)\]`);
      assert.equal(j.samples?.[0]?.after, '* [Example](https://example.com/page)');
      assert.equal(
        await readFile(note, 'utf8'),
        String.raw`* \[[Example](https://example.com/page)\]`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
