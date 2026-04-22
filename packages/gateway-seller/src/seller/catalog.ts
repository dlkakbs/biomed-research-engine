export interface SellerEndpoint {
  key: "literature-search" | "drugdb-fetch" | "pathway-analysis" | "review" | "red-team-critics";
  service: "literature" | "drugdb" | "pathway" | "evaluator" | "red_team";
  path: string;
  priceUsd: "0.002";
}

export interface SellerCatalog {
  endpoints: SellerEndpoint[];
}

export function createSellerCatalog(): SellerCatalog {
  return {
    endpoints: [
      {
        key: "literature-search",
        service: "literature",
        path: "/literature/search",
        priceUsd: "0.002"
      },
      {
        key: "drugdb-fetch",
        service: "drugdb",
        path: "/drugdb/fetch",
        priceUsd: "0.002"
      },
      {
        key: "pathway-analysis",
        service: "pathway",
        path: "/pathway/analyze",
        priceUsd: "0.002"
      },
      {
        key: "review",
        service: "evaluator",
        path: "/review",
        priceUsd: "0.002"
      },
      {
        key: "red-team-critics",
        service: "red_team",
        path: "/red-team/review",
        priceUsd: "0.002"
      }
    ]
  };
}
