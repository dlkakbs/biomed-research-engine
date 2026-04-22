'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { decodeEventLog, isAddress } from 'viem';
import { arcTestnet } from '@/lib/chain';

const FIXED_BUDGET_UNITS = 3_000_000n; // 3 USDC (6 decimals), fixed

type ReceiptLogWithTopics = {
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
};

const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;
const USDC    = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000') as `0x${string}`;
const PUBLIC_PI_AGENT_ADDRESS = process.env.NEXT_PUBLIC_PI_AGENT_ADDRESS as `0x${string}` | undefined;
const PUBLIC_FINALIZER_ADDRESS = process.env.NEXT_PUBLIC_FINALIZER_ADDRESS as `0x${string}` | undefined;

type RuntimeConfig = {
  piAgentAddress: `0x${string}` | null;
  finalizerAddress: `0x${string}` | null;
};

// Real ABI from AgenticCommerce contract (0xa316fd02827242d537f84730f8a37d0ba5fd351a)
const ERC8183_ABI: any = [
  {
    name: 'createJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider',    type: 'address' },
      { name: 'evaluator',   type: 'address' },
      { name: 'expiredAt',   type: 'uint256' },
      { name: 'description', type: 'string'  },
      { name: 'hook',        type: 'address' }, // pass address(0) for no hook
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'setBudget',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'amount',    type: 'uint256' },
      { name: 'optParams', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'fund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'optParams', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'JobCreated',
    type: 'event',
    inputs: [
      { name: 'jobId',     type: 'uint256', indexed: true  },
      { name: 'client',    type: 'address', indexed: true  },
      { name: 'provider',  type: 'address', indexed: true  },
      { name: 'evaluator', type: 'address', indexed: false },
      { name: 'expiredAt', type: 'uint256', indexed: false },
      { name: 'hook',      type: 'address', indexed: false },
    ],
  },
];

const DISCLAIMER =
  'AI-generated research output for informational purposes only. Not medical advice. Validate with qualified researchers before any use.';

type Step = 'idle' | 'create' | 'awaiting_confirmation' | 'setbudget' | 'done' | 'error';

type PartialJobDebug = {
  jobId?: string;
  createTxHash?: `0x${string}`;
};

type PendingCreate = {
  createTxHash: `0x${string}`;
  disease: string;
  query: string;
  userType: 'researcher';
};

type CreatePhase = 'wallet_approval' | 'submitting';
type CreateNetworkStage =
  | 'idle'
  | 'wallet_prompt'
  | 'tx_hash_received'
  | 'waiting_for_receipt'
  | 'receipt_confirmed'
  | 'job_created_decoded'
  | 'setbudget_started';

function isTransactionReceiptTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out while waiting for transaction/i.test(message);
}

function saveLifecycleDebug(input: {
  jobId: string;
  kind: 'create' | 'setbudget';
  txHash?: string | null;
}) {
  if (!input.txHash || typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      `biomed_job_lifecycle_${input.jobId}_${input.kind}`,
      JSON.stringify({
        txHash: input.txHash,
        createdAt: new Date().toISOString(),
      })
    );
  } catch {}
}

const STEP_LABELS: Record<Step, string> = {
  idle:      'Create Research Request',
  create:    'Creating request on-chain...',
  awaiting_confirmation: 'Waiting for network confirmation...',
  setbudget: 'Setting up budget...',
  done:      'Done! Redirecting...',
  error:     'Transaction failed — try again',
};

const STEP_DETAILS: Partial<Record<Step, string>> = {
  awaiting_confirmation:
    'Your request was submitted to the network and is still awaiting confirmation. Do not resubmit while this transaction is pending. We will move you to the workspace automatically once it is confirmed.',
  setbudget:
    'Redirecting to workspace. Set the budget there to start the agent pipeline.'
};

const inputClass =
  'w-full rounded-lg border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500/50 transition min-h-[44px] backdrop-blur-sm';

function getStepLabel(step: Step, createPhase: CreatePhase) {
  if (step !== 'create') return STEP_LABELS[step];
  return createPhase === 'wallet_approval'
    ? 'Waiting for wallet approval...'
    : 'Submitting transaction to the network...';
}

function getStepDetail(step: Step, createPhase: CreatePhase) {
  if (step === 'create' && createPhase === 'wallet_approval') {
    return 'Approve the create transaction in your wallet to continue.';
  }
  if (step === 'create' && createPhase === 'submitting') {
    return 'Your wallet approved the transaction and the request is being handed off to the network.';
  }
  return STEP_DETAILS[step];
}

function getCreateNetworkStatus(stage: CreateNetworkStage, txHash?: string | null) {
  if (stage === 'wallet_prompt') {
    return 'Create tx has not been submitted yet. Waiting for wallet confirmation.';
  }
  if (stage === 'tx_hash_received') {
    return `Create tx submitted: ${txHash ?? 'hash pending display'}. Waiting for the network receipt.`;
  }
  if (stage === 'waiting_for_receipt') {
    return `Create tx is on the network${txHash ? ` (${txHash})` : ''}. Waiting for confirmation.`;
  }
  if (stage === 'receipt_confirmed') {
    return 'The create transaction was confirmed. Recovering the JobCreated event now.';
  }
  if (stage === 'job_created_decoded') {
    return 'JobCreated event recovered. Handing off to PI budget setup.';
  }
  if (stage === 'setbudget_started') {
    return 'Job recovered. PI budget setup call has started.';
  }
  return '';
}

export default function Dashboard() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { writeContractAsync } = useWriteContract();

  const [disease,  setDisease]  = useState('');
  const [query,    setQuery]    = useState('');
  const [step,     setStep]     = useState<Step>('idle');
  const [error,    setError]    = useState<string | null>(null);
  const [partialJob, setPartialJob] = useState<PartialJobDebug | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [createPhase, setCreatePhase] = useState<CreatePhase>('wallet_approval');
  const [createNetworkStage, setCreateNetworkStage] = useState<CreateNetworkStage>('idle');
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    piAgentAddress: PUBLIC_PI_AGENT_ADDRESS ?? null,
    finalizerAddress: PUBLIC_FINALIZER_ADDRESS ?? null,
  });

  const isLoading = step !== 'idle' && step !== 'done' && step !== 'error';

  useEffect(() => {
    if (PUBLIC_PI_AGENT_ADDRESS && PUBLIC_FINALIZER_ADDRESS) return;

    let cancelled = false;
    void fetch('/api/public-config', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: RuntimeConfig | null) => {
        if (cancelled || !payload) return;
        setRuntimeConfig({
          piAgentAddress: payload.piAgentAddress,
          finalizerAddress: payload.finalizerAddress,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pendingCreate || !publicClient || !address) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const persistJobAndRedirect = async (jobIdStr: string) => {
      setPartialJob({ jobId: jobIdStr, createTxHash: pendingCreate.createTxHash });
      saveLifecycleDebug({ jobId: jobIdStr, kind: 'create', txHash: pendingCreate.createTxHash });
      setCreateNetworkStage('job_created_decoded');

      try {
        const walletKey = `biomed_jobs_${String(address).toLowerCase()}`;
        const prev = JSON.parse(localStorage.getItem(walletKey) ?? '[]') as string[];
        const updated = [jobIdStr, ...prev.filter(id => id !== jobIdStr)].slice(0, 20);
        localStorage.setItem(walletKey, JSON.stringify(updated));
        localStorage.setItem(`biomed_job_desc_${jobIdStr}`, `${pendingCreate.disease} | ${pendingCreate.query}`);
        localStorage.setItem(`biomed_job_type_${jobIdStr}`, pendingCreate.userType);
      } catch {}

      setStep('setbudget');
      setCreateNetworkStage('setbudget_started');
      try {
        const response = await fetch(`/api/jobs/${jobIdStr}/setbudget`, { method: 'POST' });
        const payload = await response.json().catch(() => null) as { tx_hash?: string | null } | null;
        saveLifecycleDebug({ jobId: jobIdStr, kind: 'setbudget', txHash: payload?.tx_hash ?? null });
      } catch {
        // Non-fatal — workspace will still work, PI auto-funds on pickup
      }

      if (cancelled) return;
      setPendingCreate(null);
      setStep('done');
      router.push(`/workspace/${jobIdStr}`);
    };

    const pollReceipt = async () => {
      try {
        const txReceipt = await publicClient.getTransactionReceipt({ hash: pendingCreate.createTxHash });
        if (cancelled || !txReceipt) return;

        if (txReceipt.status !== 'success') {
          setPendingCreate(null);
          setStep('error');
          setError('The create transaction was confirmed on-chain but reverted. Please try again.');
          return;
        }
        setCreateNetworkStage('receipt_confirmed');

        let jobId: bigint | null = null;
        for (const log of txReceipt.logs) {
          if (!('topics' in log) || !Array.isArray(log.topics)) continue;
          try {
            const topics = [...(log as ReceiptLogWithTopics).topics] as [`0x${string}`, ...`0x${string}`[]];
            const decoded = decodeEventLog({
              abi: ERC8183_ABI,
              data: (log as ReceiptLogWithTopics).data,
              topics,
            }) as { eventName: string; args: unknown };
            if (decoded.eventName === 'JobCreated') {
              jobId = BigInt((decoded.args as any).jobId);
              break;
            }
          } catch {}
        }

        if (jobId == null) {
          setPendingCreate(null);
          setStep('error');
          setError(
            'The create transaction confirmed, but the workspace could not be recovered from the receipt. Please check wallet activity and try again.'
          );
          return;
        }

        await persistJobAndRedirect(jobId.toString());
        return;
      } catch (pollError) {
        const message = pollError instanceof Error ? pollError.message : String(pollError || '');
        if (!/transaction receipt not found|not found/i.test(message)) {
          console.error(pollError);
        }
      }

      if (!cancelled) {
        timeoutId = setTimeout(() => {
          void pollReceipt();
        }, 6_000);
      }
    };

    void pollReceipt();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [address, pendingCreate, publicClient, router]);

  const startCreateRecovery = () => {
    const createTxHash = partialJob?.createTxHash;
    const normalizedDisease = disease.trim().replace(/\s+/g, ' ');
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    if (!createTxHash || !normalizedDisease || !normalizedQuery) return;

    setError(null);
    setPendingCreate({
      createTxHash,
      disease: normalizedDisease,
      query: normalizedQuery,
      userType: 'researcher',
    });
    setStep('awaiting_confirmation');
    setCreateNetworkStage('waiting_for_receipt');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      setError('Please connect your wallet.');
      return;
    }

    const piAgentAddress = runtimeConfig.piAgentAddress;
    const finalizerAddress = runtimeConfig.finalizerAddress;

    if (!piAgentAddress || !isAddress(piAgentAddress)) {
      setError('NEXT_PUBLIC_PI_AGENT_ADDRESS is missing or invalid.');
      return;
    }

    if (!finalizerAddress || !isAddress(finalizerAddress)) {
      setError('NEXT_PUBLIC_FINALIZER_ADDRESS is missing or invalid.');
      return;
    }

    const normalizedDisease = disease.trim().replace(/\s+/g, ' ');
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    if (!normalizedDisease || !normalizedQuery) {
      setError('Disease and query are required.');
      return;
    }
    const userType = 'researcher' as const;

    setError(null);
    setPartialJob(null);
    setPendingCreate(null);
    setCreatePhase('wallet_approval');
    setCreateNetworkStage('wallet_prompt');
    const provider  = piAgentAddress;
    const evaluator = finalizerAddress;
    const expiredAt  = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    const description = `${normalizedDisease} | ${normalizedQuery} | ${userType}`;
    let createTxHash: `0x${string}` | null = null;

    try {
      // Step 1: createJob on-chain (user signs 1 tx)
      setStep('create');
      const NO_HOOK = '0x0000000000000000000000000000000000000000' as const;
      setCreatePhase('wallet_approval');
      createTxHash = await writeContractAsync({
        address: ERC8183,
        abi: ERC8183_ABI,
        account: address,
        chain: arcTestnet,
        functionName: 'createJob',
        args: [provider as `0x${string}`, evaluator as `0x${string}`, expiredAt, description, NO_HOOK],
      } as any);
      setCreatePhase('submitting');
      setCreateNetworkStage('tx_hash_received');
      setPartialJob({ createTxHash });

      if (!publicClient) throw new Error('public_client_unavailable');
      setCreateNetworkStage('waiting_for_receipt');
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash, timeout: 300_000 });
      if (txReceipt.status !== 'success') throw new Error('createJob transaction reverted');
      if (!txReceipt.logs?.length) throw new Error('job_id_missing_from_receipt');
      setCreateNetworkStage('receipt_confirmed');

      let jobId: bigint | null = null;
      for (const log of txReceipt.logs) {
        if (!('topics' in log) || !Array.isArray(log.topics)) continue;
        try {
          const topics = [...(log as ReceiptLogWithTopics).topics] as [`0x${string}`, ...`0x${string}`[]];
          const decoded = decodeEventLog({
            abi: ERC8183_ABI,
            data: (log as ReceiptLogWithTopics).data,
            topics,
          }) as { eventName: string; args: unknown };
          if (decoded.eventName === 'JobCreated') {
            jobId = BigInt((decoded.args as any).jobId);
            break;
          }
        } catch { /* ignore unrelated logs */ }
      }
      if (jobId == null) throw new Error('job_id_missing_from_receipt');
      const jobIdStr = jobId.toString();
      setPartialJob({ jobId: jobIdStr, createTxHash });
      saveLifecycleDebug({ jobId: jobIdStr, kind: 'create', txHash: createTxHash });
      setCreateNetworkStage('job_created_decoded');

      // Persist job to wallet history
      try {
        const walletKey = `biomed_jobs_${String(address).toLowerCase()}`;
        const prev = JSON.parse(localStorage.getItem(walletKey) ?? '[]') as string[];
        const updated = [jobIdStr, ...prev.filter(id => id !== jobIdStr)].slice(0, 20);
        localStorage.setItem(walletKey, JSON.stringify(updated));
        localStorage.setItem(`biomed_job_desc_${jobIdStr}`, `${normalizedDisease} | ${normalizedQuery}`);
        localStorage.setItem(`biomed_job_type_${jobIdStr}`, userType);
      } catch {}

      // Step 2: Gateway PI wallet calls setBudget on-chain (fixed 3 USDC) + stores snapshot
      setStep('setbudget');
      setCreateNetworkStage('setbudget_started');
      try {
        const response = await fetch(`/api/jobs/${jobIdStr}/setbudget`, { method: 'POST' });
        const payload = await response.json().catch(() => null) as { tx_hash?: string | null } | null;
        saveLifecycleDebug({ jobId: jobIdStr, kind: 'setbudget', txHash: payload?.tx_hash ?? null });
      } catch {
        // Non-fatal — workspace will still work, PI auto-funds on pickup
      }

      setStep('done');
      router.push(`/workspace/${jobIdStr}`);
    } catch (err: unknown) {
      console.error(err);
      if (isTransactionReceiptTimeout(err) && createTxHash) {
        setPendingCreate({
          createTxHash,
          disease: normalizedDisease,
          query: normalizedQuery,
          userType,
        });
        setPartialJob({ createTxHash });
        setStep('awaiting_confirmation');
        setCreateNetworkStage('waiting_for_receipt');
        setError(null);
      } else if (isTransactionReceiptTimeout(err)) {
        setStep('error');
        setError(
          'The create transaction was submitted but took too long to confirm, and the transaction hash could not be recovered. Check your wallet activity and retry in a moment.'
        );
      } else {
        setPendingCreate(null);
        setError(err instanceof Error ? err.message : 'Transaction failed');
        setStep('error');
      }
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Same atmospheric gradient as landing */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_35%),radial-gradient(circle_at_top_right,rgba(96,165,250,0.08),transparent_30%)]" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/30 to-transparent" aria-hidden="true" />

      <div className="relative max-w-2xl mx-auto px-6 py-12">

        {/* Back nav */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none rounded"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to home
        </Link>

        <p className="mb-2 text-xs uppercase tracking-[0.28em] text-sky-300">New Request</p>
        <h1 className="text-4xl font-semibold mb-3">Create Research Request</h1>
        <p className="text-slate-400 mb-8 text-sm leading-relaxed max-w-lg">{DISCLAIMER}</p>

        {!isConnected && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-700/50 bg-amber-900/15 px-4 py-3 text-sm text-amber-200">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            Connect your wallet to continue.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-700/70 bg-white/4 p-6 backdrop-blur-sm">

          <div>
            <label htmlFor="disease" className="mb-1.5 block text-sm font-medium text-slate-300">
              Research Topic <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="disease"
              className={inputClass}
              value={disease}
              onChange={e => setDisease(e.target.value)}
              placeholder="e.g. Duchenne muscular dystrophy, EGFR lung cancer"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="query" className="mb-1.5 block text-sm font-medium text-slate-300">
              What do you want to learn? <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="query"
              className={inputClass}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. Identify repurposing candidates, compare active trials"
              required
              aria-required="true"
            />
          </div>

          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Request Type</p>
            <p className="mt-1 text-sm font-medium text-white">Researcher</p>
          </div>

          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-300">Research Budget</span>
            <span className="text-sm font-semibold text-white">3 USDC</span>
          </div>

          {isLoading && (
            <div
              role="status"
              className="rounded-lg border border-sky-900/50 bg-sky-950/30 px-4 py-3 text-sm text-sky-300"
            >
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>{getStepLabel(step, createPhase)}</span>
              </div>
              {getStepDetail(step, createPhase) && (
                <p className="mt-2 pl-7 text-xs leading-5 text-sky-200/90">
                  {getStepDetail(step, createPhase)}
                </p>
              )}
              {getCreateNetworkStatus(createNetworkStage, partialJob?.createTxHash ?? pendingCreate?.createTxHash ?? null) && (
                <p className="mt-2 pl-7 font-mono text-[11px] leading-5 text-sky-100/80 break-all">
                  {getCreateNetworkStatus(createNetworkStage, partialJob?.createTxHash ?? pendingCreate?.createTxHash ?? null)}
                </p>
              )}
              {partialJob?.createTxHash && (
                <div className="mt-3 pl-7 flex flex-wrap gap-3 text-xs">
                  <a
                    href={`https://testnet.arcscan.app/tx/${partialJob.createTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-300 hover:text-sky-200 underline"
                  >
                    View transaction
                  </a>
                  {!pendingCreate && (
                    <button
                      type="button"
                      onClick={startCreateRecovery}
                      className="text-sky-300 hover:text-sky-200 underline"
                    >
                      Recover workspace from tx hash
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <div className="min-w-0">
                <p>{error}</p>
                {partialJob?.jobId && (
                  <div className="mt-3 space-y-1.5 text-xs text-red-200/90">
                    <p>Partial on-chain job detected: #{partialJob.jobId}</p>
                    <div className="flex flex-wrap gap-3 pt-1">
                      <Link
                        href={`/workspace/${partialJob.jobId}`}
                        className="text-sky-300 hover:text-sky-200 underline"
                      >
                        Open workspace #{partialJob.jobId}
                      </Link>
                      {partialJob.createTxHash && (
                        <a
                          href={`https://testnet.arcscan.app/tx/${partialJob.createTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-300 hover:text-sky-200 underline"
                        >
                          View create tx
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'awaiting_confirmation' && partialJob?.createTxHash && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
              <p className="font-medium text-amber-200">Transaction sent, waiting for network confirmation.</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/85">
                The create transaction is still pending on-chain, so the workspace cannot be created yet. Do not submit another request while this transaction is pending. If it stays stuck, check your wallet for a speed up or cancel action.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <a
                  href={`https://testnet.arcscan.app/tx/${partialJob.createTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 hover:text-sky-200 underline"
                >
                  View transaction
                </a>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !isConnected}
            className="w-full rounded-lg bg-sky-600 py-3 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none"
          >
            {getStepLabel(isLoading ? step : 'idle', createPhase)}
          </button>
        </form>
      </div>
    </main>
  );
}
