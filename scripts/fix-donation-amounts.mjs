// One-off. Re-read each stored donation from the mirror and keep only the
// HBAR the payer sent. A staking reward paid in that same transaction used
// to be counted as part of the gift. Prints old -> new. Leaves a row alone
// when the mirror does not confirm a positive donation.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assessTransfer, formatHbar, mirrorTxPath, transactionRow } from "../donationmath.js";

const MIRROR = "https://mainnet.mirrornode.hedera.com";
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(process.env.DATA_DIR || path.join(here, "../server"), "data.db");

const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT tx_id, to_acct, amount_tinybar FROM donations").all();
const update = db.prepare("UPDATE donations SET amount_tinybar = ? WHERE tx_id = ?");

for (const row of rows) {
  const oldHbar = formatHbar(row.amount_tinybar);
  const txPath = mirrorTxPath(row.tx_id);
  if (!txPath) {
    console.log(`${row.tx_id} ${oldHbar} -> (bad transaction id)`);
    continue;
  }
  const res = await fetch(`${MIRROR}/api/v1/transactions/${txPath}`);
  if (!res.ok) {
    console.log(`${row.tx_id} ${oldHbar} -> (mirror ${res.status})`);
    continue;
  }
  const tx = transactionRow(await res.json(), row.tx_id);
  const assessed = tx ? assessTransfer(tx, row.to_acct) : { error: "transaction not found" };
  if (assessed.error) {
    console.log(`${row.tx_id} ${oldHbar} -> (${assessed.error})`);
    continue;
  }
  const next = assessed.amount.toString();
  const newHbar = formatHbar(next);
  if (next !== String(row.amount_tinybar)) update.run(next, row.tx_id);
  console.log(`${row.tx_id} ${oldHbar} -> ${newHbar}`);
}

db.close();
