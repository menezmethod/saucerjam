# Shared Fider service

Fider is the shared feedback portal for SaucerJam and future Menezmethod apps. There is one public board and one URL; apps are separated with categories and an `app` tag rather than extra subdomains.

Suggested URLs:

- `https://community.saucerjam.com` — the shared community portal
- `app:saucerjam` — SaucerJam posts
- `app:<future-app>` — future app posts

This is Fider's default single-tenant deployment: one `BASE_URL`, one database, and one feedback board. It avoids wildcard DNS and keeps the community experience in one place.

## Deployment

The secret-free Coolify template is [`deploy/fider/docker-compose.yml`](../../deploy/fider/docker-compose.yml). Configure the values in [`deploy/fider/.env.example`](../../deploy/fider/.env.example) as Coolify environment variables, not in Git.

Required infrastructure:

1. A Coolify Docker Compose application using `deploy/fider/docker-compose.yml`.
2. Persistent storage for `fider_pg_data`.
3. DNS: `community.saucerjam.com` to the Fider application.
4. HTTPS at the reverse proxy.
5. SMTP credentials for sign-in and verification email.
6. Keep the public board available, but keep engineering/security reports on GitHub and preserve the moderation controls below.

## Supabase authentication

The game’s Supabase Auth project remains the identity provider; Fider keeps its own local user records and feedback data. Direct Supabase-to-Fider SSO is deferred until the OAuth 2.1 PKCE flow is proven against the installed Fider release. If it is tested later, the current Supabase OAuth server endpoints are:

- authorize: `https://<project-ref>.supabase.co/auth/v1/oauth/authorize`
- token: `https://<project-ref>.supabase.co/auth/v1/oauth/token`
- userinfo: `https://<project-ref>.supabase.co/auth/v1/oauth/userinfo`

Keep the provider disabled while testing and verify sign-in, logout, callback handling, and account linking before enabling it. The in-game report bridge works without this SSO dependency.

Never place the Supabase secret/service-role key in the browser, Fider public settings, or this repository. Fider receives an OAuth identity and stores only the profile fields needed for feedback ownership.

## App integration

The first app integration is a normal external link; Fider is not a runtime dependency for joining or playing a match.

- `Community` → `https://community.saucerjam.com`
- `Report feedback` → the in-game bridge, with bug, feature, balance, or question type
- `Suggest an idea` → the Fider board and roadmap at `https://community.saucerjam.com`

Pass only non-sensitive context such as app name, release version, device category, and map/mode as a prefilled form hint. Never pass pilot tokens, access tokens, player names, precise locations, or private gameplay data.

### In-game reports

SaucerJam also exposes a narrow server-side report bridge at `POST /api/community/report`. The browser sends the current Supabase access token to the game server; the server verifies the session and confirmed email, applies per-user and per-IP limits, and then calls Fider. The Fider API key is server-only. Fider users are mapped with `reference=supabase:<auth-user-id>` and posts are created with Fider's documented user impersonation header. The endpoint is intentionally not a generic Fider proxy.

The launch limits are one post per ten minutes and five per day per account, with a twenty-per-hour IP backstop. Titles are capped at 120 characters, descriptions at 4,000 characters, and links/attachments are not accepted by the first version. The in-game bridge requires a verified account; guests use Fider's normal sign-in flow before posting. New or suspicious accounts can be challenged with Turnstile without adding friction to every report.

Direct Supabase-to-Fider SSO remains deferred until the OAuth 2.1 PKCE flow is proven against the installed Fider release. The report bridge works for Google, Apple, and confirmed email/password accounts without sharing either database.

## GitHub and agent workflow

Use Fider for discovery, voting, status, and discussion. Use GitHub for code, issues, pull requests, CI, provenance, and releases.

Fider webhooks can notify a small trusted integration endpoint when a post or status changes. The endpoint may create or update a GitHub issue after validation; it must verify a shared secret, rate-limit requests, and never merge or deploy. Agents can summarize, label, deduplicate, draft tests, and open PRs. A maintainer approves scope, security, IP, merges, and releases.

## Rollout gates

1. Deploy privately behind deployment access controls.
2. Create and test the SaucerJam board.
3. Verify Supabase sign-in and Fider email verification.
4. Verify mobile and desktop board layouts.
5. Enable public board access and add in-game links.
6. Add other apps as categories/tags on the same Fider board, not separate URLs, databases, or deployments.

Back up the Fider database before upgrades and test restore. Pin/review the chosen Fider image release before production upgrades; do not blindly track a mutable image forever.
