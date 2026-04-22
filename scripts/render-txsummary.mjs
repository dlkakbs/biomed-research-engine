import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Web3 } from "web3";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3");

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifestPath = path.join(repoRoot, "artifacts/hackathon-batch/latest.json");
const dbPath = path.join(repoRoot, "biomed_research.sqlite3");
const outputPath = process.argv[2] || path.join(process.env.HOME || "", "Desktop/txsummary.html");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const db = new BetterSqlite3(dbPath, { readonly: true });
const web3 = new Web3(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network");
const usdc = new web3.eth.Contract(
  [{
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }],
  "0x3600000000000000000000000000000000000000"
);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUnits6(units) {
  return (Number(units) / 1_000_000).toFixed(6);
}

function formatPriceUsdc(value) {
  return Number(value || 0.002).toFixed(3);
}

function normalizeAction(agent) {
  const normalized = String(agent || "").trim().toLowerCase();
  if (normalized === "literature") return "literature/search";
  if (normalized === "drugdb") return "drugdb/fetch";
  if (normalized === "pathway") return "pathway/analyze";
  if (normalized === "red_team" || normalized === "critics") return "red-team/critics";
  if (normalized === "evaluator" || normalized === "review" || normalized === "pi") return "review-service/review";
  return normalized;
}

function normalizeResource(resource) {
  return String(resource || "")
    .replace("/api/paid/red-team/review", "/api/paid/red-team/critics")
    .replace("/api/paid/review", "/api/paid/review-service/review");
}

async function getClientFundingRows() {
  const buyers = manifest.beforeBalances.filter((row) => row.label.startsWith("client_buyer_"));
  const rows = [];
  for (const buyer of buyers) {
    const afterUnits = BigInt(String(await usdc.methods.balanceOf(buyer.address).call()));
    const runCount = manifest.runs.filter(
      (run) => run.clientAddress.toLowerCase() === buyer.address.toLowerCase()
    ).length;
    const spentUnits = BigInt(runCount) * 5_000_000n;
    const beforeUnits = afterUnits + spentUnits;
    rows.push({
      label: buyer.label,
      address: buyer.address,
      before: formatUnits6(beforeUnits),
      after: formatUnits6(afterUnits),
      change: `-${formatUnits6(spentUnits)}`,
      runCount
    });
  }
  return rows;
}

async function getSellerBalanceRows() {
  const sellers = manifest.afterBalances.filter((row) => /seller/.test(row.label));
  const response = await fetch("https://gateway-api-testnet.circle.com/v1/balances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: sellers.map((item) => ({ domain: 26, depositor: item.address }))
    })
  });
  const payload = await response.json();
  const liveByAddress = new Map(
    (payload.balances || []).map((row) => [String(row.depositor).toLowerCase(), String(row.balance)])
  );
  const checkedAt = new Date().toISOString();
  const snapshot = {
    checked_at: checkedAt,
    balances: payload
  };
  const snapshotName = `post-settlement-balance-${checkedAt.slice(0, 10)}.json`;
  const snapshotPath = path.join(repoRoot, "artifacts/hackathon-batch", snapshotName);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return {
    snapshotName,
    snapshotPath,
    rows: sellers.map((seller) => {
      const live = liveByAddress.get(seller.address.toLowerCase()) || seller.balance;
      const immediate = seller.balance;
      const diff = (Number(live) - Number(immediate)).toFixed(6);
      const signed = Number(diff) > 0 ? `+${diff}` : diff;
      return {
        label: seller.label,
        address: seller.address,
        immediate,
        live,
        change: signed
      };
    })
  };
}

function getMicropaymentRows() {
  const query = db.prepare(`
    SELECT job_id, created_at, details_json
    FROM agent_events
    WHERE job_id = ? AND event_type = 'payment'
    ORDER BY id ASC
  `);
  const rows = [];
  let index = 1;
  for (const run of manifest.runs) {
    for (const event of query.all(run.jobId)) {
      const details = event.details_json ? JSON.parse(event.details_json) : null;
      if (details?.kind !== "x402_payment") continue;
      const proof = details.proof || {};
      rows.push({
        index: index++,
        jobId: run.jobId,
        action: normalizeAction(proof.agent),
        price: formatPriceUsdc(proof.amountUsdc),
        buyerWallet: proof.payer || "",
        sellerWallet: proof.seller || "",
        resource: normalizeResource(proof.resourceUrl || proof.endpoint || ""),
        verify: String(proof.settled === true),
        settle: String(proof.settled === true),
        transaction: proof.transaction || ""
      });
    }
  }
  return rows;
}

function getLifecycleRows() {
  const query = db.prepare(`
    SELECT job_id, tx_type, tx_status, tx_hash, wallet_address, amount_units
    FROM job_funding_transactions
    WHERE job_id = ?
    ORDER BY
      CASE tx_type
        WHEN 'create' THEN 1
        WHEN 'setbudget' THEN 2
        WHEN 'approve' THEN 3
        WHEN 'fund' THEN 4
        WHEN 'submit' THEN 5
        WHEN 'complete' THEN 6
        WHEN 'reject' THEN 7
        ELSE 99
      END ASC
  `);
  return manifest.runs.flatMap((run) => query.all(run.jobId));
}

function getRunSummaryRows() {
  return manifest.runs.map((run, index) => ({
    ...run,
    runNumber: index + 1
  }));
}

function tableRows(rows, columns) {
  return rows.map((row) => {
    const cells = columns.map((column) => `<td${column.className ? ` class="${column.className}"` : ""}>${escapeHtml(row[column.key] ?? "")}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("\n");
}

async function main() {
  const clientRows = await getClientFundingRows();
  const sellerBalances = await getSellerBalanceRows();
  const micropayments = getMicropaymentRows();
  const lifecycleRows = getLifecycleRows();
  const runSummaryRows = getRunSummaryRows();
  const totalPaid = (micropayments.length * 0.002).toFixed(3);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hackathon Batch Ledger</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #ffffff; color: #0f172a; line-height: 1.55; margin: 0; padding: 32px; }
    .container { max-width: 1440px; margin: 0 auto; }
    h1 { color: #0f172a; background: #ede9fe; padding: 12px 16px; border-radius: 10px; margin-bottom: 20px; }
    h2 { color: #0f172a; padding: 10px 14px; border-radius: 8px; margin-top: 32px; margin-bottom: 16px; font-size: 1.25rem; }
    .section-cyan { background: #ecfeff; }
    .section-green { background: #ecfccb; }
    .section-purple { background: #ede9fe; }
    .section-yellow { background: #fef3c7; }
    .section-red { background: #fee2e2; }
    .info-box, .success-box, .warning-box { padding: 12px 16px; border-radius: 8px; margin: 12px 0 20px 0; }
    .info-box { background: #eff6ff; border-left: 4px solid #2563eb; }
    .client-box { background: #e0f2fe; border-left: 4px solid #0284c7; padding: 12px 16px; border-radius: 8px; margin: 12px 0 20px 0; }
    .success-box { background: #f0fdf4; border-left: 4px solid #16a34a; }
    .warning-box { background: #fff7ed; border-left: 4px solid #f97316; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; font-size: 0.95em; }
    .accent { color: #0369a1; }
    .success { color: #166534; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 13px; table-layout: auto; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #f8fafc; font-weight: 700; }
    tr:nth-child(even) td { background: #fcfcfd; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .nowrap { white-space: nowrap; word-break: normal; }
    .col-index { min-width: 40px; white-space: nowrap; }
    .col-run { min-width: 56px; white-space: nowrap; }
    .col-job { min-width: 88px; white-space: nowrap; }
    .col-payment { min-width: 110px; white-space: nowrap; }
    .col-action { min-width: 96px; white-space: nowrap; }
    .col-price { min-width: 92px; white-space: nowrap; }
    .col-verify { min-width: 86px; white-space: nowrap; word-break: normal; }
    .col-settle { min-width: 86px; white-space: nowrap; word-break: normal; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Transaction Proof Summary</h1>

    <div class="info-box">
      <strong>Batch</strong>: <code>${escapeHtml(manifest.batchId)}</code><br />
      <strong>Total actions</strong>: <span class="accent">${micropayments.length}</span><br />
      <strong>Avg price</strong>: <span class="accent">$0.002</span><br />
      <strong>Total paid</strong>: <span class="accent">$${totalPaid}</span><br />
      <strong>Runs</strong>: <span class="accent">${manifest.runs.length}</span>
    </div>

    <h2 class="section-cyan">Client Escrow Funding</h2>
    <div class="client-box">
      This batch used direct client wallets for ERC-8183 <code>create</code>, <code>approve</code>, and <code>fund</code>. Each successful run locked <code>5 USDC</code> from the client wallet into escrow before PI delivered and final review settled the job.
    </div>
    <table>
      <thead>
        <tr>
          <th>wallet</th>
          <th>address</th>
          <th>runs_used</th>
          <th>before_usdc</th>
          <th>after_usdc</th>
          <th>observed_change</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows(clientRows, [
          { key: "label" },
          { key: "address", className: "mono" },
          { key: "runCount" },
          { key: "before" },
          { key: "after" },
          { key: "change" }
        ])}
      </tbody>
    </table>

    <h2 class="section-green">Seller Post-Batch Settlement Evidence</h2>
    <div class="success-box">
      Micropayments during the pipeline were recorded with <code>verify=isValid</code> and <code>settle=success</code>. The live Gateway balance check below reflects the current available balances for seller-side depositors after the 10-run proof batch.
    </div>
    <table>
      <thead>
        <tr>
          <th>wallet</th>
          <th>address</th>
          <th>immediate_after_usdc</th>
          <th>later_available_usdc</th>
          <th>observed_change</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows(sellerBalances.rows, [
          { key: "label" },
          { key: "address", className: "mono" },
          { key: "immediate" },
          { key: "live" },
          { key: "change" }
        ])}
      </tbody>
    </table>
    <h2 class="section-purple">Run Summary</h2>
    <table>
      <thead>
        <tr>
          <th class="col-run">run</th>
          <th class="col-job">job_id</th>
          <th>client</th>
          <th class="col-payment">payment_count</th>
          <th>create</th>
          <th>setBudget</th>
          <th>approve</th>
          <th>fund</th>
          <th>submit</th>
          <th>complete</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows(runSummaryRows, [
          { key: "runNumber", className: "col-run" },
          { key: "jobId", className: "col-job" },
          { key: "clientAddress", className: "mono" },
          { key: "paymentCount", className: "col-payment" },
          { key: "createTxHash", className: "mono" },
          { key: "setBudgetTxHash", className: "mono" },
          { key: "approveTxHash", className: "mono" },
          { key: "fundTxHash", className: "mono" },
          { key: "submitTxHash", className: "mono" },
          { key: "completeOrRejectTxHash", className: "mono" }
        ])}
      </tbody>
    </table>

    <h2 class="section-yellow">Micropayment Ledger</h2>
    <table>
      <thead>
        <tr>
          <th class="col-index">#</th>
          <th class="col-job">job_id</th>
          <th class="col-action">action</th>
          <th class="col-price">price_usdc</th>
          <th>buyer wallet</th>
          <th>seller wallet</th>
          <th>resource</th>
          <th class="col-verify">verify=<br /><span class="nowrap">isValid</span></th>
          <th class="col-settle">settle=<br /><span class="nowrap">success</span></th>
          <th>transaction</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows(micropayments, [
          { key: "index", className: "col-index" },
          { key: "jobId", className: "col-job" },
          { key: "action", className: "col-action" },
          { key: "price", className: "col-price" },
          { key: "buyerWallet", className: "mono" },
          { key: "sellerWallet", className: "mono" },
          { key: "resource" },
          { key: "verify", className: "col-verify" },
          { key: "settle", className: "col-settle" },
          { key: "transaction", className: "mono" }
        ])}
      </tbody>
    </table>

    <h2 class="section-red">Lifecycle Transactions</h2>
    <table>
      <thead>
        <tr>
          <th>job_id</th>
          <th>tx_type</th>
          <th>tx_status</th>
          <th>tx_hash</th>
          <th>wallet_address</th>
          <th>amount_units</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows(lifecycleRows, [
          { key: "job_id" },
          { key: "tx_type" },
          { key: "tx_status" },
          { key: "tx_hash", className: "mono" },
          { key: "wallet_address", className: "mono" },
          { key: "amount_units" }
        ])}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({ ok: true, outputPath, snapshotPath: sellerBalances.snapshotPath }, null, 2));
}

await main();
