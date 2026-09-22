import { stagedRecordingPath, withHandleBoundRegularFile } from "../capture-layout/index.js";
import type { SensitivityScanner } from "../../domain/ports/sensitivity-scanner.js";
import { err, ok } from "../../shared/result.js";

const RECORDING = "recording.spec.ts";
const MINIMUM_SCANNABLE_SECRET_LENGTH = 4;

export interface LiteralSensitivityScannerOptions {
  readonly projectRoot: string;
  /** Test-only observation seam for proving lstat/open replacement refusal. */
  readonly beforeOpen?: () => void | Promise<void>;
}

function singleQuotedJavaScript(value: string): string {
  return `'${value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}'`;
}

function representations(value: string): readonly string[] {
  const encoded = encodeURIComponent(value);
  return [
    value,
    JSON.stringify(value),
    singleQuotedJavaScript(value),
    encoded,
    encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
  ];
}

/** Scans only a private, regular staged recording and returns no raw bytes or match details. */
export class LiteralSensitivityScanner implements SensitivityScanner {
  constructor(private readonly options: LiteralSensitivityScannerOptions) {}

  async scan(command: Parameters<SensitivityScanner["scan"]>[0]) {
    const values = [...command.resolvedSecrets.values()];
    if (values.some((value) => value.length < MINIMUM_SCANNABLE_SECRET_LENGTH)) {
      return err({ category: "incomplete" as const, count: 0 });
    }

    const contents = await withHandleBoundRegularFile(
      stagedRecordingPath(this.options.projectRoot, command.captureId),
      async (file) => {
        await this.options.beforeOpen?.();
        return await file.readContents();
      },
    );
    if (contents === null) return err({ rule: "unsafe-artifact" as const });

    const text = contents.bytes.toString("utf8");
    const count = values.reduce((total, value) => total + Number(representations(value).some((candidate) => text.includes(candidate))), 0);
    if (count > 0) return err({ category: "detected" as const, count });

    return ok({
      reference: `captures/${command.captureId}/${RECORDING}`,
      byteSize: contents.byteSize,
      sha256: contents.sha256,
    });
  }
}
