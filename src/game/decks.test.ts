import { describe, expect, it } from "vitest";
import { deckForMode } from "./decks";

describe("built-in decks", () => {
  it("include larger common and arcane word pools", () => {
    expect(deckForMode("common").length).toBeGreaterThanOrEqual(175);
    expect(deckForMode("arcane").length).toBeGreaterThanOrEqual(125);
  });

  it("do not contain duplicate built-in words", () => {
    for (const mode of ["common", "arcane", "mixed"] as const) {
      const words = deckForMode(mode);
      const unique = new Set(words.map((word) => word.toLocaleLowerCase()));
      expect(unique.size).toBe(words.length);
    }
  });
});
