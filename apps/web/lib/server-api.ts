const DEFAULT_API_URL = "http://localhost:3001";

export function getServerApiBaseUrl(): string {
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.GATEWAY_URL ||
    DEFAULT_API_URL
  ).replace(/\/$/, "");
}

export function buildServerApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getServerApiBaseUrl()}${normalizedPath}`;
}
