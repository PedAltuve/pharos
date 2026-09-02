import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/index.js";
import type { Hasher, JsonValue } from "../../../src/domain/ports/index.js";
import type { SemanticProjection } from "../../../src/domain/semantics/index.js";

function hashProjection(
  hasher: Hasher,
  projection: SemanticProjection,
): string {
  return hasher.hash(projection);
}

function reverseObjectInsertion(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((child) =>
      reverseObjectInsertion(child as JsonValue),
    ) as JsonValue;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [
          key,
          reverseObjectInsertion(child as JsonValue),
        ]),
    ) as JsonValue;
  }
  return value;
}

function digestUtf8(value: string): string {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(value, "utf8"))
    .digest("hex")}`;
}

const rfcVectors: ReadonlyArray<{
  name: string;
  input: JsonValue;
  expectedCanonical: string;
  expectedFingerprint: string;
}> = [
  {
    // RFC 8785 §3.2.2 serialization of primitive data types sample.
    name: "primitive serialization sample",
    input: JSON.parse(
      String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\u000F\nA'B\"\\\\\"/","literals":[null,true,false]}`,
    ),
    expectedCanonical:
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    expectedFingerprint:
      "sha256:2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb",
  },
  {
    // RFC 8785 §3.2.3 UTF-16 property sorting sample.
    name: "property sorting sample",
    input: {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    },
    expectedCanonical:
      '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    expectedFingerprint:
      "sha256:5e321556d22018a9656991a9e94f77ec175fa193e52a2429d312f8419ec8b08c",
  },
];

const rootJsonObjectArbitrary = fc.dictionary(
  fc.stringMatching(/^k:[a-z]{1,8}$/),
  fc.jsonValue(),
  { minKeys: 2, maxKeys: 4 },
);

describe("JcsSha256Hasher", () => {
  it("accepts a frozen SemanticProjection through the Hasher port", () => {
    const hasher: Hasher = new JcsSha256Hasher();
    const value: JsonValue = { greeting: "hello" };

    expect(hasher.hash(value)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashProjection).toBeTypeOf("function");
  });

  it.each(rfcVectors)(
    "matches the RFC 8785 $name",
    ({ input, expectedCanonical, expectedFingerprint }) => {
      const hasher = new JcsSha256Hasher();

      expect(digestUtf8(expectedCanonical)).toBe(expectedFingerprint);
      expect(hasher.hash(input)).toBe(expectedFingerprint);
    },
  );

  it("distinguishes arrays whose ordered values differ", () => {
    const hasher = new JcsSha256Hasher();

    expect(hasher.hash([1, 2])).not.toBe(hasher.hash([2, 1]));
  });

  it("stabilizes hashes across serialization and recursive object insertion order", () => {
    const hasher = new JcsSha256Hasher();

    fc.assert(
      fc.property(rootJsonObjectArbitrary, (original) => {
        const originalText = JSON.stringify(original);
        if (originalText === undefined) {
          throw new TypeError("Test fixture serialization unexpectedly failed");
        }
        const originalParsed: JsonValue = JSON.parse(originalText);
        const reordered = reverseObjectInsertion(originalParsed);
        const reorderedText = JSON.stringify(reordered);
        if (reorderedText === undefined) {
          throw new TypeError("Test fixture serialization unexpectedly failed");
        }
        const reorderedParsed: JsonValue = JSON.parse(reorderedText);

        expect(reorderedText).not.toBe(originalText);
        expect(reorderedParsed).toEqual(originalParsed);
        expect(hasher.hash(reorderedParsed)).toBe(hasher.hash(originalParsed));
      }),
    );
  });
});
