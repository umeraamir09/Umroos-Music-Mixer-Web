import { describe, expect, it } from "vitest";
import { fallbackPlan, normalizePlan, requestedTrackCount } from "./prompt-plan";

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
  it.each([
    ["A Drake only club music playlist.", ["Drake"]],
    ["Drake-only club tracks", ["Drake"]],
    ["Only songs by Bad Bunny for the club", ["Bad Bunny"]],
    ["A Beyoncé only playlist", ["Beyoncé"]],
    ["Only Drake and SZA songs", ["Drake", "SZA"]],
    ["Drake and SZA only", ["Drake", "SZA"]],
    ["Nothing but The Weeknd", ["The Weeknd"]],
  ])("extracts a hard artist scope from %s", (prompt, artists) => {
    expect(fallbackPlan(prompt).allowedArtists.sort()).toEqual([...artists].sort());
  });
  it.each(["mostly Drake", "artists like Drake", "Drake heavy with SZA", "not only Drake", "Drake, only songs I know", "only house music with Drake"])("keeps soft or unrelated instructions unrestricted: %s", (prompt) => {
    expect(fallbackPlan(prompt).allowedArtists).toEqual([]);
  });
  it("repairs AI scope expansion and broad searches from the explicit prompt", () => {
    const plan = normalizePlan({ ...fallbackPlan("club"), allowedArtists: ["Drake", "SZA"], searchQueries: ["genre:house"] }, "A Drake only club music playlist.");
    expect(plan.allowedArtists).toEqual(["Drake"]);
    expect(plan.searchQueries).toEqual(['artist:"Drake"']);
  });
  it("retains AI-parsed complex restrictions and excludes named artists locally", () => {
    expect(normalizePlan({ ...fallbackPlan("club"), allowedArtists: ["Bad Bunny"] }, "Keep every recording within Bad Bunny's catalog").allowedArtists).toEqual(["Bad Bunny"]);
    const plan = fallbackPlan("club, no Drake");
    expect(plan.avoidArtists).toContain("Drake");
    expect(plan.anchorArtists).not.toContain("Drake");
    expect(plan.energy).toBe("high");
  });
});
