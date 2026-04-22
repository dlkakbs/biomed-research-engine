import { NextRequest, NextResponse } from 'next/server';
import { buildServerApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(buildServerApiUrl('/api/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
