import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildVaultIndex,
  normalizeTitle,
  parseFrontmatterTitle,
  VaultIndexRootError,
} from './vaultIndex.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('normalizeTitle', () => {
  it('trims, lowercases, NFC, and collapses whitespace', () => {
    assert.equal(normalizeTitle('  Hello \t World  '), 'hello world');
    const nfdCoffee = `caf\u0065\u0301`; // e + combining acute
    assert.equal(normalizeTitle(nfdCoffee), normalizeTitle('caf\u00E9'));
  });
});

describe('parseFrontmatterTitle', () => {
  it('returns undefined when there is no frontmatter', () => {
    assert.equal(parseFrontmatterTitle('# Hi\n'), undefined);
  });

  it('reads title from a standard block', () => {
    assert.equal(parseFrontmatterTitle('---\ntitle: My Title\n---\n\n'), 'My Title');
  });

  it('strips optional quotes', () => {
    assert.equal(parseFrontmatterTitle("---\ntitle: 'X'\n---\n"), 'X');
    assert.equal(parseFrontmatterTitle('---\ntitle: "Y"\n---\n'), 'Y');
  });
});

describe('buildVaultIndex', () => {
  it('indexes a vault with unique normalized titles', async () => {
    const root = join(here, '__fixtures__', 'unique');
    const r = await buildVaultIndex(root);
    assert.equal(r.ok, true);
    if (!r.ok) {
      return;
    }
    assert.equal(r.byNormalizedTitle.get('first'), 'first.md');
    assert.equal(r.byNormalizedTitle.get('second note'), 'sub/second note.md');
    assert.equal(r.byNormalizedTitle.get('quoted title'), 'third.md');
  });

  it('fails with a sorted collision report when titles collide', async () => {
    const root = join(here, '__fixtures__', 'collision');
    const r = await buildVaultIndex(root);
    assert.equal(r.ok, false);
    if (r.ok) {
      return;
    }
    assert.deepEqual(r.collisions, [
      {
        normalizedTitle: 'shared',
        paths: ['a.md', 'b.md'],
      },
    ]);
  });

  it('rejects a missing vault root', async () => {
    const root = join(here, '__fixtures__', 'nonexistent-vault');
    await assert.rejects(
      () => buildVaultIndex(root),
      (e: unknown) => e instanceof VaultIndexRootError,
    );
  });
});

describe('buildVaultIndex temp dir', () => {
  it('skips .git and node_modules when walking', async () => {
    const root = join(here, '__fixtures__', 'temp-skip');
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, '.git', 'tracked.md'), '# x\n', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'readme.md'), '# x\n', 'utf8');
    await writeFile(join(root, 'visible.md'), '# Visible\n', 'utf8');

    try {
      const r = await buildVaultIndex(root);
      assert.equal(r.ok, true);
      if (!r.ok) {
        return;
      }
      assert.equal(r.entries.length, 1);
      assert.equal(r.entries[0]?.path, 'visible.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
