/**
 * The player bar: a pill floating over the bottom of the workspace, there
 * from the first play until it is closed.
 *
 * It floats over the workspace and not inside the note so that it is still
 * there when you switch tabs while listening, and on mobile, where there is
 * no status bar and the ribbon is behind a menu.
 */
import { setIcon, setTooltip } from "obsidian";
import type { PlayerState } from "./player.ts";
import { rateLabel } from "./rate.ts";

export interface BarActions {
  // Function properties, not methods: each is handed to a click listener on its own.
  toggle: () => void;
  back: () => void;
  forward: () => void;
  chooseVoice: () => void;
  chooseRate: (event: MouseEvent) => void;
  close: () => void;
}

export interface Bar {
  update(state: PlayerState, voiceName: string): void;
  remove(): void;
}

export function createBar(parent: HTMLElement, actions: BarActions): Bar {
  const el = parent.createDiv({ cls: "speechify-bar", attr: { role: "toolbar", "aria-label": "Speechify player" } });

  const button = (cls: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement => {
    const control = el.createEl("button", { cls: `speechify-bar-button ${cls}`, attr: { "aria-label": label } });
    setTooltip(control, label, { placement: "top" });
    control.addEventListener("click", onClick);
    return control;
  };

  const voice = button("speechify-bar-voice", "Choose voice", actions.chooseVoice);
  const back = button("", "Previous sentence", actions.back);
  const toggle = button("speechify-bar-toggle", "Play", actions.toggle);
  const forward = button("", "Next sentence", actions.forward);
  const rate = button("speechify-bar-rate", "Speed", actions.chooseRate);
  const close = button("", "Close player", actions.close);
  setIcon(back, "skip-back");
  setIcon(forward, "skip-forward");
  setIcon(close, "x");

  let shown = "";
  return {
    update(state, voiceName) {
      const icon = state.status === "playing" ? "pause" : state.status === "loading" ? "loading" : "play";
      if (icon !== shown) {
        shown = icon;
        // Loading has no icon: the stylesheet draws a ring in the empty button.
        if (icon === "loading") toggle.empty();
        else setIcon(toggle, icon);
        const label = icon === "pause" ? "Pause" : icon === "loading" ? "Loading" : "Play";
        toggle.setAttribute("aria-label", label);
        setTooltip(toggle, label, { placement: "top" });
        // Not "is-loading": Obsidian draws its own progress bar on anything with that class.
        toggle.toggleClass("speechify-bar-loading", icon === "loading");
      }
      voice.setText(voiceName);
      rate.setText(rateLabel(state.rate));
      const loaded = state.status !== "idle";
      back.disabled = !loaded;
      forward.disabled = !loaded;
    },
    remove: () => el.remove(),
  };
}
