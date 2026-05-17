import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVaultMarkdownFile } from './readVaultMarkdownFile.ts';

describe('readVaultMarkdownFile', () => {
  it('prefers overlay mirror when present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eo-read-overlay-'));
    const overlay = join(root, 'mirror');
    const vaultAbs = join(root, 'note.md');
    try {
      await writeFile(vaultAbs, 'from vault', 'utf8');
      await mkdir(overlay, { recursive: true });
      await writeFile(join(overlay, 'note.md'), 'from overlay', 'utf8');
      const text = await readVaultMarkdownFile(vaultAbs, root, { overlayRoot: overlay });
      assert.equal(text, 'from overlay');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to vault file when overlay is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eo-read-fallback-'));
    const vaultAbs = join(root, 'note.md');
    try {
      await writeFile(vaultAbs, 'from vault', 'utf8');
      const text = await readVaultMarkdownFile(vaultAbs, root, {
        overlayRoot: join(root, 'empty-mirror'),
      });
      assert.equal(text, 'from vault');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
