# CLAUDE.md: Speechify for Obsidian conventions

**Start here: read `RUNBOOK.md`** for what has been verified, what is open,
and how to test in a real Obsidian without touching anyone's vault. This file
is the rules; the runbook is the state.

An Obsidian plugin that reads a note aloud in a Speechify voice on simba-3.2
and highlights the spoken sentence and word in the editor. Official Speechify
plugin, in its own repo, depending on nothing outside it. The speech modules
came from Readback (<https://github.com/Speechify-AI/readback>) as copies.

## Invariants, never weaken

- **Every spoken character is a character of the note.** `toPassages`
  returns each passage's text plus `map`, the note offset of every character
  in it. Nothing is ever inserted, so `map` is strictly increasing and any
  spoken range has a note range. A feature that wants to speak words that are
  not in the note (say "link" for a bare URL) breaks this; skip the text
  instead.
- **Highlighting is anchored on character offsets, never token positions,
  and gaps are absorbed forward.** `src/marks.ts` is Readback's, evidence and
  all.
- **The API counts mark offsets in code points; the editor counts UTF-16
  units.** `toCodeUnits` converts. Without it one emoji shifts every later
  highlight in the passage by a character. Measured 2026-10-01; the test
  holds the live case.
- **`/v1/audio/speech`, not a stream.** Only speech and
  stream/with-timestamps return marks, and the latter is server-sent events,
  which Obsidian's `requestUrl` cannot stream.
- **Passages are short, 200 characters at most, cut at sentence ends.**
  /speech answers only when the whole clip is made, about 1.5 s plus 8 ms a
  character. The passage size is the wait after pressing play. Raising
  `PASSAGE_LIMIT` makes the start slower; the numbers are in
  `src/speakable.ts`.
- **Text is the truth, audio is a cache over it.** A render is keyed by
  `sha256(text)`, voice and model. Replaying never bills, and switching voice
  re-renders instead of serving the wrong narrator.
- **A render under way is never abandoned.** Dropping the connection does
  not cancel a /speech request and it is billed either way, so it finishes
  and lands in the cache. For the same reason the look-ahead stays small.
- **The cache lives in IndexedDB, never in the vault.** Audio in the vault
  would sync to every device.
- **The API key lives in Obsidian's SecretStorage.** `data.json` holds the
  secret's name only, because that file is in the vault and syncs. The key is
  never logged or shown.
- **Requests go through `requestUrl`.** No `fetch`, no Node modules. That is
  what keeps the plugin loadable on mobile.
- **CodeMirror is external in the bundle.** Obsidian supplies it. A bundled
  second copy would make the editor reject the highlight field.
- **The player reads the note once and maps through edits.** Ranges the
  player holds are offsets into the note as it was read. `highlight.ts`
  composes every change since, and a range is mapped through that before it
  is painted. At each passage boundary a changed note is read again.
- **Unload leaves nothing behind.** The bar, the header buttons, the
  decorations and the audio all go in `onunload` and `stop`.

## Structure

- `src/main.ts`: the plugin: commands, ribbon and header buttons, editor
  menu, settings host
- `src/player.ts`: playback, look-ahead, the highlight loop, following
  edits
- `src/speakable.ts`: markdown to passages with a source map (tested)
- `src/highlight.ts`: the CodeMirror field: two mark decorations and the
  edit tracking
- `src/seek.ts`: where a sentence skip lands (tested)
- `src/render.ts`: one passage to audio and marks, through the cache
  (tested)
- `src/cache.ts`: the IndexedDB render cache
- `src/speechify.ts`: the /v1/audio/speech client and the voice catalogue
  (tested)
- `src/marks.ts`: speech marks to a highlight model (tested, copied)
- `src/text.ts`: `chunkRanges` (tested, copied)
- `src/rate.ts`: playback speed limits and label (tested)
- `src/bar.ts`, `src/voices.ts`, `src/settings.ts`: the player bar, the
  voice picker, the settings tab
- `styles.css`: highlight colours, the bar and the voice picker. Speechify's
  blue is set at the top; everything else is on Obsidian's theme variables

Files that import `obsidian` cannot be loaded by the test runner, since the
package ships types only. Keep logic worth testing in files that do not
import it.

## Commands

- `npm run typecheck` / `npm test` / `npm run build`
- `npm run dev`: rebuild on change
