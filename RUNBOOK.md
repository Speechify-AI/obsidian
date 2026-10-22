# RUNBOOK: Speechify for Obsidian

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## State

Version 0.1.7, released 2026-10-21: the model is `simba-3.5`, Speechify's
recommended one. Every voice on a key can read on it, in 48 languages, where
3.2 took English voices only; the eight `*_32` voices stay at the top of the
picker. Marks and latency were checked against the live API before the
move, below. Renders are keyed by model, so each note is rendered once more
on first replay.

Version 0.1.6, released 2026-10-19: tables are read, a row at a time, and
a click on a sentence while a note plays moves the playhead to it, in the
editor and in Reading view, with a setting to turn it off. A support
question on 2026-10-19 prompted both: a user's tables were not being read.

Version 0.1.5, released 2026-10-15: every request carries
`Speechify-Caller: obsidian` and the plugin's version, so the traffic shows
in Speechify's analytics. Workspaces that first called the API from an
earlier release are attributed to nothing and are not back-filled. 0.1.4 went out
on 2026-10-13: the voice picker's selected row keeps dark text under themes
that whiten it. 0.1.3 went out the same day with
voice avatars and a picker styled after Speechify's, 0.1.2 the same day with 10-second jumps
on the bar and Speechify's icons, 0.1.1 on 2026-10-03 with highlighting in Reading
view, and 0.1.0 on 2026-10-01, the day the repo at
<https://github.com/Speechify-AI/obsidian> went public. Listed in the
community directory at <https://community.obsidian.md/plugins/speechify>;
329 installs on 2026-10-22. The directory serves each release from its
GitHub tag, which must equal the manifest version, no `v`, with `main.js`,
`manifest.json` and `styles.css` attached.

| Thing | Value |
| --- | --- |
| Plugin id | `speechify` |
| Model | `simba-3.5`, fixed in `src/main.ts`; 3.2 until 2026-10-21 |
| Default voice | `harper_32` |
| Minimum Obsidian | 1.11.4, for SecretStorage |
| Platforms | Desktop only (`isDesktopOnly: true`) until mobile is tested |
| Author in the manifest | Speechify AI, `https://speechify.ai` with listing UTM tags |
| Integration slug | `obsidian`, in `src/speechify.ts`, never changes |
| Render cache | IndexedDB database `speechify-renders`, 400 MB cap |

## Verified on 2026-10-01

Unit tests: 84 passing across speakable, marks, seek, render, speechify,
text, rate and align.

Against the live API (simba-3.2, harper_32, a Speechify test workspace):

- Mark offsets are code points. Accents, curly quotes and CJK slice
  correctly; after one emoji every mark was one character early, and
  `billable_characters_count` equalled the code point count. The emoji got no
  mark of its own.
- /v1/audio/speech latency by input size: 70 characters 2.1 s, 300
  characters 4.1 s, 600 characters 6.6 s, 1,200 characters 10.9 s, 1,900
  characters 16.9 s. One run each.
- 125 voices list simba-3.2 on that key, eight of them `*_32`, all with a
  sample URL, none cloned. A stock voice carries about twenty tags in
  lowercase `category:value` form.

In Obsidian 1.13.7 on macOS, in a throwaway instance:

- Play from the top: first audio at 1.4 s uncached, 70 ms cached. Word and
  sentence highlights follow through bold, italic, links, wikilink aliases,
  inline code, list items and a task item.
- The emoji paragraph highlights the right words after the emoji.
- Pause holds the highlight. Next and previous sentence work inside a
  passage and across passages.
- A line inserted above the playhead during playback: the highlight stayed
  on the spoken words and the next passages were found correctly.
- The paragraph being read deleted mid-playback: the next paragraph was
  read, not skipped. Going back after an edit landed on the last sentence
  of the passage before.
- Pause pressed in the gap between two passages held; the passage on its
  way did not start.
- A selection is read to its end and then playback stops with no
  decorations left.
- Listen from cursor starts at the sentence holding the cursor.
- Voice picker: 125 rows, a sample click does not choose, "male british"
  finds 18 voices and no female ones (nine before the language name became
  searchable: the other nine are en-GB with no accent tag), choosing a voice
  repeats the current sentence in it.
- The play button, the picker and both highlights use Speechify's blue in
  the default light and dark themes. No community theme was tried.
- Speed menu and the speed commands change and save the rate.
- Reading view plays. A second tab does not interrupt playback. Opening
  another file in the same tab stops it.
- A refused key and a missing key each show a notice and leave the player
  paused.
- Disabling the plugin removes the bar, the header buttons and the
  decorations.

A Codex review of the first build found five defects, all confirmed and
fixed the same day: a skipped passage after deleting the one being read, a
pause between passages being overridden, the cache cap only applied at
startup, and tables without outer pipes and indented code being read aloud.

Obsidian's review lint (`eslint-plugin-obsidianmd`, recommended config) on
`src/`, tests excluded: 0 errors, 9 warnings. Run in a scratch copy with
TypeScript 5.9, because typescript-eslint cannot load TypeScript 7. The
warnings: CodeMirror imports not in `package.json` (Obsidian supplies them),
three sentence-case checks of which two want "Speechify" in lowercase, the
settings tab not using `getSettingDefinitions()`, and a bare `setTimeout` in
`src/speechify.ts`, which the tests load without a `window`.

## Verified on 2026-10-19: tables and click to listen

In Obsidian 1.14.4 on macOS, in a throwaway instance, against the stub
backend with a word every 500 ms, on a note with a two-column table between
two paragraphs.

- Unit tests: 94 passing. The source map holds through a table: a pipe
  between cells maps to itself as a space, an escaped pipe is read as a pipe,
  a bare URL or a backtick in a cell reaches no further than the cell.
- The table was requested as "Name Value", "Alpha Beta", "Gamma Delta",
  one passage a row, the delimiter row never. In Source mode the sentence
  highlight covers the row. In Reading view it covers the cells of the row
  across the cell boundary. In Live Preview the table is a widget and shows
  no highlight, as with callouts.
- Clicks during playback, sent as real mouse events: in Source mode a click
  on a word moved the playhead to its sentence, a click on a table row to
  that row, a click back on the first sentence to it, and the cursor moved
  with each. The same in Live Preview. In Reading view the same three,
  painted through the CSS highlights.
- A click inside Live Preview's table widget lands on the row clicked, header
  included: `posAtCoords` inside the widget gives the position after the
  table, so the row's index is mapped to its line instead. This leans on
  Obsidian's `.cm-table-widget` class; if that goes, the click falls back to
  the paragraph after the table.
- Paused, a click moved nothing and playback stayed paused. A drag that
  selected text, in the editor and in Reading view, selected it and moved
  nothing.
- With two paragraphs typed above the playhead during playback, a click on
  the last sentence landed on it, and a click on one of the new paragraphs
  played it.
- Switching between Live Preview and Reading view during playback did not
  stop it.
- Not checked: a click on a link or a checkbox (ignored by selector), a
  table inside a callout, a right-to-left table, the setting switched off
  (it is read on every click and nothing else), a real Speechify voice
  reading a row.

A Codex review of the first build found two defects, both confirmed and
fixed the same day: a bare URL in a cell with no spaces around its pipes
swallowed the rest of the row, and a click after an edit that landed
nowhere replaced the passages and reset edit tracking while the old audio
played on.

## Verified on 2026-10-13: the voice picker

In Obsidian 1.14.4, in a throwaway instance, with a made-up catalogue and
drawn pictures in place of Speechify's.

- Each row shows the catalogue's `avatar_image` in a circle, or the voice's
  initial when there is none or it fails to load (an unreachable URL was
  tried). Play shows on the row under the pointer or keyboard, stop while a
  sample plays. A voice with no sample keeps a plain avatar.
- The selected row is grey with normal text in light and dark, not the
  theme's accent. Also under Glassive 1.1.15, which redefines
  `--text-normal` and `--text-muted` on the selected row for white on its
  accent: the picker takes its colours on the modal, so they hold.
- Not checked: what `avatar_image` holds for real voices. The docs say it
  is an optional string.

## Verified on 2026-10-13: 10-second jumps

In Obsidian 1.14.4 on macOS, in a throwaway instance, against the stub
below with a word every 500 ms, so passages ran about 18 s.

- Back and forward 10 s land within a passage, carry into the next passage,
  and land that far before the end of the previous one. Back from the first
  passage goes to its start. A jump while paused stays paused.
- After a paragraph was typed above the playhead, a jump across passages
  landed in the right passage at its new position.
- The Next sentence command still skips by sentence.
- The bar's icons follow the theme in light and dark. The play button is
  round: Obsidian 1.14 gives buttons a superellipse corner, which the bar
  overrides with `corner-shape: round`.
- Not checked: a cleared API key in settings, now saved as `""` where the
  1.14 types say `null` can arrive. Jumps against real Speechify audio.

## Verified on 2026-10-02: highlighting in Reading view

In Obsidian 1.13.7 on macOS, in a throwaway instance with no API key. The
speech API was replaced by a stub that returns silent audio and made-up word
marks, so the timings are not Speechify's.

- Play from the top in Reading view: the sentence and word highlights follow
  through a heading, bold, italic, a link, a wikilink alias, inline code, an
  emoji, list items, a task item and a callout title and body.
- A bare URL, a tag, a link to a heading and `&amp;` in the note: the words
  around them are found. The sentence highlight stops at "Note" for a link
  shown as "Note > Heading".
- An embedded note is stepped over and the line after it highlights.
- In a 400-paragraph note, skipping forward 90 sentences kept the spoken
  sentence on screen. A section Obsidian had not rendered was scrolled to and
  highlighted on the next word. After scrolling away by hand the view stayed
  put.
- Pause holds the highlight. Next sentence works while paused. Switching to
  the editor and back while paused shows the highlight in each. Stop and
  disabling the plugin leave no highlight registered.

## Verified on 2026-10-21: simba-3.5

Against the live API, with the key of a Speechify workspace, before the
model moved from `simba-3.2`:

- `GET /v1/audio/models` lists `simba-3.5` as recommended, 48 languages,
  not English-only, on /speech, /stream and /stream/with-timestamps.
  `simba-3.0` is still the default when `model` is omitted. `simba-english`
  and `simba-multilingual` are retired, sunset 2026-11-21.
- Every one of the 1,106 voices on the key lists `simba-3.5`, against 125
  for 3.2, so the picker offers nine times as many rows, 981 of them in
  languages other than English. The eight `*_32` voices all list 3.5 and no
  `*_35` voice exists, so they stay the roster. The picker shows 200 rows
  at most, which is why the roster and the search matter.
- Marks on 3.5 have the same shape as on 3.2 and count code points: in a
  32-code-point sentence with an accent, an emoji and curly quotes, every
  offset matched by code point and the ones after the emoji were one short
  by UTF-16 unit. `billable_characters_count` was the code point count. The
  emoji again got no mark.
- Latency for that sentence: 1.16 s on 3.5, 1.12 s on 3.2, one run each.
- A Hindi voice (`aadi`, hi-IN) read a Hindi and English line on 3.5 with
  no `language` sent, with a mark per word. The same voice on 3.2 is a 400,
  "supports English voices only".
- The request body is unchanged: `language` is not sent, so 3.5 routes by
  the voice's locale. Unit tests: 94 passing.

In Obsidian 1.14.4, in the throwaway instance, with the same key:

- The picker opened 612 ms after the command, fetch and first paint
  together, with 1,106 voices in 51 locales. It shows 200 rows; the eight
  roster voices come first, then the rest A to Z, Telugu and Hindi voices
  from row nine. Every locale had a name from `Intl.DisplayNames`.
- Searches: "hindi" 42 voices, "french" 53, "male british" 18 (as on
  2026-10-01), "harper" 2 (an American and a British one), nonsense none.
- Choosing Aadi (Hindi) and playing the English test note: first word
  highlight at 1.5 s, sentence and word highlights in place, the bar
  naming the voice, nothing left after stop.

Not tried: a cloned voice, and `language` for a note whose language is
not the voice's.

## Not verified

- Mobile, at all.
- Popout windows. The bar is added to the main window's body. Reading view
  highlights use the popout's own registry, untried.
- Reading view against the live API, and in a community theme.
- Cloned voices. The test key has none.
- The cache's 400 MB prune. It runs at startup and after every 20 MB
  written, and has never been run against a full cache.
- Languages other than English in Obsidian, and right-to-left text. One
  Hindi line rendered with word marks on the API alone.

## Open

- Phase 2: a play button per paragraph, lock-screen controls.
- Reading view: no "listen from here", so it starts from the top. A footnote
  definition is read but not highlighted, because Obsidian renders it in a
  footnotes section that reports the note's last line as its source.
- Callouts and tables in Live Preview are read but not highlighted, because
  Live Preview draws them as widgets.
- A table row is spoken as its cells run together, "Alpha Beta", with
  nothing to say which column a cell is in. Saying the header before each
  cell would speak words that are not at that place in the note; it needs a
  source map that can repeat a range before it can be considered.
- Time to first audio is one to three seconds. The streaming endpoint with
  timestamps would cut it, and needs a streaming HTTP path that
  `requestUrl` does not offer.
- Mobile: test on a phone, then set `isDesktopOnly` back to `false`. No
  code needs desktop.
- Readback and Soundbites share the code point bug: neither converts mark
  offsets, so an emoji shifts their highlights too.

## Testing in a throwaway Obsidian

Nothing here touches a real vault or the real profile. A second Obsidian
runs from its own user-data directory with remote debugging on.

```sh
P=/tmp/obsidian-test-profile
mkdir -p "$P"
# Without this the instance runs the installer's old version, which has no SecretStorage.
cp "$HOME/Library/Application Support/obsidian/"obsidian-*.asar "$P/"
echo '{"vaults":{"de7c0de7c0de7c0d":{"path":"'"$PWD"'/dev-vault","ts":1790000000000,"open":true}}}' > "$P/obsidian.json"
open -g -n -a /Applications/Obsidian.app --args --user-data-dir="$P" --remote-debugging-port=9333 --mute-audio
```

`dev-vault/` is gitignored. It needs `.obsidian/community-plugins.json`
holding `["speechify"]` and `.obsidian/plugins/speechify/` with links to
`main.js`, `manifest.json` and `styles.css`. Drop `--mute-audio` to listen.

Drive it over the DevTools protocol at `http://127.0.0.1:9333/json`. Things
that cost time the first time:

- Set the key with `app.secretStorage.setSecret(name, key)` and
  `plugin.settings.keySecret = name`.
- Settings is a separate window with its own page target.
- A modal opens in whichever window Obsidian thinks is active. Send
  `Emulation.setFocusEmulationEnabled` to the main page first or a modal
  opened from a script will not appear there.
- macOS uses native menus by default and they are not in the DOM. Run
  `app.vault.setConfig("nativeMenus", false)` to see the speed menu.
- Reload after a build with `app.plugins.disablePlugin("speechify")` then
  `enablePlugin`.
- `/tmp` is emptied between days. A new profile opens the vault in Restricted
  Mode behind a "Trust author" dialog, and has no API key and no cache.
- Without a key, assign `plugin.config` a function returning a `TtsConfig`
  whose `http` answers with a silent WAV in `audio_data` and one word mark
  per word. Playback and highlighting then run with no request to Speechify.
- A top-level `const` in one `Runtime.evaluate` stays declared for the next
  one and makes it throw. Wrap each expression in an IIFE.
- Real clicks go through `Input.dispatchMouseEvent` (pressed then released,
  `button: "left"`, `clickCount: 1`) at the coordinates `coordsAtPos` or a
  text node's `Range.getBoundingClientRect()` gives. A `click()` on an
  element has no coordinates and finds no position.
- Node 22 and later has `WebSocket` built in, so a CDP driver is one short
  `.mjs` file: fetch `/json`, open the page's `webSocketDebuggerUrl`, send
  `{id, method, params}`.
