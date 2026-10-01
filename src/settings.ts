/** What the plugin remembers, and the settings tab that edits it. */
import { type App, type Plugin, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { clampRate, MAX_RATE, MIN_RATE } from "./rate.ts";
import type { KeyCheck } from "./speechify.ts";

export interface Settings {
  /**
   * The name of the secret in Obsidian's keychain that holds the API key.
   * Never the key: this file is saved in the vault and syncs with it.
   */
  keySecret: string;
  voiceId: string;
  voiceName: string;
  rate: number;
  /** Scroll the note to keep the spoken sentence on screen. */
  follow: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  keySecret: "",
  voiceId: "harper_32",
  voiceName: "Harper",
  rate: 1,
  follow: true,
};

export interface SettingsHost {
  settings: Settings;
  saveSettings(): Promise<void>;
  /** Check the chosen key against the live API. */
  checkKey(): Promise<KeyCheck>;
  chooseVoice(onChosen: () => void): void;
  setRate(rate: number): void;
}

export class SpeechifySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly host: SettingsHost,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, host } = this;
    containerEl.empty();

    const key = new Setting(containerEl).setName("API key");
    const describeKey = (status: string): void => {
      key.setDesc(
        createFragment((fragment) => {
          fragment.appendText("Create one at ");
          fragment.createEl("a", { text: "platform.speechify.ai", href: "https://platform.speechify.ai/api-keys" });
          fragment.appendText(". It is kept in Obsidian's keychain, not in your vault, and what you listen to is billed to your own Speechify workspace.");
          if (status !== "") fragment.createDiv({ cls: "speechify-key-status", text: status });
        }),
      );
    };
    const check = async (): Promise<void> => {
      if (host.settings.keySecret === "") return describeKey("");
      describeKey("Checking the key…");
      const result = await host.checkKey();
      describeKey(result.ok ? `The key works. ${result.voices.length} voices can read your notes.` : result.reason);
    };
    key.addComponent((el) =>
      new SecretComponent(this.app, el).setValue(host.settings.keySecret).onChange(async (name) => {
        host.settings.keySecret = name;
        await host.saveSettings();
        await check();
      }),
    );
    void check();

    const voice = new Setting(containerEl).setName("Voice").setDesc(host.settings.voiceName);
    voice.addButton((button) =>
      button.setButtonText("Choose").onClick(() =>
        host.chooseVoice(() => {
          voice.setDesc(host.settings.voiceName);
        }),
      ),
    );

    // The slider shows its own value; no description needed.
    new Setting(containerEl).setName("Speed").addSlider((slider) =>
      slider
        .setLimits(MIN_RATE, MAX_RATE, 0.05)
        .setValue(host.settings.rate)
        .onChange((value) => host.setRate(clampRate(value))),
    );

    new Setting(containerEl)
      .setName("Follow along")
      .setDesc("Scroll the note to keep the sentence being read on screen. Scrolling away yourself pauses this until you come back.")
      .addToggle((toggle) =>
        toggle.setValue(host.settings.follow).onChange(async (value) => {
          host.settings.follow = value;
          await host.saveSettings();
        }),
      );
  }
}
