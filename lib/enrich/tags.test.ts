import { describe, expect, it } from "vitest";
import { isEraTag, isGenreTag, isJunkTag, normalizeTags } from "./tags";

describe("tag classification", () => {
  it("filters scrobble-context junk regardless of count", () => {
    expect(isJunkTag("seen live")).toBe(true);
    expect(isJunkTag("favorites")).toBe(true);
    expect(isJunkTag("guilty pleasure")).toBe(true);
    expect(isJunkTag("house")).toBe(false);
    const result = normalizeTags([
      { name: "Seen Live", count: 500 },
      { name: "favorites", count: 400 },
      { name: "house", count: 90 },
    ]);
    expect(result.tags).toEqual(["house"]);
    expect(result.genres).toEqual(["house"]);
  });

  it("recognizes genre vocabulary, compound genres, eras and plain descriptors", () => {
    expect(isGenreTag("house")).toBe(true);
    expect(isGenreTag("indie pop")).toBe(true); // ends with a single-word genre
    expect(isGenreTag("alternative hip hop")).toBe(true);
    expect(isGenreTag("bedroom pop")).toBe(true);
    expect(isGenreTag("female vocalists")).toBe(false);
    expect(isEraTag("90s")).toBe(true);
    expect(isEraTag("throwback")).toBe(true);
    expect(isEraTag("groovy")).toBe(false);
  });

  it("aliases spelling variants onto one label", () => {
    const result = normalizeTags([
      { name: "hip-hop", count: 10 },
      { name: "hip hop", count: 4 },
      { name: "rnb", count: 6 },
      { name: "r&b", count: 3 },
    ]);
    expect(result.genres.sort()).toEqual(["hip hop", "r&b"]);
    expect(result.tags).toEqual(["hip hop", "r&b"]);
  });

  it("keeps the highest count when variants collapse", () => {
    const result = normalizeTags([
      { name: "lo-fi", count: 5 },
      { name: "lo fi", count: 50 },
    ]);
    expect(result.tags).toEqual(["lo fi"]);
  });

  it("demotes era tags behind fresher descriptors and caps both lists", () => {
    const full = normalizeTags([
      { name: "80s", count: 99 },
      { name: "house", count: 50 },
      { name: "groovy", count: 30 },
    ]);
    expect(full.tags).toEqual(["house", "groovy", "80s"]);
    const capped = normalizeTags([
      { name: "80s", count: 99 },
      { name: "house", count: 50 },
      { name: "groovy", count: 30 },
    ], { maxTags: 2 });
    expect(capped.tags).toEqual(["house", "groovy"]);
  });

  it("caps genres at six, count-weighted", () => {
    const result = normalizeTags([
      { name: "house", count: 9 },
      { name: "techno", count: 8 },
      { name: "disco", count: 7 },
      { name: "funk", count: 6 },
      { name: "soul", count: 5 },
      { name: "jazz", count: 4 },
      { name: "blues", count: 3 },
    ]);
    expect(result.genres).toEqual(["house", "techno", "disco", "funk", "soul", "jazz"]);
  });

  it("trusts a curated genre list without a vocabulary check", () => {
    // MusicBrainz's genre namespace contains labels outside any hand-rolled vocab.
    expect(normalizeTags([{ name: "crossover prog", count: 5 }], { trusted: true }).genres).toEqual(["crossover prog"]);
    expect(normalizeTags([{ name: "crossover prog", count: 5 }]).genres).toEqual([]);
  });
});
