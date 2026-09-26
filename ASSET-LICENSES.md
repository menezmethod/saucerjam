# Asset licences

> Working policy, not legal advice. Open items that need evidence or an attorney's view
> are marked **[OPEN]** and tracked in [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md).

The source code is MIT ([`LICENSE`](LICENSE)). **The art, models, music and sound
effects are not covered by that licence.** They are controlled separately, exactly like
the brand ([`TRADEMARK.md`](TRADEMARK.md)). This file is the licence that applies to
them, and the record of what is in the repo.

## 1. SaucerJam Asset License (the default for game assets)

**All rights reserved, with a narrow grant for playing and running SaucerJam.**

You may, without asking:

- play SaucerJam, and let others play it, including publicly;
- redistribute the assets **as part of an unmodified SaucerJam build**, keeping the build
  and the assets together;
- host an unmodified build, or an unmodified build with code modifications only;
- record, stream and screenshot gameplay for review or commentary.

You may not, without written permission:

- extract an asset and use it in another game, product, app, video, stream overlay,
  avatar, wallpaper pack, or website of your own;
- redistribute the assets on their own, or in a modified build that replaces the game —
  take the code, leave the art;
- sell, sublicense, rent or distribute them commercially;
- use them as training data for a machine-learning model;
- use them in merchandise, prints, or physical goods;
- claim authorship of them.

Rationale: the soundtrack, SFX and models are the most expensive authoring work in the
project, the most likely to be lifted, and the most likely to carry merchandise or OST
value. A permissive grant over them would give away the parts a game's identity actually
lives in. If you have a use in mind, ask — see §7.

## 2. What is in the repository

| Path | Contents | Licence |
| --- | --- | --- |
| `src/**/*.js`, `src/**/*.css`, `server/**`, `shared/**`, `scripts/**`, `tests/**`, build config | Source code | MIT |
| `src/assets/models/ships/*.glb` | 3 original low-poly ship models | **CC0** — see §3 |
| `src/assets/music/*.ogg` | 9 soundtrack cues and stings | SaucerJam Asset License — see §4 |
| `src/assets/sounds/*.mp3` | 9 sound effects (3 unreferenced, see §5) | SaucerJam Asset License — see §4 |
| `src/assets/social/saucerjam-share.png` | Official social share image | Brand asset — [`TRADEMARK.md`](TRADEMARK.md) |
| `docs/**/*.png`, `docs/**/*.jpg` | Screenshots, verification captures, concept boards | SaucerJam Asset License (documentation use) |
| `docs/concepts/confluence-v2/images/**` | AI-generated concept boards and turnarounds — **not shipped in the game** | SaucerJam Asset License — see §6 |
| `docs/licenses/AGPL-3.0.txt` | Staged licence text, not operative | See [`LICENSING.md`](LICENSING.md) §6 |

Anything not listed is covered by [`LICENSING.md`](LICENSING.md).

## 3. The three ship models are CC0 — and stay CC0

`src/assets/models/ships/ufo.glb`, `cryptos_saucer.glb` and
`avrocar_vz-9-av_experimental_aircraft.glb` are original models built in Blender, and
[`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md) records them as "CC0 / original,
no restrictions".

**That grant is kept.** CC0 is irrevocable for the copies already released, and quietly
tightening it now would be exactly the retroactive move this project refuses to make with
MIT. They are also the three assets that replaced the previously flagged
unclear-provenance ships, so a clean, permissive, well-documented status is worth more
than the extra control.

Consequence: anyone may reuse those three models. The default in §1 applies to every
asset added **from now on**, not to those three.

## 4. Music and sound effects

All 15 shipped cues (9 music, 6 wired SFX) were generated with **Suno v6**; the cue-by-cue
record — clip IDs, loop lengths, prompts, chop points — is in
[`docs/AUDIO.md`](docs/AUDIO.md). Holding:

- **SaucerJam owns** whatever copyright subsists in the generated audio, to the extent the
  terms and applicable law grant it. The project's position is that these files are the
  project's to license under §1.
- **[OPEN] Commercial-rights evidence is not in the repo.** `docs/AUDIO.md` notes the six
  beds were downloaded as `_paid_wm.wav` files, and the wider policy
  ([`docs/PUBLIC-LAUNCH-FOUNDATION.md`](docs/PUBLIC-LAUNCH-FOUNDATION.md) §AI-generated
  content) already requires keeping generation date, account/tier, asset ID, the
  commercial-use terms in force at that time, and the source master where practical.
  Nothing here should be treated as settled for a paid OST release, a merchandise run, or
  a commercial licence sale until that record exists. Required action is in the review.
- **[OPEN] The watermark question.** If any shipped bed carries a perceptual watermark from
  a lower service tier, that is a problem for a standalone OST or a physical release, not
  for in-game use as things stand. Also in the review.

The independent oscillator SFX generated in code (`playSound()` in `src/index.js`) are
part of the source and are MIT.

## 5. Unreferenced assets (dead weight)

Three files under `src/assets/sounds/` are referenced nowhere in the codebase: `bounce.mp3`,
`laser-bounce.mp3`, `grenade-laser.mp3` (noted as dead in `docs/AUDIO.md`). They are
Suno-era files still sitting in the tree, so they carry §4's provenance questions without
earning their place. **Delete them, or record them in the provenance ledger as unused.**
Listed as an open item in [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md).

## 6. Concept boards and AI-generated design material

`docs/concepts/confluence-v2/` is a **design handoff, not shipped content**
(its own README says so). It documents a pipeline of GPT image generation → Meshy
image-to-3D → Blender cleanup.

Two separate things to keep straight:

- **The style direction and prompts** are the project's own work and are covered like
  documentation.
- **The generated boards and turnarounds themselves** are AI output. They are not in the
  game, they are not part of any release bundle, and they should not be promoted to
  marketing material or to `src/assets/` without first recording their generation
  provenance (tool, date, model version, account, terms) in
  [`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md).

The three shipped ship models in `src/assets/models/ships/` remain the §3 CC0 files. No
Meshy output is shipped.

## 7. Requesting other use

For anything §1 rules out — reuse in your own project, a stream overlay pack, merch,
an OST release, a physical print, a commercial deployment — open a GitHub Discussion at
<https://github.com/menezmethod/saucerjam/discussions> and describe the asset, the use,
the channel and whether it is commercial. Requests are decided case by case; a commercial
licence is a step the project may take later ([`LICENSING.md`](LICENSING.md) §6).

## 8. Inbound assets: the gate

A pull request that adds art, audio, a model or a font must fill in the asset checklist in
[`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md) and disclose AI tooling. The rule
there is the rule here:

> **No provenance = no canonical release.**

Unknown provenance, unknown licence, an unverifiable origin, or "found it online" means
the asset stays out until that changes. Contributors also grant the project the licence in
[`CLA.md`](CLA.md) §2, which is what lets the project keep shipping contributed assets
under the split described here.

## 9. Marketplace and community creations

Creator-owned, with the project's licence defined in
[`docs/MARKETPLACE-TERMS.md`](docs/MARKETPLACE-TERMS.md). That path is deferred scope and
not active; §1 governs anything contributed outside it.
