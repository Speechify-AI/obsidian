# Speechify for Obsidian

Listen to your notes in a Speechify voice. The sentence being read is
highlighted in the note and the word being spoken is highlighted inside it.

Press play and a small player appears over the bottom of the window with
play and pause, back and forward 10 seconds, the speed, and the voice. You can
keep editing while it reads. Type above the playhead and the highlight moves
with the text.

## Install

In Obsidian, open Settings, Community plugins, Browse, search for
**Speechify** and install it, or open
<https://community.obsidian.md/plugins/speechify>. Then turn it on under
Settings, Community plugins. It needs Obsidian 1.11.4 or later, on desktop
or mobile.

To run a build of your own instead, copy three files into your vault:

```sh
git clone https://github.com/Speechify-AI/obsidian.git
cd obsidian
npm install
npm run build
mkdir -p <vault>/.obsidian/plugins/speechify
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/speechify/
```

## Set up

You need a Speechify API key. Create one at
<https://platform.speechify.ai/api-keys?utm_source=github&utm_medium=readme&utm_campaign=obsidian>,
then open the plugin's settings and
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
- While it plays, click a sentence to jump to it, in the editor or in Reading
  view. If you edit while you listen and would rather clicks only moved the
  cursor, turn off **Click to listen** in the settings.

Every action is also a command, so you can give it a hotkey: Play or pause,
Listen from cursor, Stop, Next sentence, Previous sentence, Speed up, Slow
down, Choose voice.

## What is read

Headings, paragraphs, list items, quotes, callouts, footnote text and
tables. Links are read as their text, wikilinks as what Obsidian shows for
them, and tags as their name. A table is read a row at a time, the cells of
each row in order, the header row first; nothing says which column a cell
is in, because the plugin never speaks a word that is not in the note.

Not read: properties, code blocks, math, comments, images and embeds, link
targets, bare URLs, footnote markers and block ids.

## Languages

The plugin works out the language of each paragraph from its text. A
paragraph in another language than your voice's is read by Speechify's
top voice for that language, of the same gender as yours, so a French
quotation in an English note is read by a French narrator and a Hindi
note by a Hindi one. A heading or a one-word list item, which says too
little on its own, takes the language of the paragraph after it.

A cloned voice is never swapped, because you cloned it to sound like
itself; it reads every language in its own accent. The **Other languages**
setting chooses between a native voice, your voice told the language so
the words are said right in its own accent, and off, where every paragraph
is read as your voice's language.

To set a note's language yourself, give it a `lang` property: `lang: fr`,
or `lang: pt-BR`. It stands for every paragraph that does not clearly read
as something else, and it counts even with **Other languages** off.

Not told apart: Bosnian and Serbian in Latin script from Croatian, and
Malay from Indonesian. A `lang` property settles those.

## Limits

- Highlighting works in Live Preview, Source mode and Reading view. Reading
  view always starts from the top of the note, and footnote text is read
  there without a highlight.
- Live Preview draws callouts and tables as blocks of its own, so the
  highlight does not show inside one unless your cursor is in it. Source
  mode and Reading view show it.
- The first audio arrives about one to three seconds after you press play.
  After that the plugin renders ahead of the playhead and playback is
  continuous.
- On a phone or tablet, playback runs while Obsidian is open in front of
  you with the screen on, one paragraph flowing into the next. It is not
  built to keep reading from the lock screen or from behind another app.
  The ribbon is behind the sidebar menu there, so the header icon or a
  command on your toolbar is the way to start. Tested on an iPhone;
  Android should work the same way but has not been tried.

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
