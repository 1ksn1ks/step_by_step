// Prints the real reason if the server dies during import or startup.
// Railway's healthcheck only says "service unavailable" when nothing is listening.
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.DATA_DIR || path.dirname(fileURLToPath(import.meta.url));
console.log(
  `boot node ${process.version} port=${process.env.PORT || "(unset)"} DATA_DIR=${DATA_DIR}`
);
try {
  await import("./index.js");
} catch (err) {
  console.error("backend failed to start");
  console.error(err);
  process.exit(1);
}
