import { NextResponse } from 'next/server';
import { buildServerApiUrl } from '@/lib/server-api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const response = await fetch(buildServerApiUrl(`/api/jobs/${id}/funding`), {
      cache: 'no-store',
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'funding_fetch_failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const response = await fetch(buildServerApiUrl(`/api/jobs/${id}/funding`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'funding_upsert_failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
