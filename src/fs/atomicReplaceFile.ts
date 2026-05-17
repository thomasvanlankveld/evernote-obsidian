import { open, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface AtomicReplaceFileDeps {
  writeFile: typeof writeFile;
  open: typeof open;
  rename: typeof rename;
  unlink: typeof unlink;
  pid: number;
}

export function defaultAtomicReplaceFileDeps(): AtomicReplaceFileDeps {
  return { writeFile, open, rename, unlink, pid: process.pid };
}

/** Temp path beside `targetPath` for atomic in-place replacement. */
export function inPlaceTempPath(targetPath: string, pid: number): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  return join(dir, `.${base}.evernote-obsidian.${pid}.tmp`);
}

async function unlinkIgnoringEnoent(path: string, unlinkFn: typeof unlink): Promise<void> {
  try {
    await unlinkFn(path);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return;
    }
    throw e;
  }
}

/**
 * Replace `targetPath` atomically: write a same-directory temp file, fsync, rename.
 * On failure before rename, the original target is left unchanged and the temp is removed.
 */
export async function atomicReplaceFile(
  targetPath: string,
  content: string,
  deps: AtomicReplaceFileDeps = defaultAtomicReplaceFileDeps(),
): Promise<void> {
  const tempPath = inPlaceTempPath(targetPath, deps.pid);
  try {
    await deps.writeFile(tempPath, content, 'utf8');
    const handle = await deps.open(tempPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await deps.rename(tempPath, targetPath);
  } catch (e) {
    await unlinkIgnoringEnoent(tempPath, deps.unlink);
    throw e;
  }
}
