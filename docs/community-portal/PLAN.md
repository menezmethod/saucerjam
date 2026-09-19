# SaucerJam Community Portal Plan

Status: planning only. Do not implement this plan until an agent is explicitly assigned to build it.

## Outcome

Give players, contributors, and agents one public place to:

- report reproducible bugs;
- suggest features, balance changes, ships, art, and lore;
- upvote useful requests;
- follow status and release updates;
- connect a request to an RFC, branch, pull request, playtest, and shipped release.

The portal is a feedback and workflow surface. GitHub remains the source of truth for code, reviews, CI, provenance, and releases.

## Recommendation

Use a staged approach instead of building a custom voting/forum product.

### Phase 1: zero-cost launch

Enable GitHub Discussions with these categories:

- Bug reports
- Feature ideas
- Combat and balance
- Mobile UX
- Ships, art, and lore
- Agent experiments
- Questions and support
- Announcements

Use GitHub issue forms for bugs that need structured reproduction data. Link Discussions to Issues and pull requests manually at first. GitHub Discussions supports categories, comments, polls, and community upvotes:

- https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/collaborating-with-maintainers-using-discussions

Do not add a custom portal before there is enough activity to justify another system.

### Phase 2: shared Fider portal

Selected direction: self-host one Fider board at `community.menezmethod.com` for SaucerJam and future Menezmethod apps. Separate apps with categories and tags, not extra subdomains. Use Supabase Auth as the OAuth/OIDC identity provider, while Fider keeps its own feedback database. See [`FIDER_SHARED_SERVICE.md`](./FIDER_SHARED_SERVICE.md) for the deployment contract.

Fider is open source and supports public posts, comments, votes, statuses, OAuth providers, and webhooks. The software is free; hosting, SMTP, backups, updates, and moderation remain operational responsibilities:

- https://docs.fider.io/configuring-oauth/
- https://docs.fider.io/using-webhooks/

Featurebase and Canny remain alternatives only if Fider’s maintenance, moderation, or product needs stop fitting. Do not run GitHub Discussions, Fider, a paid provider, and a custom database as competing sources of truth.

## Voting policy

Use public upvotes. Do not use a public downvote total as the prioritization algorithm.

Downvotes encourage popularity contests and are easy to brigade. If negative signal is needed, use one of these instead:

- private “not interested” signal;
- “does not affect me” feedback;
- maintainer labels for risk, complexity, or disagreement;
- a short impact survey after triage.

If public downvotes are later required, limit them to verified accounts and never let raw vote totals auto-create work.

## Portal information architecture

Every post has:

- type: bug, feature, balance, content, documentation, or question;
- title and concise problem statement;
- expected behavior and actual behavior;
- build/version;
- map/mode;
- device/browser/OS;
- reproduction steps for bugs;
- screenshots, video, logs, or links;
- provenance/AI disclosure for submitted code, art, audio, or models;
- optional contact/notification consent.

Suggested statuses:

`Inbox -> Needs details -> Triaged -> Duplicate -> Accepted -> Planned -> In progress -> Playtest -> Shipped -> Closed`

Only maintainers change workflow status. Community votes inform priority; they do not bypass security, scale, moderation, IP, or design review.

## In-game entry points

Add these links only after the external portal exists:

- Flight menu: `Report a bug`, `Suggest an idea`, `View roadmap`;
- round recap: `Report this match` and `Suggest improvement`;
- website: `Community` and `Changelog`;
- README: `Play`, `Community`, `Contribute`.

The game may prefill build, map, mode, browser category, and a generated session reference. Never send the pilot authentication token, player name, precise location, or raw private gameplay data to the portal.

## Spam, abuse, and privacy controls

Use provider authentication/SSO where possible. For any custom submission surface, require:

- Cloudflare Turnstile;
- account/IP rate limits;
- one vote per account per post;
- duplicate detection;
- moderation queue for links and uploads;
- upload size/type limits;
- new-account cooldowns;
- report and block controls;
- webhook signature verification;
- no anonymous write API from the browser;
- documented deletion/export path;
- short raw-event retention period.

The game’s pilot token is not an identity system for the portal. Use a separate provider user ID or SSO subject.

## Human and agent workflow

```text
Community post
  -> spam/rate-limit check
  -> agent summarizes, labels, and detects duplicates
  -> maintainer confirms scope, IP, security, and reproducibility
  -> community discussion/upvotes
  -> RFC when the change is material
  -> human or agent claims a bounded task
  -> branch + tests + provenance
  -> pull request
  -> CI + human review
  -> experimental playtest
  -> feedback
  -> maintainer merge
  -> release/changelog notification
```

Agents may triage, summarize, reproduce, draft tests, create branches, open PRs, update docs, and draft changelog entries.

Agents may not auto-merge, approve their own PR, modify production infrastructure, accept unverified assets, bypass provenance/security review, or turn votes directly into features.

Every portal item that becomes code should link both ways:

- portal post -> GitHub issue/RFC/PR;
- PR/release -> portal post/changelog.

## Metrics

Measure counts and rates, not just percentages:

- time to first triage;
- duplicate rate;
- reproducible-bug rate;
- votes per active player;
- accepted ideas;
- PRs created from community posts;
- community PR review time;
- shipped requests;
- repeat contributors;
- player retention after shipped changes;
- spam and moderation actions.

Do not call the portal successful because it has many votes. The useful signal is a healthy path from player problem to tested, shipped improvement.

## Acceptance gates

The implementation is ready only when:

- a player can submit a bug without learning the repository structure;
- a duplicate can be merged without losing voters or context;
- a maintainer can change status and notify followers;
- a request links to an issue, PR, playtest, and release;
- agent-created work is visibly labeled and human-reviewed;
- spam controls are tested;
- private tokens and unnecessary personal data never leave SaucerJam;
- deleting a portal account removes or anonymizes its personal data;
- exports/backups and provider failure behavior are documented;
- no vote automatically changes the canonical game.

## Explicitly deferred

- custom forum backend;
- custom voting database;
- marketplace payments or royalties;
- community-uploaded executable scripts;
- automatic agent merges;
- public downvote ranking;
- Discord as the system of record;
- a full account system inside SaucerJam.
