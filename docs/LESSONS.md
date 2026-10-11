# Lessons

The defects that shaped the rules of this repository: what went wrong, which tier or report found it, and the rule it left behind. Each lesson is also a rule in `AGENTS.md` or a skill; this file is the *why*. Keeping the stories here keeps `AGENTS.md` within its byte budget.

Tooling quirks that are not product defects (an image setting, a linter's behaviour) belong in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks* instead.

## How to add a lesson

Append a numbered entry to *Lessons from this repository* in the task that finds the defect:

1. **One-line title of what the user saw.**
   - Seen: what happened, on which surface (viewer, admin, function, pipeline), viewport, browser or data.
   - Found by: the tier, analyser or crash report that caught it, and why every tier below it was green.
   - Fix and pin: the fix, and the scenario id in `e2e/scenarios.json` (or the unit test) that now pins it.
   - **The lesson, in bold, general enough to outlive the code.**

## Lessons from this repository

No entries yet.
