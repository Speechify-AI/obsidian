/**
 * The player bar: a pill floating over the bottom of the workspace, there
 * from the first play until it is closed.
 *
 * It floats over the workspace and not inside the note so that it is still
 * there when you switch tabs while listening, and on mobile, where there is
 * no status bar and the ribbon is behind a menu.
 */
import { addIcon, setIcon, setTooltip } from "obsidian";
import type { PlayerState } from "./player.ts";
import { rateLabel } from "./rate.ts";

/**
 * The bar's own icons, drawn on a 24-unit grid and scaled to the 100-unit box
 * Obsidian's icons use. Prefixed so they cannot replace another plugin's.
 */
const BAR_ICONS: Record<string, string> = {
  "speechify-play":
    '<path d="M19 10.268C20.3333 11.0378 20.3333 12.9623 19 13.7321L10 18.9282C8.66667 19.698 7 18.7358 7 17.1962L7 6.80386C7 5.26426 8.66667 4.30201 10 5.07181L19 10.268Z"/>',
  "speechify-pause":
    '<path d="M7 4C5.89543 4 5 4.89543 5 6V18C5 19.1046 5.89543 20 7 20H9C10.1046 20 11 19.1046 11 18V6C11 4.89543 10.1046 4 9 4H7Z"/><path d="M15 4C13.8954 4 13 4.89543 13 6V18C13 19.1046 13.8954 20 15 20H17C18.1046 20 19 19.1046 19 18V6C19 4.89543 18.1046 4 17 4H15Z"/>',
  "speechify-back":
    '<path d="M21.2263 11.1973C21.2263 6.77899 17.6446 3.19727 13.2263 3.19727C10.3485 3.19727 7.82394 4.71704 6.41423 7H8.75024C9.30253 7 9.75024 7.44772 9.75024 8C9.75024 8.55228 9.30253 9 8.75024 9H3.75024C3.19796 9 2.75024 8.55228 2.75024 8V3C2.75024 2.44772 3.19796 2 3.75024 2C4.30253 2 4.75024 2.44772 4.75024 3V5.88897C6.51824 3.07174 9.6525 1.19727 13.2263 1.19727C18.7492 1.19727 23.2263 5.67442 23.2263 11.1973C23.2263 15.0447 21.0533 18.3829 17.8723 20.0545C17.3834 20.3115 16.7788 20.1234 16.5219 19.6345C16.265 19.1456 16.453 18.541 16.9419 18.2841C19.4913 16.9444 21.2263 14.2727 21.2263 11.1973Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.50219 16.4297C7.50219 19.1953 8.89086 20.8828 11.1291 20.8828C13.3674 20.8828 14.7502 19.1836 14.7502 16.4238C14.7502 13.6465 13.3557 12 11.1291 12C8.90844 12 7.50219 13.6523 7.50219 16.4297ZM12.5647 16.4297C12.5647 18.2754 12.0256 19.207 11.1291 19.207C10.2385 19.207 9.68773 18.2754 9.68773 16.4238C9.68773 14.584 10.2385 13.6758 11.1291 13.6758C12.0198 13.6758 12.5647 14.5781 12.5647 16.4297Z"/><path d="M4.98828 20.8066C4.34961 20.8066 3.91602 20.3906 3.91602 19.7461V14.1152H3.875L2.82031 14.8477C2.62695 14.9824 2.49805 15.0293 2.29297 15.0293C1.87695 15.0293 1.56641 14.7188 1.56641 14.2852C1.56641 13.9746 1.68945 13.7344 1.99414 13.5234L3.59375 12.4336C4.04492 12.1289 4.4082 12.082 4.83008 12.082C5.60352 12.082 6.05469 12.5449 6.05469 13.2832V19.7461C6.05469 20.3906 5.62695 20.8066 4.98828 20.8066Z"/>',
  "speechify-forward":
    '<path d="M2.52393 11.1973C2.52393 6.77899 6.10565 3.19727 10.5239 3.19727C13.4017 3.19727 15.9263 4.71704 17.336 7H15C14.4477 7 14 7.44772 14 8C14 8.55228 14.4477 9 15 9H20C20.5523 9 21 8.55228 21 8V3C21 2.44772 20.5523 2 20 2C19.4477 2 19 2.44772 19 3V5.88897C17.232 3.07174 14.0977 1.19727 10.5239 1.19727C5.00108 1.19727 0.523926 5.67442 0.523926 11.1973C0.523926 15.0447 2.69696 18.3829 5.87795 20.0545C6.36683 20.3115 6.97143 20.1234 7.22835 19.6345C7.48526 19.1456 7.29721 18.541 6.80832 18.2841C4.25899 16.9444 2.52393 14.2727 2.52393 11.1973Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14.9358 16.4297C14.9358 19.1953 16.3245 20.8828 18.5627 20.8828C20.801 20.8828 22.1838 19.1836 22.1838 16.4238C22.1838 13.6465 20.7893 12 18.5627 12C16.342 12 14.9358 13.6523 14.9358 16.4297ZM19.9983 16.4297C19.9983 18.2754 19.4592 19.207 18.5627 19.207C17.6721 19.207 17.1213 18.2754 17.1213 16.4238C17.1213 14.584 17.6721 13.6758 18.5627 13.6758C19.4534 13.6758 19.9983 14.5781 19.9983 16.4297Z"/><path d="M12.4219 20.8066C11.7832 20.8066 11.3496 20.3906 11.3496 19.7461V14.1152H11.3086L10.2539 14.8477C10.0605 14.9824 9.93164 15.0293 9.72656 15.0293C9.31055 15.0293 9 14.7188 9 14.2852C9 13.9746 9.12305 13.7344 9.42773 13.5234L11.0273 12.4336C11.4785 12.1289 11.8418 12.082 12.2637 12.082C13.0371 12.082 13.4883 12.5449 13.4883 13.2832V19.7461C13.4883 20.3906 13.0605 20.8066 12.4219 20.8066Z"/>',
  "speechify-close":
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M7.70711 6.29289C7.31658 5.90237 6.68342 5.90237 6.29289 6.29289C5.90237 6.68342 5.90237 7.31658 6.29289 7.70711L10.5858 12L6.29289 16.2929C5.90237 16.6834 5.90237 17.3166 6.29289 17.7071C6.68342 18.0976 7.31658 18.0976 7.70711 17.7071L12 13.4142L16.2929 17.7071C16.6834 18.0976 17.3166 18.0976 17.7071 17.7071C18.0976 17.3166 18.0976 16.6834 17.7071 16.2929L13.4142 12L17.7071 7.70711C18.0976 7.31658 18.0976 6.68342 17.7071 6.29289C17.3166 5.90237 16.6834 5.90237 16.2929 6.29289L12 10.5858L7.70711 6.29289Z"/>',
};

/** Registers the bar's icons with Obsidian. Call once, before the first bar. */
export function addBarIcons(): void {
  for (const [name, paths] of Object.entries(BAR_ICONS)) {
    addIcon(name, `<g transform="scale(${100 / 24})" fill="currentColor" stroke="none">${paths}</g>`);
  }
}

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
  const back = button("", "Back 10 seconds", actions.back);
  const toggle = button("speechify-bar-toggle", "Play", actions.toggle);
  const forward = button("", "Forward 10 seconds", actions.forward);
  const rate = button("speechify-bar-rate", "Speed", actions.chooseRate);
  const close = button("", "Close player", actions.close);
  setIcon(back, "speechify-back");
  setIcon(forward, "speechify-forward");
  setIcon(close, "speechify-close");

  let shown = "";
  return {
    update(state, voiceName) {
      const icon = state.status === "playing" ? "pause" : state.status === "loading" ? "loading" : "play";
      if (icon !== shown) {
        shown = icon;
        // Loading has no icon: the stylesheet draws a ring in the empty button.
        if (icon === "loading") toggle.empty();
        else setIcon(toggle, `speechify-${icon}`);
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
