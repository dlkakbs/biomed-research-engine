import { Web3 } from "web3";
import { CircleWalletClient } from "../wallets/circle-client.js";
import { ARC_ERC20_USDC } from "@biomed/shared";

const ARC_RPC_URL = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const ERC8183_ADDRESS = process.env.ERC_8183 ?? "0x0747EEf0706327138c69792bF28Cd525089e4583";

const web3 = new Web3(ARC_RPC_URL);

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
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" }
        ],
        name: "",
        type: "tuple"
      }
    ]
  }
] as const;

const JOB_CREATED_EVENT = {
  type: "event",
  name: "JobCreated",
  inputs: [
    { name: "jobId", type: "uint256", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "provider", type: "address", indexed: true },
    { name: "evaluator", type: "address", indexed: false },
    { name: "expiredAt", type: "uint256", indexed: false },
    { name: "hook", type: "address", indexed: false }
  ]
} as const;

const STATUS_MAP: Record<number, "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired"> = {
  0: "Open",
  1: "Funded",
  2: "Submitted",
  3: "Completed",
  4: "Rejected",
  5: "Expired"
};

export interface Erc8183Job {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: string;
  expiredAt: number;
  statusCode: number;
  status: "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired";
  hook: string;
}

export interface Erc8183ExecutionResult {
  txHash: string;
  transactionId: string;
  state: string;
  refId: string;
  walletId: string;
}

export interface Erc8183CreateResult extends Erc8183ExecutionResult {
  jobId: string;
}

function getContract() {
  return new web3.eth.Contract(ERC8183_ABI as never, ERC8183_ADDRESS);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ERC-8183 lifecycle execution`);
  return value;
}

function createCircleClient(): CircleWalletClient {
  return CircleWalletClient.fromEnv();
}

function bytes32Hex(value: string): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= 32) {
    return `0x${encoded.toString("hex").padEnd(64, "0")}`;
  }
  return web3.utils.keccak256(value);
}

async function executeThroughWallet(input: {
  walletIdEnv?: string;
  walletId?: string;
  signature: string;
  parameters: string[];
  refId: string;
  contractAddress?: string;
  amount?: string;
}): Promise<Erc8183ExecutionResult> {
  const walletId = input.walletId ?? getRequiredEnv(input.walletIdEnv ?? "PI_AGENT_WALLET_ID");
  const client = createCircleClient();
  const result = await client.executeContractAndWait({
    walletId,
    contractAddress: input.contractAddress ?? ERC8183_ADDRESS,
    abiFunctionSignature: input.signature,
    abiParameters: input.parameters,
    refId: input.refId,
    amount: input.amount,
    feeLevel: "MEDIUM"
  });

  if (!result.txHash) {
    throw new Error(`ERC-8183 ${input.signature} completed without tx hash`);
  }

  return {
    txHash: result.txHash,
    transactionId: result.id,
    state: result.state ?? "COMPLETE",
    refId: input.refId,
    walletId
  };
}

async function waitForReceipt(txHash: string): Promise<{
  logs?: Array<{ address?: string; data?: string; topics?: string[] }>;
}> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt as { logs?: Array<{ address?: string; data?: string; topics?: string[] }> };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for receipt ${txHash}`);
}

function resolveDemoClientWalletId(): string {
  return (
    process.env.DEMO_CLIENT_WALLET_ID?.trim() ||
    process.env.PI_AGENT_WALLET_ID?.trim() ||
    getRequiredEnv("PI_AGENT_WALLET_ID")
  );
}

async function resolveDemoClientAddress(walletId?: string): Promise<string> {
  const direct = process.env.DEMO_CLIENT_ADDRESS?.trim();
  if (direct) return direct;
  const client = createCircleClient();
  const wallet = await client.getWallet(walletId ?? resolveDemoClientWalletId());
  return wallet.address;
}

export async function inspectErc8183SignerConfig(): Promise<{
  pi: {
    walletId: string | null;
    configuredAddress: string | null;
    circleAddress: string | null;
    matchesConfiguredAddress: boolean | null;
  };
  evaluator: {
    walletId: string | null;
    configuredAddress: string | null;
    circleAddress: string | null;
    matchesConfiguredAddress: boolean | null;
  };
}> {
  const client = createCircleClient();
  const piWalletId = process.env.PI_AGENT_WALLET_ID?.trim() || null;
  const evaluatorWalletId =
    process.env.FINALIZER_WALLET_ID?.trim() ||
    null;
  const piConfiguredAddress = process.env.PI_AGENT_WALLET_ADDRESS?.trim() || null;
  const evaluatorConfiguredAddress =
    process.env.FINALIZER_ADDRESS?.trim() ||
    null;

  const [piWallet, evaluatorWallet] = await Promise.all([
    piWalletId ? client.getWallet(piWalletId).catch(() => null) : Promise.resolve(null),
    evaluatorWalletId ? client.getWallet(evaluatorWalletId).catch(() => null) : Promise.resolve(null)
  ]);

  const piCircleAddress = piWallet?.address?.trim() || null;
  const evaluatorCircleAddress = evaluatorWallet?.address?.trim() || null;

  return {
    pi: {
      walletId: piWalletId,
      configuredAddress: piConfiguredAddress,
      circleAddress: piCircleAddress,
      matchesConfiguredAddress:
        piConfiguredAddress && piCircleAddress
          ? piConfiguredAddress.toLowerCase() === piCircleAddress.toLowerCase()
          : null
    },
    evaluator: {
      walletId: evaluatorWalletId,
      configuredAddress: evaluatorConfiguredAddress,
      circleAddress: evaluatorCircleAddress,
      matchesConfiguredAddress:
        evaluatorConfiguredAddress && evaluatorCircleAddress
          ? evaluatorConfiguredAddress.toLowerCase() === evaluatorCircleAddress.toLowerCase()
          : null
    }
  };
}

export async function getErc8183Job(jobId: string | number): Promise<Erc8183Job | null> {
  if (!/^\d+$/.test(String(jobId))) {
    return null;
  }

  const contract = getContract();
  const raw = (await contract.methods.getJob(String(jobId)).call()) as
    | {
        id?: string;
        client?: string;
        provider?: string;
        evaluator?: string;
        description?: string;
        budget?: string;
        expiredAt?: string;
        status?: string;
        hook?: string;
        0?: string;
        1?: string;
        2?: string;
        3?: string;
        4?: string;
        5?: string;
        6?: string;
        7?: string;
        8?: string;
      }
    | undefined;

  if (!raw) return null;
  const statusCode = Number(raw.status ?? raw[7] ?? 0);

  return {
    id: String(raw.id ?? raw[0] ?? jobId),
    client: String(raw.client ?? raw[1] ?? ""),
    provider: String(raw.provider ?? raw[2] ?? ""),
    evaluator: String(raw.evaluator ?? raw[3] ?? ""),
    description: String(raw.description ?? raw[4] ?? ""),
    budget: String(raw.budget ?? raw[5] ?? "0"),
    expiredAt: Number(raw.expiredAt ?? raw[6] ?? 0),
    statusCode,
    status: STATUS_MAP[statusCode] ?? "Open",
    hook: String(raw.hook ?? raw[8] ?? "")
  };
}

export async function setErc8183Budget(jobId: string | number, amountUnits: bigint): Promise<Erc8183ExecutionResult> {
  return executeThroughWallet({
    walletIdEnv: "PI_AGENT_WALLET_ID",
    signature: "setBudget(uint256,uint256,bytes)",
    parameters: [String(jobId), amountUnits.toString(), "0x"],
    refId: `erc8183-setBudget-${jobId}`
  });
}

export async function createErc8183Job(input: {
  description: string;
  expiredAt: bigint | number;
  providerAddress?: string;
  evaluatorAddress?: string;
  walletId?: string;
}): Promise<Erc8183CreateResult> {
  const walletId = input.walletId ?? resolveDemoClientWalletId();
  const providerAddress =
    input.providerAddress ??
    process.env.PI_AGENT_ADDRESS?.trim() ??
    (await resolveDemoClientAddress(walletId));
  const evaluatorAddress =
    input.evaluatorAddress ??
    process.env.FINALIZER_ADDRESS?.trim() ??
    getRequiredEnv("FINALIZER_ADDRESS");

  const result = await executeThroughWallet({
    walletId,
    signature: "createJob(address,address,uint256,string,address)",
    parameters: [
      providerAddress,
      evaluatorAddress,
      String(input.expiredAt),
      input.description,
      "0x0000000000000000000000000000000000000000"
    ],
    refId: `erc8183-create-${crypto.randomUUID()}`
  });

  const receipt = await waitForReceipt(result.txHash);
  const signature = web3.eth.abi.encodeEventSignature(JOB_CREATED_EVENT as never);
  const log = receipt.logs?.find(
    (item) =>
      item.address?.toLowerCase() === ERC8183_ADDRESS.toLowerCase() &&
      Array.isArray(item.topics) &&
      item.topics[0]?.toLowerCase() === signature.toLowerCase()
  );
  if (!log?.topics || !log.data) {
    throw new Error(`JobCreated event not found in receipt ${result.txHash}`);
  }

  const decoded = web3.eth.abi.decodeLog(
    JOB_CREATED_EVENT.inputs as never,
    log.data,
    log.topics.slice(1)
  ) as { jobId?: string };
  if (!decoded.jobId) {
    throw new Error(`Decoded JobCreated event missing jobId for ${result.txHash}`);
  }

  return {
    ...result,
    jobId: String(decoded.jobId)
  };
}

export async function approveUsdcForErc8183(input: {
  amountUnits: bigint | number;
  walletId?: string;
}): Promise<Erc8183ExecutionResult> {
  return executeThroughWallet({
    walletId: input.walletId ?? resolveDemoClientWalletId(),
    contractAddress: ARC_ERC20_USDC.address,
    signature: "approve(address,uint256)",
    parameters: [ERC8183_ADDRESS, String(input.amountUnits)],
    refId: `erc20-approve-erc8183-${crypto.randomUUID()}`
  });
}

export async function fundErc8183Job(input: {
  jobId: string | number;
  walletId?: string;
}): Promise<Erc8183ExecutionResult> {
  return executeThroughWallet({
    walletId: input.walletId ?? resolveDemoClientWalletId(),
    signature: "fund(uint256,bytes)",
    parameters: [String(input.jobId), "0x"],
    refId: `erc8183-fund-${input.jobId}`
  });
}

export async function submitErc8183Job(jobId: string | number, deliverableDigest: string): Promise<Erc8183ExecutionResult> {
  const bytes32 =
    /^0x[a-fA-F0-9]{64}$/.test(deliverableDigest) ? deliverableDigest : bytes32Hex(deliverableDigest);
  return executeThroughWallet({
    walletIdEnv: "PI_AGENT_WALLET_ID",
    signature: "submit(uint256,bytes32,bytes)",
    parameters: [String(jobId), bytes32, "0x"],
    refId: `erc8183-submit-${jobId}`
  });
}

export async function finalizeErc8183Job(input: {
  jobId: string | number;
  approved: boolean;
  reason: string;
}): Promise<Erc8183ExecutionResult> {
  return executeThroughWallet({
    walletIdEnv: "FINALIZER_WALLET_ID",
    signature: input.approved ? "complete(uint256,bytes32,bytes)" : "reject(uint256,bytes32,bytes)",
    parameters: [String(input.jobId), bytes32Hex(input.reason), "0x"],
    refId: `erc8183-${input.approved ? "complete" : "reject"}-${input.jobId}`
  });
}

export async function claimExpiredErc8183Refund(jobId: string | number): Promise<string> {
  const privateKey = getRequiredEnv("WATCHER_PRIVATE_KEY");
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  const contract = getContract();
  const tx = contract.methods.claimRefund(String(jobId));
  const signed = await account.signTransaction({
    to: ERC8183_ADDRESS,
    data: tx.encodeABI(),
    gas: 250_000,
    gasPrice: await web3.eth.getGasPrice(),
    nonce: await web3.eth.getTransactionCount(account.address),
    chainId: Number(process.env.CHAIN_ID ?? "5042002")
  });
  if (!signed.rawTransaction) {
    throw new Error("claimRefund signing failed");
  }
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  return String(receipt.transactionHash);
}
