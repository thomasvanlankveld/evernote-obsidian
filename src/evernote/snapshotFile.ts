import { readFile, writeFile } from 'node:fs/promises';
import type { EvernoteNoteSnapshot, NoteRecord } from './noteRecord.ts';

export function buildSnapshotEnvelope(host: string, notes: NoteRecord[]): EvernoteNoteSnapshot {
  return {
    version: 1,
    writtenAt: new Date().toISOString(),
    host,
    notes,
  };
}

export function parseSnapshotJson(raw: string): EvernoteNoteSnapshot {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('snapshot: root must be an object');
  }
  const o = parsed as Record<string, unknown>;
  if (o.version !== 1) {
    throw new Error('snapshot: unsupported or missing version (expected 1)');
  }
  if (typeof o.host !== 'string' || o.host === '') {
    throw new Error('snapshot: missing host');
  }
  if (!Array.isArray(o.notes)) {
    throw new Error('snapshot: notes must be an array');
  }
  const notes: NoteRecord[] = [];
  for (const n of o.notes) {
    if (!n || typeof n !== 'object') {
      throw new Error('snapshot: each note must be an object');
    }
    const r = n as Record<string, unknown>;
    if (
      typeof r.guid !== 'string' ||
      typeof r.title !== 'string' ||
      typeof r.updated !== 'string'
    ) {
      throw new Error('snapshot: each note needs guid, title, updated (string)');
    }
    notes.push({ guid: r.guid, title: r.title, updated: r.updated });
  }
  return {
    version: 1,
    writtenAt: typeof o.writtenAt === 'string' ? o.writtenAt : '',
    host: o.host,
    notes,
  };
}

export async function readSnapshotFile(path: string): Promise<EvernoteNoteSnapshot> {
  const raw = await readFile(path, 'utf8');
  return parseSnapshotJson(raw);
}

export async function writeSnapshotFile(
  path: string,
  snapshot: EvernoteNoteSnapshot,
): Promise<void> {
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(path, body, 'utf8');
}
