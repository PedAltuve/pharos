import { stderr } from "node:process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clack = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => clack);

import { beaconLifecyclePrompt } from "../../../src/cli/prompts/clack.js";

const approval = {
  beaconId: "bcn_1",
  draftId: "drf_1",
  captureId: "cap_1",
  semanticHash: "sha256:semantic",
};

const revocation = {
  beaconId: "bcn_1",
  expectedActiveVersionId: "ver_1",
  reason: "No longer needed",
};

describe("beaconLifecyclePrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clack.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    clack.text.mockResolvedValueOnce("No longer needed");
    clack.isCancel.mockReturnValue(false);
  });

  it("renders every lifecycle prompt through stderr", async () => {
    const prompt = beaconLifecyclePrompt();

    await expect(prompt.confirmApproval(approval)).resolves.toBe(true);
    await expect(prompt.requestRevocationReason()).resolves.toBe("No longer needed");
    await expect(prompt.confirmRevocation(revocation)).resolves.toBe(false);

    expect(clack.confirm).toHaveBeenCalledTimes(2);
    expect(clack.text).toHaveBeenCalledTimes(1);
    expect(clack.confirm.mock.calls[0]?.[0].output).toBe(stderr);
    expect(clack.text.mock.calls[0]?.[0].output).toBe(stderr);
    expect(clack.confirm.mock.calls[1]?.[0].output).toBe(stderr);
  });
});
