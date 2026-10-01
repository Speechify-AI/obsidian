/**
 * The voice picker: every voice the key can render on the model, searchable,
 * with a sample on each.
 */
import { type App, setIcon, SuggestModal } from "obsidian";
import { languageName, matchesVoice, type Voice, voiceTraits } from "./speechify.ts";

export class VoiceModal extends SuggestModal<Voice> {
  /** Samples play through their own element so they never replace the reader's audio. */
  private readonly sample = new Audio();
  private sampling: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly voices: readonly Voice[],
    private readonly currentId: string,
    private readonly onChoose: (voice: Voice) => void,
  ) {
    super(app);
    this.modalEl.addClass("speechify-voices");
    this.setPlaceholder("Search voices by name, language or style");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to choose" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No voice matches.";
    this.limit = 200;
    this.sample.addEventListener("ended", () => this.stopSample());
  }

  getSuggestions(query: string): Voice[] {
    return this.voices.filter((voice) => matchesVoice(voice, query));
  }

  renderSuggestion(voice: Voice, el: HTMLElement): void {
    el.addClass("speechify-voice");
    this.renderSample(voice, el);

    const text = el.createDiv({ cls: "speechify-voice-text" });
    text.createDiv({ cls: "speechify-voice-name", text: voice.name });
    const language = languageName(voice.locale);
    const origin = [
      voice.cloned ? "Your clone" : "",
      language,
      voice.gender === "unspecified" ? "" : voice.gender === "female" ? "Female" : "Male",
    ].filter((part) => part !== "");
    const detail = text.createDiv({ cls: "speechify-voice-detail" });
    if (origin.length > 0) detail.createSpan({ text: origin.join(" · ") });
    // "British English" has already said "british".
    const said = new Set(language.toLowerCase().split(" "));
    for (const trait of voiceTraits(voice)) {
      if (!said.has(trait.split(" ")[0] ?? "")) detail.createSpan({ cls: "speechify-voice-trait", text: trait });
    }

    if (voice.id === this.currentId) {
      const current = el.createDiv({ cls: "speechify-voice-current", attr: { "aria-label": "Current voice" } });
      setIcon(current, "check");
    }
  }

  /** The round button that plays the catalogue's sample, or its width left empty so the names line up. */
  private renderSample(voice: Voice, el: HTMLElement): void {
    const preview = voice.preview;
    if (preview === null) {
      el.createDiv({ cls: "speechify-voice-sample-none" });
      return;
    }
    const play = el.createEl("button", { cls: "speechify-voice-sample", attr: { "aria-label": `Hear ${voice.name}` } });
    setIcon(play, "play");
    // Hearing a voice is not choosing it: keep the click from the row.
    play.addEventListener("mousedown", (event) => event.stopPropagation());
    play.addEventListener("click", (event) => {
      event.stopPropagation();
      const wasPlaying = this.sampling === play;
      this.stopSample();
      if (wasPlaying) return;
      this.sampling = play;
      play.addClass("is-playing");
      setIcon(play, "square");
      this.sample.src = preview;
      void this.sample.play().catch(() => this.stopSample());
    });
  }

  onChooseSuggestion(voice: Voice): void {
    this.onChoose(voice);
  }

  onClose(): void {
    this.stopSample();
    super.onClose();
  }

  private stopSample(): void {
    this.sample.pause();
    if (this.sampling) {
      this.sampling.removeClass("is-playing");
      setIcon(this.sampling, "play");
    }
    this.sampling = null;
  }
}
