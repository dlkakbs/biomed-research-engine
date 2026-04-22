import { NextRequest } from 'next/server';
import { buildServerApiUrl } from '@/lib/server-api';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('job_id');
  const sinceId = req.nextUrl.searchParams.get('since_id') || '0';

  if (!jobId) {
    return new Response('job_id required', { status: 400 });
  }

  const encoder = new TextEncoder();
  const requestSignal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let lastId = parseInt(sinceId);
      let done = false;
      let closed = false;

      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      requestSignal.addEventListener('abort', onAbort);

      try {
        while (!done && !closed && !requestSignal.aborted) {
          try {
            const res = await fetch(
              buildServerApiUrl(`/api/workspace/events?job_id=${jobId}&since_id=${lastId}`),
              { signal: AbortSignal.any([AbortSignal.timeout(5000), requestSignal]) }
            );

            if (res.ok) {
              const data = await res.json();
              const events: Array<{ id: number; agent_name: string; event_type: string; message: string; target_agent?: string; created_at: string }> = data.events || [];
              for (const event of events) {
                if (closed || requestSignal.aborted) {
                  break;
                }
                send(event);
                lastId = event.id;
              }
              if (data.job_status === 'complete' || data.job_status === 'failed') {
                // Flush: client'ın son olayları işlemesi için bekle, sonra kapat
                controller.enqueue(encoder.encode(': flush\n\n'));
                await new Promise(r => setTimeout(r, 800));
                done = true;
              }
            }
          } catch {
            // gateway not running yet — send keepalive
          }

          if (!done && !closed && !requestSignal.aborted) {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } finally {
        requestSignal.removeEventListener('abort', onAbort);
        if (!closed) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
