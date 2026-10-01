/** Playback speed. Applied by the audio element, so changing it costs nothing and renders nothing. */

export const MIN_RATE = 0.5;
export const MAX_RATE = 4;
/** What the speed commands step by. */
export const RATE_STEP = 0.1;
/** The speeds offered in the bar's menu. */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Inside the range and on a 0.05 grid, so 1.1 + 0.1 is 1.2 and not 1.2000000000000002. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 20) / 20;
}

/** "1×", "1.25×": the rate as the bar shows it. */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}
