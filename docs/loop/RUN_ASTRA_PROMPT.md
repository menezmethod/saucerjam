# CLI Resume Prompt

Paste this into Codex CLI from the repository root:

```text
Resume the SaucerJam v2 quality loop from the current checkout.

Read:
- docs/loop/LOOP.md
- docs/loop/STATE.md
- docs/loop/TASKS.json
- docs/loop/EVALUATORS.md
- docs/loop/CONTROLS_PASS_01.md

First inspect git status, the latest commit, and the current NEXT_ACTION.
Continue only the active bounded task. Do not restart the audit or redesign the roadmap.

You are the heavy implementation agent. Perform code changes, browser tests,
screenshots, 3D/world work, and benchmarks when they are required. Preserve
authoritative multiplayer behavior, deterministic simulation, independent aim,
desktop controls, touch controls, mobile compatibility, and performance.

Run focused tests and the production build. Record actual evidence and known
limitations. Do not claim showcase quality without native browser/device evidence.
Update docs/loop/STATE.md and the relevant evidence report with the next action.
Do not modify main, force-push, merge, deploy, or open a PR unless explicitly asked.
Stop at a clean checkpoint if browser/device evidence or another required dependency
is unavailable.
```
