# Licensing

> Working policy, not legal advice. It is the map of which licence covers which
> part of SaucerJam, what has already been granted, and what is staged but not
> yet adopted. An IP attorney review is an open gate before any licence switch
> (see §6 and [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md)).

## 1. Current state — code is MIT

| Part of the project | Licence today | Where it is stated |
| --- | --- | --- |
| Source code (`src/`, `server/`, `shared/`, `scripts/`, `tests/`, build config) | **MIT** | [`LICENSE`](LICENSE) |
| In-game art, 3D models, music, sound effects | **SaucerJam Asset License — all rights reserved** (separate from the code licence) | [`ASSET-LICENSES.md`](ASSET-LICENSES.md) |
| Original ship models in `src/assets/models/ships/` | **CC0** (as recorded at creation) | [`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md) |
| SaucerJam name, wordmark, logo, official domains | **No licence granted — trademark/brand rights reserved** | [`TRADEMARK.md`](TRADEMARK.md) |
| Marketplace and community creations | **Creator-owned**, with a licence granted to the project | [`docs/MARKETPLACE-TERMS.md`](docs/MARKETPLACE-TERMS.md) |
| Contributions offered to this repo | Inbound = MIT, plus the contributor licence in [`CLA.md`](CLA.md) | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Official servers and hosted services | **Operated by the project; no rights granted by any code licence** | [`TRADEMARK.md`](TRADEMARK.md) §Official services |
| Third-party dependencies | Their own licences (all MIT / Apache-2.0 today) | §5 below |

`NOTICE` restates this mapping at the root so it is visible without reading this file.

## 2. The version boundary

MIT is irrevocable for the copies already granted. Nothing below changes that.

| Release | Code licence |
| --- | --- |
| `1.0.0` – `1.3.0` (shipped) | MIT |
| `1.4.0` (current, unreleased in `CHANGELOG.md`) | MIT |
| Any future release | MIT by default; AGPL-3.0 **only after the gates in §6 are cleared and the switch is executed deliberately** |

If the switch happens, it is announced in `CHANGELOG.md`, the release notes, and this
file, with the first AGPL release named explicitly. Nothing becomes AGPL retroactively.

## 3. Why the split at all

A single permissive file containing the whole repository would hand out four things
the project does not want to hand out:

1. **The brand.** A code licence that also covered the name and logo would let anyone
   ship a modified build *called SaucerJam*. The moat is the official brand, canonical
   universe, community, hosted service, moderation and marketplace — not the code.
   See [`TRADEMARK.md`](TRADEMARK.md).
2. **The art and audio.** The soundtrack, SFX and models are the most expensive
   authoring work in the repo and the most likely to appear in merchandise, an OST
   release, or a competitor's project. They are licensed separately and restrictively.
   See [`ASSET-LICENSES.md`](ASSET-LICENSES.md).
3. **Other people's creations.** A marketplace only works if creators keep their
   rights and grant the project exactly what it needs to display and distribute.
   See [`docs/MARKETPLACE-TERMS.md`](docs/MARKETPLACE-TERMS.md).
4. **Operational authority.** No code licence — MIT or AGPL — should be readable as
   "you may operate the official SaucerJam service". See [`TRADEMARK.md`](TRADEMARK.md).

## 4. What MIT does and does not give you today

You may, without asking:

- run SaucerJam locally, on a LAN, or on your own public server;
- read, modify, fork and redistribute the source code;
- ship a modified build for free or commercially;
- use the code in your own project, including a commercial one;
- publish your fork, including one with a different name.

You may not, without separate permission:

- use the SaucerJam name, wordmark or logo to brand your build, or imply that it is
  official (see [`TRADEMARK.md`](TRADEMARK.md));
- reuse the in-game art, models, music or sound effects outside an unmodified
  SaucerJam build (see [`ASSET-LICENSES.md`](ASSET-LICENSES.md));
- represent yourself as running the official SaucerJam service.

MIT requires only that the copyright notice and the licence text travel with copies of
the code. That is genuinely all it asks, and it stays true forever for the releases
already made.

## 5. Third-party dependencies

Read directly from the installed packages in this repo (September 2026). All are
permissive and **compatible with a future AGPL-3.0 switch** — no dependency would block
it, and none imposes a copyleft obligation on SaucerJam today.

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| `three` | 0.160.1 | MIT | Renderer |
| `express` | 4.22.1 | MIT | HTTP server |
| `socket.io` | 4.8.3 | MIT | Realtime transport |
| `socket.io-client` | 4.8.1 | MIT | Realtime client |
| `@supabase/supabase-js` | 2.116.0 | MIT | Optional accounts / ledger |
| `webpack` | 5.110.3 | MIT | Build |
| `webpack-cli` | 5.1.4 | MIT | Build |
| `webpack-dev-server` | 4.15.2 | MIT | Dev build |
| `html-webpack-plugin` | 5.6.3 | MIT | Build |
| `css-loader` | 6.11.0 | MIT | Build |
| `style-loader` | 3.3.4 | MIT | Build |
| `copy-webpack-plugin` | 11.0.0 | MIT | Build |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser tests |

Apache-2.0 and MIT are both one-way compatible into AGPL-3.0. A dependency audit is
part of every switch (re-run it; do not trust this table as current forever).

## 6. AGPL-3.0 — staged, not adopted

Future releases are **intended** to move to AGPL-3.0-only. It is not the licence today,
and the switch waits on four gates recorded in
[`docs/PUBLIC-LAUNCH-FOUNDATION.md`](docs/PUBLIC-LAUNCH-FOUNDATION.md). Current status,
with evidence, is in [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md):

1. code ownership verified across all contributors and AI-generated code — **clean today**, see review;
2. CLA vs DCO chosen and implemented — **CLA chosen**, text in [`CLA.md`](CLA.md), signing
   tooling still to wire up;
3. an effective version/date fixed for the switch — **not fixed** (proposal in the review);
4. IP attorney review completed — **outstanding**, and the only hard blocker.

### Why AGPL rather than staying permissive

AGPL is still open source and still commercially usable, but anyone who runs a
**modified** version as a network service has to offer the corresponding source to that
service's users. It closes the "take the code, improve it privately, run it as a
competing hosted game, publish nothing" path while leaving self-hosting, modding and
community forks fully legal. Permissive licences leave that path open.

If maximum adoption ever matters more than reciprocity, staying on MIT permanently is
also a defensible end state. The moat then rests on the brand, servers, community,
moderation, marketplace and physical products instead. That is a business decision, not
a defect in this file.

### Prepared, not activated

The complete AGPL-3.0 text is already in the repo at
[`docs/licenses/AGPL-3.0.txt`](docs/licenses/AGPL-3.0.txt) (verbatim from
<https://www.gnu.org/licenses/agpl-3.0.txt>, SHA-256
`0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`). It is staged so the
switch is a reviewable commit rather than an improvised one, and so the file is
available for the attorney review without depending on network access. Staging it
grants nobody anything: MIT in `LICENSE` remains the only operative grant.

### Executing the switch

Do this only after all four gates are cleared and recorded in
[`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md):

1. `LICENSE` ← the contents of `docs/licenses/AGPL-3.0.txt`, with
   `Copyright (C) 2026 Luis Gimenez` and the standard "how to apply" block appended.
2. `package.json` and `server/package.json` ← `"license": "AGPL-3.0-only"`.
3. `NOTICE` ← state AGPL for the code, keep every carve-out unchanged.
4. This file ← move AGPL from §6 to §1 and record the first AGPL release version.
5. `README.md` §Licence and `CONTRIBUTING.md` §Licensing ← same wording.
6. Re-run the dependency audit in §5 against the then-current lockfile.
7. Confirm the release bundle ships Corresponding Source (§7) **before** publishing it.
8. Tag the first AGPL release, name it in `CHANGELOG.md`, and note in the release notes
   that earlier releases remain MIT.
9. If any outside contributor's code is in the tree, confirm a signed CLA is on file
   for every one of them first (see [`CLA.md`](CLA.md)).

### If you want to go further later: dual licensing

The CLA is what makes this possible. Because contributors grant the project a
relicensable licence, the project can keep publishing under AGPL-3.0 for the community
**and** sell a commercial licence to a company that wants to embed, host or modify
SaucerJam without the AGPL's source-offer obligation. That option exists only while
every contributor's grant permits it — which is why the CLA in [`CLA.md`](CLA.md) is a
licence grant rather than a narrow inbound=outbound assignment.

## 7. Source availability in release bundles

`scripts/package-release.cjs` builds the downloadable release: a prebuilt browser client
plus the Node server. The client in that bundle is **compiled output**, so the
corresponding source (`src/`, `shared/`, `webpack.config.js`) and the licence files are
packaged with it. Anyone who receives the bundle can therefore rebuild it, which is what
every licence in play here — and §13 of AGPL-3.0, if and when it applies — requires.

## 8. Questions this file exists to answer

- **Can I self-host it?** Yes. MIT today, AGPL after a switch; either way self-hosting an
  unmodified or modified build is permitted. Name it something else if you run it
  publicly, and never imply it is official.
- **Can I sell a game built on it?** Yes, under MIT, as long as the MIT notice travels
  with the code. Under a future AGPL you may also sell it, but a modified network service
  must offer its source to its users.
- **Can I put SaucerJam in my product's name?** Not the official mark; see
  [`TRADEMARK.md`](TRADEMARK.md).
- **Can I use the music or the ship models in my own game?** No — not under the code
  licence. See [`ASSET-LICENSES.md`](ASSET-LICENSES.md), then ask.
- **Can I sell a t-shirt with the logo?** No. Brand and physical goods are controlled
  separately; ask first.
- **Do I keep the rights to what I contribute?** Yes. You grant the project a
  relicensable licence ([`CLA.md`](CLA.md)); you keep ownership.

## 9. Changing this file

Licence decisions are maintainer decisions, not drive-by PRs. Any change to this file,
`LICENSE`, `NOTICE`, `TRADEMARK.md`, `ASSET-LICENSES.md`, `CLA.md` or
`docs/MARKETPLACE-TERMS.md` requires maintainer review; the PR template asks for it
explicitly.
