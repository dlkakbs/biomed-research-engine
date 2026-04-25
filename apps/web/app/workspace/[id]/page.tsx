'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { arcTestnet } from '@/lib/chain';

const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;
const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000') as `0x${string}`;
const FIXED_BUDGET_UNITS = 3_000_000n; // 3 USDC
const NANOPAYMENT_PRICE_USDC = '0.002';

const ERC20_APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const ERC8183_FUND_ABI = [{
  name: 'fund', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'optParams', type: 'bytes' }],
  outputs: [],
}] as const;

type AgentStatus = 'idle' | 'active' | 'done' | 'warn' | 'error';

interface AgentEvent {
  id: number;
  agent_name: string;
  event_type: string;
  message: string;
  target_agent?: string;
  created_at: string;
}

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  subtitle: string;
}

interface EscrowStatus {
  status: string;
  escrow_state: string;
  headline: string;
  detail: string;
}

interface FundingTransaction {
  job_id: string;
  tx_type: string;
  tx_hash: string;
  tx_status: string;
  wallet_address?: string | null;
  amount_units?: string | null;
  chain_id?: number | null;
  metadata?: Record<string, unknown> | null;
}

interface FundingDebug {
  job_id: string;
  transactions: FundingTransaction[];
  onchain_job?: {
    status?: string;
    budget?: string | number;
    client?: string;
    provider?: string;
    evaluator?: string;
  } | null;
  chain_read_error?: string | null;
}

interface StoredLifecycleDebug {
  txHash?: string;
  createdAt?: string;
}

function explainRejectReason(reason?: string) {
  const text = (reason || '').toLowerCase();
  if (text.includes('methodology_missing:limitations')) {
    return 'Peer review rejected the report because the methodology section did not clearly state the run limitations.';
  }
  if (text.includes('methodology_missing:rubric')) {
    return 'Peer review rejected the report because the methodology summary was incomplete.';
  }
  if (text.includes('deterministic evaluator checks failed')) {
    return 'Peer review rejected the report because the report did not meet the review requirements.';
  }
  if (text.includes('future date') || text.includes('training data cutoff')) {
    return 'Peer review found a data-integrity issue in the generated report, so delivery was rejected and the escrow was not released.';
  }
  if (text.includes('confidence value')) {
    return 'Peer review found a report-format inconsistency, so the result was rejected before settlement.';
  }
  if (text.includes('methodology') || text.includes('missing')) {
    return 'Peer review found required report sections or evidence details missing, so the result was rejected before settlement.';
  }
  return 'Peer review rejected this report because the output did not meet the marketplace quality checks. Your locked escrow was not released as a successful delivery.';
}

function extractEvaluatorReason(message?: string) {
  if (!message) return '';
  const match = message.match(/reason=(.*)$/i);
  return match?.[1]?.trim() ?? '';
}

function formatEvaluatorDetail(reason?: string) {
  const normalized = (reason || '').trim();
  if (!normalized) return '';
  return normalized
    .replace(/^Both reviewers rejected\s*[-:]\s*/i, '')
    .replace(/^Tiebreaker:\s*/i, '')
    .replace(/^Deterministic evaluator checks failed:\s*/i, '')
    .trim();
}

function explainPipelineFailure(message?: string) {
  const text = String(message || '').trim();
  const lowered = text.toLowerCase();

  if (
    /^draft_report_safety_failed:/i.test(text) &&
    lowered.includes('report_missing: top_candidates empty') &&
    lowered.includes('report_missing: evidence_table empty')
  ) {
    return 'The pipeline found only an early-stage hypothesis, but the draft report was still checked against the stricter final-candidate format. This was an internal classification mismatch rather than a missing research run.';
  }

  if (/^draft_report_safety_failed:/i.test(text) && lowered.includes('report_missing: deliverable_signal empty')) {
    return 'The pipeline stopped before delivery because the run did not produce a strong candidate, an early-stage hypothesis, or a reviewed signal worth handing off.';
  }

  if (/^draft_report_safety_failed:/i.test(text) && lowered.includes('report_missing: top_candidates empty')) {
    return 'The research completed, but none of the reviewed candidates met the bar for either a reportable shortlist or an early-stage hypothesis. No report was delivered for this pass, and the escrow was refunded.';
  }

  if (/^draft_report_safety_failed:/i.test(text) && lowered.includes('provenance_missing: pmids_used empty')) {
    if (lowered.includes('top_candidate_missing_pmids')) {
      return 'The pipeline stopped before delivery because the shortlisted candidate did not carry usable paper provenance into the final report. The run found a mechanism-linked lead, but the literature support was not strong enough for safe delivery.';
    }
    return 'The pipeline stopped before delivery because the final report did not include enough literature provenance to support a safe handoff.';
  }

  if (/^draft_report_safety_failed:/i.test(text) && lowered.includes('no_reportable_signal')) {
    return 'The pipeline stopped before delivery because this run did not produce a reportable candidate signal. No paid result was delivered, and the escrow was refunded to the client.';
  }

  if (/^draft_report_safety_failed:/i.test(text)) {
    return 'The pipeline stopped before delivery because the draft report failed an internal quality and safety check.';
  }

  return 'The pipeline stopped before delivery because the run failed an internal quality check.';
}

function explainPipelineFailureShort(message?: string) {
  const text = String(message || '').trim();
  const lowered = text.toLowerCase();

  if (/^draft_report_safety_failed:/i.test(text) && lowered.includes('report_missing: top_candidates empty')) {
    return 'No shortlist or early-stage hypothesis met the quality bar.';
  }

  return explainPipelineFailure(message);
}

function prettyAgentName(agent: string) {
  const labels: Record<string, string> = {
    literature: 'Literature',
    drugdb: 'DrugDB',
    pathway: 'Pathway',
    repurposing: 'Repurposing',
    evidence: 'Evidence',
    red_team: 'Red Team',
    report: 'Report'
  };
  return labels[agent] ?? agent.replace(/_/g, ' ');
}

function humanizeGatewayPayment(actor: string) {
  const normalized = actor.trim().toLowerCase();
  if (normalized === 'literature') {
    return 'PI paid for Literature agent: literature retrieval, filtering, synthesis service';
  }
  if (normalized === 'drugdb') {
    return 'PI paid for DrugDB agent: target/candidate screening service';
  }
  if (normalized === 'pathway') {
    return 'PI paid for Pathway agent: disease-biology interpretation service';
  }
  if (normalized === 'red team') {
    return 'PI paid for Red Team agent: independent red-team review service';
  }
  if (normalized === 'pi evaluator') {
    return 'PI paid for Review service: peer-review seller';
  }
  if (normalized === 'evaluator') {
    return 'PI paid for Review service: peer-review seller';
  }
  return `PI paid the ${actor} service for a research step`;
}

function readStoredLifecycleDebug(jobId: string, kind: 'create' | 'setbudget' | 'fund'): StoredLifecycleDebug | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`biomed_job_lifecycle_${jobId}_${kind}`);
    if (!raw) return null;
    return JSON.parse(raw) as StoredLifecycleDebug;
  } catch {
    return null;
  }
}

function readLifecycleSignature(jobId: string): string {
  const create = readStoredLifecycleDebug(jobId, 'create');
  const setbudget = readStoredLifecycleDebug(jobId, 'setbudget');
  const fund = readStoredLifecycleDebug(jobId, 'fund');
  return JSON.stringify({
    create: create?.txHash ?? null,
    createAt: create?.createdAt ?? null,
    setbudget: setbudget?.txHash ?? null,
    setbudgetAt: setbudget?.createdAt ?? null,
    fund: fund?.txHash ?? null,
    fundAt: fund?.createdAt ?? null,
  });
}

function buildSyntheticLifecycleEvents(jobId: string): AgentEvent[] {
  const synthetic = [
    {
      key: 'create' as const,
      message: 'Client create executed on ERC-8183',
    },
    {
      key: 'setbudget' as const,
      message: 'PI setBudget executed on ERC-8183',
    },
    {
      key: 'fund' as const,
      message: 'Client fund executed on ERC-8183',
    },
  ]
    .map((entry, index) => {
      const stored = readStoredLifecycleDebug(jobId, entry.key);
      if (!stored?.txHash) return null;
      return {
        id: -(index + 1),
        agent_name: 'pi',
        event_type: 'payment',
        message: `${entry.message} tx=${stored.txHash}`,
        created_at: stored.createdAt || new Date(0).toISOString(),
      } satisfies AgentEvent;
    })
    .filter(Boolean) as AgentEvent[];

  return synthetic.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

const AGENTS: AgentInfo[] = [
  { id: 'pi',          name: 'Dr. Iris',  role: 'PI Agent',    subtitle: 'Orchestrator'    },
  { id: 'literature',  name: 'Dr. Mira',  role: 'Literature',  subtitle: 'PubMed Mining'   },
  { id: 'drugdb',      name: 'Dr. Rex',   role: 'DrugDB',      subtitle: 'ChEMBL Analysis' },
  { id: 'pathway',     name: 'Dr. Nova',  role: 'Pathway',     subtitle: 'Network Analysis'},
  { id: 'repurposing', name: 'Dr. Spark', role: 'Repurposing', subtitle: 'Hypothesis Gen'  },
  { id: 'evidence',    name: 'Dr. Vera',  role: 'Evidence',    subtitle: 'Scoring Engine'  },
  { id: 'red_team',    name: 'Dr. Vale',  role: 'Red Team',    subtitle: 'Critical Review' },
  { id: 'report',      name: 'Dr. Aria',  role: 'Report',      subtitle: 'Final Synthesis' },
  { id: 'evaluator_1', name: 'Review I',  role: 'Reviewer',    subtitle: 'Peer Review'     },
  { id: 'evaluator_2', name: 'Review II', role: 'Reviewer',    subtitle: 'Peer Review'     },
  { id: 'evaluator_3', name: 'Tiebreak',  role: 'Tiebreaker',  subtitle: 'Review Split'    },
];

const PIPELINE_IDS = AGENTS.map(a => a.id);

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle:   'border-slate-700 bg-slate-900/60',
  active: 'border-sky-500 bg-sky-950/40',
  done:   'border-emerald-600 bg-emerald-950/30',
  warn:   'border-amber-600 bg-amber-950/25',
  error:  'border-red-600 bg-red-950/30',
};

const STATUS_DOT: Record<AgentStatus, string> = {
  idle:   'bg-slate-600',
  active: 'bg-sky-400 animate-pulse',
  done:   'bg-emerald-400',
  warn:   'bg-amber-400',
  error:  'bg-red-400',
};

const STATUS_GLOW: Record<AgentStatus, string> = {
  idle:   '',
  active: 'shadow-[0_0_20px_rgba(56,189,248,0.35)]',
  done:   'shadow-[0_0_12px_rgba(52,211,153,0.2)]',
  warn:   'shadow-[0_0_12px_rgba(251,191,36,0.18)]',
  error:  'shadow-[0_0_12px_rgba(239,68,68,0.25)]',
};

function formatAgentPreview(agentId: string, lastMsg?: string) {
  if (!lastMsg) return lastMsg;
  if (agentId !== 'evaluator_1' && agentId !== 'evaluator_2' && agentId !== 'evaluator_3') {
    return lastMsg;
  }

  const text = lastMsg.toLowerCase();
  if (text.includes('methodology_missing:limitations')) {
    return 'Methodology requirements not met.';
  }
  if (text.includes('methodology_missing:rubric')) {
    return 'Scoring rubric summary missing.';
  }
  if (text.includes('deterministic evaluator checks failed')) {
    return 'Peer review checks failed.';
  }
  if (text.includes('report passed deterministic evaluator checks')) {
    return 'Report passed review checks.';
  }
  if (text.includes('decision=approve') || text.includes('decision=approved')) {
    return 'Peer review approved.';
  }
  if (text.includes('decision=reject') || text.includes('decision=rejected')) {
    return 'Peer review rejected.';
  }
  return lastMsg;
}

function buildSlowAgentMessage(agentId: string) {
  if (agentId === 'pi') return '';
  if (agentId === 'pathway') return 'Pathway analysis is taking longer than usual.';
  if (agentId === 'literature') return 'Literature review is taking longer than usual.';
  if (agentId === 'drugdb') return 'Drug evidence screening is taking longer than usual.';
  if (agentId === 'repurposing') return 'Candidate generation is taking longer than usual.';
  if (agentId === 'evidence') return 'Evidence scoring is taking longer than usual.';
  if (agentId === 'red_team') return 'Independent challenge review is taking longer than usual.';
  if (agentId === 'report') return 'Report synthesis is taking longer than usual.';
  return 'This step is taking longer than usual.';
}

function isNoHitMessage(message?: string) {
  const text = (message || '').toLowerCase();
  return text.includes('completed with no hit') || text.includes('completed with no critiques') || text.includes('red-team skipped because');
}

function AgentCard({
  agent,
  status,
  lastMsg,
  slow
}: {
  agent: AgentInfo;
  status: AgentStatus;
  lastMsg?: string;
  slow?: boolean;
}) {
  const preview = formatAgentPreview(agent.id, lastMsg);
  return (
    <div
      className={`relative rounded-xl border p-4 transition-all duration-500 ${STATUS_COLORS[status]} ${STATUS_GLOW[status]}`}
      aria-label={`${agent.role}: ${status}`}
    >
      {status === 'active' && (
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-500/10 to-transparent animate-[shimmer_2s_linear_infinite]" />
        </div>
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-sm text-white">{agent.role}</span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
      </div>
      <div className="text-xs text-slate-500">{agent.name} · {agent.subtitle}</div>
      {preview && (
        <div className="text-xs text-slate-300 mt-2 truncate" title={preview}>{preview}</div>
      )}
      {status === 'active' && slow && (
        <div className="mt-2 text-[11px] text-amber-300">
          {buildSlowAgentMessage(agent.id)}
        </div>
      )}
    </div>
  );
}

function Connector({ active }: { active?: boolean }) {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <div className={`w-px h-8 relative overflow-hidden transition-colors duration-300 ${active ? 'bg-sky-800' : 'bg-slate-800'}`}>
        {active && (
          <div className="absolute inset-x-0 h-4 bg-gradient-to-b from-transparent via-sky-400 to-transparent animate-[slide-down_1s_linear_infinite]" />
        )}
      </div>
    </div>
  );
}

function FanConnector({ active }: { active?: boolean }) {
  return (
    <div className="relative h-10 my-1" aria-hidden="true">
      <svg width="100%" height="40" viewBox="0 0 600 40" preserveAspectRatio="none" className="absolute inset-0">
        <line x1="300" y1="0" x2="100" y2="40" stroke={active ? '#38bdf8' : '#334155'} strokeWidth="1.5" />
        <line x1="300" y1="0" x2="300" y2="40" stroke={active ? '#38bdf8' : '#334155'} strokeWidth="1.5" />
        <line x1="300" y1="0" x2="500" y2="40" stroke={active ? '#38bdf8' : '#334155'} strokeWidth="1.5" />
        {active && (
          <>
            <circle r="3" fill="#60a5fa"><animateMotion dur="1s" repeatCount="indefinite" path="M300,0 L100,40" /></circle>
            <circle r="3" fill="#60a5fa"><animateMotion dur="1.2s" repeatCount="indefinite" path="M300,0 L300,40" /></circle>
            <circle r="3" fill="#60a5fa"><animateMotion dur="1s" repeatCount="indefinite" path="M300,0 L500,40" /></circle>
          </>
        )}
      </svg>
    </div>
  );
}

function FanInConnector({ active }: { active?: boolean }) {
  return (
    <div className="relative h-10 my-1" aria-hidden="true">
      <svg width="100%" height="40" viewBox="0 0 600 40" preserveAspectRatio="none" className="absolute inset-0">
        <line x1="100" y1="0" x2="300" y2="40" stroke={active ? '#f59e0b' : '#334155'} strokeWidth="1.5" />
        <line x1="300" y1="0" x2="300" y2="40" stroke={active ? '#f59e0b' : '#334155'} strokeWidth="1.5" />
        <line x1="500" y1="0" x2="300" y2="40" stroke={active ? '#f59e0b' : '#334155'} strokeWidth="1.5" />
        {active && (
          <>
            <circle r="3" fill="#fbbf24"><animateMotion dur="1s" repeatCount="indefinite" path="M100,0 L300,40" /></circle>
            <circle r="3" fill="#fbbf24"><animateMotion dur="1.2s" repeatCount="indefinite" path="M300,0 L300,40" /></circle>
            <circle r="3" fill="#fbbf24"><animateMotion dur="1s" repeatCount="indefinite" path="M500,0 L300,40" /></circle>
          </>
        )}
      </svg>
    </div>
  );
}

const TX_HASH_RE = /(tx=)?(0x[0-9a-fA-F]{18,64})\b/;
const TX_FIELD_RE = /(?:^|\s)tx=([^\s]+)/i;
const GATEWAY_PAYMENT_RE = /^(.*?)(?: nanopayment verified through Gateway| payment verified through Gateway)/i;
const INTERNAL_PAYOUT_RE =
  /^(?:PI paid|Internal payout sent to) ([a-z_]+)(?::)? \$([0-9.]+) USDC .*?(tx=)?(0x[0-9a-fA-F]{18,64})/i;
const ERC8183_BUDGET_RE = /^PI setBudget executed on ERC-8183/i;
const ERC8183_CREATE_RE = /^Client create executed on ERC-8183/i;
const ERC8183_FUND_RE = /^Client fund executed on ERC-8183/i;
const ERC8183_SUBMIT_RE = /^Provider submit executed on ERC-8183/i;
const ERC8183_COMPLETE_RE = /^Finalizer complete executed on ERC-8183/i;
const ERC8183_REJECT_RE = /^Finalizer reject executed on ERC-8183/i;
const ERC8183_PIPELINE_REFUND_RE = /^Pipeline refund executed on ERC-8183/i;
const GATEWAY_TX_ID_RE = /(?:^|\s)tx=([^\s]+)/i;

function isEvaluatorDispatchMessage(event: AgentEvent) {
  return event.agent_name === 'pi' && event.event_type === 'dispatch' && /^Review service dispatch started\.?/i.test(event.message);
}

function isPeerReviewDecisionMessage(event: AgentEvent) {
  return event.agent_name === 'pi' && event.event_type === 'result' && /^Review decision=/i.test(event.message);
}

function lifecycleEventKey(event: AgentEvent) {
  const txHash = extractTxHash(event.message) || '';
  if (txHash) {
    if (ERC8183_CREATE_RE.test(event.message)) return `lifecycle:create:${txHash}`;
    if (ERC8183_BUDGET_RE.test(event.message)) return `lifecycle:setbudget:${txHash}`;
    if (ERC8183_FUND_RE.test(event.message)) return `lifecycle:fund:${txHash}`;
  }
  return '';
}

function dedupeLifecycleEvents(events: AgentEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const lifecycleKey = lifecycleEventKey(event);
    if (lifecycleKey) {
      if (seen.has(lifecycleKey)) return false;
      seen.add(lifecycleKey);
      return true;
    }
    const normalizedMessage = event.message.replace(/\s+/g, ' ').trim();
    const txHash = extractTxHash(event.message) || '';
    const key = `${event.agent_name}|${event.event_type}|${normalizedMessage}|${txHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldHideActivityEvent(event: AgentEvent) {
  if (event.event_type === 'payout') return true;
  if (/^Internal payouts skipped:/i.test(event.message)) return true;
  if (/^Internal payout config missing for:/i.test(event.message)) return true;
  if (/^Internal payouts completed for /i.test(event.message)) return true;
  if (/^Internal payouts partially failed for /i.test(event.message)) return true;
  if (/^Internal payout sent to /i.test(event.message)) return true;
  if (/^Internal payout failed for /i.test(event.message)) return true;
  if (/^Budget set on-chain\.?$/i.test(event.message)) return true;
  if (/^Funding confirmed on ERC-8183\.?$/i.test(event.message)) return true;
  return false;
}

function shouldRenderActivityEvent(event: AgentEvent) {
  if (shouldHideActivityEvent(event)) return false;
  return formatActivityMessage(event.message, event.event_type, event.agent_name).trim().length > 0;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function isExplorerTxHash(value?: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value || '');
}

function extractTxHash(message?: string) {
  const match = TX_HASH_RE.exec(message || '');
  return match?.[2] ?? '';
}

function formatActivityMessage(message: string, eventType: string, agentName?: string) {
  if (
    eventType === 'start' &&
    agentName === 'pi' &&
    /^Research pipeline started by orchestrator\.?/i.test(message)
  ) {
    return 'PI started the workflow and queued the first research steps.';
  }

  if (eventType === 'dispatch') {
    if (agentName === 'literature') {
      return 'PI -> Literature: gather relevant papers.';
    }
    if (agentName === 'drugdb') {
      return 'PI -> DrugDB: screen drug and target data.';
    }
    if (agentName === 'pathway') {
      return 'PI -> Pathway: collect disease biology, genetics, and trial context.';
    }
    if (agentName === 'repurposing') {
      return 'PI -> Repurposing: turn the evidence into candidate ideas.';
    }
    if (agentName === 'evidence') {
      return 'PI -> Evidence: score the candidate set.';
    }
    if (agentName === 'red_team') {
      return 'PI -> Red Team: stress-test the leading ideas.';
    }
    if (agentName === 'report') {
      return 'PI -> Report: assemble the research brief.';
    }
    if (agentName === 'pi' && /^Review service dispatch started\.?/i.test(message)) {
      return 'PI -> Review service: run the peer-review committee.';
    }
  }

  if (
    eventType === 'info' &&
    /^Budget set on-chain\.?$/i.test(message)
  ) {
    return 'Budget set on-chain.';
  }

  if (
    eventType === 'result' &&
    /^Report narrative synthesized with /i.test(message)
  ) {
    return '';
  }

  if (
    eventType === 'complete' &&
    /^Report synthesized and written to reports directory\.?/i.test(message)
  ) {
    return '';
  }

  if (
    eventType === 'complete' &&
    agentName === 'report' &&
    /^Report assembly completed and delivered to PI\.?/i.test(message)
  ) {
    return 'Report -> PI: research brief ready for review.';
  }

  if (eventType === 'result' && /^Review decision=/i.test(message)) {
    const lowered = message.toLowerCase();
    if (lowered.includes('decision=reject')) {
      if (lowered.includes('methodology_missing:limitations')) {
        return 'Peer review rejected the report because the methodology section did not clearly state the run limitations.';
      }
      if (lowered.includes('methodology_missing:rubric')) {
        return 'Peer review rejected the report because the methodology summary was incomplete.';
      }
      return 'Review service rejected the report.';
    }
    if (lowered.includes('decision=approve')) {
      return 'Review service approved the report.';
    }
  }

  if (eventType === 'debug' && agentName === 'repurposing') {
    if (/single-candidate salvage applied/i.test(message)) {
      return 'Repurposing -> PI: one mechanism-linked candidate was retained for review because it carried usable disease context.';
    }
    const match = message.match(/reviewed (\d+) additional candidate/i);
    if (match) {
      return `Repurposing -> PI: ${match[1]} additional candidates were reviewed, but the shortlist stayed selective.`;
    }
  }

  if (eventType === 'result') {
    if (agentName === 'literature') {
      if (/completed with no hit/i.test(message)) {
        const reviewed = message.match(/reviewing (\d+) retrieved papers/i)?.[1];
        const reranked = message.match(/(\d+) entered reranking/i)?.[1];
        if (reviewed && reranked) {
          return `Literature -> PI: ${reviewed} papers were reviewed, ${reranked} entered reranking, but none cleared the current disease-specific reportability filter.`;
        }
        return reviewed
          ? `Literature -> PI: ${reviewed} papers were reviewed, but none cleared the current disease-specific reportability filter.`
          : 'Literature -> PI: papers were reviewed, but none cleared the current disease-specific reportability filter.';
      }
      const rerankedMatch = message.match(/completed: (\d+) paper records cleared from (\d+) retrieved papers after (\d+) entered reranking/i);
      if (rerankedMatch) {
        return `Literature -> PI: ${rerankedMatch[1]} paper records cleared from ${rerankedMatch[2]} retrieved papers after ${rerankedMatch[3]} entered reranking.`;
      }
      const match = message.match(/completed: (\d+) paper records cleared from (\d+) retrieved papers/i);
      if (match) return `Literature -> PI: ${match[1]} paper records cleared from ${match[2]} retrieved papers.`;
    }
    if (agentName === 'drugdb') {
      if (/completed with no hit/i.test(message)) {
        return 'DrugDB -> PI: no reportable drug-target matches were recovered in this pass.';
      }
      const degradedMatch = message.match(/completed with degraded ChEMBL lookup: (\d+) Open Targets drug rows and (\d+) expanded candidates were recovered without ChEMBL target matches/i);
      if (degradedMatch) {
        return `DrugDB -> PI: ChEMBL target matching was temporarily unavailable, but ${degradedMatch[1]} Open Targets rows and ${degradedMatch[2]} expanded candidates were still recovered.`;
      }
      const degradedWithTargetsMatch = message.match(/completed with degraded ChEMBL lookup: (\d+) ChEMBL targets, (\d+) Open Targets drug rows, (\d+) activity molecule ids, and (\d+) expanded candidates/i);
      if (degradedWithTargetsMatch) {
        return `DrugDB -> PI: target screening finished in degraded mode; ${degradedWithTargetsMatch[1]} ChEMBL targets, ${degradedWithTargetsMatch[2]} Open Targets rows, ${degradedWithTargetsMatch[3]} molecule records, and ${degradedWithTargetsMatch[4]} expanded candidates were recovered.`;
      }
      const match = message.match(/completed: (\d+) ChEMBL targets, (\d+) Open Targets drug rows, (\d+) activity molecule ids, and (\d+) expanded candidates/i);
      if (match) return `DrugDB -> PI: ${match[1]} ChEMBL targets, ${match[2]} Open Targets rows, ${match[3]} molecule records, and ${match[4]} expanded candidates ready.`;
    }
    if (agentName === 'pathway') {
      if (/completed with no hit/i.test(message)) {
        return 'Pathway -> PI: no pathway or trial context cleared the current retrieval window.';
      }
      const match = message.match(/returned (\d+) pathways, (\d+) active trials, (\d+) genetic evidence blocks/i);
      if (match) {
        return `Pathway -> PI: ${match[1]} pathways, ${match[2]} active trials, and ${match[3]} genetic evidence blocks ready.`;
      }
    }
    if (agentName === 'repurposing') {
      const match = message.match(/returned (\d+) hypotheses/i);
      if (match && match[1] === '0') {
        return 'Repurposing -> PI: candidate ideas were reviewed, but none were strong enough to move forward.';
      }
      if (match) return `Repurposing -> PI: ${match[1]} candidate ideas ready.`;
    }
    if (agentName === 'evidence') {
      const match = message.match(/returned (\d+) scores/i);
      if (match && match[1] === '0') {
        return 'Evidence -> PI: scoring did not proceed because no reportable candidate set was available.';
      }
      if (match) return `Evidence -> PI: ${match[1]} candidates scored.`;
    }
    if (agentName === 'red_team') {
      if (/skipped because candidate review did not produce a shortlist/i.test(message)) {
        return 'PI skipped Red Team because repurposing did not produce a shortlist.';
      }
      if (/completed with no critiques/i.test(message)) {
        return 'Red Team -> PI: no challenge notes were generated because no scored shortlist was available.';
      }
      const match = message.match(/returned (\d+) critiques/i);
      if (match) return `Red Team -> PI: ${match[1]} challenge notes ready.`;
    }
    if (agentName === 'report' && /^Report narrative synthesized with /i.test(message)) {
      return 'Final research brief synthesized.';
    }
  }

  if (eventType === 'payment') {
    if (ERC8183_BUDGET_RE.test(message)) {
      return 'PI set the job budget on-chain.';
    }
    if (ERC8183_CREATE_RE.test(message)) {
      return 'Client created the job on-chain.';
    }
    if (ERC8183_FUND_RE.test(message)) {
      return 'Client funded the escrow on-chain.';
    }
    if (ERC8183_SUBMIT_RE.test(message)) {
      return 'PI submitted the deliverable on-chain.';
    }
    if (ERC8183_COMPLETE_RE.test(message)) {
      return 'Peer review completion recorded on-chain.';
    }
    if (ERC8183_REJECT_RE.test(message)) {
      return 'Peer review rejection recorded on-chain.';
    }
    if (ERC8183_PIPELINE_REFUND_RE.test(message)) {
      return 'Pipeline failure refund recorded on-chain.';
    }
  }

  if (eventType === 'error' && agentName === 'pi') {
    if (/^draft_report_safety_failed:/i.test(message) && /provenance_missing:\s*pmids_used empty/i.test(message)) {
      return explainPipelineFailure(message);
    }
    if (/^draft_report_safety_failed:/i.test(message)) {
      return explainPipelineFailure(message);
    }
  }

  if (eventType === 'error' && agentName === 'literature') {
    if (/pubmed search did not respond in time/i.test(message)) {
      return 'Literature -> PI: PubMed search took too long to respond, so the paper scan stopped before any shortlist could be built.';
    }
    if (/paper details did not load in time/i.test(message)) {
      return 'Literature -> PI: PubMed returned paper IDs, but the article details step timed out before screening could finish.';
    }
    if (/citation enrichment service did not respond in time/i.test(message)) {
      return 'Literature -> PI: the citation-ranking service took too long to respond, so literature reranking stopped early.';
    }
    if (/external medical literature service took too long to respond/i.test(message)) {
      return 'Literature -> PI: an external literature source took too long to respond, so this run stopped at the literature stage.';
    }
    if (/external literature service failed/i.test(message)) {
      return 'Literature -> PI: an external literature source failed before the paper scan finished.';
    }
  }

  if (eventType === 'error' && agentName === 'drugdb') {
    if (/chembl target service returned a server error/i.test(message)) {
      return 'DrugDB -> PI: the ChEMBL target service returned a server error before target screening finished.';
    }
    if (/chembl target service rejected the disease query format/i.test(message)) {
      return 'DrugDB -> PI: the ChEMBL target service rejected the disease query format for this pass.';
    }
    if (/external target service took too long to respond/i.test(message)) {
      return 'DrugDB -> PI: an external target lookup service took too long to respond, so drug-target screening stopped early.';
    }
    if (/external drug intelligence service failed/i.test(message)) {
      return 'DrugDB -> PI: an external drug intelligence source failed before candidate screening finished.';
    }
  }

  if (eventType === 'error' && agentName === 'pi') {
    if (/gateway replay failed for pi/i.test(message) && /drugdb target lookup failed because chembl returned 500/i.test(message)) {
      return 'DrugDB -> PI: the ChEMBL target service returned a server error, so this paid screening pass could not recover ChEMBL target matches.';
    }
    if (/gateway replay failed for pi/i.test(message) && /status=502/i.test(message)) {
      return 'PI -> Agent: a paid upstream service returned a temporary server error before this step could finish.';
    }
    if (/gateway replay failed for pi/i.test(message) && /service_execution_failed/i.test(message) && /drugdb/i.test(message)) {
      return 'DrugDB -> PI: the paid DrugDB call failed before target screening could finish.';
    }
  }

  return message;
}

function EventMessage({ message, eventType, agentName }: { message: string; eventType: string; agentName: string }) {
  const displayMessage = formatActivityMessage(message, eventType, agentName);
  if (!displayMessage.trim()) {
    return null;
  }
  const payoutMatch = eventType === 'payout' ? INTERNAL_PAYOUT_RE.exec(message) : null;
  if (payoutMatch) {
    const recipient = payoutMatch[1];
    const amount = payoutMatch[2];
    const hash = payoutMatch[4];
    return (
      <span className="text-slate-300 break-words">
        PI paid {prettyAgentName(recipient)} ${amount} USDC{' '}
        <a
          href={`https://testnet.arcscan.app/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline font-mono"
          title={hash}
        >
          {shortHash(hash)}
        </a>
      </span>
    );
  }

  const gatewayMatch = eventType === 'payment' ? GATEWAY_PAYMENT_RE.exec(message) : null;
  if (gatewayMatch) {
    const actor = gatewayMatch[1]?.trim() || 'Payment';
    const gatewayPaymentId = GATEWAY_TX_ID_RE.exec(message)?.[1] ?? '';
    return (
      <span className="text-slate-300 break-words">
        {humanizeGatewayPayment(actor)}
        <span className="text-slate-500"> · {NANOPAYMENT_PRICE_USDC} USDC</span>
        {gatewayPaymentId ? (
          <>
            <span className="text-slate-600"> · </span>
            <span className="text-slate-400">Payment ID </span>
            <span className="font-mono text-slate-500" title={gatewayPaymentId}>
              {gatewayPaymentId}
            </span>
          </>
        ) : null}
      </span>
    );
  }

  const rawMatch = TX_HASH_RE.exec(message);
  const match = TX_HASH_RE.exec(displayMessage);
  const hash = rawMatch?.[2] ?? match?.[2] ?? '';
  if (!match) {
    if (eventType === 'payment' && hash) {
      return (
        <span className="text-slate-300 break-words">
          {displayMessage}{' '}
          <a
            href={`https://testnet.arcscan.app/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline font-mono"
            title={hash}
          >
            {shortHash(hash)}
          </a>
        </span>
      );
    }
    return <span className="text-slate-300 break-words">{displayMessage}</span>;
  }
  const [full, , matchedHash] = match;

  if (eventType === 'payment') {
    return (
      <span className="text-slate-300 break-words">
        {displayMessage}{' '}
        <a
          href={`https://testnet.arcscan.app/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline font-mono"
          title={hash}
        >
          {shortHash(hash)}
        </a>
      </span>
    );
  }

  const before = displayMessage
    .slice(0, match.index)
    .replace(/\s+on ERC-8183\s*$/i, ' ')
    .replace(/\s+/g, ' ');
  const after  = displayMessage.slice(match.index + full.length);
  return (
    <span className="text-slate-300 break-words">
      {before}
      <a
        href={`https://testnet.arcscan.app/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 hover:text-sky-300 underline font-mono"
        title={hash}
      >
        {shortHash(hash)}
      </a>
      {after}
    </span>
  );
}

const EVENT_COLOR: Record<string, string> = {
  start:    'text-sky-400',
  dispatch: 'text-indigo-400',
  done:     'text-emerald-400',
  send:     'text-yellow-400',
  payment:  'text-fuchsia-400',
  payout:   'text-emerald-300',
  error:    'text-red-400',
  info:     'text-slate-400',
};

export default function WorkspacePage() {
  const params = useParams();
  const jobId = params.id as string;

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { writeContractAsync } = useWriteContract();

  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, string>>({});
  const [activeSince, setActiveSince] = useState<Record<string, number>>({});
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [escrow, setEscrow] = useState<EscrowStatus | null>(null);
  const [funding, setFunding] = useState<FundingDebug | null>(null);
  const [fundStep, setFundStep] = useState<'idle' | 'approving' | 'funding' | 'starting' | 'done' | 'error'>('idle');
  const [fundError, setFundError] = useState<string | null>(null);
  const [lifecycleSignature, setLifecycleSignature] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const evaluatorReason = extractEvaluatorReason(lastMessages['pi']);
  const syntheticLifecycleEvents = useMemo(() => buildSyntheticLifecycleEvents(jobId), [jobId, lifecycleSignature]);
  const mergedEvents = useMemo(
    () => dedupeLifecycleEvents([...syntheticLifecycleEvents, ...events]).sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [events, syntheticLifecycleEvents]
  );

  const onchainFundingStatus = funding?.onchain_job?.status ?? 'Draft';
  const fundingBudgetReady =
    funding?.onchain_job?.budget !== undefined &&
    Number(funding.onchain_job.budget) > 0;
  const pipelineIdle = Object.keys(statuses).length === 0;
  const fundingTerminal =
    onchainFundingStatus === 'Completed' ||
    onchainFundingStatus === 'Rejected' ||
    onchainFundingStatus === 'Expired';
  const showFundingPanel = pipelineIdle && !fundingTerminal;
  const canFund =
    showFundingPanel &&
    fundingBudgetReady &&
    (onchainFundingStatus === 'Open' || onchainFundingStatus === 'Draft');

  const handleFund = async () => {
    if (!isConnected || !address || !publicClient) {
      setFundError('Connect your wallet first.');
      return;
    }
    setFundError(null);
    try {
      // 1. approve
      setFundStep('approving');
      const approveHash = await writeContractAsync({
        address: USDC,
        abi: ERC20_APPROVE_ABI,
        account: address,
        chain: arcTestnet,
        functionName: 'approve',
        args: [ERC8183, FIXED_BUDGET_UNITS],
      } as any);
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
      if (approveReceipt.status !== 'success') throw new Error('approve reverted');

      // 2. fund
      setFundStep('funding');
      const fundHash = await writeContractAsync({
        address: ERC8183,
        abi: ERC8183_FUND_ABI,
        account: address,
        chain: arcTestnet,
        functionName: 'fund',
        args: [BigInt(jobId), '0x'],
      } as any);
      const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash, timeout: 120_000 });
      if (fundReceipt.status !== 'success') throw new Error('fund reverted');
      try {
        localStorage.setItem(
          `biomed_job_lifecycle_${jobId}_fund`,
          JSON.stringify({ txHash: fundHash, createdAt: new Date().toISOString() })
        );
        setLifecycleSignature(readLifecycleSignature(jobId));
      } catch {}

      // 3. start pipeline
      setFundStep('starting');
      const desc = typeof window !== 'undefined'
        ? localStorage.getItem(`biomed_job_desc_${jobId}`) ?? ''
        : '';
      const userType = 'researcher';
      const [disease = '', query = ''] = desc.split(' | ');
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: Number(jobId),
          disease: disease.trim(),
          query: query.trim(),
          user_type: userType,
          budget_units: FIXED_BUDGET_UNITS.toString(),
        }),
      });

      if (!response.ok) {
        let detail = 'Pipeline start failed.';
        try {
          const data = await response.json();
          detail = data?.detail || data?.error || detail;
        } catch {}
        throw new Error(detail);
      }

      setFundStep('done');
    } catch (err: unknown) {
      setFundError(err instanceof Error ? err.message : 'Fund failed');
      setFundStep('error');
    }
  };

  const piActive          = statuses['pi'] === 'active';
  const dataAgentsActive  = ['literature', 'drugdb', 'pathway'].some(a => statuses[a] === 'active');
  const repurposingActive = statuses['repurposing'] === 'active';
  const evidenceActive    = statuses['evidence'] === 'active';
  const redTeamActive     = statuses['red_team'] === 'active';
  const reportActive      = statuses['report'] === 'active';
  const pipelineStarted   = Object.keys(statuses).length > 0;

  const allDone = PIPELINE_IDS.every(id => statuses[id] === 'done' || statuses[id] === 'error') &&
    Object.keys(statuses).length > 0;
  const peerReviewStarted = mergedEvents.some(isEvaluatorDispatchMessage) || mergedEvents.some(isPeerReviewDecisionMessage);
  const peerReviewRejected = peerReviewStarted && statuses['evaluator_3'] === 'error';
  const pipelineRefunded = mergedEvents.some((event) => event.event_type === 'payment' && ERC8183_PIPELINE_REFUND_RE.test(event.message));
  const approved = statuses['evaluator_3'] === 'done' && !peerReviewRejected;
  const rejected = peerReviewRejected;
  const pipelineFailedBeforeReview = statuses['pi'] === 'error' && !peerReviewRejected && pipelineRefunded;
  const displayEscrow =
    escrow?.escrow_state === 'funded' && pipelineStarted
      ? {
          ...escrow,
          headline: 'Escrow funded',
          detail: 'The agent pipeline is now running.'
        }
      : escrow;
  const rejectTxHash = extractTxHash(
    [...events]
      .reverse()
      .find((event) => /finalizer reject executed|pipeline refund executed/i.test(event.message))
      ?.message
  );
  const completeTxHash = extractTxHash(
    [...events]
      .reverse()
      .find((event) => /finalizer complete executed/i.test(event.message))
      ?.message
  );

  useEffect(() => {
    setLifecycleSignature(readLifecycleSignature(jobId));
    const timer = setInterval(() => {
      setLifecycleSignature((current) => {
        const next = readLifecycleSignature(jobId);
        return current === next ? current : next;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [jobId]);

  useEffect(() => {
    if (pipelineStarted && (fundStep === 'starting' || fundStep === 'done')) {
      setFundStep('idle');
    }
  }, [pipelineStarted, fundStep]);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/workspace/events?job_id=${jobId}`);
    es.onmessage = (e) => {
      const event: AgentEvent = JSON.parse(e.data);
      setEvents(prev => {
        if (prev.some((item) => item.id === event.id)) return prev;
        return [...prev.slice(-200), event];
      });
      setLastMessages(prev => ({ ...prev, [event.agent_name]: event.message }));
      setActiveSince(prev => {
        const next = { ...prev };
        if (event.event_type === 'start' || event.event_type === 'dispatch') {
          next[event.agent_name] = next[event.agent_name] ?? Date.now();
          if (event.target_agent) next[event.target_agent] = next[event.target_agent] ?? Date.now();
          if (isEvaluatorDispatchMessage(event)) {
            next['evaluator_1'] = next['evaluator_1'] ?? Date.now();
            next['evaluator_2'] = next['evaluator_2'] ?? Date.now();
            next['evaluator_3'] = next['evaluator_3'] ?? Date.now();
          }
        } else if (event.event_type === 'done' || event.event_type === 'complete' || event.event_type === 'result' || event.event_type === 'error') {
          delete next[event.agent_name];
          if (isPeerReviewDecisionMessage(event) || (event.agent_name === 'pi' && event.event_type === 'error')) {
            delete next['report'];
            delete next['evaluator_1'];
            delete next['evaluator_2'];
            delete next['evaluator_3'];
          }
        }
        return next;
      });
      setStatuses(prev => {
        const next = { ...prev };
        if (event.event_type === 'start' || event.event_type === 'dispatch') {
          next[event.agent_name] = 'active';
          if (event.target_agent) next[event.target_agent] = 'active';
          if (isEvaluatorDispatchMessage(event)) {
            next['evaluator_1'] = 'active';
            next['evaluator_2'] = 'active';
            next['evaluator_3'] = 'active';
          }
        } else if (event.event_type === 'done' || event.event_type === 'complete' || event.event_type === 'result') {
          next[event.agent_name] = isNoHitMessage(event.message) ? 'warn' : 'done';
        } else if (event.event_type === 'error') {
          next[event.agent_name] = 'error';
          if (event.agent_name === 'pi') {
            next['report'] = next['report'] === 'done' ? 'done' : 'error';
            next['evaluator_1'] = 'error';
            next['evaluator_2'] = 'error';
            next['evaluator_3'] = 'error';
          }
        }
        if (event.agent_name === 'pi' && event.event_type === 'result') {
          const lowered = event.message.toLowerCase();
          if (lowered.includes('decision=approve') || lowered.includes('decision=approved')) {
            next['evaluator_1'] = 'done';
            next['evaluator_2'] = 'done';
            next['evaluator_3'] = 'done';
          } else if (lowered.includes('decision=reject') || lowered.includes('decision=rejected')) {
            next['evaluator_1'] = 'error';
            next['evaluator_2'] = 'error';
            next['evaluator_3'] = 'error';
          }
        }
        return next;
      });
      if (event.agent_name === 'pi' && event.event_type === 'error' && /^draft_report_safety_failed:/i.test(event.message)) {
        const failureText = explainPipelineFailure(event.message);
        const shortFailureText = explainPipelineFailureShort(event.message);
        setLastMessages(prev => ({
          ...prev,
          report: failureText,
          pi: shortFailureText
        }));
      }
      if (event.agent_name === 'pi' && event.event_type === 'result') {
        const lowered = event.message.toLowerCase();
        if (lowered.includes('decision=approve') || lowered.includes('decision=approved') || lowered.includes('decision=reject') || lowered.includes('decision=rejected')) {
          const reason = extractEvaluatorReason(event.message);
          setLastMessages(prev => ({
            ...prev,
            evaluator_1: reason || event.message,
            evaluator_2: reason || event.message,
            evaluator_3: reason || event.message
          }));
        }
      }
    };
    return () => es.close();
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadFunding = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/funding`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setFunding(data);
      } catch {}
      if (!cancelled) {
        timer = setTimeout(loadFunding, 4000);
      }
    };

    loadFunding();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadEscrow = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/escrow`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setEscrow(data);
      } catch {}
      if (!cancelled) {
        timer = setTimeout(loadEscrow, 4000);
      }
    };

    loadEscrow();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [mergedEvents]);

  const getStatus = (id: string): AgentStatus => statuses[id] ?? 'idle';
  const isSlow = (id: string) =>
    id !== 'pi' &&
    getStatus(id) === 'active' &&
    typeof activeSince[id] === 'number' &&
    nowTs - activeSince[id] > 15000;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            New request
          </Link>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">Research Workspace</h1>
          </div>
          <p className="text-slate-500 text-sm">Task #{jobId} · Agent Pipeline</p>
        </div>

        {/* Fund Research panel — shown before the pipeline starts */}
        {(showFundingPanel || fundStep !== 'idle') && (
          <div className="mb-6 rounded-xl border border-sky-700/50 bg-sky-950/25 px-5 py-4">
            <p className="text-sm font-semibold text-white mb-1">Fund Research to Start</p>
            <p className="text-xs text-slate-300 mb-4">
              {fundingBudgetReady
                ? 'Your request has been accepted and a fixed 3 USDC budget has been prepared. Fund the escrow to start the agent pipeline.'
                : 'Your request has been created. The fixed 3 USDC budget is still being prepared; refresh in a few seconds if the fund button does not appear immediately.'}
            </p>
            {fundStep === 'idle' || fundStep === 'error' ? (
              <button
                onClick={handleFund}
                disabled={!isConnected || !canFund}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {!fundingBudgetReady
                  ? 'Preparing 3 USDC budget...'
                  : isConnected
                    ? 'Approve & Fund 3 USDC'
                    : 'Connect wallet to fund'}
              </button>
            ) : fundStep === 'done' ? (
              <p className="text-xs text-emerald-400 font-medium">Funded — opening live workspace...</p>
            ) : (
              <div className="flex items-center gap-2 text-xs text-sky-300">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {fundStep === 'approving' ? 'Approving USDC...' : fundStep === 'funding' ? 'Funding escrow...' : 'Starting pipeline...'}
              </div>
            )}
            {fundError && <p className="mt-2 text-xs text-red-400">{fundError}</p>}
          </div>
        )}

        {displayEscrow && !rejected && (
          <div
            className={`mb-6 rounded-xl border px-5 py-4 ${
              displayEscrow.escrow_state === 'settled_to_pi'
                ? 'border-emerald-700/50 bg-emerald-950/30'
                : displayEscrow.escrow_state === 'refunded'
                  ? 'border-amber-700/50 bg-amber-950/25'
                  : displayEscrow.escrow_state === 'refund_pending'
                    ? 'border-rose-700/50 bg-rose-950/25'
                    : 'border-sky-700/40 bg-sky-950/20'
            }`}
          >
            <p className="text-sm font-medium text-white">{displayEscrow.headline}</p>
            <p className="mt-1 text-xs text-slate-300">
              {displayEscrow.detail}
              {displayEscrow.escrow_state === 'settled_to_pi' && completeTxHash ? (
                <>
                  {' '}
                  <a
                    href={`https://testnet.arcscan.app/tx/${completeTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-300 hover:text-sky-200 underline font-mono"
                    title={completeTxHash}
                  >
                    {shortHash(completeTxHash)}
                  </a>
                </>
              ) : displayEscrow.escrow_state === 'refunded' && rejectTxHash ? (
                <>
                  {' '}
                  <a
                    href={`https://testnet.arcscan.app/tx/${rejectTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-300 hover:text-sky-200 underline font-mono"
                    title={rejectTxHash}
                  >
                    {shortHash(rejectTxHash)}
                  </a>
                </>
              ) : null}
            </p>
            {displayEscrow.escrow_state !== 'funded' && (
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">Technical status: {displayEscrow.status}</p>
            )}
          </div>
        )}


        <div className="flex gap-6">
          {/* Pipeline canvas */}
          <div className="flex-1 min-w-0">
            <div className="max-w-sm mx-auto">
              <AgentCard agent={AGENTS[0]} status={getStatus('pi')} lastMsg={lastMessages['pi']} slow={isSlow('pi')} />
            </div>
            <FanConnector active={piActive || dataAgentsActive} />
            <div className="grid grid-cols-3 gap-3">
              {AGENTS.slice(1, 4).map(agent => (
                <AgentCard key={agent.id} agent={agent} status={getStatus(agent.id)} lastMsg={lastMessages[agent.id]} slow={isSlow(agent.id)} />
              ))}
            </div>
            <FanInConnector active={dataAgentsActive || repurposingActive} />
            <div className="max-w-sm mx-auto">
              <AgentCard agent={AGENTS[4]} status={getStatus('repurposing')} lastMsg={lastMessages['repurposing']} slow={isSlow('repurposing')} />
            </div>
            <Connector active={repurposingActive || evidenceActive} />
            <div className="max-w-sm mx-auto">
              <AgentCard agent={AGENTS[5]} status={getStatus('evidence')} lastMsg={lastMessages['evidence']} slow={isSlow('evidence')} />
            </div>
            <Connector active={evidenceActive || redTeamActive} />
            <div className="max-w-sm mx-auto">
              <AgentCard agent={AGENTS[6]} status={getStatus('red_team')} lastMsg={lastMessages['red_team']} slow={isSlow('red_team')} />
            </div>
            <Connector active={redTeamActive || reportActive} />
            <div className="max-w-sm mx-auto">
              <AgentCard agent={AGENTS[7]} status={getStatus('report')} lastMsg={lastMessages['report']} slow={isSlow('report')} />
            </div>

            <div className="mt-6 border-t border-slate-800 pt-6">
              <p className="text-xs text-slate-600 text-center mb-3 uppercase tracking-widest">Peer Review Panel</p>
              <div className="grid grid-cols-3 gap-3">
                {AGENTS.slice(8).map(agent => (
                  <AgentCard key={agent.id} agent={agent} status={getStatus(agent.id)} lastMsg={lastMessages[agent.id]} slow={isSlow(agent.id)} />
                ))}
              </div>
            </div>

            {approved && (
              <div className="mt-6 flex items-center justify-between rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-5 py-4">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-sm font-medium text-emerald-200">
                    Peer review approved — research report is ready.
                  </span>
                </div>
                <Link
                  href={`/results/${jobId}`}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
                >
                  View Report
                </Link>
              </div>
            )}
            {pipelineFailedBeforeReview && (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-700/50 bg-amber-950/30 px-5 py-4">
                <svg className="w-5 h-5 text-amber-300 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm0-13.5 8.25 14.25H3.75L12 3Z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-100">Delivery stopped by an internal quality check</p>
                  <p className="text-xs text-white mt-1">
                    {lastMessages['report'] || explainPipelineFailure(lastMessages['pi'])}
                  </p>
                  {rejectTxHash && (
                    <p className="text-xs text-amber-300 mt-1">
                      Refund recorded on-chain.
                      {' '}
                      <a
                        href={`https://testnet.arcscan.app/tx/${rejectTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-300 hover:text-sky-200 underline font-mono"
                        title={rejectTxHash}
                      >
                        {shortHash(rejectTxHash)}
                      </a>
                    </p>
                  )}
                </div>
              </div>
            )}
            {rejected && (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-red-700/50 bg-red-950/30 px-5 py-4">
                <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-200">Peer review rejected</p>
                  <p className="text-xs text-white mt-1">
                    {explainRejectReason(evaluatorReason || lastMessages['evaluator_3'])}
                  </p>
                  {escrow?.escrow_state === 'refunded' && (
                    <p className="text-xs text-amber-300 mt-1">
                      The locked escrow was refunded to the client wallet and recorded on-chain.
                      {rejectTxHash && (
                        <>
                          {' '}
                          <a
                            href={`https://testnet.arcscan.app/tx/${rejectTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-300 hover:text-sky-200 underline font-mono"
                            title={rejectTxHash}
                          >
                            {shortHash(rejectTxHash)}
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Activity feed */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-6 rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden backdrop-blur">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                <span className="text-sm font-medium">Live Activity</span>
              </div>
              <div
                ref={feedRef}
                className="h-[600px] overflow-y-auto p-3 space-y-2 text-xs font-mono"
                role="log"
                aria-live="polite"
                aria-label="Agent activity feed"
              >
                {mergedEvents.length === 0 ? (
                  <p className="text-slate-600 text-center mt-8">Waiting for agents…</p>
                ) : (
                  mergedEvents.filter(shouldRenderActivityEvent).map(ev => (
                    <div
                      key={ev.id}
                      className={`flex gap-2 rounded-md px-2 py-1 ${
                        ev.event_type === 'payment'
                          ? 'bg-fuchsia-950/30 border border-fuchsia-900/40'
                          : ev.event_type === 'payout'
                            ? 'bg-emerald-950/20 border border-emerald-900/30'
                            : ''
                      }`}
                    >
                      <span className="text-slate-600 flex-shrink-0">
                        {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span className={`flex-shrink-0 font-semibold ${EVENT_COLOR[ev.event_type] ?? 'text-slate-400'}`}>
                        [{ev.agent_name}]
                      </span>
                      <EventMessage message={ev.message} eventType={ev.event_type} agentName={ev.agent_name} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes slide-down { 0% { top: -100%; } 100% { top: 100%; } }
      `}</style>
    </main>
  );
}
