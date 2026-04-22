# Demo Examples

This directory contains sanitized demo data for local evaluation and jury walkthroughs.

## Included Files

- `sample-task.json`
  Demo task metadata that becomes the seeded job record.
- `sample-events.json`
  Demo pipeline events shown on the workspace timeline.
- `sample-report.json`
  Demo report payload shown on the results page.

## Safety

- No API keys, wallet IDs, private keys, or live payment metadata are stored here.
- No real local runtime state is copied into these files.
- Transaction hashes, funding records, and personal session notes are intentionally excluded.

## Usage

Run the demo seed from the repo root:

```bash
npm run seed:demo
```

Then open:

- `/workspace/demo-ipf-001`
- `/results/demo-ipf-001`

The seed is deterministic and can be run again to refresh the same demo job.
