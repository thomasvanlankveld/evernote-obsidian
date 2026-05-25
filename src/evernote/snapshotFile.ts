import { readFile, writeFile } from 'node:fs/promises';
import {
  type EvernoteNoteSnapshot,
  type NoteRecord,
  type NoteRecordNotebook,
  normalizeEvernoteGuid,
} from './noteRecord.ts';

export function buildSnapshotEnvelope(host: string, notes: NoteRecord[]): EvernoteNoteSnapshot {
  return {
    version: 1,
    writtenAt: new Date().toISOString(),
    host,
    notes: notes.map((n) => ({ ...n, guid: normalizeEvernoteGuid(n.guid) })),
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
    notes.push({
      guid: normalizeEvernoteGuid(r.guid),
      title: r.title,
      updated: r.updated,
      ...parseOptionalNotebook(r.notebook),
    });
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

function parseOptionalNotebook(value: unknown): { notebook?: NoteRecordNotebook | undefined } {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object') {
    throw new Error('snapshot: note notebook must be an object when present');
  }
  const notebook = value as Record<string, unknown>;
  if (typeof notebook.name !== 'string' || notebook.name.trim() === '') {
    throw new Error('snapshot: note notebook needs name (string)');
  }
  if (notebook.stack !== undefined && typeof notebook.stack !== 'string') {
    throw new Error('snapshot: note notebook stack must be a string when present');
  }
  return {
    notebook: {
      name: notebook.name,
      ...(typeof notebook.stack === 'string' && notebook.stack.trim() !== ''
        ? { stack: notebook.stack }
        : {}),
    },
  };
}
