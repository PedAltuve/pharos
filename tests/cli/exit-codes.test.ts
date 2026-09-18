import { describe, expect, it } from "vitest";
import { exitCodeFor, type CliOutcome } from "../../src/cli/exit-codes.js";

describe("stable CLI exit taxonomy", () => {
  it.each<readonly [CliOutcome, number]>([
    ["succeeded", 0],
    ["failed", 1],
    ["usage", 2],
    ["refused", 3],
    ["inconclusive", 4],
    ["interrupted", 5],
    ["internal", 10],
  ])("maps %s to %i", (outcome, expected) => {
    expect(exitCodeFor(outcome)).toBe(expected);
  });
});
