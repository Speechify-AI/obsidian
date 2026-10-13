/**
 * The voice picker: every voice the key can render on the model, searchable,
 * with a sample on each. Each row leads with a round avatar, the
 * catalogue's picture or else the voice's initial, which shows the sample's
 * play button on the row under the pointer or the keyboard.
 */
import { type App, setIcon, SuggestModal } from "obsidian";
import { languageName, matchesVoice, type Voice, voiceTraits } from "./speechify.ts";

export class VoiceModal extends SuggestModal<Voice> {
  /** Samples play through their own element so they never replace the reader's audio. */
  private readonly sample = new Audio();
  private sampling: { button: HTMLElement; icon: HTMLElement } | null = null;

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
    this.renderAvatar(voice, el);

    const text = el.createDiv({ cls: "speechify-voice-text" });
    text.createDiv({ cls: "speechify-voice-name", text: voice.name });
    const language = languageName(voice.locale);
    const origin = [
      voice.cloned ? "Your clone" : "",
      language,
      voice.gender === "unspecified" ? "" : voice.gender === "female" ? "Female" : "Male",
    ].filter((part) => part !== "");
    // "British English" has already said "british".
    const said = new Set(language.toLowerCase().split(" "));
    const traits = voiceTraits(voice)
      .filter((trait) => !said.has(trait.split(" ")[0] ?? ""))
      .map((trait) => trait.charAt(0).toUpperCase() + trait.slice(1));
    const detail = [...origin, ...traits];
    if (detail.length > 0) text.createDiv({ cls: "speechify-voice-detail", text: detail.join(" · ") });

    if (voice.id === this.currentId) {
      const current = el.createDiv({ cls: "speechify-voice-current", attr: { "aria-label": "Current voice" } });
      setIcon(current, "check");
    }
  }

  /**
   * The voice's picture, or its initial, in a circle. With a catalogue sample
   * it is a button that plays it; without one it stays a plain avatar.
   */
  private renderAvatar(voice: Voice, el: HTMLElement): void {
    const preview = voice.preview;
    const initial = [...voice.name][0]?.toUpperCase() ?? "";
    const avatar =
      preview === null
        ? el.createDiv({ cls: "speechify-voice-avatar" })
        : el.createEl("button", {
            cls: "speechify-voice-avatar speechify-voice-sample",
            attr: { "aria-label": `Hear ${voice.name}` },
          });
    avatar.createSpan({ cls: "speechify-voice-initial", text: initial });
    if (voice.avatar !== null) {
      const picture = avatar.createEl("img", { cls: "speechify-voice-picture", attr: { src: voice.avatar, alt: "", loading: "lazy" } });
      // A picture that will not load leaves the initial showing.
      picture.addEventListener("error", () => picture.remove());
    }
    if (preview === null) return;
    const icon = avatar.createSpan({ cls: "speechify-voice-play" });
    setIcon(icon, "speechify-play");
    // Hearing a voice is not choosing it: keep the click from the row.
    avatar.addEventListener("mousedown", (event) => event.stopPropagation());
    avatar.addEventListener("click", (event) => {
      event.stopPropagation();
      const wasPlaying = this.sampling?.button === avatar;
      this.stopSample();
      if (wasPlaying) return;
      this.sampling = { button: avatar, icon };
      avatar.addClass("is-playing");
      setIcon(icon, "square");
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
      this.sampling.button.removeClass("is-playing");
      setIcon(this.sampling.icon, "speechify-play");
    }
    this.sampling = null;
  }
}
