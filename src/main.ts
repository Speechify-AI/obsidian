/**
 * Speechify for Obsidian: listen to a note in a Speechify voice, with the
 * sentence and word being spoken highlighted in the editor.
 *
 * This file is the wiring: commands, the ribbon and header buttons, the
 * editor menu, settings, and the one player they all drive.
 */
import { EditorView } from "@codemirror/view";
import {
  addIcon,
  type Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  requestUrl,
} from "obsidian";
import { type Bar, createBar } from "./bar.ts";
import { indexedDbCache } from "./cache.ts";
import { canHighlight, type Highlight, highlightExtension } from "./highlight.ts";
import { createPlayer, type Player, type PlayerState, type StartOptions } from "./player.ts";
import { clampRate, RATE_STEP, rateLabel, RATES } from "./rate.ts";
import { createReadingPainter } from "./reading.ts";
import { memoryCache, type RenderCache } from "./render.ts";
import { DEFAULT_SETTINGS, type Settings, type SettingsHost, SpeechifySettingTab } from "./settings.ts";
import { checkKey, type Http, type KeyCheck, listVoices, type TtsConfig, type Voice } from "./speechify.ts";
import { VoiceModal } from "./voices.ts";

const API_BASE = "https://api.speechify.ai";
const MODEL = "simba-3.2";
const ICON = "speechify";
/** The Speechify mark, drawn for the 100-unit box Obsidian's icons use. */
const ICON_SVG =
  '<path transform="translate(4.2 22.3) scale(0.4608)" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M45.1765 35.0482C50.2344 27.6571 54.6206 24.0024 61.1876 26.0326C65.1614 27.2611 66.7926 32.3339 65.1614 38.6991C62.2932 49.8909 61.1876 56.3153 61.1876 63.9614C71.2752 42.8176 89.9232 14.7156 98.0052 5.26364C103.591 -1.26941 111.598 -0.436276 114.613 1.02095C119.51 3.3887 119.769 8.52276 118.079 13.4327C106.383 47.4016 105.975 65.5439 104.539 83.1693C111.808 63.6217 120.646 45.2343 131.318 32.2844C135.815 26.0732 143.696 24.1234 148.674 26.1411C153.652 28.1589 154.787 32.9862 153.652 39.0355C150.693 54.8107 149.225 62.2044 149.225 68.3156C154.63 64.1812 158.935 60.688 168.775 59.8897C178.616 59.0913 198.952 63.009 198.952 63.009C198.952 63.009 187.212 65.0038 181.011 66.5243C168.299 69.6416 163.86 73.2872 155.631 85.339C153.239 88.8409 149.225 91.5295 144.702 91.1876C140.179 90.8457 137.142 88.0002 135.815 84.1575C133.971 78.8166 133.422 70.8277 135.815 53.5392C124.091 71.3762 118.079 95.6056 110.046 111.673C107.992 115.782 104.484 120.463 99.7302 120.463C94.9764 120.463 88.8118 118.619 88.0115 104.495C85.9615 68.3156 92.7962 39.5248 92.7962 39.5248C79.4837 60.6329 75.2321 72.9368 70.6014 79.3527C65.9707 85.7686 61.4774 91.3249 56.0117 91.1876C50.5459 91.0504 47.365 84.9399 46.6734 79.3527C45.9818 73.7654 45.7828 66.6295 47.8028 53.5392C42.5445 58.7975 37.921 62.3586 29.6407 64.5885C21.3603 66.8185 11.4727 65.3992 0 63.009C11.4727 63.009 30.7793 56.0872 45.1765 35.0482Z"/>';

/** Obsidian's own HTTP client: not subject to CORS, and the same on desktop and mobile. */
const http: Http = async (request) => {
  const response = await requestUrl({ ...request, throw: false });
  return { status: response.status, text: response.text };
};

/** The CodeMirror view behind an Obsidian editor. */
function editorViewOf(editor: Editor): EditorView | null {
  const cm: unknown = "cm" in editor ? editor.cm : null;
  return cm instanceof EditorView ? cm : null;
}

export default class SpeechifyPlugin extends Plugin implements SettingsHost {
  settings: Settings = DEFAULT_SETTINGS;
  private player!: Player;
  private state: PlayerState = { status: "idle", rate: 1 };
  private bar: Bar | null = null;
  /** The note being read, so playback stops when it is closed or replaced. */
  private listening: { view: MarkdownView; path: string } | null = null;
  /** What the editor shows as spoken, kept so Reading view can be painted the same. */
  private painted: Highlight | null = null;
  private readonly reading = createReadingPainter(() => this.settings.follow);
  private voices: { key: string; list: Voice[] } | null = null;
  private readonly headerActions = new Map<MarkdownView, HTMLElement>();

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(typeof saved === "object" && saved !== null ? saved : {}) };
    this.settings.rate = clampRate(this.settings.rate);

    let cache: RenderCache = memoryCache();
    if (typeof indexedDB !== "undefined") {
      const persistent = indexedDbCache(indexedDB);
      cache = persistent;
      this.app.workspace.onLayoutReady(() => void persistent.prune());
    }

    this.player = createPlayer({
      config: () => this.config(),
      cache,
      follow: () => this.settings.follow,
      onState: (state) => {
        this.state = state;
        if (state.status === "idle") this.listening = null;
        this.updateBar();
      },
      onError: (message) => new Notice(message),
      onPaint: (highlight, moved) => {
        this.painted = highlight;
        this.paintReading(moved);
      },
    });
    this.player.setRate(this.settings.rate);

    addIcon(ICON, ICON_SVG);
    this.registerEditorExtension(highlightExtension);
    this.registerMarkdownPostProcessor((el, context) => this.reading.process(el, context));
    this.addSettingTab(new SpeechifySettingTab(this.app, this, this));
    this.addRibbonIcon(ICON, "Listen to this note", () => this.toggle());
    this.addCommands();

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        if (!(info instanceof MarkdownView)) return;
        const selected = editor.somethingSelected();
        menu.addItem((item) =>
          item
            .setTitle(selected ? "Listen to selection" : "Listen from here")
            .setIcon(ICON)
            .onClick(() => this.listen(info, selected ? this.selectionOf(editor) : this.cursorOf(editor))),
        );
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.onLayout()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.onLayout()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.onLayout()));
    this.app.workspace.onLayoutReady(() => this.onLayout());
  }

  onunload(): void {
    this.player.stop();
    this.bar?.remove();
    for (const action of this.headerActions.values()) action.remove();
  }

  private addCommands(): void {
    this.addCommand({ id: "toggle", name: "Play or pause", callback: () => this.toggle() });
    this.addCommand({
      id: "listen-from-cursor",
      name: "Listen from cursor",
      editorCallback: (editor, context) => {
        if (context instanceof MarkdownView) this.listen(context, this.cursorOf(editor));
      },
    });
    this.addCommand({ id: "stop", name: "Stop", callback: () => this.player.stop() });
    this.addCommand({ id: "next-sentence", name: "Next sentence", callback: () => this.player.skip(1) });
    this.addCommand({ id: "previous-sentence", name: "Previous sentence", callback: () => this.player.skip(-1) });
    this.addCommand({ id: "faster", name: "Speed up", callback: () => this.setRate(this.settings.rate + RATE_STEP) });
    this.addCommand({ id: "slower", name: "Slow down", callback: () => this.setRate(this.settings.rate - RATE_STEP) });
    this.addCommand({ id: "choose-voice", name: "Choose voice", callback: () => this.chooseVoice() });
  }

  // ---- starting and stopping ------------------------------------------------

  /** Play or pause what is loaded; with nothing loaded, read the note in front. */
  private toggle(): void {
    if (this.player.toggle()) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) this.listenTo(view);
    else new Notice("Open a note to listen to it.");
  }

  /** Read a note from the top, or its selection when there is one. */
  private listenTo(view: MarkdownView): void {
    // Reading view has no cursor to trust, so a selection only counts in the editor.
    const selected = view.getMode() === "source" && view.editor.somethingSelected();
    this.listen(view, selected ? this.selectionOf(view.editor) : {});
  }

  private listen(view: MarkdownView, options: StartOptions): void {
    const editorView = editorViewOf(view.editor);
    if (!editorView || !canHighlight(editorView)) {
      new Notice("Speechify cannot read this view.");
      return;
    }
    this.showBar();
    if (!this.player.start(editorView, options)) return;
    this.listening = { view, path: view.file?.path ?? "" };
    // The first paint came before `listening` was set.
    this.paintReading(true);
  }

  /** Show in Reading view what the editor shows, when the note being read is in Reading view. */
  private paintReading(moved: boolean): void {
    const view = this.listening?.view;
    if (view && this.painted && view.getMode() === "preview") this.reading.paint(view, this.painted, moved);
    else this.reading.clear();
  }

  private selectionOf(editor: Editor): StartOptions {
    return {
      selection: {
        from: editor.posToOffset(editor.getCursor("from")),
        to: editor.posToOffset(editor.getCursor("to")),
      },
    };
  }

  private cursorOf(editor: Editor): StartOptions {
    return { from: editor.posToOffset(editor.getCursor("from")) };
  }

  /** The layout changed: give new notes their header button, and stop if ours went away. */
  private onLayout(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || this.headerActions.has(view)) continue;
      const action = view.addAction(ICON, "Listen to this note", () => {
        if (this.listening?.view === view && this.player.toggle()) return;
        this.listenTo(view);
      });
      this.headerActions.set(view, action);
    }
    for (const [view, action] of this.headerActions) {
      if (!action.isConnected) this.headerActions.delete(view);
    }

    const listening = this.listening;
    if (!listening) return;
    const gone = listening.view.file?.path !== listening.path || this.player.view()?.dom.isConnected !== true;
    if (gone) this.player.stop();
    // Switching between the editor and Reading view is a layout change too.
    else this.paintReading(false);
  }

  // ---- the bar ----------------------------------------------------------------

  private showBar(): void {
    this.bar ??= createBar(document.body, {
      toggle: () => this.toggle(),
      back: () => this.player.skip(-1),
      forward: () => this.player.skip(1),
      chooseVoice: () => this.chooseVoice(),
      chooseRate: (event) => this.chooseRate(event),
      close: () => {
        this.player.stop();
        this.bar?.remove();
        this.bar = null;
      },
    });
    this.updateBar();
  }

  private updateBar(): void {
    this.bar?.update(this.state, this.settings.voiceName);
  }

  private chooseRate(event: MouseEvent): void {
    const menu = new Menu();
    for (const rate of RATES) {
      menu.addItem((item) =>
        item
          .setTitle(rateLabel(rate))
          .setChecked(rate === this.settings.rate)
          .onClick(() => this.setRate(rate)),
      );
    }
    menu.showAtMouseEvent(event);
  }

  // ---- settings ---------------------------------------------------------------

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  setRate(rate: number): void {
    this.settings.rate = clampRate(rate);
    this.player.setRate(this.settings.rate);
    void this.saveSettings();
  }

  private apiKey(): string | null {
    if (this.settings.keySecret === "") return null;
    const key = this.app.secretStorage.getSecret(this.settings.keySecret)?.trim();
    return key ? key : null;
  }

  private config(): TtsConfig | null {
    const apiKey = this.apiKey();
    return apiKey ? { apiBase: API_BASE, apiKey, voiceId: this.settings.voiceId, model: MODEL, http } : null;
  }

  async checkKey(): Promise<KeyCheck> {
    const apiKey = this.apiKey();
    if (!apiKey) return { ok: false, reason: "That secret is empty. Choose one that holds your Speechify API key." };
    const result = await checkKey(apiKey, API_BASE, MODEL, http);
    if (result.ok) this.voices = { key: apiKey, list: result.voices };
    return result;
  }

  chooseVoice(onChosen?: () => void): void {
    void this.loadVoices().then((voices) => {
      if (!voices) return;
      new VoiceModal(this.app, voices, this.settings.voiceId, (voice) => {
        this.settings.voiceId = voice.id;
        this.settings.voiceName = voice.name;
        void this.saveSettings();
        this.updateBar();
        this.player.voiceChanged();
        onChosen?.();
      }).open();
    });
  }

  /** The voices this key can use, fetched once per key. Null (with a notice) when they cannot be had. */
  private async loadVoices(): Promise<Voice[] | null> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      new Notice("Add your Speechify API key in the plugin's settings to choose a voice.");
      return null;
    }
    if (this.voices?.key === apiKey) return this.voices.list;
    try {
      this.voices = { key: apiKey, list: await listVoices({ apiBase: API_BASE, apiKey, model: MODEL, http }) };
      return this.voices.list;
    } catch {
      new Notice("Could not load the voices from Speechify. Check the API key and your connection.");
      return null;
    }
  }
}
