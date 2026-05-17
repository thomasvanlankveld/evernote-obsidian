import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeStreams } from './cliTestHelpers.ts';
import { parseFixResourcesArgs, runFixResources } from './fixResourcesCommand.ts';

const resourcesFixtureVault = join(
  dirname(fileURLToPath(import.meta.url)),
  '../vault/__fixtures__/resources',
);

describe('fixResourcesCommand', () => {
  it('parseFixResourcesArgs defaults to dry-run', () => {
    const parsed = parseFixResourcesArgs(['--vault-dir', '/tmp/vault'], '/cwd');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.fixResources.mode, 'dry-run');
  });

  it('dry-run lists file and line changes without writing', async () => {
    const { streams, out, err } = makeStreams();
    const code = await runFixResources(
      {
        vaultRoot: resourcesFixtureVault,
        mode: 'dry-run',
      },
      streams,
    );
    assert.equal(code, 0);
    assert.equal(err(), '');
    const j = JSON.parse(out()) as {
      ok: boolean;
      mode: string;
      filesChanged: number;
      replacements: number;
      wroteFiles: boolean;
      changes: { file: string; line: number; before: string; after: string }[];
    };
    assert.equal(j.ok, true);
    assert.equal(j.mode, 'dry-run');
    assert.equal(j.filesChanged, 1);
    assert.equal(j.replacements, 2);
    assert.equal(j.wroteFiles, false);
    assert.equal(j.changes.length, 2);
    assert.equal(j.changes[0]?.file, 'bad-embed.md');
    assert.equal(j.changes[0]?.line, 3);
  });

  it('out-dir reads mirrored markdown from a prior rewrite step when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fix-resources-out-'));
    const outDir = join(dir, 'out');
    const note = join(dir, 'note.md');
    const mirrored = join(outDir, 'note.md');
    await writeFile(note, '![[Evernote/Writings/_resources/a.png]]\n', 'utf8');
    await mkdir(outDir, { recursive: true });
    await writeFile(
      mirrored,
      '[[target.md|alias]]\n![[Evernote/Writings/_resources/a.png]]\n',
      'utf8',
    );
    try {
      const { streams, out } = makeStreams();
      const code = await runFixResources({ vaultRoot: dir, mode: 'out-dir', outDir }, streams);
      assert.equal(code, 0);
      const j = JSON.parse(out()) as { replacements: number };
      assert.equal(j.replacements, 1);
      const next = await readFile(mirrored, 'utf8');
      assert.match(next, /\[\[target\.md\|alias\]\]/);
      assert.match(next, /!\[\[_resources\/a\.png\]\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('in-place rewrites markdown under the vault', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fix-resources-'));
    const note = join(dir, 'note.md');
    const original = '![[Evernote/Writings/_resources/a.png]]\n';
    await writeFile(note, original, 'utf8');
    try {
      const { streams, out } = makeStreams();
      const code = await runFixResources({ vaultRoot: dir, mode: 'in-place' }, streams);
      assert.equal(code, 0);
      const j = JSON.parse(out()) as { wroteFiles: boolean; replacements: number };
      assert.equal(j.wroteFiles, true);
      assert.equal(j.replacements, 1);
      assert.equal(await readFile(note, 'utf8'), '![[_resources/a.png]]\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
