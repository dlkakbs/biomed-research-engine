export const AGENT_NAMES = [
  "literature",
  "drugdb",
  "pathway",
  "repurposing",
  "evidence",
  "red_team",
  "report",
  "pi"
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export * from "./paid-services.js";
export * from "./openrouter.js";
export * from "./internal-pathway.js";
export * from "./internal-repurposing.js";
export * from "./internal-evidence.js";
export * from "./internal-red-team.js";
