import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/** Reads `version` from the repo `package.json` (two levels above this file: `src/cli/` or `dist/cli/`). */
export function readCliPackageVersion(): string {
  if (cached !== undefined) {
    return cached;
  }
  const pkgDir = dirname(fileURLToPath(import.meta.url));
  const root = join(pkgDir, '..', '..');
  const raw = readFileSync(join(root, 'package.json'), 'utf8');
  const j = JSON.parse(raw) as { version?: string };
  cached = typeof j.version === 'string' ? j.version : '0.0.0';
  return cached;
}
