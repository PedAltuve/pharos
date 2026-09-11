import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePharosHome } from "../../../src/adapters/fs-project/index.js";
import { writePrivateJson } from "../../../src/adapters/fs-project/filesystem.js";

describe("resolvePharosHome", () => {
  it("uses only absolute explicit and environment overrides before platform defaults", () => {
    expect(resolvePharosHome({
      override: "/operator/pharos",
      environment: { PHAROS_HOME: "/ignored", XDG_DATA_HOME: "/xdg" },
      platform: "linux",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: true, value: "/operator/pharos" });
    expect(resolvePharosHome({
      environment: { PHAROS_HOME: "/configured/pharos", XDG_DATA_HOME: "/xdg" },
      platform: "linux",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: true, value: "/configured/pharos" });
    expect(resolvePharosHome({
      environment: { XDG_DATA_HOME: "/xdg" },
      platform: "linux",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: true, value: "/xdg/pharos" });
  });

  it("rejects relative configuration and unsupported platforms rather than guessing", () => {
    expect(resolvePharosHome({
      override: "relative/home",
      environment: {},
      platform: "linux",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: false, error: { rule: "invalid-pharos-home" } });
    expect(resolvePharosHome({
      environment: { PHAROS_HOME: "relative/home" },
      platform: "linux",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: false, error: { rule: "invalid-pharos-home" } });
    expect(resolvePharosHome({
      environment: {},
      platform: "win32",
      homeDirectory: "/home/operator",
    })).toEqual({ ok: false, error: { rule: "unsupported-platform" } });
  });
});

describe("filesystem failure injection", () => {
  it.each(["lstat", "realpath", "mkdir", "chmod"] as const)(
    "surfaces an injected %s failure instead of continuing initialization",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), "pharos-fs-failure-"));
      try {
        const { FsProjectContextStore } = await import("../../../src/adapters/fs-project-context-store/index.js");
        const store = new FsProjectContextStore({
          home,
          observer: { onOperation: (actual: string) => {
            if (actual === operation) throw new Error(`injected ${operation}`);
          } },
        });
        await expect(store.resolveByPath(home)).rejects.toThrow(`injected ${operation}`);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  it.each(["rename", "fsync"] as const)("surfaces an injected %s write failure", async (operation) => {
    const root = await mkdtemp(join(tmpdir(), "pharos-fs-write-failure-"));
    const target = join(root, "state.json");
    try {
      await expect(writePrivateJson(target, { state: "new" }, {
        onOperation: (actual: string) => {
          if (actual === operation) throw new Error(`injected ${operation}`);
        },
      })).rejects.toThrow(`injected ${operation}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
