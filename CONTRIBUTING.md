# Contributing to SaucerJam

Thanks for wanting to help. This file covers how to set up, where work goes, what a pull
request needs to include, and the rules that keep the project shippable. It is short on
ceremony and specific about evidence, because the automation around this repository
(see [`docs/LOOP.md`](docs/LOOP.md)) is strict about the difference between a proposal and a
release.

**Before you write code:** read [`docs/ROADMAP.md`](docs/ROADMAP.md) and
[`docs/PUBLIC-LAUNCH-FOUNDATION.md`](docs/PUBLIC-LAUNCH-FOUNDATION.md). The second one lists
the non-negotiable IP rules and the direction. Both are short.

## 1. Where things belong

| You have | Go to |
| --- | --- |
| A reproducible bug in a released build | [Bug report issue form](https://github.com/menezmethod/saucerjam/issues/new/choose) |
| A feature idea, balance thought, ship/art/lore proposal | <https://community.saucerjam.com> (or Discussions) |
| A question, or a proposal that needs discussion first | [Discussions](https://github.com/menezmethod/saucerjam/discussions) |
| A security vulnerability | [`SECURITY.md`](SECURITY.md) — private advisory, never a public issue |
| An existing-issue fix with tests and evidence | A pull request (§5) |

Search before you post. Duplicates cost the maintainers more time than they save you.
Community votes help prioritise; they do not bypass performance, security, moderation or IP
review, and they do not create work automatically.

## 2. Setup

Requires **Node.js 22** (20 is the declared minimum; CI, the Dockerfile and the production
host run 22+).

```sh
git clone https://github.com/menezmethod/saucerjam.git
cd saucerjam
npm ci
npx playwright install --with-deps chromium   # needed by npm test and the browser suite
npm start                                     # build + serve on http://localhost:8080
npm run dev                                   # rebuild-on-change, server on :3000 via proxy
```

`npm test` launches Chromium (the interface tests), so install the browser before the first
run or you will see `Executable doesn't exist` failures that have nothing to do with your
change. If you already have Google Chrome, `CHROME_PATH` points the browser suite at it, and
`CHROME_BACKEND=native` drops SwiftShader for real-GPU rendering.

## 3. Branches

Two long-lived branches, both deployed automatically:

| Branch | Environment | URL | Rule |
| --- | --- | --- | --- |
| `develop` | SaucerJam (dev) | <https://dev.saucerjam.com> | **Land work here.** Integration and playtesting. |
| `main` | SaucerJam | <https://saucerjam.com> | Release. Merge only what has passed on dev. |

A push to either branch deploys. There is no staging step between them, so anything merged to
`main` is live within a couple of minutes — treat that as the review pressure it is.

- Branch from `develop`, and branch names are `feat/…`, `fix/…`, `docs/…`, `chore/…`,
  `ops/…`, `scale/…` (match the existing history).
- Keep a pull request to one idea. A "while I was in there" refactor costs review time and
  makes a rollback riskier.
- Do not force-push a branch someone is reviewing. Do not commit to `main` directly.
- Never commit `.env` files, tokens, or real player data.

## 4. Commits

[Conventional Commits](https://www.conventionalcommits.org/), matching the existing history:
`feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `ops: …`, `chore(scope): …`, `scale: …`.

Write the subject in the imperative, and use the body for the *why* — what was broken, what
the tradeoff was, what you rejected. Release notes and the changelog are assembled from these,
so the body is not optional for anything non-obvious.

## 5. Pull requests

Use the template. It asks for what changed, the player-visible outcome, evidence, and the
compatibility picture. What reviewers actually look for:

1. **Tests.** New behaviour needs a test that fails without your change. The suite is
   `node --test` based; put unit tests next to what they cover (`*.test.js`, `*.test.cjs`,
   `*.test.mjs` by module system). Do not weaken or delete an existing assertion to make a
   change pass — if a test is wrong, say so explicitly in the PR.
2. **Evidence.** Paste the commands you ran and their outcome. Screenshots or a clip for
   anything visual; numbers for anything performance-related. "Verified 220/220 tests plus
   the browser suite" is evidence; "tested locally" is not.
3. **The trust boundary.** Clients send **inputs only**. Never accept health, damage,
   positions, projectile speed or resource values from a client, and never move an
   authoritative decision into `src/`.
4. **Determinism.** `shared/simulation.js` runs identically on the server and in offline
   practice. Keep it deterministic: no wall-clock reads, no `Math.random()` outside the
   seeded paths, no DOM, no browser APIs.
5. **No new dependencies** without asking first in the issue or discussion. Every dependency
   is a licence and maintenance decision, not just a convenience one.
6. **No new tooling** (linter, formatter, framework) in a feature PR. There is deliberately
   no linter configured — match the surrounding style, keep diffs tight.
7. **Compatibility.** Note the effect on desktop keyboard/mouse, touch, multiplayer
   authority, and performance. Say what you could not test.
8. **Rollback.** Name the path back if this turns out badly.

Maintainers merge. There is no auto-merge, and the automation in this repository is
contractually forbidden from deploying to production without a human
([`docs/LOOP.md`](docs/LOOP.md) §Guardrails). Agent-authored pull requests follow exactly the
same gates as human ones — see §8.

## 6. Before you push

```sh
npm test                                     # expect 220/220 (re-run; do not quote the number)
npm run build
npm run test:browser                         # after a build
```

Add the focused verification script for what you touched when one exists — for example
`node scripts/verification/confluence.cjs` for territory expansion, `camera.cjs` for camera
work, `movement.cjs` for movement, `playability.cjs` for feel. See the
[documentation index in the README](README.md#verification-scripts).

## 7. Assets

Any pull request that adds or replaces art, audio, a model, a font or a texture must fill in
the checklist in [`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md): who made it, where it
came from, the exact licence, whether commercial use and modification are allowed, whether
attribution is required, and whether AI tooling was involved (and if so, which tool and what
source or reference material was supplied).

**No provenance = no canonical release.** "Found it online", an unverifiable origin, or
"should be fine" means the asset does not ship until that changes. Assets are licensed
separately from the code — see [`ASSET-LICENSES.md`](ASSET-LICENSES.md) — and by contributing
one you grant the project the licence in [`CLA.md`](CLA.md) §2.

## 8. AI-assisted contributions

Using AI tooling is allowed and normal here — this project's own history is full of it. The
requirements are disclosure and accountability:

- **Disclose it.** Which tools, and what you gave them as source or reference material. The
  pull request template asks directly.
- **Disclose it in commits** where it matters, following the existing pattern (co-author or
  session trailers).
- **You own the result.** You are responsible for its correctness, its licence cleanliness,
  and its provenance, exactly as if you had typed it. "The model wrote it" is not a defence in
  a provenance dispute.
- **Never generate a replica** of another game's character, logo, art, ship, map or named
  visual asset.
- **Human review is mandatory** before merge, always.

Agents (including the maintainers' own automation) may open branches and pull requests,
summarise issues, and draft tests. They may not merge, force-push, edit production
configuration, or change balance, monetisation or roadmap without a human decision. Agent
work must link back to the issue or discussion that prompted it.

## 9. Licensing of contributions

By submitting a contribution you agree that:

1. your contribution is licensed to the project under the [MIT License](LICENSE), and
2. you accept the [Contributor License Agreement](CLA.md), either by signing through the CLA
   signing service or by posting the acceptance sentence from `CLA.md` §1 on your pull
   request.

You keep the copyright in your work. The CLA is what allows the project to move future
releases to AGPL-3.0 and to keep the dual-licensing option open — see
[`LICENSING.md`](LICENSING.md) §6. A pull request without CLA acceptance cannot be merged once
the signing flow is live.

Changes to `LICENSE`, `NOTICE`, `LICENSING.md`, `TRADEMARK.md`, `ASSET-LICENSES.md`, `CLA.md`
or `docs/MARKETPLACE-TERMS.md` need maintainer review; open an issue before writing the patch.

## 10. Conduct and reporting

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Harassment,
provenance disputes and private data concerns go through the reporting channel described
there, not into a public thread. Vulnerabilities follow [`SECURITY.md`](SECURITY.md).

Never include another player's pilot token, real name, precise location, or raw private
gameplay data in an issue, a pull request, a screenshot or a chat message.

## 11. Getting help

- Stuck: [Discussions](https://github.com/menezmethod/saucerjam/discussions).
- Unsure whether an idea fits the direction: ask in the discussion *before* building it.
- Unsure whether an asset is clean enough to submit: ask in the issue *before* sending the
  PR. A five-minute question beats a rejected asset.

Reasonable, evidence-backed pull requests get merged. Small, correct fixes are the easiest
way to build trust here.
