# Mode: evaluate one vacancy

Use this mode for a single pasted vacancy or URL. Read `modes/_shared.md`
first; its 0--100 scoring and safety rules are authoritative.

## Procedure

1. Capture the exact URL and available job description. If the vacancy is not
   accessible, say so; do not fill gaps from search snippets.
2. Prefer the deterministic path:

   ```powershell
   npm run evaluate-url -- --url "https://example.com/job"
   ```

3. Report only source-backed facts: company, role, location/work mode,
   requirements, application channel, evidence limits, score, recommendation,
   strengths, gaps, hard blockers and next action.
4. If a report is written or promoted, use the existing pipeline/merge flow.
   Do not directly append a tracker row.
5. A score of `apply` authorizes preparation for human review, never a send or
   submission.

## Output principles

- Use 0--100, not A--F or 1--5.
- Distinguish `confirmed`, `inferred conservatively` and `a confirmar`.
- Preserve the official job title even if a focused junior track is described
  separately.
- Never claim that a vacancy is active without a current detail-page check.
