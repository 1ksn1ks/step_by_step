// Restore one SQLite backup from R2. Not an HTTP route.
// Usage: node scripts/restore-backup.js <backup-key> <output.sqlite>
// Loads server/.env for R2_*, R2_BUCKET, and BACKUP_ENCRYPTION_KEY.
// The backup key is the object name, not a URL. An existing output file is left untouched.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { restoreBackup, r2ClientFromEnv } from "../server/backup.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "server", ".env"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const objectKey = process.argv[2];
const destPath = process.argv[3] ? path.resolve(process.argv[3]) : "";

if (!objectKey || !destPath) {
  console.error("Usage: node scripts/restore-backup.js <backup-key> <output.sqlite>");
  process.exit(1);
}

try {
  const { client, bucket } = r2ClientFromEnv();
  await restoreBackup({ r2: client, bucket, objectKey, destPath });
  console.log(`restored ${destPath}`);
} catch (err) {
  const prefix = String(process.env.BACKUP_PREFIX || "").trim();
  const secret = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  let message = err && err.message ? String(err.message) : "restore failed";
  if (prefix.length >= 8) message = message.split(prefix).join("[redacted]");
  if (secret.length >= 8) message = message.split(secret).join("[redacted]");
  if (objectKey.length >= 8) message = message.split(objectKey).join("[redacted]");
  console.error(message.slice(0, 300));
  process.exit(1);
}
