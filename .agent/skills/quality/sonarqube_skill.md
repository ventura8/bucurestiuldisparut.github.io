# SonarQube Skill

**Historic City Map** is analysed by SonarQube Cloud: organisation `ventura8`, project key `ventura8_bucurestiuldisparut.github.io`. The repository is public, so analysis runs both in CI (free) and locally in the `sonar` stage, which is part of `all` (`quality/pipeline_skill.md` → *Stages*). Status today: `sonar-project.properties`, `scripts/ci/sonar_scan.sh`, `scripts/ci/sonar_report.py` and the CI job `sonarqube` exist; `scripts/ci/sonar_setup.py` is planned. The `sonar` stage has no gate yet and fails on purpose: the quality image has no `sonar-scanner`, so registering `Gate("sonar", ("bash", "scripts/ci/sonar_scan.sh"))` first needs the scanner copied into `docker/Dockerfile.quality` from the pinned scanner image.

## Scope (`sonar-project.properties`)

- `sonar.sources`: `packages/{shared,ui,engine,admin}/src`, `functions/src`, `pipeline/src`, `scripts/ci`, `scripts/git-hooks`, `docker` and `.github/workflows`. Every listed folder must exist (the scanner refuses to start otherwise), so the sites and the starter kit join with M1 and M5. Workflows and Dockerfiles are in sources because Sonar's GitHub Actions and Docker security rules find real issues there.
- `sonar.tests`: every package's `test/` tree, `packages/test-support/src`, `functions/test`, `firebase/rules-tests/test`, `pipeline/tests`, `scripts/ci/tests` (also excluded from sources) and `e2e`. Sources and tests stay disjoint, so no file is indexed twice.
- Reports: `reports/coverage/ts/lcov.info` (Vitest), `reports/coverage/scripts.xml` (pytest for `scripts/ci`) and `reports/coverage/pipeline.xml` (the raster pipeline), `reports/junit/pytest.xml` and `reports/junit/pipeline.xml`.
- `sonar.coverage.exclusions` is **empty**: every measured file must reach 90 %. The `coverage` gate (`scripts/ci/check_coverage.py`) reads the same file, so its scope equals Sonar's.
- No `sonar.projectVersion` in the file: the scanner invocation passes the `package.json` version.

## The verdict (`scripts/ci/sonar_report.py`)

After the upload it waits for the server's compute task (5 s polls, 600 s timeout) and exits 1 unless **all** hold: quality gate OK, 0 open issues, 0 security hotspots to review, 0 duplicated blocks, coverage at least 90 % as the server reports it. It exits 2 when Sonar is not configured, which the stage reports as skipped, not failed.

## CI job (`sonarqube` in `.github/workflows/ci.yml`)

- Needs the `tests` job; downloads its `coverage` artifact and checks every report is non-empty.
- Runs for pushes to `master` and for pull requests from this repository only: fork PRs get no secrets, and a tag or another branch would be a non-default-branch analysis, which returns 403 on the free plan. A tag will be gated by looking up the default-branch analysis of the same commit (M5).
- `SONAR_TOKEN` is the only repository secret. A first step checks for it and for `sonar-project.properties`; without either, every later step is skipped and the job ends with a notice instead of failing.
- Scan and quality-gate actions pinned by full SHA with a `# vX.Y.Z` comment; then `sonar_report.py --min-coverage 90` inside the quality image (Python 3.14), the token passed through the environment.

## Local `sonar` stage

`scripts/ci/sonar_scan.sh` runs the scanner image `sonarsource/sonar-scanner-cli` pinned by digest (never `:latest`) with the repository mounted at the same path, then `sonar_report.py` in the quality image; `--check-token` only validates the token. The token comes from `SONAR_TOKEN` or the git-ignored `.sonar-token`, which is refused unless its mode is 0600 (`chmod 600 .sonar-token`); it reaches the scanner as an environment variable and is validated through `curl -K -` with the token on stdin, never in argv. Without a token the script skips with a notice and exits 0.

## Credentials (human-only)

1. The user signs in to SonarCloud and creates the token.
2. The user runs `python3 scripts/ci/sonar_setup.py` (hidden prompt, writes `.sonar-token`) and `gh secret set SONAR_TOKEN` (stdin) in their own terminal.
3. An agent never reads, prints or pastes the token; it is sent only as a `Bearer` header over HTTPS.

## Pitfalls inherited from the sibling repositories

- **Automatic Analysis must be OFF** (SonarCloud → Administration → Analysis Method). With it on, the scanner is refused; the stage prints a skip message.
- A token minted while Automatic Analysis was on may lack analysis rights: create a fresh one.
- Coverage 0 % usually means stale or missing reports: run the `tests` stage first, and keep the repository mounted at the same absolute path (paths in lcov and Cobertura must match the scanner's).
- Including `.github` and `docker` in sources is deliberate.

## Rules

- Fix every finding in code. Never `NOSONAR`, never `sonar.issue.ignore.*`, never "Accepted" or "False positive" in the UI. A rule that is wrong for the whole project is changed in the quality profile, with the user's yes.
- Common rules to respect while writing: never drop a promise (`void fn()` or `.catch`), use `.at(-1)`, shared globals on `globalThis`; Python `monkeypatch.setattr`, single-call `pytest.raises`, split composite asserts, `math.isclose`; Bash `[[ ]]`, errors to stderr, a `*)` case branch, explicit `return`.
