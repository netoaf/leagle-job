# Leagle Job Branding

## Current identity

- Product name: `Leagle Job`
- Technical slug and package name: `leagle-job`
- Canonical folder: `leagle-job`
- Previous local name: `JobFinder`
- Upstream project: `Career-Ops`

Leagle Job is a local, Portugal-first adaptation of
[Career-Ops](https://github.com/santifer/career-ops), created by the upstream
author identified in `CITATION.cff` and distributed under the MIT License.

The original `LICENSE`, `CITATION.cff`, upstream links and author attribution
must not be removed or rewritten. Claims from the original Career-Ops case
study must always be identified as upstream results, not as local product
results.

## Compatibility policy

The rebrand must not break the working pipeline. These legacy technical names
remain supported until a separately tested migration removes them:

- npm commands under `jobfinder:*`;
- `jobfinder-health.mjs`;
- `config/jobfinder-rules.yml`;
- existing code identifiers and environment variables containing
  `JobFinder`, `JOBFINDER` or `career-ops`;
- `/career-ops` slash commands;
- Career-Ops updater and upstream repository URLs;
- historical reports, attestations and release evidence.

New user-facing copy should use `Leagle Job`. New npm entry points may use the
`leagle:*` aliases while the old commands continue to work.

## Safe replacement guide

| Found text | Action |
| --- | --- |
| `JobFinder` in visible headings or messages | Replace with `Leagle Job` |
| `jobfinder` in commands, filenames, config or code | Keep for compatibility |
| `Career-Ops` describing the current local product | Use `Leagle Job (based on Career-Ops)` |
| `Career-Ops` in attribution, license, citation or upstream links | Keep unchanged |
| `career-ops` in slash commands, URLs or updater logic | Keep unchanged |

Do not run a repository-wide blind search-and-replace.
