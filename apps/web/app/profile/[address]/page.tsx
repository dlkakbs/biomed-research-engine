'use client';

import { useParams } from 'next/navigation';

export default function ProfilePage() {
  const params = useParams();
  const address = params.address as string;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Agent Profile</h1>
        <p className="text-gray-400 text-sm font-mono mb-8">{address}</p>

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <p className="text-gray-400 text-sm">
            Agent profile details will appear here.
          </p>
        </div>
      </div>
    </main>
  );
}
