'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';

export default function JobsPage() {
  const { address, isConnected } = useAccount();
  const [jobs, setJobs] = useState<string[]>([]);

  useEffect(() => {
    if (!isConnected || !address) {
      setJobs([]);
      return;
    }
    try {
      const walletKey = `biomed_jobs_${String(address).toLowerCase()}`;
      const stored = JSON.parse(localStorage.getItem(walletKey) ?? '[]') as string[];
      setJobs(stored);
    } catch {
      setJobs([]);
    }
  }, [address, isConnected]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_35%)]" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/25 to-transparent" aria-hidden="true" />

      <div className="relative max-w-2xl mx-auto px-6 py-12">
        <p className="mb-2 text-xs uppercase tracking-[0.28em] text-sky-300">History</p>
        <h1 className="text-4xl font-semibold mb-2">My Research Tasks</h1>
        <p className="text-slate-400 text-sm mb-8">Tasks are stored locally in this browser.</p>

        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/70 bg-white/4 p-10 text-center backdrop-blur-sm">
            <svg className="w-10 h-10 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <p className="text-slate-500 text-sm mb-4">
              {isConnected ? 'No tasks for this wallet yet.' : 'Connect your wallet to see your tasks.'}
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 transition focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
            >
              Create your first task
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((jobId) => {
              const desc = (() => {
                try { return localStorage.getItem(`biomed_job_desc_${jobId}`) ?? ''; } catch { return ''; }
              })();
              return (
                <Link
                  key={jobId}
                  href={`/workspace/${jobId}`}
                  className="group flex items-center justify-between rounded-2xl border border-slate-700/70 bg-white/4 px-5 py-4 backdrop-blur-sm transition hover:border-sky-700/60 hover:bg-sky-950/20 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">Task #{jobId}</p>
                    {desc && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate max-w-sm">{desc}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <span className="text-xs text-slate-500 group-hover:text-sky-400 transition">View workspace</span>
                    <svg className="w-4 h-4 text-slate-600 group-hover:text-sky-400 transition" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </Link>
              );
            })}

            <div className="pt-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 transition focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New request
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
