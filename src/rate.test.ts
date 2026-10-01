import { describe, expect, it } from "vitest";
import { clampRate, rateLabel, RATE_STEP } from "./rate.ts";

describe("clampRate", () => {
  it("keeps the rate in range", () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(9)).toBe(4);
    expect(clampRate(Number.NaN)).toBe(1);
  });

  it("steps without floating point drift", () => {
    let rate = 1;
    for (let i = 0; i < 3; i++) rate = clampRate(rate + RATE_STEP);
    expect(rate).toBe(1.3);
  });
});

describe("rateLabel", () => {
  it("drops trailing zeros", () => {
    expect(rateLabel(1)).toBe("1×");
    expect(rateLabel(1.25)).toBe("1.25×");
    expect(rateLabel(1.5)).toBe("1.5×");
  });
});
