# Speechify for Obsidian

Listen to your notes in a Speechify voice. The sentence being read is
highlighted in the editor and the word being spoken is highlighted inside it.

Press play and a small player appears over the bottom of the window with
play and pause, sentence back and forward, the speed, and the voice. You can
keep editing while it reads. Type above the playhead and the highlight moves
with the text.

## Install

The plugin is not in the community directory yet. Until it is, build it and
copy three files into your vault:

```sh
git clone https://github.com/Speechify-AI/obsidian.git
cd obsidian
npm install
npm run build
mkdir -p <vault>/.obsidian/plugins/speechify
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/speechify/
```

Then turn on **Speechify** under Settings, Community plugins. It needs
Obsidian 1.11.4 or later.

## Set up

You need a Speechify API key. Create one at
<https://platform.speechify.ai/api-keys>, then open the plugin's settings and
choose it under **API key**. Obsidian stores the key in its keychain. The
plugin's own settings file, which lives in your vault and syncs with it, only
holds the name you gave the secret.

The settings tab checks the key against the API as soon as you choose it and
tells you how many voices it can use.

## Use

- The Speechify icon in a note's header, or in the ribbon, reads the note
  from the top. With text selected it reads the selection.
- Right-click in the editor for **Listen from here** or **Listen to
  selection**.
- The player's voice button opens a searchable list of every voice your key
  can use, your own clones included, with a sample on each. Changing voice
  says the current sentence again in the new one.
- The speed button offers 0.75× to 3×. Speed changes apply at once and cost
  nothing, because the audio element does it.

Every action is also a command, so you can give it a hotkey: Play or pause,
Listen from cursor, Stop, Next sentence, Previous sentence, Speed up, Slow
down, Choose voice.

## What is read

Headings, paragraphs, list items, quotes, callouts and footnote text. Links
are read as their text, wikilinks as what Obsidian shows for them, and tags
as their name.

Not read: properties, code blocks, tables, math, comments, images and embeds,
link targets, bare URLs, footnote markers and block ids.

## Limits

- Highlighting works in Live Preview and Source mode. In Reading view the
  note is read but nothing is highlighted yet.
- Live Preview draws callouts as a block of its own, so the highlight does
  not show inside one unless your cursor is in it. Source mode shows it.
- The first audio arrives about one to three seconds after you press play.
  After that the plugin renders ahead of the playhead and playback is
  continuous.
- Mobile is untested. Nothing in the plugin needs desktop, but on iOS the
  first play may need a second tap.

## Network use and cost

The plugin sends the text of the passages you listen to, and nothing else
from your vault, to `api.speechify.ai` with your API key. Speechify bills
your workspace per character. A passage is sent when the playhead is about to
reach it, a few hundred characters ahead, so a note you stop after one
sentence costs about that much.

Rendered audio is cached on your device, outside the vault, keyed by the
passage text, voice and model. Hearing a passage again is free, and editing
one paragraph leaves the cached audio of the others in place. The cache
holds up to 400 MB and drops what you heard longest ago.

## Development

```sh
npm run dev        # rebuild main.js on change
npm test           # unit tests
npm run typecheck
npm run build      # production main.js
```

`CLAUDE.md` holds the rules the code depends on. `RUNBOOK.md` holds what has
been verified and how to test the plugin in a throwaway Obsidian instance.

## License

MIT
