/**
 * Finished renders, kept in IndexedDB.
 *
 * On this device and not in the vault: audio in the vault would sync to
 * every device and grow it by megabytes a note. IndexedDB belongs to the app,
 * so one cache serves every vault opened here, and a passage heard in one is
 * a hit in another.
 *
 * A cache must never be the reason playback fails. Every failure here reads
 * as a miss or a write that did not happen.
 */
import type { Mark } from "./marks.ts";
import type { RenderCache, Rendered } from "./render.ts";

const DATABASE = "speechify-renders";
const STORE = "renders";
const BY_USE = "usedAt";

/** Oldest renders are dropped past this. About seven hours of speech. */
export const CACHE_LIMIT_BYTES = 400 * 1024 * 1024;
/** Prune again after this much new audio, so the cap holds while the app stays open. */
const PRUNE_EVERY_BYTES = 20 * 1024 * 1024;

interface Row {
  key: string;
  audio: Uint8Array;
  marks: Mark[];
  usedAt: number;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex(BY_USE, BY_USE);
  };
  return settled(request);
}

export interface PersistentCache extends RenderCache {
  /** Drop the least recently heard renders until the cache fits `limitBytes`. */
  prune(limitBytes?: number): Promise<void>;
}

export function indexedDbCache(factory: IDBFactory): PersistentCache {
  let database: Promise<IDBDatabase> | null = null;
  let writtenSincePrune = 0;
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    database ??= open(factory);
    return (await database).transaction(STORE, mode).objectStore(STORE);
  };

  const cache: PersistentCache = {
    async get(key) {
      try {
        const renders = await store("readwrite");
        const row = (await settled(renders.get(key))) as Row | undefined;
        if (!row) return null;
        renders.put({ ...row, usedAt: Date.now() });
        return { audio: row.audio, marks: row.marks };
      } catch {
        return null;
      }
    },

    async put(key, rendered: Rendered) {
      try {
        const row: Row = { key, audio: rendered.audio, marks: rendered.marks, usedAt: Date.now() };
        await settled((await store("readwrite")).put(row));
        writtenSincePrune += rendered.audio.byteLength;
        if (writtenSincePrune > PRUNE_EVERY_BYTES) void cache.prune();
      } catch {
        // Not cached; the passage is simply rendered again next time.
      }
    },

    async prune(limitBytes = CACHE_LIMIT_BYTES) {
      writtenSincePrune = 0;
      try {
        const renders = await store("readwrite");
        let kept = 0;
        await new Promise<void>((resolve, reject) => {
          const walk = renders.index(BY_USE).openCursor(null, "prev");
          walk.onerror = () => reject(walk.error ?? new Error("IndexedDB cursor failed"));
          walk.onsuccess = () => {
            const cursor = walk.result;
            if (!cursor) return resolve();
            const row = cursor.value as Row;
            kept += row.audio.byteLength;
            if (kept > limitBytes) cursor.delete();
            cursor.continue();
          };
        });
      } catch {
        // Pruning is housekeeping; try again next launch.
      }
    },
  };
  return cache;
}
