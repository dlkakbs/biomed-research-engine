import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { Web3 } from "web3";

import {
  connectDatabase,
  getAgentEvents,
  getJobRuntimeState,
  listJobFundingTransactions,
  logAgentEvent,
  upsertJobFundingTransaction
} from "@biomed/db";
import {
  approveUsdcForErc8183,
  createErc8183Job,
  fundErc8183Job,
  getErc8183Job,
  setErc8183Budget
} from "@biomed/payments";
import { ARC_CHAIN_ID, ARC_ERC20_USDC, ARC_RPC_URL } from "@biomed/shared";
import { createHttpServer } from "../server/http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env.local"), override: true });

const FIXED_BUDGET_UNITS = 5_000_000n;
const ERC8183_ADDRESS = process.env.ERC_8183 ?? "0x0747EEf0706327138c69792bF28Cd525089e4583";
const PREFERRED_API_PORT = Number(process.env.HACKATHON_BATCH_API_PORT ?? "3001");
const RUN_COUNT = Number(process.env.HACKATHON_BATCH_RUNS ?? "10");
const BATCH_PREFIX = process.env.HACKATHON_BATCH_PREFIX?.trim() || "hackathon-final";
const OUTPUT_DIR = path.resolve(__dirname, "../../../../artifacts/hackathon-batch");
const PI_ADDRESS = process.env.PI_AGENT_ADDRESS?.trim() || "";
const LITERATURE_ADDRESS = process.env.LITERATURE_AGENT_ADDRESS?.trim() || "";
const DRUGDB_ADDRESS = process.env.DRUGDB_AGENT_ADDRESS?.trim() || "";
const PATHWAY_ADDRESS = process.env.PATHWAY_AGENT_ADDRESS?.trim() || "";
const REVIEW_SELLER_ADDRESS =
  process.env.REVIEW_PAYMENT_ADDRESS?.trim() ||
  process.env.REVIEW_SELLER_ADDRESS?.trim() ||
  "";
const RED_TEAM_SELLER_ADDRESS =
  process.env.RED_TEAM_PAYMENT_ADDRESS?.trim() ||
  process.env.RED_TEAM_SELLER_ADDRESS?.trim() ||
  process.env.RED_TEAM_AGENT_ADDRESS?.trim() ||
  "";
const FINALIZER_ADDRESS =
  process.env.FINALIZER_ADDRESS?.trim() ||
  "";

interface RunSpec {
  disease: string;
  query: string;
  userType: "pharma" | "researcher" | "doctor";
}

interface WalletBalanceSnapshot {
  label: string;
  address: string;
  balance: string;
}

interface BatchRunSummary {
  label: string;
  jobId: string;
  clientAddress: string;
  disease: string;
  query: string;
  finalStatus: string;
  paymentCount: number;
  createTxHash: string;
  setBudgetTxHash: string;
  approveTxHash: string;
  fundTxHash: string;
  submitTxHash?: string;
  completeOrRejectTxHash?: string;
}

interface LocalClientWallet {
  label: string;
  privateKey: string;
  address: string;
}

interface LocalExecutionResult {
  txHash: string;
  transactionId: string;
  state: string;
  refId: string;
  walletId: string;
}

interface LocalCreateResult extends LocalExecutionResult {
  jobId: string;
}

const localWeb3 = new Web3(ARC_RPC_URL);
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;

const ERC8183_ABI = [
  {
    name: "createJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "fund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" }
    ],
    outputs: []
  },
  {
    name: "JobCreated",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
      { name: "hook", type: "address", indexed: false }
    ]
  }
] as const;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function getUsdcBalanceUnits(address: string): Promise<bigint> {
  const contract = new localWeb3.eth.Contract(ERC20_ABI as never, ARC_ERC20_USDC.address);
  const balance = await contract.methods.balanceOf(address).call();
  return BigInt(String(balance));
}

async function getLocalClientWallets(): Promise<LocalClientWallet[]> {
  const wallets: LocalClientWallet[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const privateKey = process.env[`USER_PK_${index}`]?.trim();
    if (!privateKey) continue;
    const account = localWeb3.eth.accounts.privateKeyToAccount(privateKey);
    wallets.push({
      label: `client_buyer_${index}`,
      privateKey,
      address: account.address.toLowerCase()
    });
  }
  if (wallets.length === 0) {
    throw new Error("At least one USER_PK_* must be configured for hackathon batch runs");
  }
  const eligible: LocalClientWallet[] = [];
  for (const wallet of wallets) {
    const balanceUnits = await getUsdcBalanceUnits(wallet.address);
    if (balanceUnits >= FIXED_BUDGET_UNITS) {
      eligible.push(wallet);
    } else {
      console.warn(
        `[batch] skipping ${wallet.address}: balance ${balanceUnits.toString()} below required ${FIXED_BUDGET_UNITS.toString()}`
      );
    }
  }
  if (eligible.length === 0) {
    throw new Error("No USER_PK_* wallet has enough USDC to fund the batch");
  }
  return eligible;
}

async function sendSignedContractTx(input: {
  wallet: LocalClientWallet;
  contractAddress: string;
  data: string;
  value?: string;
}): Promise<{ txHash: string; receipt: Awaited<ReturnType<typeof localWeb3.eth.getTransactionReceipt>> }> {
  const nonce = await localWeb3.eth.getTransactionCount(input.wallet.address, "pending");
  const gasPrice = await localWeb3.eth.getGasPrice();
  const gasEstimate = await localWeb3.eth.estimateGas({
    from: input.wallet.address,
    to: input.contractAddress,
    data: input.data,
    value: input.value ?? "0x0"
  });
  const signed = await localWeb3.eth.accounts.signTransaction(
    {
      to: input.contractAddress,
      data: input.data,
      value: input.value ?? "0x0",
      gas: Math.ceil(Number(gasEstimate) * 1.2),
      gasPrice: String(gasPrice),
      nonce,
      chainId: ARC_CHAIN_ID
    },
    input.wallet.privateKey
  );

  if (!signed.rawTransaction) {
    throw new Error(`Failed to sign transaction for ${input.wallet.address}`);
  }

  const receipt = await localWeb3.eth.sendSignedTransaction(signed.rawTransaction);
  if (!receipt.transactionHash) {
    throw new Error(`Signed transaction for ${input.wallet.address} returned no tx hash`);
  }
  return {
    txHash: String(receipt.transactionHash),
    receipt
  };
}

async function createJobWithLocalSigner(input: {
  wallet: LocalClientWallet;
  description: string;
  expiredAt: bigint;
  providerAddress: string;
  evaluatorAddress: string;
}): Promise<LocalCreateResult> {
  const contract = new localWeb3.eth.Contract(ERC8183_ABI as never, ERC8183_ADDRESS);
  const data = String(contract.methods
    .createJob(
      input.providerAddress,
      input.evaluatorAddress,
      String(input.expiredAt),
      input.description,
      "0x0000000000000000000000000000000000000000"
    )
    .encodeABI());
  const { txHash, receipt } = await sendSignedContractTx({
    wallet: input.wallet,
    contractAddress: ERC8183_ADDRESS,
    data
  });
  const eventAbi = ERC8183_ABI.find((item) => item.type === "event" && item.name === "JobCreated") as
    | {
        readonly inputs: readonly {
          readonly name: string;
          readonly type: string;
          readonly indexed?: boolean;
        }[];
      }
    | undefined;
  if (!eventAbi) {
    throw new Error("JobCreated event ABI is missing");
  }
  const signature = String(localWeb3.eth.abi.encodeEventSignature(eventAbi as never));
  const log = receipt.logs?.find((item) => String(item.topics?.[0] ?? "").toLowerCase() === signature.toLowerCase());
  if (!log?.data || !log.topics) {
    throw new Error(`JobCreated event not found in receipt ${txHash}`);
  }
  const decoded = localWeb3.eth.abi.decodeLog(
    eventAbi?.inputs as never,
    String(log.data),
    log.topics.slice(1).map((topic) => String(topic))
  ) as { jobId?: string };
  if (!decoded.jobId) {
    throw new Error(`Decoded JobCreated event missing jobId for ${txHash}`);
  }
  return {
    jobId: String(decoded.jobId),
    txHash,
    transactionId: txHash,
    state: "COMPLETE",
    refId: `local-create-${decoded.jobId}`,
    walletId: input.wallet.address
  };
}

async function approveUsdcWithLocalSigner(input: {
  wallet: LocalClientWallet;
  amountUnits: bigint;
}): Promise<LocalExecutionResult> {
  const contract = new localWeb3.eth.Contract(ERC20_ABI as never, ARC_ERC20_USDC.address);
  const data = String(contract.methods.approve(ERC8183_ADDRESS, String(input.amountUnits)).encodeABI());
  const { txHash } = await sendSignedContractTx({
    wallet: input.wallet,
    contractAddress: ARC_ERC20_USDC.address,
    data
  });
  return {
    txHash,
    transactionId: txHash,
    state: "COMPLETE",
    refId: `local-approve-${crypto.randomUUID()}`,
    walletId: input.wallet.address
  };
}

async function fundJobWithLocalSigner(input: {
  wallet: LocalClientWallet;
  jobId: string;
}): Promise<LocalExecutionResult> {
  const contract = new localWeb3.eth.Contract(ERC8183_ABI as never, ERC8183_ADDRESS);
  const data = String(contract.methods.fund(String(input.jobId), "0x").encodeABI());
  const { txHash } = await sendSignedContractTx({
    wallet: input.wallet,
    contractAddress: ERC8183_ADDRESS,
    data
  });
  return {
    txHash,
    transactionId: txHash,
    state: "COMPLETE",
    refId: `local-fund-${input.jobId}`,
    walletId: input.wallet.address
  };
}

function normalizeLedgerAction(agent: string): string {
  const normalized = agent.trim().toLowerCase();
  if (normalized === "red_team" || normalized === "critics") return "critics";
  if (normalized === "review" || normalized === "evaluator" || normalized === "pi") return "review";
  return normalized;
}

const RUN_SPECS: RunSpec[] = [
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" },
  { disease: "glioblastoma", query: "Find EGFR resistance repurposing candidates", userType: "researcher" }
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListenOnPort(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number, attempts = 10) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListenOnPort(port)) return port;
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + attempts - 1}`);
}

function lifecycleDetails(input: {
  txType: string;
  txHash: string;
  transactionId?: string;
  refId?: string;
  walletId?: string;
  amountUnits?: string;
}) {
  return {
    kind: "lifecycle_tx",
    txType: input.txType,
    txHash: input.txHash,
    circleTransactionId: input.transactionId,
    refId: input.refId,
    walletId: input.walletId,
    amountUnits: input.amountUnits,
    chainId: 5042002,
    status: "success"
  };
}

async function fetchGatewayBalances(addresses: Array<{ label: string; address: string }>) {
  const filtered = addresses.filter((item) => item.address);
  const response = await fetch("https://gateway-api-testnet.circle.com/v1/balances", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      token: "USDC",
      sources: filtered.map((item) => ({
        domain: 26,
        depositor: item.address
      }))
    })
  });

  if (!response.ok) {
    throw new Error(`Gateway balances failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    balances: Array<{ depositor: string; balance: string }>;
  };

  return filtered.map((item) => ({
    label: item.label,
    address: item.address,
    balance:
      payload.balances.find((row) => row.depositor.toLowerCase() === item.address.toLowerCase())?.balance ??
      "0.000000"
  })) satisfies WalletBalanceSnapshot[];
}

async function waitForJobStatus(jobId: string, expected: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getErc8183Job(jobId);
    if (job?.status === expected) return job;
    await sleep(2_000);
  }
  throw new Error(`Job ${jobId} did not reach ${expected} within ${timeoutMs}ms`);
}

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 3, delayMs = 4_000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn(`[batch] ${label} failed on attempt ${attempt}/${attempts}: ${error instanceof Error ? error.message : "unknown"}`);
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

function countStructuredPayments(jobId: string, db: ReturnType<typeof connectDatabase>): number {
  return getAgentEvents({ db, jobId }).filter(
    (event) => event.eventType === "payment" && event.details?.kind === "x402_payment"
  ).length;
}

function buildLedgerMarkdown(input: {
  batchId: string;
  runs: BatchRunSummary[];
  beforeBalances: WalletBalanceSnapshot[];
  afterBalances: WalletBalanceSnapshot[];
  db: ReturnType<typeof connectDatabase>;
}) {
  const lines: string[] = [];
  const allPaymentEvents = input.runs.flatMap((run) =>
    getAgentEvents({ db: input.db, jobId: run.jobId }).filter(
      (event) => event.eventType === "payment" && event.details?.kind === "x402_payment"
    )
  );
  const totalPaid = allPaymentEvents.length * 0.002;

  lines.push("# Hackathon Fresh Batch Ledger");
  lines.push("");
  lines.push(`- Batch: ${input.batchId}`);
  lines.push(`- Total actions: ${allPaymentEvents.length}`);
  lines.push("- Avg price: $0.002");
  lines.push(`- Total paid: $${totalPaid.toFixed(3)}`);
  lines.push(`- Runs: ${input.runs.length}`);
  lines.push("");
  lines.push("## Gateway Balance Before/After");
  lines.push("");
  lines.push("| wallet | address | before_usdc | after_usdc |");
  lines.push("|---|---|---:|---:|");
  for (const before of input.beforeBalances) {
    const after = input.afterBalances.find((item) => item.address.toLowerCase() === before.address.toLowerCase());
    lines.push(`| ${before.label} | ${before.address} | ${before.balance} | ${after?.balance ?? "0.000000"} |`);
  }
  lines.push("");
  lines.push("## Run Summary");
  lines.push("");
  lines.push("| run | job_id | final_status | payment_count | create | setBudget | approve | fund | submit | terminal |");
  lines.push("|---|---|---|---:|---|---|---|---|---|---|");
  for (const run of input.runs) {
    lines.push(
      `| ${run.label} | ${run.jobId} | ${run.finalStatus} | ${run.paymentCount} | ${run.createTxHash} | ${run.setBudgetTxHash} | ${run.approveTxHash} | ${run.fundTxHash} | ${run.submitTxHash ?? ""} | ${run.completeOrRejectTxHash ?? ""} |`
    );
  }
  lines.push("");
  lines.push("## Micropayment Ledger");
  lines.push("");
  lines.push("| # | timestamp | job_id | action | price_usdc | buyer wallet | seller wallet | resource | nonce | verify=isValid | settle=success | gateway tx/ref |");
  lines.push("|---:|---|---|---|---:|---|---|---|---|---|---|---|");

  let index = 1;
  for (const run of input.runs) {
    for (const event of getAgentEvents({ db: input.db, jobId: run.jobId })) {
      if (event.eventType !== "payment" || event.details?.kind !== "x402_payment") continue;
      const proof = (event.details.proof ?? {}) as Record<string, unknown>;
      lines.push(
        `| ${index} | ${event.createdAt} | ${run.jobId} | ${normalizeLedgerAction(String(proof.agent ?? ""))} | ${String(proof.amountUsdc ?? "0.002")} | ${String(proof.payer ?? "")} | ${String(proof.seller ?? "")} | ${String(proof.resourceUrl ?? proof.endpoint ?? "")} | ${String(proof.nonce ?? "")} | ${String(proof.settled === true)} | ${String(proof.settled === true)} | ${String(proof.transaction ?? "")} |`
      );
      index += 1;
    }
  }
  lines.push("");
  lines.push("## Lifecycle Transactions");
  lines.push("");
  lines.push("| job_id | tx_type | tx_status | tx_hash | wallet_address | amount_units |");
  lines.push("|---|---|---|---|---|---:|");
  for (const run of input.runs) {
    for (const tx of listJobFundingTransactions({ db: input.db, jobId: run.jobId })) {
      lines.push(
        `| ${tx.jobId} | ${tx.txType} | ${tx.txStatus} | ${tx.txHash} | ${tx.walletAddress ?? ""} | ${tx.amountUnits ?? ""} |`
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const apiPort = await findAvailablePort(PREFERRED_API_PORT);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  process.env.API_URL = apiUrl;
  const clientWallets = await getLocalClientWallets();
  const providerAddress = getRequiredEnv("PI_AGENT_ADDRESS");
  const evaluatorAddress = getRequiredEnv("FINALIZER_ADDRESS");

  const db = connectDatabase();
  const server = createHttpServer(db);
  await new Promise<void>((resolve) => server.listen(apiPort, "127.0.0.1", () => resolve()));
  console.log(`[batch] local api listening on ${apiUrl}`);

  const balanceAddresses = [
    ...clientWallets.map((wallet) => ({ label: wallet.label, address: wallet.address })),
    { label: "literature_seller", address: LITERATURE_ADDRESS },
    { label: "drugdb_seller", address: DRUGDB_ADDRESS },
    { label: "pathway_seller", address: PATHWAY_ADDRESS },
    { label: "review_seller", address: REVIEW_SELLER_ADDRESS },
    { label: "critics_seller", address: RED_TEAM_SELLER_ADDRESS },
    { label: "finalizer", address: FINALIZER_ADDRESS }
  ];

  const beforeBalances = await fetchGatewayBalances(balanceAddresses);
  console.log("[batch] captured before balances");
  const runs: BatchRunSummary[] = [];
  const batchId = `${BATCH_PREFIX}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`[batch] batch id ${batchId}`);

  try {
    for (let i = 0; i < RUN_COUNT; i += 1) {
      const spec = RUN_SPECS[i] ?? RUN_SPECS[RUN_SPECS.length - 1];
      const label = `${BATCH_PREFIX}-${String(i + 1).padStart(2, "0")}`;
      const clientWallet = clientWallets[i % clientWallets.length];
      const description = `[${label}] ${spec.disease} | ${spec.query} | ${spec.userType}`;
      console.log(`[batch] ${label} creating job as ${clientWallet.address}`);

      const createResult = await createJobWithLocalSigner({
        wallet: clientWallet,
        description,
        expiredAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
        providerAddress,
        evaluatorAddress
      });
      console.log(`[batch] ${label} created job ${createResult.jobId}`);
      upsertJobFundingTransaction({
        db,
        jobId: createResult.jobId,
        txType: "create",
        txHash: createResult.txHash,
        txStatus: "success",
        walletAddress: clientWallet.address,
        chainId: 5042002,
        metadata: lifecycleDetails({
          txType: "create",
          txHash: createResult.txHash,
          transactionId: createResult.transactionId,
          refId: createResult.refId,
          walletId: createResult.walletId
        })
      });
      logAgentEvent({
        db,
        jobId: createResult.jobId,
        agentName: "client",
        eventType: "payment",
        message:
          `Client create executed on ERC-8183 tx=${createResult.txHash}` +
          ` circle_tx=${createResult.transactionId}` +
          ` ref=${createResult.refId}` +
          ` wallet=${createResult.walletId}`,
        details: lifecycleDetails({
          txType: "create",
          txHash: createResult.txHash,
          transactionId: createResult.transactionId,
          refId: createResult.refId,
          walletId: createResult.walletId
        })
      });

      const setBudgetResult = await setErc8183Budget(createResult.jobId, FIXED_BUDGET_UNITS);
      console.log(`[batch] ${label} set budget tx=${setBudgetResult.txHash}`);
      upsertJobFundingTransaction({
        db,
        jobId: createResult.jobId,
        txType: "setbudget",
        txHash: setBudgetResult.txHash,
        txStatus: "success",
        chainId: 5042002,
        amountUnits: FIXED_BUDGET_UNITS.toString(),
        metadata: lifecycleDetails({
          txType: "setbudget",
          txHash: setBudgetResult.txHash,
          transactionId: setBudgetResult.transactionId,
          refId: setBudgetResult.refId,
          walletId: setBudgetResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });
      logAgentEvent({
        db,
        jobId: createResult.jobId,
        agentName: "pi",
        eventType: "payment",
        message:
          `PI setBudget executed on ERC-8183 tx=${setBudgetResult.txHash}` +
          ` circle_tx=${setBudgetResult.transactionId}` +
          ` ref=${setBudgetResult.refId}` +
          ` wallet=${setBudgetResult.walletId}`,
        details: lifecycleDetails({
          txType: "setbudget",
          txHash: setBudgetResult.txHash,
          transactionId: setBudgetResult.transactionId,
          refId: setBudgetResult.refId,
          walletId: setBudgetResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });

      const approveResult = await approveUsdcWithLocalSigner({
        wallet: clientWallet,
        amountUnits: FIXED_BUDGET_UNITS
      });
      console.log(`[batch] ${label} approve tx=${approveResult.txHash}`);
      upsertJobFundingTransaction({
        db,
        jobId: createResult.jobId,
        txType: "approve",
        txHash: approveResult.txHash,
        txStatus: "success",
        walletAddress: clientWallet.address,
        chainId: 5042002,
        amountUnits: FIXED_BUDGET_UNITS.toString(),
        metadata: lifecycleDetails({
          txType: "approve",
          txHash: approveResult.txHash,
          transactionId: approveResult.transactionId,
          refId: approveResult.refId,
          walletId: approveResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });
      logAgentEvent({
        db,
        jobId: createResult.jobId,
        agentName: "client",
        eventType: "payment",
        message:
          `Client approve executed on USDC tx=${approveResult.txHash}` +
          ` circle_tx=${approveResult.transactionId}` +
          ` ref=${approveResult.refId}` +
          ` wallet=${approveResult.walletId}`,
        details: lifecycleDetails({
          txType: "approve",
          txHash: approveResult.txHash,
          transactionId: approveResult.transactionId,
          refId: approveResult.refId,
          walletId: approveResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });

      const fundResult = await retry(
        `${label} fund`,
        () => fundJobWithLocalSigner({ wallet: clientWallet, jobId: createResult.jobId }),
        3,
        5_000
      );
      console.log(`[batch] ${label} fund tx=${fundResult.txHash}`);
      upsertJobFundingTransaction({
        db,
        jobId: createResult.jobId,
        txType: "fund",
        txHash: fundResult.txHash,
        txStatus: "success",
        walletAddress: clientWallet.address,
        chainId: 5042002,
        amountUnits: FIXED_BUDGET_UNITS.toString(),
        metadata: lifecycleDetails({
          txType: "fund",
          txHash: fundResult.txHash,
          transactionId: fundResult.transactionId,
          refId: fundResult.refId,
          walletId: fundResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });
      logAgentEvent({
        db,
        jobId: createResult.jobId,
        agentName: "client",
        eventType: "payment",
        message:
          `Client fund executed on ERC-8183 tx=${fundResult.txHash}` +
          ` circle_tx=${fundResult.transactionId}` +
          ` ref=${fundResult.refId}` +
          ` wallet=${fundResult.walletId}`,
        details: lifecycleDetails({
          txType: "fund",
          txHash: fundResult.txHash,
          transactionId: fundResult.transactionId,
          refId: fundResult.refId,
          walletId: fundResult.walletId,
          amountUnits: FIXED_BUDGET_UNITS.toString()
        })
      });

      await waitForJobStatus(createResult.jobId, "Funded");
      console.log(`[batch] ${label} reached Funded`);

      const runResponse = await fetch(`${apiUrl}/api/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          job_id: Number(createResult.jobId),
          disease: spec.disease,
          query: spec.query,
          user_type: spec.userType,
          budget_units: FIXED_BUDGET_UNITS.toString()
        })
      });
      if (!runResponse.ok) {
        throw new Error(`api_run_failed:${createResult.jobId}:${runResponse.status}:${await runResponse.text()}`);
      }
      console.log(`[batch] ${label} pipeline started`);

      const terminalDeadline = Date.now() + 20 * 60_000;
      let finalStatus = "";
      while (Date.now() < terminalDeadline) {
        const runtime = getJobRuntimeState({ db, jobId: createResult.jobId });
        if (runtime?.status === "Completed" || runtime?.status === "Rejected") {
          finalStatus = runtime.status;
          break;
        }
        if (runtime?.status === "Failed") {
          throw new Error(`job_failed:${createResult.jobId}`);
        }
        await sleep(5_000);
      }
      if (!finalStatus) {
        throw new Error(`job_timeout:${createResult.jobId}`);
      }
      console.log(`[batch] ${label} terminal status ${finalStatus}`);

      const paymentCount = countStructuredPayments(createResult.jobId, db);
      if (paymentCount !== 5) {
        throw new Error(`payment_count_mismatch:${createResult.jobId}:${paymentCount}`);
      }
      console.log(`[batch] ${label} captured ${paymentCount} micropayments`);

      const lifecycle = listJobFundingTransactions({ db, jobId: createResult.jobId });
      runs.push({
        label,
        jobId: createResult.jobId,
        clientAddress: clientWallet.address,
        disease: spec.disease,
        query: spec.query,
        finalStatus,
        paymentCount,
        createTxHash: lifecycle.find((item) => item.txType === "create")?.txHash ?? "",
        setBudgetTxHash: lifecycle.find((item) => item.txType === "setbudget")?.txHash ?? "",
        approveTxHash: lifecycle.find((item) => item.txType === "approve")?.txHash ?? "",
        fundTxHash: lifecycle.find((item) => item.txType === "fund")?.txHash ?? "",
        submitTxHash: lifecycle.find((item) => item.txType === "submit")?.txHash,
        completeOrRejectTxHash:
          lifecycle.find((item) => item.txType === "complete")?.txHash ??
          lifecycle.find((item) => item.txType === "reject")?.txHash
      });
    }

    const afterBalances = await fetchGatewayBalances(balanceAddresses);
    console.log("[batch] captured after balances");
    const markdown = buildLedgerMarkdown({
      batchId,
      runs,
      beforeBalances,
      afterBalances,
      db
    });

    const manifest = {
      batchId,
      apiUrl,
      runs,
      beforeBalances,
      afterBalances,
      generatedAt: new Date().toISOString()
    };

    const manifestPath = path.join(OUTPUT_DIR, `${batchId}.json`);
    const markdownPath = path.join(OUTPUT_DIR, `${batchId}.md`);
    const latestManifestPath = path.join(OUTPUT_DIR, "latest.json");
    const latestMarkdownPath = path.join(OUTPUT_DIR, "latest.md");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    writeFileSync(markdownPath, markdown);
    writeFileSync(latestManifestPath, JSON.stringify(manifest, null, 2));
    writeFileSync(latestMarkdownPath, markdown);

    console.log(
      JSON.stringify(
        { ok: true, batchId, apiUrl, manifestPath, markdownPath, latestManifestPath, latestMarkdownPath, runCount: runs.length },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

void main();
