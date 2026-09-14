# Public Launch Foundation

> Working product/IP policy. Not legal advice. Before trademark filing or a meaningful commercial launch, have a U.S. IP attorney review the final name, licenses, contributor terms, and asset register.
>
> Last reviewed: September 2026.

## Product identity

**Confirmed public name: SaucerJam.** (Formal trademark clearance is still pending — see Name strategy below.)

This is **not an ARC remake**.

It is an independently built large-scale multiplayer arena game inspired by the *feeling* of older arena games such as ARC: instant controls, fast respawns, chaotic team fights, ricochets, projectiles, and large populations.

We may acknowledge ARC historically, but we do **not** copy or ship ARC source code, art, audio, maps, UI, logos, lore, characters, or other expressive material.

Reference: U.S. Copyright Office guidance states that game ideas/methods of play are not protected by copyright, while specific code, artwork, text, sound, and audiovisual expression can be.
- https://www.copyright.gov/register/tx-games.html

## Non-negotiable IP rules

1. No ripped or mystery assets in canonical releases.
2. Every external asset must be recorded in `docs/ASSET-PROVENANCE.md`.
3. No recreation of another game's logo, map, UI, ship, story, or character closely enough to create confusion.
4. Community/AI submissions must disclose source material, tools used, and rights/license.
5. The official game name/logo remain controlled separately from the source-code license.

## Current repo cleanup before promotion — done

All three previously-flagged ship assets have been replaced:
- `src/assets/models/ships/avrocar_vz-9-av_experimental_aircraft.glb`
- `src/assets/models/ships/cryptos_saucer.glb`
- `src/assets/models/ships/ufo.glb`

Each is now an original, self-modeled, CC0 asset with zero third-party provenance risk — see `docs/ASSET-PROVENANCE.md`'s "Replaced ship assets" table for the full record (creator, modifications, license, importer). The old unclear-provenance geometry is gone from the working tree entirely, not just undocumented. Marketing material is no longer restricted to the procedural/asset-independent ship rendering fallback on this basis (other launch gates in this document may still apply).

## License strategy

### Decision (September 2026)

**MIT is retained. This PR changes no license.**

AGPL-3.0 is revisited only when all four are true:
1. code ownership is verified across all contributors and AI-generated code;
2. CLA vs DCO is chosen and implemented;
3. an effective version/date for the switch is fixed;
4. an IP attorney review is completed.

Until then, treat AGPL as an option under consideration, not an adopted direction. If maximum adoption keeps mattering more than reciprocity, staying on MIT permanently is also defensible; the moat then comes from the official brand, servers, community, moderation, marketplace, and physical products rather than the license.

### Current reality

The repo is already MIT licensed. Existing MIT releases remain usable under MIT.

### Option under consideration (not adopted): AGPL-3.0

Preferred structure if the four conditions above are ever met:

- **AGPL-3.0** for future canonical game/server code
- separate trademark/brand policy
- explicit asset licenses
- contributor agreement before accepting substantial external contributions

Why AGPL: it is still open source and commercially usable, but modified network-hosted versions must offer corresponding source to users.

Reference:
- https://choosealicense.com/licenses/agpl-3.0/

## ARC acknowledgment

Safe positioning:

> Inspired by memories of classic large-scale arena games such as ARC: Attack Retrieve Capture.

Avoid:
- "ARC remake"
- "ARC 2"
- ARC in the product title
- implying endorsement or affiliation
- ARC artwork/screenshots/logo in marketing

## Name strategy

### Confirmed name: SaucerJam

SaucerJam is confirmed as the product's public name — no longer a shortlist candidate.

Initial screening found no strong exact collision across Steam, itch.io, GitHub, or indexed web results. That is **not formal trademark clearance**; the name is decided, but the clearance work below is still outstanding and is a separate risk (a third party could still hold rights to it).

Before trademark filing or broad commercial launch, complete:
- live USPTO exact + similar-mark search
- common-law/web search
- Steam / itch.io / app-store search
- GitHub search
- domain ownership
- social-handle ownership
- attorney review if monetization becomes material

Preferred brand language:
- **SaucerJam**
- **Join the Jam**
- **Jam Night**
- **Build a Saucer**
- **The Archive Opens**

### Legacy name (being retired)

**Quantum Drift** was the name the repo, package, deploy targets, and in-game title shipped under before the rename below was executed. It was not a rejected candidate — it was the outgoing name replaced by SaucerJam. Do not reintroduce it as a *new* public-facing name now that it's retired. The old code and history remain at `github.com/menezmethod/quantum-drift` (kept public until the new repo's deploy/CI is verified, then set private) for historical reference only — it is not the canonical repo.

### Rejected in preliminary search

Do not use without a new legal clearance:
- Shardwake
- Riftwake
- Voidwake
- Driftforge
- Orbline
- Vectorfall
- Fluxward
- Phasefront
- Corewake
- Hexwake
- Starweld

USPTO references:
- https://www.uspto.gov/trademarks/basics/why-search-similar-trademarks
- https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks

### Rename scope — done

The rename is complete. The repo name, `package.json` name, deploy targets/URLs, and in-game title/UI now read **SaucerJam**. The canonical repo is `github.com/menezmethod/saucerjam`, created fresh (single squashed initial commit, not a rename of the old repo) so the new license posture and brand start with a clean slate. The old repo (`github.com/menezmethod/quantum-drift`) stays public read-only until the new repo's deploy/CI is verified working, then is set private.

## AI-generated content

Keep provenance for generated music, art, code, models, and audio.

For Suno or similar tools, retain:
- generation date
- account/tier
- song/asset ID
- applicable commercial-use terms
- source/master when practical

Never prompt for direct replicas of another game's copyrighted character, logo, art, or named visual asset.

## Community governance

Community direction is advisory; maintainers protect the canonical build.

Flow:

`Idea -> Discussion -> RFC -> Prototype PR -> tests -> playable preview -> community feedback -> maintainer decision -> release`

Maintainers may reject proposals for:
- IP/license risk
- security or cheating
- poor scalability
- moderation/safety
- performance
- breaking the game's identity

Before broad contributor outreach, add:
- `CONTRIBUTING.md`
- Code of Conduct
- CLA/DCO decision
- PR template with provenance + AI disclosure
- `SECURITY.md`

## Monetization

Open source does not mean no business.

Good future revenue:
- official hosted servers
- cosmetics / ship skins
- supporter packs
- tournaments/events
- creator marketplace fee
- revenue share for community assets
- official 3D prints/collectibles
- commercial support/private deployment offerings

Avoid pay-to-win.

The durable moat is:
**official brand + canonical universe + community + hosted service + moderation + marketplace + physical goods.**

## Scale strategy

### Near-term engineering goal: 128 concurrent players

The next meaningful scale target is **128 real players in one coherent battle experience**.

We do not claim 128 until it is load-tested on production-like infrastructure and gameplay remains readable.

Progression:
`8 -> 32 -> 64 -> 128`

Focus areas:
- interest management / spatial culling
- compact state snapshots / deltas
- authoritative simulation performance
- projectile and collision cost
- bandwidth budgets per player
- browser render cost
- bot-driven load testing
- observability for tick time, snapshot size, latency, packet loss, and CPU

### Long-term north star: thousands

Thousands of players is a **future research goal**, not a launch promise.

We pursue it only when:
1. real player demand justifies the complexity;
2. 128-player battles are already fun and stable;
3. metrics show where the current architecture stops scaling.

Likely later solutions:
- spatial partitioning
- authoritative simulation cells
- server-to-server handoff
- regional/world shards that feel contiguous
- hierarchical interest management
- event-driven state replication

The architecture should earn complexity from demand instead of prematurely building an MMO backend for an empty game.

## What makes this game original

Not one isolated weapon or control scheme.

The identity should become:
- population-responsive expanding world
- large faction battles
- skill-based projectile combat
- community-proposed evolution
- AI agents as players and contributors
- community-created ships/lore/art
- digital creations that can become physical collectibles

The goal is **not prettier ARC**.

The goal is to preserve the feeling that made massive arena combat addictive, then build a new universe on top of it.
