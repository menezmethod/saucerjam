# Agent Build Prompt: SaucerJam Community Portal

Copy the prompt below into the implementation agent after reviewing `PLAN.md`.

```text
You are implementing the SaucerJam community portal integration.

Read first:

- docs/community-portal/PLAN.md
- docs/GO-TO-MARKET.md
- docs/PUBLIC-LAUNCH-FOUNDATION.md
- docs/ROADMAP.md
- README.md
- docs/HOSTING.md
- docs/ASSET-PROVENANCE.md

Objective:

Create the smallest production-safe community feedback integration that lets players report bugs, suggest features, upvote requests, follow status, and connect accepted work to GitHub issues/PRs/releases. Do not build a custom forum or voting backend unless the selected provider cannot satisfy a required acceptance gate.

Default provider decision:

1. If GitHub Discussions is not enabled, implement Phase 1 using GitHub Discussions plus GitHub issue forms and documentation.
2. If the maintainer provides Featurebase credentials and explicitly approves hosted-provider use, implement a thin Featurebase integration.
3. Do not silently choose a paid provider, create accounts, spend money, or store personal data without explicit approval.
4. Canny is an alternative only after comparing pricing, privacy, export, SSO, API, and moderation behavior.

Non-negotiable boundaries:

- GitHub remains the source of truth for code, review, CI, provenance, and releases.
- No browser-exposed secret API keys.
- Never send the pilot authentication token, player name, precise location, or raw private gameplay data to the portal.
- No automatic merge, deploy, release, or production mutation from a vote or webhook.
- Agents can draft/triage/branch/open PRs; a human must approve merges and canonical adoption.
- Do not modify gameplay, weapons, maps, assets, or marketplace behavior in this task.
- Preserve existing mobile UX and release behavior.

Required deliverables:

1. A provider-neutral `Community`/`Feedback` entry in the public documentation.
2. If GitHub Discussions is the chosen Phase 1, add the category/issue-form templates and contributor guidance without inventing unavailable GitHub settings.
3. If a provider is already configured, add a single game/menu link and optional post-match feedback link. Keep provider integration behind a small adapter or plain external URL; do not add a framework for one provider.
4. Add submission templates for bug, feature, balance, content, documentation, and question.
5. Document statuses:
   `Inbox -> Needs details -> Triaged -> Duplicate -> Accepted -> Planned -> In progress -> Playtest -> Shipped -> Closed`.
6. Document the human/agent workflow and provenance/AI disclosure requirements.
7. Add a short privacy and moderation policy.
8. Add tests for every local integration behavior you implement.

Spam and abuse requirements:

- Use provider authentication/SSO where available.
- If any custom write surface exists, require Turnstile, rate limits, duplicate detection, upload limits, webhook signature checks, and moderation handling.
- Do not implement fake spam protection with a hidden field alone.

Agent workflow requirements:

- Incoming feedback may be summarized, labeled, deduplicated, and linked by an agent.
- Agent-created branches and PRs must include the originating portal URL.
- Every community asset/code contribution must include provenance and AI/tool disclosure.
- A maintainer owns status transitions to Accepted, Planned, Playtest, Shipped, and Closed.

Verification:

- Run the full existing test suite.
- Run the production build.
- Run the browser/mobile suite.
- Verify no secrets enter the client bundle.
- Verify the game still works if the external portal is unavailable.
- Verify the game does not block combat on a portal request.
- Verify links work on desktop and touch/mobile layouts.
- Report exactly what was implemented, what provider is configured, what remains manual, and any acceptance gate that could not be verified.

Stop conditions:

- If provider credentials, billing approval, or a required external setting is missing, implement the documented Phase 1 fallback and stop.
- If the requested change would require a custom account system, stop and report the decision needed.
- If you find a conflict with existing release or IP policy, stop and report it rather than routing around it.

Return:

- files changed;
- provider and configuration chosen;
- tests and commands run;
- screenshots or URLs verified;
- security/privacy checks;
- known limitations;
- next human decision.
```
