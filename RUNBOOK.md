# RUNBOOK: Speechify for Obsidian

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## State

Version 0.1.1, released 2026-10-03 with highlighting in Reading view. 0.1.0
went out on 2026-10-01, the day the repo at
<https://github.com/Speechify-AI/obsidian> went public. Not yet submitted to
the community directory.

| Thing | Value |
| --- | --- |
| Plugin id | `speechify` |
| Model | `simba-3.2`, fixed in `src/main.ts` |
| Default voice | `harper_32` |
| Minimum Obsidian | 1.11.4, for SecretStorage |
| Platforms | Desktop only (`isDesktopOnly: true`) until mobile is tested |
| Author in the manifest | Speechify AI, `https://speechify.ai` |
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

## Not verified

- Mobile, at all.
- Popout windows. The bar is added to the main window's body. Reading view
  highlights use the popout's own registry, untried.
- Reading view against the live API, and in a community theme.
- Cloned voices. The test key has none.
- The cache's 400 MB prune. It runs at startup and after every 20 MB
  written, and has never been run against a full cache.
- Languages other than English, and right-to-left text.

## Open

- Phase 2: a play button per paragraph, lock-screen controls.
- Reading view: no "listen from here", so it starts from the top. A footnote
  definition is read but not highlighted, because Obsidian renders it in a
  footnotes section that reports the note's last line as its source.
- Callouts in Live Preview are read but not highlighted, because Live
  Preview draws them as a widget.
- Time to first audio is one to three seconds. The streaming endpoint with
  timestamps would cut it, and needs a streaming HTTP path that
  `requestUrl` does not offer.
- Submit at <https://community.obsidian.md>: sign in, connect GitHub, then
  New plugin with the repo URL. The `0.1.0` release it needs exists. Each
  later release needs a tag equal to the manifest version, no `v`, with
  `main.js`, `manifest.json` and `styles.css` attached.
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
