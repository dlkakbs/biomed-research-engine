const API_URL = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");

async function main() {
  const response = await fetch(`${API_URL}/api/debug/x402/supported`);
  const text = await response.text();

  console.log(`status=${response.status}`);
  console.log(text);
}

void main();
