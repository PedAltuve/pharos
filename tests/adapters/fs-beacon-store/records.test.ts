import { describe, expect, it } from "vitest";
import {
  getOwn,
  recordFromEntries,
} from "../../../src/adapters/fs-beacon-store/records.js";

describe("adapter record assembly", () => {
  it("accumulates adversarial names safely before materialising a record", () => {
    const record = recordFromEntries([
      ["__proto__", "shadow"],
      ["constructor", "ctor"],
      ["toString", "stringifier"],
    ]);

    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(record["__proto__"]).toBe("shadow");
    expect(record.constructor).toBe("ctor");
    expect(record.toString).toBe("stringifier");
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("shadow");
  });

  it("looks up only own properties", () => {
    const record = { real: 1 };

    expect(getOwn(record, "real")).toBe(1);
    expect(getOwn(record, "toString")).toBeUndefined();
    expect(getOwn(record, "constructor")).toBeUndefined();
  });
});
