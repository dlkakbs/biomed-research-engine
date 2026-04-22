# Report Quality Rubric

This checklist is for quickly judging whether a generated report is defensible, especially for rare-disease runs.

Use it to answer one question fast:
Is this report trustworthy enough to inspect further, or is it mostly pipeline noise?

## Scoring

Score each category from `0` to `3`.

- `0` = clearly bad
- `1` = weak / questionable
- `2` = acceptable
- `3` = strong

Total score bands:

- `0-7` = unreliable
- `8-12` = usable with caution
- `13-16` = good
- `17-21` = very good

## Categories

### 1. Literature Precision

Question:
Are the top papers genuinely disease-central, or are they broad umbrella reviews / generic neurology papers?

High score:
- top papers directly mention the disease in title, abstract, or MeSH
- little or no umbrella-title leakage
- limited generic review noise

Red flags:
- `Ataxia.` / `Neuropathy.` / similarly broad titles near the top
- disease-family reviews outranking disease-specific papers

### 2. Biology Coherence

Question:
Do disease, gene, pathway, and mechanism form a coherent chain?

High score:
- disease-linked genes make sense
- pathways align with disease biology
- mechanism narrative is internally consistent

Red flags:
- pathway section feels disconnected from disease
- gene list and mechanism do not support each other

### 3. Candidate Legitimacy

Question:
Is the proposed candidate grounded in real disease/mechanism context, or is it generic expansion noise?

High score:
- candidate has disease-specific or target-linked rationale
- indication/mechanism context is visible
- not just a generic database artifact

Red flags:
- opaque candidate with no meaningful disease anchor
- candidate appears only because a target was loosely matched

### 4. Evidence Honesty

Question:
Does the report clearly distinguish disease-context evidence from candidate-specific evidence?

High score:
- candidate-specific support is stated accurately
- uncertainty is visible
- disease papers are not overclaimed as validation for the candidate

Red flags:
- disease literature is presented as if it directly validates the candidate
- weak evidence is written with high confidence

### 5. No-Hit Behavior

Question:
If the run has no strong repurposing signal, does the report say so honestly?

High score:
- no-hit or weak-hit state is explicit
- report does not invent a fallback candidate
- limitations are visible

Red flags:
- forced top candidate despite weak upstream support
- report sounds decisive when the pipeline is actually empty

### 6. Redundancy Control

Question:
Does the report avoid repeating the same disease-title review pattern?

High score:
- exact-title review duplication is limited
- paper set covers distinct perspectives
- shortlist is not dominated by near-duplicates

Red flags:
- same disease-title review appears in multiple old variants
- list feels repetitive rather than informative

### 7. Actionability

Question:
Does the report help a researcher decide what to do next?

High score:
- suggests concrete next validation directions
- points to target, assay, biomarker, or mechanism follow-up
- useful even when the answer is "not enough evidence"

Red flags:
- purely descriptive summary
- no clear next-step signal

## Expected Score by Scenario

### Strong Biology-Signal Disease

Expected:
- score should usually be `13+`

Interpretation:
- if this class scores low, the pipeline likely still has a structural problem

### Weak / No-Hit Rare Disease

Expected:
- candidate strength may be low
- honesty score should be high

Interpretation:
- a good report here is often conservative, not exciting

### Broad / Common Disease

Expected:
- literature volume will be higher
- the main test is prioritization under noise

Interpretation:
- report should stay coherent despite a broader evidence field

## Fast Failure Signs

If any of these appear, the report likely needs manual skepticism:

- generic umbrella paper is near the top
- candidate-specific evidence is absent
- disease, pathway, and candidate do not connect cleanly
- no-hit run still produces a confident top candidate
- old exact-title reviews dominate the paper list

## Practical Use

For a quick review:

1. Score all 7 categories.
2. Mark any red flags.
3. Decide whether the report is:
   - `reject`
   - `inspect manually`
   - `good enough to continue`

For regression checks:

- compare the same query across revisions
- do not only compare top candidate presence
- compare honesty, literature precision, and redundancy control too
