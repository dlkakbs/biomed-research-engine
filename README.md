# Veliora

Agentic biomedical research workflow for drug repurposing analysis, powered by programmable payment rails.

Built for the **Agentic Economy on Arc Hackathon**  
Categories:

| Category |
| --- |
| Usage-Based Compute Billing |
| Real-Time Micro-Commerce Flow |

---

## Overview

Veliora is a multi-agent biomedical research system that turns a disease-focused query into a structured repurposing analysis workflow.

A user funds a research job in **USDC**, and the system coordinates multiple specialist agents across literature mining, drug database screening, pathway analysis, hypothesis generation, evidence scoring, red-team review, and final report synthesis.

The result is a **research brief**, not a treatment recommendation.

Veliora is designed to be selective:

| Output possibility |
| --- |
| it may return a strong shortlist, |
| a weaker exploratory hypothesis, |
| or no deliverable at all. |

If the output does not pass review, the job is rejected and the escrow is refunded onchain.

---

## Problem

Biomedical research workflows are expensive to coordinate because they are made up of many small, specialized steps such as:

| Step |
| --- |
| retrieving and filtering literature, |
| screening candidate drugs and targets, |
| anchoring candidates to disease biology, |
| scoring evidence quality, |
| and running independent review. |

These steps are often too fragmented for traditional payment rails.

Paying for each small research action individually is usually:

| Constraint |
| --- |
| operationally heavy, |
| too expensive for low-value actions, |
| and difficult to audit across a multi-stage workflow. |

As a result, it is hard to build a research pipeline where many agents or services can be paid fairly and efficiently per action.

---

## Solution

Veliora solves this by combining an **agentic research workflow** with a **two-layer payment architecture**:

| Layer | Description |
| --- | --- |
| **ERC-8183 on Arc** | manages the outer job lifecycle: create, fund, submit, complete, or reject. |
| **x402 + Circle Gateway** | handle low-value paid research actions inside the workflow. |
| **Arc** | provides fast finality and a USDC-native coordination layer. |

This lets Veliora support:

| Capability |
| --- |
| escrowed research jobs, |
| paid per-step external services, |
| traceable evidence collection, |
| peer review before delivery, |
| and refund-on-rejection behavior. |

In short, Veliora makes multi-step biomedical research economically practical.

---

## Use Case

A user submits a disease-focused research question such as:

> “What repurposable compounds may be relevant for this disease area based on literature, pathway context, and known targets?”

The workflow then:

1. creates and funds a research job in USDC,
2. dispatches specialist agents,
3. pays external research services as needed,
4. synthesizes candidate hypotheses,
5. evaluates evidence strength,
6. runs adversarial review,
7. prepares a final research brief,
8. and either delivers or rejects the result.

### Example output behavior

| Scenario | Outcome |
| --- | --- |
| **Strong evidence + review approval** | A report is delivered and the job is completed. |
| **Weak but still interesting signal** | A report may still be delivered, but clearly labeled as exploratory. |
| **No defensible signal** | The job is rejected and the client escrow is refunded. |

---

## System Architecture

Veliora is built as a payment-aware multi-agent research pipeline.

### High-level flow

```text
Client Wallet
  |
  | 1. createJob
  v
ERC-8183 Job on Arc
  |
  | 2. setBudget
  | 3. approve USDC
  | 4. fund
  v
Escrowed Research Job
  |
  v
PI Agent / Orchestrator (Dr. Iris)
  |
  +--> Literature Agent / Seller
  +--> DrugDB Agent / Seller
  +--> Pathway Agent / Seller
  +--> Internal Repurposing
  +--> Internal Evidence Scoring
  +--> Red-Team Agent / Seller
  +--> Internal Report Synthesis
  +--> Review Agent / Seller
  |
  | 5. submit(reportDigest)
  v
Finalizer
  |
  +--> complete -> escrow released -> internal payouts
  |
  +--> reject   -> escrow refunded
```

### Agent roles

| Agent | Role |
| --- | --- |
| **Dr. Iris · PI Agent** | Orchestrates the workflow, manages paid service calls, tracks progress, and handles submission or rejection. |
| **Dr. Mira · Literature** | Mines and prioritizes literature evidence. |
| **Dr. Rex · DrugDB** | Screens drug, target, and candidate-molecule context. |
| **Dr. Nova · Pathway** | Anchors the analysis in disease biology. |
| **Dr. Spark · Repurposing** | Generates and filters candidate hypotheses. |
| **Dr. Vera · Evidence** | Scores evidence across literature, biology, clinical signal, safety, and genetics. |
| **Dr. Vale · Red Team** | Performs adversarial review and surfaces weaknesses. |
| **Dr. Aria · Report** | Produces the final research brief. |
| **Review I / Review II / Tiebreak** | Final peer-review layer that determines approval or rejection. |

---

## Payment Architecture

Veliora uses **two distinct payment layers**.

### 1) External service payments

Handled through **x402 + Circle Gateway**

The PI agent pays for external research actions such as:

| External research action |
| --- |
| literature retrieval, |
| DrugDB screening, |
| pathway analysis, |
| red-team review, |
| evaluator review. |

Flow:

1. request paid resource,
2. receive `402 Payment Required`,
3. sign Circle Gateway authorization,
4. replay request with payment payload,
5. settle batched payments later on Arc.

This makes low-value research actions economically feasible.

**Configured default nanopayment:**  

| Amount |
| --- |
| `0.002 USDC` per paid action |

### 2) Internal budget distribution

Handled after successful completion

Once a report is approved and the job is completed onchain, budget can be distributed internally to downstream agents such as:

| Downstream agent |
| --- |
| repurposing, |
| evidence, |
| report. |

These payouts are computed using:

| Input |
| --- |
| base cost, |
| contribution weight, |
| risk weight, |
| payout weight. |

This is separate from the x402 seller payment layer.

---

## Tech Stack

### Blockchain / Settlement

| Component | Purpose |
| --- | --- |
| **Arc** | Fast finality and USDC-native coordination |
| **ERC-8183** | Job escrow and resolution lifecycle |
| **USDC** | Funding and settlement currency |

### Payment Infrastructure

| Component | Purpose |
| --- | --- |
| **Circle Gateway** | Gasless authorization and batched nanopayment settlement |
| **x402** | Paid API-style access to research actions |

### Research Workflow

| Capability |
| --- |
| Multi-agent orchestration |
| Literature mining |
| Drug database screening |
| Pathway analysis |
| Hypothesis generation |
| Evidence scoring |
| Red-team review |
| Final report synthesis |

### Output / Evaluation Layer

| Capability |
| --- |
| Peer review |
| Delivery gating |
| Refund-on-rejection logic |
| Structured research brief generation |

---

## Evidence Model

Veliora uses a structured evidence rubric across:

| Evidence dimension |
| --- |
| literature support, |
| biology overlap, |
| clinical evidence, |
| safety profile, |
| genetic context. |

Genetic evidence is used as disease-biology context, not as causal proof or medical validation.

Outputs are **research prioritization artifacts**, not medical advice.

The full evaluation criteria and scoring thresholds are defined in [REPORT_QUALITY_RUBRIC.md](/Users/dilekakbas/Desktop/biomed-research/REPORT_QUALITY_RUBRIC.md:1).

---

## Report Policy

Veliora is intentionally selective.

| Status | Criteria |
| --- | --- |
| Deliverable | A reportable shortlist exists |
| Conditionally deliverable | Only an early-stage hypothesis exists, but it is clearly labeled as exploratory |
| Reject | No reportable candidate<br>No meaningful early-stage hypothesis<br>Review does not approve the report |

If rejected, the escrow is refunded onchain.

---

## Why Veliora Matters

Veliora demonstrates that biomedical research workflows can be:

| Property |
| --- |
| modular, |
| agent-driven, |
| economically coordinated, |
| payment-aware, |
| and auditable end to end. |

Instead of treating research as a single opaque service, Veliora breaks it into specialized paid actions while preserving delivery control, review quality, and settlement logic.

This makes it a strong example of how agentic systems can support real-world, low-value, high-frequency knowledge work.

---

## Summary

Veliora is a payment-aware, multi-agent biomedical research pipeline for drug repurposing analysis.

It combines:

| Component | Role |
| --- | --- |
| **ERC-8183** | for escrowed research jobs, |
| **x402 + Circle Gateway** | for paid low-value research actions, |
| **Arc** | for final settlement and coordination. |

The result is a system that can gather evidence, review it, and either deliver a structured brief or reject the run and refund the user.
