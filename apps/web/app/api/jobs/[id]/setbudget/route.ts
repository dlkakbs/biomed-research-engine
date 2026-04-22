import { NextResponse } from 'next/server';
import { buildServerApiUrl } from '@/lib/server-api';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const response = await fetch(buildServerApiUrl(`/api/jobs/${id}/setbudget`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'setbudget_failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
