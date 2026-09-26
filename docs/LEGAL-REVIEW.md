# Legal and IP review

> **Not legal advice.** This is an engineering review of the repository's legal and IP
> posture, produced from evidence in the repo and on the hosting accounts. It is written
> to be handed to an attorney, not to replace one. Anything marked **[OPEN]** needs either
> evidence that does not exist yet or a lawyer's judgement.

- **Reviewed:** 26 September 2026
- **Scope:** code ownership, dependency compatibility, asset provenance, AI-generated
  content, contributor terms, trademark/IP separation, release-bundle obligations
- **Method:** read the tracked tree and git history; read the installed dependency
  metadata; queried the GitHub API for the legacy repository; ran the test suite
- **Out of scope:** jurisdiction-specific advice, the tax and payment design for the
  marketplace, privacy/regulatory review of the leaderboards

## 1. Executive summary

**The repository is in better shape than its documentation implied, and it is not yet ready
for the licence switch.** Two findings need action before anything commercial; the
licence change itself is clean to execute once those land.

| # | Finding | Risk | Status |
| --- | --- | --- | --- |
| F1 | The legacy `quantum-drift` repository is **public** and still hosts the three flagged unclear-provenance ship models | **High** | Action required — set private/archive |
| F2 | Commercial-rights evidence for the Suno-generated soundtrack and SFX is not in the repo, and some beds may carry a tier watermark | **High** | **[OPEN]** Evidence needed |
| F3 | Three unreferenced Suno-era audio files sit in the tree with the same unanswered provenance questions | Low | Action required — delete or ledger |
| F4 | Git history has six author identities for one person plus agent identities; no `.mailmap` | Low | Action required — add `.mailmap` |
| F5 | AI-generated code is in history with disclosure trailers, but the ownership chain is not written down anywhere | Medium | Addressed in this review, §4 |
| F6 | No CLA, no signing mechanism, no contributor terms — until now | Medium | CLA drafted; signing tooling outstanding |
| F7 | Release bundles shipped a compiled client **without** its source | Medium | **Fixed** — `scripts/package-release.cjs` |
| F8 | No `package.json` `license` field, so automated tooling and registry metadata saw no licence | Low | **Fixed** |
| F9 | Trademark clearance is not done; the name is asserted through use only | Medium | **[OPEN]** Attorney + USPTO search |
| F10 | `package.json` name/version metadata and docs disagreed about branches, capacity, and shipping features | Low | **Fixed** — docs corrected |

The four gates for the AGPL switch (from
[`PUBLIC-LAUNCH-FOUNDATION.md`](PUBLIC-LAUNCH-FOUNDATION.md)):

| Gate | State |
| --- | --- |
| 1. Code ownership verified across contributors and AI-generated code | **Clean** — §3, §4 |
| 2. CLA vs DCO chosen and implemented | **Half** — CLA chosen and drafted; signing service not wired up |
| 3. Effective version/date fixed for the switch | **Not fixed** — proposal in §6.3 |
| 4. IP attorney review completed | **Outstanding** — this document is the input to it |

## 2. What was inspected

```sh
git shortlog -sne --all                                  # authorship
git log --all --format='%an|%ae|%s%n%b' | grep -i ai     # AI provenance trailers
git ls-files -z | xargs -0 du -h | sort -rh              # asset inventory and weight
node -e "...node_modules/<pkg>/package.json..."          # dependency licences
gh repo view menezmethod/quantum-drift --json visibility  # legacy exposure
git rev-list --all --objects -- src/assets/models/ships/ # history blob audit
npm test                                                 # 220/220 pass, 86.2 s
```

## 3. Code ownership

**Result: clean.** Every commit in the repository is first-party:

| Identity | Commits |
| --- | --- |
| Luis Gimenez `<menezfd@gmail.com>` | 111 |
| MenezMethod `<72755559+menezmethod@users.noreply.github.com>` | 33 |
| Luis Gimenez `<luisgimenezdev@gmail.com>` | 8 |
| Hermes `<hermes@menezmethod.local>` / `<hermes@menezmethod.com>` / `<hermes@local>` | 9 (agent, acting under the owner's direction) |

There are **no third-party human contributors**, so there is no one whose consent is
needed to relicense and no orphaned copyright. That is the single most valuable fact in
this review: the window to choose a licence posture cleanly is open right now, and closes
the moment the first outside pull request is merged.

**Required action (F4).** Six identities for one person is a provenance record that will
look like six contributors to an auditor. Add a `.mailmap` collapsing all three personal
addresses and the two agent identities onto canonical names. One file, no history rewrite,
and it makes `git shortlog` authoritative.

Also worth recording, since it is cheap now and impossible later: a `CONTRIBUTORS.md` or a
signed release tag noting that the project owner is the sole copyright holder through
release 1.4.0.

## 4. AI-generated content

**Result: defensible, with the chain written down here for the first time.**

AI involvement is not hidden; it is disclosed in commit trailers:

- `Claude-Session:` trailers on 7 commits (Claude Code sessions)
- `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` on 1 commit
- Hermes co-author trailers on 4 commits
- Commit bodies describing adversarial AI validation (Claude Opus 5)

Three categories, three different legal situations:

1. **Code** — generated with Claude Code and Hermes, under the project owner's direction
   and review. The tools' terms place output ownership with the user; the owner is
   therefore the copyright holder of the code, and the AI is not a contributor. Every
   commit passed through the owner's review, and the repository's own verification gates
   (220 unit tests, the browser suite, the SRE loop's no-auto-merge rule) apply to it.
   **No action required**, but retain the tool/terms record per
   [`PUBLIC-LAUNCH-FOUNDATION.md`](PUBLIC-LAUNCH-FOUNDATION.md) §AI-generated content.
2. **Audio** — Suno v6. See F2 below; the ownership position depends entirely on the
   service tier and terms in force at generation time, and that record is missing.
3. **Images and 3D** — GPT image generation → Meshy → Blender, confined to
   `docs/concepts/`. Not shipped. Do not promote to `src/assets/` or to marketing without
   recording generation provenance first.

**Policy now in force:** [`CONTRIBUTING.md`](../CONTRIBUTING.md) requires AI disclosure on
every contribution (code, art, audio, models, text), including the tools used and any
source or reference material supplied, and the PR template asks for it explicitly.

## 5. Dependencies

**Result: clean, and no dependency blocks an AGPL switch.** Every runtime and build
dependency is MIT except `@playwright/test` (Apache-2.0, dev-only). Both are one-way
compatible into AGPL-3.0. Full table and versions: [`../LICENSING.md`](../LICENSING.md) §5.

Re-run this audit against the lockfile at switch time and at each major dependency upgrade
— this table is a snapshot, not a permanent guarantee.

## 6. Assets

### 6.1 The three original ship models — clean

`ufo.glb`, `cryptos_saucer.glb` and `avrocar_vz-9-av_experimental_aircraft.glb` are
documented in [`ASSET-PROVENANCE.md`](ASSET-PROVENANCE.md) as original Blender work, built
from scratch, with no reference geometry, and licensed CC0. Verified: the history blob
audit shows only the current CC0 files at those paths — the flagged originals were never
committed to this repository. They are kept CC0 in
[`../ASSET-LICENSES.md`](../ASSET-LICENSES.md) §3 because tightening them retroactively
would be the same retroactive move the project refuses to make with MIT.

### 6.2 **[OPEN]** Suno soundtrack and SFX — F2

The gap is evidence, not authorship. `AUDIO.md` records clip IDs, prompts, loop lengths
and chop points for all 15 cues, which is more than most projects have. It does **not**
record the service tier, generation dates, or the commercial-use terms in force, and it
notes the six beds were downloaded as `_paid_wm.wav` files.

Required, before any of: a standalone OST release, merchandise, a paid marketplace, or a
commercial licence sale:

- [ ] account tier and subscription record at the generation date of each cue;
- [ ] the commercial-use terms in force then, saved as a file, not a link;
- [ ] confirmation of whether any shipped bed carries a perceptual watermark, and if so
      whether that contradicts the tier asserted;
- [ ] the raw masters, or a decision to accept the encoded files as the record.

Retain all four in `docs/` (or a private archive referenced from `AUDIO.md`). The in-game
use position is defensible as it stands; the commercial position is not documented.

### 6.3 Unreferenced audio — F3

`bounce.mp3`, `laser-bounce.mp3`, `grenade-laser.mp3` are referenced nowhere in the
codebase. They are Suno-era files, so they carry §6.2's questions while contributing
nothing. Delete them, or record them as unused in the provenance ledger.

### 6.4 Repository weight

The git pack is ~115 MiB, and the largest tracked files are concept boards and verification
screenshots under `docs/` (2–3 MiB each, `docs/loop/north-star/` and
`docs/concepts/confluence-v2/images/meshy-turnarounds/`). Not a legal finding, but it
inflates every clone and every release-bundle build, and it is the kind of content most
likely to be reclassified later as marketing material — which is exactly when it needs
provenance. Consider moving design boards out of the repo, or recording their provenance
now.

## 7. Trademark and IP separation

**Result: separated, now. Clearance still outstanding (F9).**

- The brand is no longer implicitly bundled with the code: [`../TRADEMARK.md`](../TRADEMARK.md)
  governs the name, wordmark, logo and official services, and states that no code licence
  grants any of them.
- Official services are explicitly reserved: operating the canonical
  saucerjam.com service is not a right any code licence confers.
- **ARC positioning is safe as written.** The project is documented as inspired by the
  *feeling* of classic arena shooters, explicitly not a remake, with no ARC code, art,
  audio, maps, UI, logos, lore or characters shipped. That is the correct posture; keep it.
  *(The historical project name "Quantum Drift"—see §8—is not an issue; nothing in the
  current build references it publicly.)*
- **[OPEN] Name clearance.** The informal screening recorded in
  `PUBLIC-LAUNCH-FOUNDATION.md` found no strong exact collision, but that is not a
  clearance search. Before filing or a material commercial launch: live USPTO exact and
  similar-mark search, common-law/web search, Steam/itch/app-store search, GitHub search,
  and domain/handle ownership confirmation. Attorney review if monetisation becomes
  material.

## 8. **[OPEN] F1 — the legacy repository is still public

This is the highest-risk item in the review.**

`menezmethod/quantum-drift` is **public**, not archived, last pushed 2026-09-14, and its
`src/assets/models/ships/` directory still contains:

- `avrocar_vz-9-av_experimental_aircraft.glb`
- `cryptos_saucer.glb`
- `ufo.glb`

Those are the three assets the project itself flagged as having unclear provenance and
replaced — the exact assets [`ASSET-PROVENANCE.md`](ASSET-PROVENANCE.md) says must not be
used in any marketing material and describes as "now removed from disk". They are removed
from *this* repository's working tree and were never committed to *this* repository's
history (verified in §6.1). But the legacy repository still distributes them publicly, so
the exposure those files represent is live, not historical.

`PUBLIC-LAUNCH-FOUNDATION.md` §Rename scope already prescribes the fix and states the
condition: the old repo "stays public read-only until the new repo's deploy/CI is verified
working, then is set private". Both conditions are now met — the new repo has green CI, a
healthy Coolify deployment on `main` and `develop`, and no dependency on the legacy repo.

**Required action:**

- [ ] set `menezmethod/quantum-drift` to **private** (preferred — removes the public
      distribution entirely);
- [ ] if it must stay visible for historical reference, **archive** it and strip the three
      flagged binaries from its tree first, understanding that its git history still
      contains them;
- [ ] confirm no marketing material, release bundle, landing page or store listing links to
      it, and none references the legacy name.

Whoever owns the decision: this is a one-click change on the GitHub repository settings
page, not an engineering task.

## 9. Contributor terms

**Result: gap closed in this change; tooling outstanding.**

- No `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` or CLA existed, and
  `PUBLIC-LAUNCH-FOUNDATION.md` lists all four as required before contributor outreach.
  All four now exist.
- **CLA chosen over DCO.** A DCO certifies origin but grants nothing beyond the existing
  licence, so it cannot support a relicensing switch or dual licensing. [`../CLA.md`](../CLA.md)
  is a licence grant (not an assignment) covering copyright, patents and relicensing
  rights, plus a corporate variant.
- **Outstanding:** wire up a CLA signing service, or use the pull-request-comment
  acceptance path in `CLA.md` §1. Until one of those is live, every outside pull request
  must be held or accompanied by an explicit signature comment.
- Because there are no outside contributors yet (§3), no signature is on file and nothing
  is blocked today. **This is the reason to act now**: the first outside merge without a
  CLA is what creates the problem.

## 10. Release bundles and source availability

**Fixed (F7).** `scripts/package-release.cjs` shipped `dist/` (a compiled client) plus the
Node server, but omitted `src/`, `shared/` and `webpack.config.js`. A recipient could run
the bundle but could not rebuild it from the corresponding source. This was a defect under
MIT's spirit, and a hard failure under AGPL-3.0 §13. The packaging now includes the
corresponding source and the licence files (`LICENSING.md`, `TRADEMARK.md`,
`ASSET-LICENSES.md`, `NOTICE`).

## 11. Licensing mechanics

- **MIT is irrevocable for existing copies.** Releases 1.0.0–1.3.0 stay MIT, and the
  current `1.4.0` stays MIT. Nothing in this change or a future one can pull that back.
- **The switch is staged, not executed.** The verbatim AGPL-3.0 text is committed to
  `docs/licenses/AGPL-3.0.txt` for review, and the exact nine-step switch procedure is in
  [`../LICENSING.md`](../LICENSING.md) §6. No file in the repository claims AGPL today.
- **Version boundary** when the switch happens: releases up to and including the last MIT
  release remain MIT; the first AGPL release is named explicitly in `CHANGELOG.md`.
- **Dual licensing** stays possible only while every contributor's grant permits it —
  which is what `CLA.md` §2 secures.

## 12. Security and hygiene (adjacent, brief)

- No credentials, tokens or keys are committed to the tree; the only matches for secret
  patterns are documentation and test fixtures. `.env` files are gitignored.
- `GET /metrics` is intentionally unauthenticated and documented as aggregate and
  non-PII. Re-confirm that claim before any public dashboard is shared.
- Rankings and leaderboards hold callsigns and per-round statistics. That is user data:
  a privacy review (retention, deletion-on-request, what a signed-in pilot's identity is
  linked to) belongs in the same attorney and product pass as the marketplace terms.

## 13. Next actions

Ranked, cheapest first:

1. **Set `menezmethod/quantum-drift` private** (F1) — a repository setting, high risk, one click.
2. **Delete the three unreferenced audio files** or ledger them (F3) — one commit.
3. **Add `.mailmap`** (F4) — one file.
4. **Wire up CLA signing**, or require the acceptance comment on outside pull requests (F6).
5. **Collect the Suno tier, date and terms record** (F2) — the only finding here that
   cannot be closed by engineering.
6. **Fix the switch version/date** (gate 3) — propose "the first release after the attorney
   review clears", or name the version now.
7. **Take this document plus `LICENSING.md`, `TRADEMARK.md`, `ASSET-LICENSES.md`, `CLA.md`
   and `docs/MARKETPLACE-TERMS.md` to an IP attorney** (gate 4). The remaining open
   questions are theirs: the CLA's enforceability and governing law, the clearance search,
   and whether the Suno position is adequate for commercial licensing.

Record the outcome of each in this file. It is the audit trail a future licensor,
acquirer, contributor or counsel will ask for — and the reason to write it down now,
while the answer to "who owns this?" is still simple.
