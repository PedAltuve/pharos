#!/usr/bin/env node
import { runCli } from "./program.js";

try {
  process.exitCode = await runCli(process.argv);
} catch {
  process.stderr.write("pharos: internal error\n");
  process.exitCode = 10;
}
