import { describe, expect, it } from "vitest";
import { fallbackPlan, requestedTrackCount } from "./prompt-plan";

describe("playlist prompt constraints", () => {
  it("uses 40 tracks when quantity is omitted", () => expect(requestedTrackCount("late night R&B")).toBe(40));
  it("enforces the 15 track minimum", () => expect(requestedTrackCount("make it 4 songs")).toBe(15));
  it("enforces the 200 track maximum", () => expect(requestedTrackCount("add 900 tracks")).toBe(200));
  it("respects explicit valid quantities", () => expect(requestedTrackCount("add at least 60 songs")).toBe(60));
  it("detects low-energy negative constraints", () => {
    const plan = fallbackPlan("Sleepy slow R&B, nothing too hype or energetic, Drake heavy with SZA");
    expect(plan.energy).toBe("low");
    expect(plan.anchorArtists).toEqual(["Drake", "SZA"]);
    expect(plan.avoidTraits).toContain("high energy");
  });
});
