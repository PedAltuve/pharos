import { readFileSync } from "node:fs";

export function readSomething(path: string): string {
  return readFileSync(path, "utf-8");
}
