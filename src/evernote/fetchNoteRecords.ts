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
  /**
   * Stop after this many notes (newest first). Useful for dry runs against production.
   * When set, fewer than `totalNotesFromApi` rows may appear in `records`.
   */
  maxRecords?: number | undefined;
}

export interface FetchNoteRecordsResult {
  records: NoteRecord[];
  clientOpts: EvernoteClientOptionsFromHost;
  /**
   * `findNotesMetadata.totalNotes` from the first response when Evernote sends it.
   * Compare to `records.length` for sanity (see CLI warning when they differ without `maxRecords`).
   */
  totalNotesFromApi?: number | undefined;
  /** True when `maxRecords` capped how many rows were kept. */
  truncated: boolean;
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

/**
 * Convert Evernote note `updated` (epoch ms) to ISO UTC, or throw if unusable.
 * Public for unit tests and to avoid silent 1970-01-01 rows in snapshots.
 */
export function evernoteUpdatedMsToIso(updated: unknown, guid: string): string {
  if (typeof updated !== 'number' || !Number.isFinite(updated)) {
    throw new Error(
      `Evernote metadata missing a finite updated time for guid=${guid}; refusing to write a misleading snapshot.`,
    );
  }
  return new Date(updated).toISOString();
}

/**
 * Load all accessible note metadata (GUID, title, updated) via Evernote NoteStore.
 * Uses the official `evernote` npm package (Thrift). Requires network.
 */
export async function fetchAllNoteRecords(
  opts: FetchNoteRecordsOptions,
): Promise<FetchNoteRecordsResult> {
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
  const maxCap =
    opts.maxRecords !== undefined && opts.maxRecords > 0 ? Math.floor(opts.maxRecords) : undefined;

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
  let records: NoteRecord[] = [];
  let offset = 0;
  let totalNotesFromApi: number | undefined;
  let truncated = false;

  for (;;) {
    const page = await noteStore.findNotesMetadata(filter, offset, pageSize, spec);
    if (totalNotesFromApi === undefined) {
      const t = page.totalNotes;
      if (typeof t === 'number' && Number.isFinite(t)) {
        totalNotesFromApi = t;
      }
    }
    const batch = page.notes ?? [];
    let stopPaging = false;

    for (const meta of batch) {
      if (!meta || typeof meta !== 'object') {
        continue;
      }
      const m = meta as { guid?: unknown; title?: unknown; updated?: unknown };
      const guid = typeof m.guid === 'string' ? m.guid : '';
      const title = typeof m.title === 'string' ? m.title : '';
      if (!guid) {
        continue;
      }
      records.push({ guid, title, updated: evernoteUpdatedMsToIso(m.updated, guid) });
      if (maxCap !== undefined && records.length >= maxCap) {
        records = records.slice(0, maxCap);
        truncated = true;
        stopPaging = true;
        break;
      }
    }

    if (stopPaging) {
      break;
    }
    if (batch.length < pageSize) {
      break;
    }
    offset += batch.length;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  return { records, clientOpts, totalNotesFromApi, truncated };
}
