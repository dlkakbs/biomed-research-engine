'use client';

import { useParams } from 'next/navigation';

const PIPELINE_STEPS = [
  { key: 'literature', label: 'Literature Agent', model: 'Claude Sonnet' },
  { key: 'drugdb', label: 'Drug DB Agent', model: 'GPT-4o' },
  { key: 'pathway', label: 'Pathway Agent', model: 'Gemini Pro' },
  { key: 'repurposing', label: 'Repurposing Agent', model: 'Claude Sonnet' },
  { key: 'evidence', label: 'Evidence Scorer', model: 'GPT-4o' },
  { key: 'report', label: 'Report Agent', model: 'Claude Sonnet' },
  { key: 'peer_review', label: 'Peer Review', model: 'Claude + GPT-4o' },
];

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export default function TaskPage() {
  const params = useParams();
  const jobId = params.id;

  // TODO: fetch real job status from on-chain + backend
  const mockStatus: Record<string, StepStatus> = {
    literature: 'done',
    drugdb: 'done',
    pathway: 'running',
    repurposing: 'pending',
    evidence: 'pending',
    report: 'pending',
    peer_review: 'pending',
  };

  const statusColor: Record<StepStatus, string> = {
    pending: 'text-gray-500',
    running: 'text-yellow-400 animate-pulse',
    done: 'text-green-400',
    failed: 'text-red-400',
  };
  const statusLabel: Record<StepStatus, string> = {
    pending: '⏳ Pending',
    running: '⚙️ Running',
    done: '✓ Done',
    failed: '✗ Failed',
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Job #{jobId}</h1>
        <p className="text-gray-400 text-sm mb-8">Pipeline progress — refreshes every 10s</p>

        <div className="space-y-3">
          {PIPELINE_STEPS.map((step) => {
            const status = mockStatus[step.key] || 'pending';
            return (
              <div key={step.key} className="bg-gray-900 rounded-lg px-5 py-4 border border-gray-800 flex justify-between items-center">
                <div>
                  <div className="font-medium">{step.label}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{step.model}</div>
                </div>
                <span className={`text-sm font-mono ${statusColor[status]}`}>
                  {statusLabel[status]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
