import evernoteImport from 'evernote';
import {
  type EvernoteClientOptionsFromHost,
  evernoteClientOptionsFromHost,
} from './evernoteHost.ts';
import type { NoteRecord } from './noteRecord.ts';

export interface FetchNoteRecordsOptions {
  token: string;
  /** Raw EVERNOTE_HOST value (optional; defaults production www). */
  hostEnv?: string | undefined;
  /** Notes per findNotesMetadata page (Evernote caps this; default 250). */
  pageSize?: number | undefined;
  /** Optional pause between pages to reduce rate-limit pressure. */
  sleepBetweenPagesMs?: number | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface EvernoteSdkRoot {
  Client: new (o: {
    token: string;
    sandbox?: boolean;
    china?: boolean;
    serviceHost?: string;
  }) => {
    getNoteStore: () => {
      findNotesMetadata: (
        filter: unknown,
        offset: number,
        maxNotes: number,
        spec: unknown,
      ) => Promise<{ notes?: unknown[]; totalNotes?: number }>;
    };
  };
  NoteStore: {
    NoteFilter: new (o: Record<string, unknown>) => unknown;
    NotesMetadataResultSpec: new (o: Record<string, unknown>) => unknown;
  };
  Types: { NoteSortOrder: { UPDATED: number } };
}

function coerceEvernoteRoot(mod: unknown): EvernoteSdkRoot {
  const m = mod as { default?: unknown };
  return (m.default ?? mod) as EvernoteSdkRoot;
}

function updatedToIso(ms: unknown): string {
  if (typeof ms === 'number' && Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Load all accessible note metadata (GUID, title, updated) via Evernote NoteStore.
 * Uses the official `evernote` npm package (Thrift). Requires network.
 */
export async function fetchAllNoteRecords(
  opts: FetchNoteRecordsOptions,
): Promise<{ records: NoteRecord[]; clientOpts: EvernoteClientOptionsFromHost }> {
  const EN = coerceEvernoteRoot(evernoteImport);

  const clientOpts = evernoteClientOptionsFromHost(opts.hostEnv);
  const client = new EN.Client({
    token: opts.token,
    sandbox: clientOpts.sandbox,
    china: clientOpts.china,
    serviceHost: clientOpts.serviceHost,
  });

  const pageSize = Math.min(250, Math.max(1, opts.pageSize ?? 250));
  const sleepMs = Math.max(0, opts.sleepBetweenPagesMs ?? 0);

  const filter = new EN.NoteStore.NoteFilter({
    order: EN.Types.NoteSortOrder.UPDATED,
    ascending: false,
    includeAllReadableNotebooks: true,
  });

  const spec = new EN.NoteStore.NotesMetadataResultSpec({
    includeTitle: true,
    includeUpdated: true,
    includeCreated: false,
    includeDeleted: false,
    includeContentLength: false,
    includeUpdateSequenceNum: false,
    includeNotebookGuid: false,
    includeTagGuids: false,
    includeAttributes: false,
    includeLargestResourceMime: false,
    includeLargestResourceSize: false,
  });

  const noteStore = client.getNoteStore();
  const records: NoteRecord[] = [];
  let offset = 0;

  for (;;) {
    const page = await noteStore.findNotesMetadata(filter, offset, pageSize, spec);
    const batch = page.notes ?? [];
    for (const meta of batch) {
      if (!meta || typeof meta !== 'object') {
        continue;
      }
      const m = meta as { guid?: unknown; title?: unknown; updated?: unknown };
      const guid = typeof m.guid === 'string' ? m.guid : '';
      const title = typeof m.title === 'string' ? m.title : '';
      if (guid) {
        records.push({ guid, title, updated: updatedToIso(m.updated) });
      }
    }
    if (batch.length < pageSize) {
      break;
    }
    offset += batch.length;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  return { records, clientOpts };
}
