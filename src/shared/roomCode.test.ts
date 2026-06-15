import { describe, expect, it } from "vitest";
import { normalizeRoomCode } from "./roomCode";

describe("normalizeRoomCode", () => {
  it("accepts a clean 6-character code", () => {
    expect(normalizeRoomCode("ha3rr7")).toBe("HA3RR7");
  });

  it("strips spaces and punctuation", () => {
    expect(normalizeRoomCode("  ha-3 rr7 ")).toBe("HA3RR7");
  });

  it("rejects codes that are too short or too long", () => {
    expect(normalizeRoomCode("ABC")).toBe("");
    expect(normalizeRoomCode("ABCDEFG")).toBe("");
  });

  it("rejects empty input", () => {
    expect(normalizeRoomCode("")).toBe("");
    expect(normalizeRoomCode(undefined)).toBe("");
  });
});
