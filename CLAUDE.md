# Claude Code Instructions

The canonical agent rules for this repository live in `AGENTS.md`; this file only imports them so
Claude Code and every other agent read the same contract.

@AGENTS.md

## Quick orientation

- Reading order before any task: `AGENTS.md` → `.agent/instructions.md` →
  `.agent/skills/SKILLS_CATALOG.md` → the relevant skill and workflow files. The plan is
  `docs/research/PLAN.md`; what exists today and how to extend it is `docs/research/M0-handoff.md`.
- Run the pipeline before claiming anything is done: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`
  for docs and tooling, `tests` and `build` for code, the default `all` before a push. It builds
  and uses the quality image `hcm-quality:local`; every gate runs inside it, never on the host.
- Claude Code skills are in `.claude/skills/`, byte-identical to `.agents/skills/`: edit the
  `.agents/skills/` copy, then `cp` it over the mirror.
- Subagents for delegation are in `.claude/agents/`: `pipeline-runner` (runs one stage, returns the
  verdict), `e2e-matrix-auditor` (`e2e/scenarios.json` against the tests), `docs-sync-checker`
  (docs and agent assets a diff must touch) and `golden-reviewer` (Playwright screenshot diffs).
- Browser work (Mapbox, Google Cloud, USGS, SonarCloud consoles) happens in the user's own signed-in
  browser: never type a credential, and confirm every accept, submit, publish or payment with the
  user in chat first, one at a time.
