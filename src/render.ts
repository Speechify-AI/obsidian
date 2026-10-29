/**
 * Turning one passage into audio plus marks, once.
 *
 * Text is the source of truth and audio is a cache over it. A render is
 * keyed by the hash of the passage text plus the voice, model and language
 * that produced it, so replaying a note never bills twice, editing one
 * paragraph leaves its neighbours' audio alone, and switching voice
 * re-renders rather than serving the wrong narrator.
 */
import { fillGaps, type Mark } from "./marks.ts";
import { synthesize, type TtsConfig, type TtsResult } from "./speechify.ts";

export interface Rendered {
  /** A complete MP3. */
  audio: Uint8Array;
  /** Word marks over the passage text, gaps closed. */
  marks: Mark[];
}

/** Where finished renders live. `cache.ts` implements it over IndexedDB. */
export interface RenderCache {
  get(key: string): Promise<Rendered | null>;
  put(key: string, rendered: Rendered): Promise<void>;
}

export type Synth = (input: string, cfg: TtsConfig) => Promise<TtsResult>;

/** A render with no language keeps the key it had before languages were sent, so nothing already cached is rendered again. */
export async function renderKey(text: string, voiceId: string, model: string, language?: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return language === undefined ? `${model}/${voiceId}/${hash}` : `${model}/${voiceId}/${language}/${hash}`;
}

export async function renderPassage(
  text: string,
  cfg: TtsConfig,
  cache: RenderCache,
  synth: Synth = synthesize,
): Promise<Rendered> {
  const key = await renderKey(text, cfg.voiceId, cfg.model, cfg.language);
  const cached = await cache.get(key);
  if (cached) return cached;

  const result = await synth(text, cfg);
  const rendered: Rendered = { audio: result.audio, marks: fillGaps(result.marks, text) };
  await cache.put(key, rendered);
  return rendered;
}

/** A cache that only lasts as long as the app is open. The fallback when IndexedDB is not usable. */
export function memoryCache(): RenderCache {
  const store = new Map<string, Rendered>();
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, rendered) => {
      store.set(key, rendered);
    },
  };
}
