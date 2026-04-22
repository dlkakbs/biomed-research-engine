import http from "node:http";
import type { DatabaseConnection } from "@biomed/db";
import { createApiRouter } from "./router.js";

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function toRequest(request: http.IncomingMessage, body: string): Request {
  const origin = `http://${request.headers.host ?? "localhost:3001"}`;
  const url = new URL(request.url ?? "/", origin);
  return new Request(url, {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : body
  });
}

export function createHttpServer(db: DatabaseConnection) {
  const route = createApiRouter(db);

  return http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    const request = toRequest(req, body);
    const response = await route(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const text = await response.text();
    res.end(text);
  });
}
