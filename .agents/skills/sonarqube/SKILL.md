---
name: sonarqube
description: Run and act on the Historic City Map SonarQube Cloud analysis (organisation ventura8, project ventura8_bucurestiuldisparut.github.io) - the CI job, the local sonar stage in all, the strict verdict of sonar_report.py (gate OK, zero issues, zero hotspots, zero duplications, coverage at least 90), the scope in sonar-project.properties shared with the per-file coverage gate, and the token rules. Use when the sonar stage or job skips or fails, when a SonarCloud finding has to be fixed, or when the Sonar wiring changes.
---

# SonarQube Skill

Working notes: `.agent/skills/quality/sonarqube_skill.md`. Status: `sonar-project.properties`, `scripts/ci/sonar_scan.sh`, `scripts/ci/sonar_report.py` and the CI job `sonarqube` exist; `scripts/ci/sonar_setup.py` is planned; the `sonar` stage has no gate yet (the quality image has no `sonar-scanner`) and fails on purpose.

## Commands

```bash
bash scripts/ci/sonar_scan.sh                            # scanner image pinned by digest, then the verdict (skips without a token)
bash scripts/ci/sonar_scan.sh --check-token              # only validate the token (.sonar-token must be mode 0600)
python3 scripts/ci/sonar_setup.py                        # planned; the USER runs it: hidden prompt, writes .sonar-token
gh secret set SONAR_TOKEN                                # the USER runs it: token on stdin
```

## Verdict

`sonar_report.py` waits for the server's task and exits 1 unless the quality gate is OK, there are 0 open issues, 0 hotspots to review, 0 duplicated blocks and coverage is at least 90 %. Exit 2 means not configured: the stage skips, never fails.

## Rules

- Fix every finding in code. Never `NOSONAR`, `sonar.issue.ignore.*`, "Accepted" or "False positive".
- `sonar.coverage.exclusions` stays empty; the per-file gate `scripts/ci/check_coverage.py` reads the same scope (TS lcov plus `reports/coverage/scripts.xml` and `reports/coverage/pipeline.xml`).
- Automatic Analysis must be OFF in SonarCloud; a token minted while it was on may lack rights.
- The token is never read, printed, pasted or passed in argv by an agent: environment variable or stdin only, `Bearer` header over HTTPS.
- CI analyses pull requests and the default branch only; fork PRs skip the job; a missing secret skips it.
