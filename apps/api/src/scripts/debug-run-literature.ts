import "dotenv/config";

import { runLiteratureSearch } from "@biomed/agents";

async function main() {
  const result = await runLiteratureSearch({
    query: process.env.DEBUG_QUERY || "glioblastoma EGFR resistance"
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
