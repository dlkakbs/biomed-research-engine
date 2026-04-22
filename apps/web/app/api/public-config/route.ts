import { NextResponse } from 'next/server';

function pickAddress(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export async function GET() {
  return NextResponse.json({
    piAgentAddress: pickAddress(
      process.env.NEXT_PUBLIC_PI_AGENT_ADDRESS,
      process.env.PI_AGENT_ADDRESS,
      process.env.PI_AGENT_WALLET_ADDRESS
    ),
    finalizerAddress: pickAddress(
      process.env.NEXT_PUBLIC_FINALIZER_ADDRESS,
      process.env.FINALIZER_ADDRESS
    ),
  });
}
