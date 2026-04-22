'use client';

import Link from 'next/link';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';

// ── Animation helpers ──────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -60px 0px' });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 24 }}
      animate={reduced ? {} : (inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 })}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function FadeUpItem({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -40px 0px' });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      animate={reduced ? {} : (inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 })}
      transition={{ duration: 0.5, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Agent pipeline ─────────────────────────────────────────────────────────────

type AgentColor = 'sky' | 'violet' | 'amber' | 'emerald' | 'slate';

const AGENT_COLORS: Record<AgentColor, { border: string; bg: string; badge: string; dot: string }> = {
  sky:     { border: 'border-sky-800/50',     bg: 'bg-sky-950/30',     badge: 'bg-sky-950/60 text-sky-300 border-sky-800/60',         dot: 'bg-sky-400'     },
  violet:  { border: 'border-violet-800/50',  bg: 'bg-violet-950/30',  badge: 'bg-violet-950/60 text-violet-300 border-violet-800/60', dot: 'bg-violet-400'  },
  amber:   { border: 'border-amber-800/50',   bg: 'bg-amber-950/30',   badge: 'bg-amber-950/60 text-amber-300 border-amber-800/60',   dot: 'bg-amber-400'   },
  emerald: { border: 'border-emerald-800/50', bg: 'bg-emerald-950/30', badge: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60', dot: 'bg-emerald-400' },
  slate:   { border: 'border-slate-700/60',   bg: 'bg-slate-900/40',   badge: 'bg-slate-800/60 text-slate-400 border-slate-700/60',   dot: 'bg-slate-500'   },
};

function AgentNode({ name, role, subtitle, detail, color = 'slate', wide = false }: {
  name: string; role: string; subtitle: string; detail: string; color?: AgentColor; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -40px 0px' });
  const reduced = useReducedMotion();
  const c = AGENT_COLORS[color];
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      animate={reduced ? {} : (inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 })}
      transition={{ duration: 0.5, ease: EASE }}
      className={`rounded-xl border p-4 backdrop-blur-sm ${c.border} ${c.bg} ${wide ? 'w-full max-w-sm' : ''}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} aria-hidden="true" />
        <span className="font-semibold text-sm text-white">{role}</span>
      </div>
      <p className="text-xs text-slate-500 mb-2">{name}</p>
      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium mb-3 ${c.badge}`}>
        {subtitle}
      </span>
      <p className="text-xs text-slate-400 leading-5">{detail}</p>
    </motion.div>
  );
}

function VerticalConnector() {
  return (
    <div className="flex justify-center my-1" aria-hidden="true">
      <div className="w-px h-6 bg-slate-800" />
    </div>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────────

const workflowSteps = [
  {
    eyebrow: 'Step 1',
    title: 'Submit a research request',
    body: 'Choose the disease area, describe the research question, and set the budget for the job.',
  },
  {
    eyebrow: 'Step 2',
    title: 'Specialized agents gather evidence',
    body: 'Specialized agents review the literature, screen candidate molecules, map disease biology, and add independent evaluation before the report is finalized.',
  },
  {
    eyebrow: 'Step 3',
    title: 'Receive a scored research brief',
    body: 'Receive ranked candidates with clear scoring, key cautions, failure modes, next-step tests, and a traceable research trail.',
  },
];

const proofPoints = [
  { icon: <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>, label: 'User-requested biomedical research workflows' },
  { icon: <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" /></svg>, label: 'Independent review before final output' },
  { icon: <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h16.5m-16.5 6.75h16.5" /></svg>, label: 'Specialized agents for evidence gathering' },
  { icon: <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>, label: 'Traceable research trail' },
];

const dataSources = [
  { name: 'PubMed / MEDLINE', tag: 'Literature',     detail: '36M+ peer-reviewed papers. Full-text mining, PMID tracing, evidence scoring.',                                                color: 'text-sky-300',     bg: 'bg-sky-950/40 border-sky-900/50',       icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg> },
  { name: 'ChEMBL',           tag: 'Drug Database',  detail: '2.4M+ bioactive compounds. Target binding, mechanism of action, clinical annotations.',                                     color: 'text-violet-300',  bg: 'bg-violet-950/40 border-violet-900/50', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg> },
  { name: 'OpenTargets',      tag: 'Disease Biology', detail: 'Disease-target associations and pathway-level target context used to anchor mechanism-first ranking.',                      color: 'text-cyan-300',    bg: 'bg-cyan-950/40 border-cyan-900/50',     icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 15.429 12 21l5.571-5.571M12 3v17.143M4.5 7.5h15" /></svg> },
  { name: 'ClinicalTrials.gov', tag: 'Trials',       detail: '480K+ registered studies. Active trial landscape, eligibility, NCT tracing.',                                               color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-900/50', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg> },
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
      <div className="relative">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_40%),radial-gradient(circle_at_top_right,rgba(96,165,250,0.10),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.06),transparent_40%)]" aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/45 to-transparent" />

        {/* ── Hero ── */}
        <section className="relative max-w-6xl mx-auto px-6 pt-28 pb-18 text-center sm:pt-32">
          <div className="mx-auto max-w-4xl">
            <FadeUpItem delay={0}><p className="mb-4 text-sm uppercase tracking-[0.32em] text-sky-200">Veliora</p></FadeUpItem>
<FadeUpItem delay={0.06}>
              <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                <span className="text-shimmer">A new economy for biomedical research</span><br />
                <span className="text-shimmer">powered by agentic intelligence.</span>
              </h1>
            </FadeUpItem>
            <FadeUpItem delay={0.12}>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-300">
                Structured insights for humans.<br />
                Coordinated agent pipelines for end-to-end research.
              </p>
            </FadeUpItem>
            <FadeUpItem delay={0.18} className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard" className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none">
                Create Research Task
              </Link>
              <a href="#how-it-works" className="rounded-lg border border-slate-700/80 bg-slate-900/40 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none">
                See How It Works
              </a>
            </FadeUpItem>
            <FadeUpItem delay={0.26} className="mt-6 flex flex-wrap justify-center gap-2">
              {['Circle', 'Arc', 'x402'].map((tag) => (
                <span key={tag} className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs text-slate-400">{tag}</span>
              ))}
            </FadeUpItem>
            <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
              {proofPoints.map((item, i) => (
                <FadeUpItem key={item.label} delay={0.22 + i * 0.07}>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-white/4 px-4 py-4 text-sm text-slate-200">
                    {item.icon}{item.label}
                  </div>
                </FadeUpItem>
              ))}
            </div>
          </div>
        </section>

        {/* ── What It Does ── */}
        <section className="relative max-w-6xl mx-auto px-6 py-14">
          <FadeUp className="mb-8 max-w-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-300">What Is Veliora</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Advancing biomedical research</h2>
          </FadeUp>
          <FadeUpItem>
            <div className="rounded-2xl border border-slate-700/70 bg-white/4 p-8 backdrop-blur-sm">
              <p className="text-lg leading-8 text-slate-200">
                Synthesize biomedical data into high-quality research reports — combining deep literature mining, rigorous evidence scoring, and end-to-end reproducibility.
              </p>
            </div>
          </FadeUpItem>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="relative max-w-6xl mx-auto px-6 py-14">
          <FadeUp className="mb-8 max-w-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-300">How It Works</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">A research request becomes an economic workflow</h2>
            <p className="mt-3 text-slate-400">The user-facing experience stays simple. The payment and coordination complexity stays in the agent layer.</p>
          </FadeUp>
          <div className="grid gap-4 lg:grid-cols-3">
            {workflowSteps.map((step, i) => (
              <FadeUpItem key={step.eyebrow} delay={i * 0.08}>
                <div className="rounded-2xl border border-slate-700/70 bg-white/4 p-6 backdrop-blur-sm h-full">
                  <p className="text-xs uppercase tracking-[0.22em] text-sky-300">{step.eyebrow}</p>
                  <h3 className="mt-3 text-xl font-semibold text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{step.body}</p>
                </div>
              </FadeUpItem>
            ))}
          </div>
        </section>

        {/* ── Why Arc ── */}
        <section className="relative max-w-6xl mx-auto px-6 py-14">
          <FadeUp className="mb-8 max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-300">Why Arc + Circle Nanopayments</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Infrastructure for low-value research payments</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              Our workflow depends on small paid research steps for data access and evaluation. Arc and Circle make that model practical through gasless payment authorization and batched settlement on Arc.
            </p>
          </FadeUp>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Per-action research economics',
                body: 'Our workflow breaks research into small paid steps for data access and evaluation. Circle Gateway keeps those low-value actions practical by batching settlement instead of forcing every payment to stand alone onchain.',
              },
              {
                title: 'USDC-native transaction flow',
                body: 'Buyers authorize payments in USDC, and Arc keeps payment and gas logic aligned around the same asset instead of introducing a separate volatile gas token into the workflow.',
              },
              {
                title: 'Fast finality for coordination',
                body: 'Research runs involve many sequential paid actions. Fast finality helps the workflow continue without long pauses between steps.',
              },
            ].map((item, i) => (
              <FadeUpItem key={item.title} delay={i * 0.07}>
                <div className="rounded-2xl border border-slate-700/70 bg-white/4 p-6 backdrop-blur-sm h-full">
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{item.body}</p>
                </div>
              </FadeUpItem>
            ))}
          </div>
        </section>

        {/* ── Data & Intelligence ── */}
        <section className="relative max-w-6xl mx-auto px-6 py-14">
          <FadeUp className="mb-10 max-w-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-300">Data & Intelligence</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Built on the leading biomedical databases and research systems</h2>
            <p className="mt-3 text-slate-400 text-sm leading-7">Each analysis is built from traceable scientific sources and specialized research agents that structure evidence into a reviewable output.</p>
          </FadeUp>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {dataSources.map((src, i) => (
              <FadeUpItem key={src.name} delay={i * 0.08}>
                <div className={`rounded-2xl border p-5 backdrop-blur-sm h-full ${src.bg}`}>
                  <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 ${src.color}`}>{src.icon}</div>
                  <p className={`text-xs uppercase tracking-wider mb-1 ${src.color}`}>{src.tag}</p>
                  <h3 className="font-semibold text-white text-sm mb-2">{src.name}</h3>
                  <p className="text-xs leading-5 text-slate-400">{src.detail}</p>
                </div>
              </FadeUpItem>
            ))}
          </div>

          <FadeUp>
            <div className="rounded-2xl border border-slate-700/70 bg-white/4 p-8 backdrop-blur-sm text-center">
              <p className="text-xs uppercase tracking-[0.22em] text-sky-300 mb-3">Task-specific research orchestration</p>
              <p className="text-slate-300 leading-7 max-w-2xl mx-auto">
                Each specialist agent handles a distinct research task, from literature review and compound screening to pathway analysis and structured evaluation.
              </p>
            </div>
          </FadeUp>

          {/* ── Agent Pipeline ── */}
          <div className="mt-10">
            <FadeUp>
              <p className="text-xs uppercase tracking-[0.28em] text-sky-300 mb-6 text-center">Agent Pipeline</p>
            </FadeUp>

            <div className="flex flex-col items-center">
              {/* PI */}
              <div className="flex justify-center w-full mb-2">
                <AgentNode name="Dr. Iris" role="PI Agent" subtitle="Research Orchestrator" color="sky" wide
                  detail="Receives the research request, coordinates all downstream agents, manages the USDC payment flow, and submits the final deliverable on-chain." />
              </div>

              {/* Fan out */}
              <div className="w-full flex justify-center mb-2" aria-hidden="true">
                <svg width="560" height="36" viewBox="0 0 560 36" className="overflow-visible">
                  <line x1="280" y1="0" x2="80"  y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                  <line x1="280" y1="0" x2="280" y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                  <line x1="280" y1="0" x2="480" y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                </svg>
              </div>

              {/* Parallel agents */}
              <div className="grid grid-cols-3 gap-4 mb-2 w-full max-w-4xl">
                <AgentNode name="Dr. Mira"  role="Literature" subtitle="PubMed + OpenAlex"               color="violet" detail="Mines peer-reviewed papers, extracts evidence scores, clinical maturity, study types, and returns ranked PMIDs with full provenance." />
                <AgentNode name="Dr. Rex"   role="DrugDB"     subtitle="ChEMBL + UniProt + OpenTargets"  color="violet" detail="Queries bioactive compound databases for target binding, mechanism of action, and existing clinical annotations for candidate drugs." />
                <AgentNode name="Dr. Nova"  role="Pathway"    subtitle="OpenTargets + ClinicalTrials.gov"  color="violet" detail="Maps disease-associated targets, aggregates pathway overlap, and adds active trial context to anchor the report in disease biology." />
              </div>

              {/* Fan in */}
              <div className="w-full flex justify-center mb-2" aria-hidden="true">
                <svg width="560" height="36" viewBox="0 0 560 36" className="overflow-visible">
                  <line x1="80"  y1="0" x2="280" y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                  <line x1="280" y1="0" x2="280" y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                  <line x1="480" y1="0" x2="280" y2="36" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 3"/>
                </svg>
              </div>

              {/* Repurposing */}
              <div className="flex justify-center w-full mb-2">
                <AgentNode name="Dr. Spark" role="Repurposing" subtitle="Cross-indication Synthesis" color="amber" wide
                  detail="Synthesizes literature, compound, and disease-biology signals into cross-indication hypotheses while separating likely repurposing leads from disease-native assets." />
              </div>
              <VerticalConnector />

              {/* Evidence */}
              <div className="flex justify-center w-full mb-2">
                <AgentNode name="Dr. Vera" role="Evidence Scorer" subtitle="Structured Scoring" color="emerald" wide
                  detail="Applies the fixed 0–100 scoring rubric across literature support, mechanism overlap, clinical evidence, and safety profile, then explains why each candidate ranked where it did." />
              </div>
              <VerticalConnector />

              {/* Red team */}
              <div className="flex justify-center w-full mb-2">
                <AgentNode name="Dr. Vale" role="Red Team" subtitle="Critical Review" color="amber" wide
                  detail="Stress-tests the shortlist with the strongest counter-arguments: confounders in the evidence, mechanism-to-clinic failure modes, and reasons each candidate may not translate." />
              </div>
              <VerticalConnector />

              {/* Report */}
              <div className="flex justify-center w-full mb-6">
                <AgentNode name="Dr. Aria" role="Report" subtitle="Final Research Brief" color="sky" wide
                  detail="Generates the structured research brief with top candidates, evidence table, provenance (PMIDs, ChEMBL IDs, NCT IDs), red-team caveats, and mandatory disclaimer." />
              </div>

              {/* Peer review */}
              <FadeUpItem className="w-full border-t border-slate-800/60 pt-6">
                <p className="text-xs uppercase tracking-widest text-sky-300 text-center mb-4">Independent Peer Review Panel</p>
                <div className="grid grid-cols-3 gap-4 max-w-4xl mx-auto">
                  <AgentNode name="Dr. Leo"   role="Reviewer I"  subtitle="Methodology Review" color="slate" detail="Checks disclaimer text, provenance fields (PMIDs, ChEMBL IDs, models, timestamp), evidence_table completeness, and that all pipeline steps are present." />
                  <AgentNode name="Dr. Zara"  role="Reviewer II" subtitle="Consistency Review" color="slate" detail="Audits evidence score breakdowns, candidate/evidence table alignment, and flags contradictory field values." />
                  <AgentNode name="Dr. Swift" role="Tiebreaker"  subtitle="Arbiter"            color="slate" detail="Called only on a 1–1 reviewer split. Reads both reasons and casts the deciding vote under a rejection-first principle." />
                </div>
              </FadeUpItem>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="relative max-w-6xl mx-auto px-6 pt-6 pb-14">
          <FadeUp>
            <div className="rounded-3xl border border-sky-900/30 bg-gradient-to-r from-sky-950/18 via-white/4 to-white/3 p-8 backdrop-blur-sm">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-xs uppercase tracking-[0.24em] text-sky-300">Start Here</p>
                  <h2 className="mt-3 text-3xl font-semibold text-white">Create a request and fund the workflow in USDC</h2>
                </div>
                <Link href="/dashboard" className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none">
                  Create Research Task
                </Link>
              </div>
            </div>
          </FadeUp>
        </section>

        {/* ── Disclaimer ── */}
        <section className="relative max-w-6xl mx-auto px-6 pb-20">
          <FadeUp>
            <div className="rounded-2xl border border-amber-800/50 bg-amber-900/14 p-4 text-sm text-amber-100">
              <strong>Research Disclaimer:</strong> This platform generates AI-assisted research outputs
              for informational purposes only. Outputs do not constitute medical advice, diagnosis,
              or treatment recommendation. All findings must be validated by qualified researchers before any use.
            </div>
          </FadeUp>
        </section>
      </div>
    </main>
  );
}
