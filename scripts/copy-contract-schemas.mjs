import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "contracts", "schemas");
const destination = join(root, "dist", "contracts", "schemas");

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".schema.json")) {
    await cp(join(source, entry.name), join(destination, entry.name));
  }
}
