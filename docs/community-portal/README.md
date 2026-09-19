# SaucerJam community feedback

Fider is the public feedback portal for SaucerJam and future Menezmethod apps. GitHub remains the source of truth for code, reviews, CI, provenance, and releases.

- [Play online](https://qd.menezmethod.com)
- [Report a bug](https://github.com/menezmethod/saucerjam/issues/new?template=bug_report.yml)
- [Suggest a feature or balance change](https://github.com/menezmethod/saucerjam/issues/new?template=feature_request.yml)
- [Join discussions and vote](https://github.com/menezmethod/saucerjam/discussions) (fallback while Fider is being deployed)
- [Read the roadmap](../ROADMAP.md)
- [Shared Fider deployment and Supabase integration](./FIDER_SHARED_SERVICE.md)

## What belongs where

- **Bug report:** a reproducible problem in a released build. Use the issue form and include version, device/browser, mode/map, steps, and safe evidence.
- **Discussion:** questions, playtest feedback, balance ideas, mobile UX, ships/art/lore, agent experiments, and proposals that need conversation before implementation.
- **Security:** use GitHub’s private security advisory flow. Never publish tokens, private player data, or an exploitable proof of concept in an issue.

Community votes help maintainers prioritize; they do not automatically create work or change the canonical game. Maintainers move accepted work through:

`Inbox -> Needs details -> Triaged -> Duplicate -> Accepted -> Planned -> In progress -> Playtest -> Shipped -> Closed`

## Agent and community contributions

Agents may summarize, label, detect duplicates, draft tests, create branches, and open pull requests. A human maintainer must review status changes, provenance, security, IP, and merges. Agent-created work must link back to the originating issue or discussion.

For submitted code, art, audio, or models, disclose source material, tools used (including AI tools), and the rights/license. Do not include the game’s pilot token, player name, precise location, or raw private gameplay data in feedback.

GitHub-native forms remain the fallback for security reports and for periods when Fider is unavailable. The shared Fider service is the intended primary feedback surface; see [`FIDER_SHARED_SERVICE.md`](./FIDER_SHARED_SERVICE.md) for deployment and Supabase integration.
