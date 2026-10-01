# RUNBOOK: Speechify for Obsidian

Live state and what has been verified. Conventions live in `CLAUDE.md`.

## State

Version 0.1.0, built 2026-10-01. Public at
<https://github.com/Speechify-AI/obsidian-speechify> since the same day. No
release, not submitted to the community directory. Phase 1 of two.

| Thing | Value |
| --- | --- |
| Plugin id | `speechify` |
| Model | `simba-3.2`, fixed in `src/main.ts` |
| Default voice | `harper_32` |
| Minimum Obsidian | 1.11.4, for SecretStorage |
| Render cache | IndexedDB database `speechify-renders`, 400 MB cap |

## Verified on 2026-10-01

Unit tests: 75 passing across speakable, marks, seek, render, speechify,
text and rate.

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

## Not verified

- Mobile, at all.
- Popout windows. The bar is added to the main window's body.
- Cloned voices. The test key has none.
- The cache's 400 MB prune. It runs at startup and after every 20 MB
  written, and has never been run against a full cache.
- Languages other than English, and right-to-left text.

## Open

- Phase 2: highlighting in Reading view, a play button per paragraph,
  lock-screen controls, community directory submission.
- Callouts in Live Preview are read but not highlighted, because Live
  Preview draws them as a widget.
- Time to first audio is one to three seconds. The streaming endpoint with
  timestamps would cut it, and needs a streaming HTTP path that
  `requestUrl` does not offer.
- `authorUrl` in `manifest.json` is `https://speechify.ai`. Confirm.
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
