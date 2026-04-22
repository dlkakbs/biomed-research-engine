import { NextResponse } from 'next/server';
import { buildServerApiUrl } from '@/lib/server-api';

const REPORT_PROXY_TIMEOUT_MS = 8000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(buildServerApiUrl(`/api/reports/${id}`), {
      cache: 'no-store',
      signal: controller.signal,
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error && error.name === 'AbortError' ? 'report_fetch_timeout' : 'report_fetch_failed',
        detail:
          error instanceof Error && error.name === 'AbortError'
            ? `Report proxy timed out after ${REPORT_PROXY_TIMEOUT_MS}ms.`
            : error instanceof Error
              ? error.message
              : 'unknown',
      },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
