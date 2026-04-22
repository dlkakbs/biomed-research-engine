# BioMed Research Engine: Veliora

Agentic biomedical research workflow for repurposing analysis, built around real payment rails.

# Built for the Agentic Economy on Arc Hackathon

 Categories:
- `Usage-Based Compute Billing`
- `Real-Time Micro-Commerce Flow`

## TL;DR

- Multi-agent biomedical research pipeline for repurposing analysis
- Uses x402 + Circle Gateway for paid low-value research actions and ERC-8183 on Arc for outer job escrow and resolution
- Produces selective research briefs with peer review, delivery gating, and refund-on-rejection behavior

The product turns a user research request into a multi-stage economic workflow:

It uses Arc, Circle Gateway, x402, and ERC-8183 to make those steps economically practical:

- `x402` provides paid API-style access to research steps
- `Circle Gateway` enables gasless authorization and batched settlement for many low-value USDC payments
- `Arc` provides fast finality and a USDC-native flow for this coordination model
- `ERC-8183` gives the outer client-provider-evaluator job lifecycle: create, fund, submit, complete, reject

- The user opens an ERC-8183 job on Arc
- The PI agent orchestrates paid evidence-gathering steps through x402
- Circle Gateway batches low-value USDC nanopayments on Arc
- The system assembles, reviews, and either delivers or rejects the report
- If the report is approved, the internal agent budget is distributed on completion

Veliora is a payment-aware research pipeline with traceable evidence, peer review, and onchain job settlement.

## What Veliora does?

The user submits a disease-focused research query and funds a job budget in USDC. The system then runs a coordinated biomedical workflow across literature mining, drug-database screening, pathway anchoring, hypothesis generation, evidence scoring, red-team review, and final report synthesis.

The output is a research brief, not a treatment recommendation. Reports are designed to be selective: a run can produce a shortlist, a weaker early-stage hypothesis, or no deliverable signal at all. If nothing crosses the quality bar, the run is rejected and the escrow is refunded onchain.

## Problem/Value
Biomedical research workflows involve many specialized but coordination-heavy steps:

- retrieving and filtering literature
- screening candidate molecules and targets
- anchoring candidates to disease biology
- running independent critique and review

Traditional payment rails are awkward for this because every small service action becomes too expensive or too operationally heavy to settle.

## Why Arc + Circle

This stack was chosen for product reasons.

- `Per-action research economics`
  The workflow breaks research into multiple paid steps. Circle Gateway batching keeps those steps practical instead of requiring every micropayment to settle as an expensive standalone transaction.

- `USDC-native coordination`
  Buyers authorize payments in USDC. The workflow does not need to force users into a separate volatile gas-token UX for every research action.

- `Fast finality for sequential agents`
  A research run contains many dependent stages. Faster confirmation reduces dead time between steps.

- `Clear outer escrow lifecycle`
  ERC-8183 is used for the higher-level marketplace contract: the client funds a job, the provider submits a result digest, and the evaluator/finalizer resolves completion or rejection.

## Execution Proof

This workflow was exercised as a real paid batch.

In one proof batch:

- `10` research jobs were executed end to end
- each job moved through the visible ERC-8183 lifecycle:
  `create -> setBudget -> fund -> submit -> complete|reject`
- this produced `50` visible lifecycle actions across the batch
- each job also triggered `5` x402-paid research actions
- this produced `50` offchain paid actions across the batch
- each paid action used the configured nanopayment price of `0.002 USDC`

This is the intended operating model of the product:
an escrowed client job on Arc, PI-orchestrated paid research steps through x402 + Circle Gateway, and final settlement through ERC-8183.

## Agent System

The pipeline is presented in-product as named specialist agents:

- `Dr. Iris · PI Agent`
  Research orchestrator. Dispatches the workflow, pays for external research services, tracks status, and manages delivery/rejection.

- `Dr. Mira · Literature`
  Mines PubMed/OpenAlex-style literature inputs, filters papers, and returns prioritized evidence with provenance.

- `Dr. Rex · DrugDB`
  Screens ChEMBL, target, and candidate-molecule context.

- `Dr. Nova · Pathway`
  Anchors the run in disease biology using pathway, target, genetic, and trial context.

- `Dr. Spark · Repurposing`
  Converts upstream evidence into candidate hypotheses and filters weak or non-reportable ideas.

- `Dr. Vera · Evidence`
  Applies structured scoring across literature support, biology overlap, clinical evidence, safety, and genetic context.

- `Dr. Vale · Red Team`
  Performs adversarial review and surfaces failure modes, limitations, and disconfirming tests.

- `Dr. Aria · Report`
  Produces the final research brief and prepares the delivery package.

- `Review I / Review II / Tiebreak`
  Peer-review layer. The evaluator stage determines whether the output is approved for delivery or rejected.

## Pipeline

## Architecture At A Glance

```text
Client Wallet
  |
  | 1. createJob
  v
ERC-8183 Job on Arc
  |
  | 2. setBudget (PI)
  | 3. approve USDC (client)
  | 4. fund (client)
  v
Escrowed Research Job
  |
  v
PI Agent / Orchestrator (Dr. Iris)
  |
  |  x402 request -> 402 challenge -> Circle Gateway auth -> paid replay
  +-------------------------------> Literature Seller
  |
  +-------------------------------> DrugDB Seller
  |
  +-------------------------------> Pathway Seller
  |
  +-------------------------------> Red-Team Seller
  |
  +-------------------------------> Review Seller
  |
  +-------------------------------> Repurposing (internal)
  |
  +-------------------------------> Evidence Scoring (internal)
  |
  +-------------------------------> Report Synthesis (internal)
  |
  | 5. submit(reportDigest) if approved
  v
Finalizer
  |
  +--> 6a. complete -> client escrow released -> internal payouts
  |
  +--> 6b. reject   -> escrow refunded -> no internal payouts

Circle Gateway layer:
  - PI maintains a pre-funded Gateway USDC balance
  - each x402 authorization is signed offchain
  - Gateway batches settlement onchain on Arc
```

The end-to-end flow is:

1. `Create job`
   The client creates an ERC-8183 job on Arc.

2. `Set budget`
   The PI side sets the budget parameters for the run.

3. `Approve + fund`
   The client approves USDC and funds the escrowed job.

4. `Run paid research services`
   The PI agent calls paid research endpoints through x402:
   literature, DrugDB, pathway, red-team, and review.

5. `Generate hypotheses`
   Repurposing and evidence stages synthesize candidate signals and score them.

6. `Assemble report`
   The report stage converts the run into a structured brief with methodology, evidence trace, candidate rationale, and limitations.

7. `Peer review`
   The reviewer approves or rejects the report.

8. `Submit + finalize onchain`
   If approved, the provider submits the report digest and the finalizer completes the ERC-8183 job.
   If rejected, the finalizer rejects the job and the escrow is refunded.

9. `Internal payouts`
   On successful completion, a portion of the budget is distributed internally to downstream agents based on recorded contribution and risk weights.

## Payment Architecture

There are two distinct payment layers in the system.

### 1. External service payments via x402 + Circle Gateway

The PI agent is the buyer for the research services. It pays for:

- literature retrieval
- DrugDB screening
- pathway analysis
- red-team review
- evaluator review

These calls are made through `/api/paid/*` endpoints. The seller side returns an x402 challenge, the PI signs a Circle Gateway authorization, and the request is replayed with a payment signature. Settlement is batched under the Gateway flow on Arc.

Operationally, this assumes the PI has already deposited USDC into a Gateway balance. Circle’s documented Gateway nanopayment flow is:

- deposit USDC into Gateway once
- request a paid resource
- receive `402 Payment Required`
- sign an offchain EIP-3009 authorization
- replay the request with the payment payload
- let Gateway batch settlement onchain later

In the codebase, the default nanopayment price is:

- `0.002 USDC` per paid action

### 2. Internal budget distribution after a successful run

After an approved report is completed onchain, the system can distribute internal payouts from the PI wallet to selected internal agents:

- `repurposing`
- `evidence`
- `report`

These payouts are not the same thing as x402 seller payments. They are internal post-run budget allocations computed from:

- base cost
- contribution weight
- risk weight
- payout weight

The PI reserve is configurable through `PI_PAYOUT_RESERVE_BPS`, so the full budget is not blindly redistributed.

## Report Policy

The system is intentionally selective.

- `Reportable shortlist present`
  deliverable

- `Only early-stage hypothesis present`
  still deliverable, but explicitly labeled as weaker and exploratory

- `No reportable candidate and no early-stage hypothesis`
  reject and refund

This matters because the product is designed to look like a serious research workflow.

The quality bar used to judge report defensibility is summarized in [REPORT_QUALITY_RUBRIC.md]

## Evidence Model

The report layer uses a structured scoring rubric across:

- literature support
- biology overlap
- clinical evidence
- safety profile
- genetic context

Genetic support is used as disease-biology context, not as causal proof or target validation. Outputs are prioritization-grade research artifacts and explicitly not medical advice.



