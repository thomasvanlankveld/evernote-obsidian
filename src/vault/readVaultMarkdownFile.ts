import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Read vault Markdown, optionally preferring a mirrored path under `overlayRoot`
 * (used when `run` chains unescape-links → rewrite with `--out-dir`).
 */
export async function readVaultMarkdownFile(
  vaultAbs: string,
  vaultRoot: string,
  options?: { overlayRoot?: string | undefined },
): Promise<string> {
  const overlayRoot = options?.overlayRoot;
  if (overlayRoot === undefined || overlayRoot === '') {
    return readFile(vaultAbs, 'utf8');
  }
  const rel = relative(vaultRoot, vaultAbs).split('\\').join('/');
  const overlayPath = join(overlayRoot, rel);
  try {
    return await readFile(overlayPath, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return readFile(vaultAbs, 'utf8');
    }
    throw e;
  }
}
