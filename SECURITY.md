# Security policy

## Reporting a vulnerability

**Do not open a public issue for anything exploitable.**

Use GitHub's private advisory flow:

**<https://github.com/menezmethod/saucerjam/security/advisories/new>**

That creates a private thread visible only to maintainers. If you cannot use it, open a
minimal public issue asking a maintainer to contact you, and share no details in it.

Include, as far as you can:

- what an attacker can achieve, and what they need to start (guest, signed-in pilot, a
  socket, direct network access to the server);
- the affected version, commit, or URL;
- reproduction steps, or a minimal proof of concept;
- whether it affects the official service at <https://saucerjam.com>, a self-hosted
  instance, or both;
- your assessment of severity, and whether you have told anyone else.

## What happens next

Best effort from a small project, not a contractual SLA:

| Stage | Target |
| --- | --- |
| Acknowledgement | within 72 hours |
| Initial assessment and severity | within 7 days |
| Fix or mitigation plan | within 30 days for high severity |
| Public disclosure | coordinated — after a fix ships, or 90 days from report, whichever is sooner |

You will be credited in the advisory and the release notes unless you ask not to be. Please
give the project the chance to fix it before publishing; that is the whole point of the
private channel.

## Supported versions

Only the current release on <https://saucerjam.com> and the head of `main` are supported. The
project is pre-1.5 with no LTS branches; older releases do not receive security patches, and
self-hosted instances are the operator's responsibility to keep updated.

## Scope

In scope:

- the game server (`server/`), shared simulation (`shared/`), and browser client (`src/`);
- authentication and session handling, including the Supabase integration;
- the rankings and leaderboard data path, including cross-pilot data leaks;
- input validation, rate limiting, and the authority boundary (a client must never be able to
  set positions, health, damage, scores or resources);
- the HTTP API (`/health`, `/metrics`, `/api/*`) and the community bridge endpoints;
- secrets, tokens, and the deployment configuration in this repository;
- the operator automation in `scripts/ops/` and the agent loop's guardrails.

Out of scope, or at most low priority:

- the fact that `/metrics` is publicly readable — that is intentional, aggregate and
  non-PII; report it only if you find personal or identifying data in it;
- denial of service by simply flooding a self-hosted instance you were given access to;
- cheat reports that are really balance or gameplay complaints (those go to
  <https://community.saucerjam.com>);
- social engineering, physical access, or attacks requiring a compromised host;
- missing hardening headers with no demonstrated impact, absent a concrete attack.

## Safe harbour

Good-faith security research is welcome. Do not access data that is not yours, do not
degrade the service for other players, do not pivot beyond what is needed to demonstrate the
issue, and do not retain or share any personal data you encounter. Report promptly through
the channel above. The project will not pursue legal action against research conducted on
that basis, and will say so publicly if asked.

## Hardening expectations for self-hosters

If you operate your own instance, at minimum: keep it patched, set `TRUST_PROXY=true` only
behind a trusted reverse proxy (never when clients can reach Node directly), serve over
HTTPS, keep `MAX_CONNECTIONS_PER_IP` and `JOIN_ATTEMPTS_PER_IP` below `MAX_CONNECTIONS` when
public, never expose a Supabase `service_role`/`secret` key to the browser, and back up the
rankings volume. See [`docs/HOSTING.md`](docs/HOSTING.md) and
[`server/env.example`](server/env.example).
