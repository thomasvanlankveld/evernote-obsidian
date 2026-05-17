import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  atomicReplaceFile,
  defaultAtomicReplaceFileDeps,
  inPlaceTempPath,
} from './atomicReplaceFile.ts';

describe('atomicReplaceFile', () => {
  it('inPlaceTempPath uses basename and pid beside the target', () => {
    assert.equal(
      inPlaceTempPath('/vault/sub/note.md', 42),
      '/vault/sub/.note.md.evernote-obsidian.42.tmp',
    );
  });

  it('replaces target content and leaves no temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-atomic-replace-'));
    const target = join(dir, 'note.md');
    await writeFile(target, 'original\n', 'utf8');
    try {
      await atomicReplaceFile(target, 'updated\n');
      assert.equal(await readFile(target, 'utf8'), 'updated\n');
      await assert.rejects(
        () => access(inPlaceTempPath(target, process.pid), constants.F_OK),
        (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('calls rename with temp then target on success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-atomic-rename-'));
    const target = join(dir, 'note.md');
    await writeFile(target, 'original\n', 'utf8');
    const pid = 99_001;
    const tempPath = inPlaceTempPath(target, pid);
    const renames: { from: string; to: string }[] = [];
    const deps = {
      ...defaultAtomicReplaceFileDeps(),
      pid,
      async rename(from: string, to: string) {
        renames.push({ from, to });
        return defaultAtomicReplaceFileDeps().rename(from, to);
      },
    };
    try {
      await atomicReplaceFile(target, 'updated\n', deps);
      assert.deepEqual(renames, [{ from: tempPath, to: target }]);
      assert.equal(await readFile(target, 'utf8'), 'updated\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves target unchanged and removes temp when rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eo-atomic-fail-'));
    const target = join(dir, 'note.md');
    await writeFile(target, 'original\n', 'utf8');
    const pid = 99_002;
    const tempPath = inPlaceTempPath(target, pid);
    const deps = {
      ...defaultAtomicReplaceFileDeps(),
      pid,
      async rename() {
        throw new Error('rename failed');
      },
    };
    try {
      await assert.rejects(() => atomicReplaceFile(target, 'updated\n', deps), /rename failed/);
      assert.equal(await readFile(target, 'utf8'), 'original\n');
      await assert.rejects(
        () => access(tempPath, constants.F_OK),
        (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
