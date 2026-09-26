# Marketplace and community creation terms

> **Draft, and deferred scope.** The marketplace is a later product phase, not current
> functionality — see [`concepts/confluence-v2/SPACESHIP_MARKETPLACE_PLAN.md`](concepts/confluence-v2/SPACESHIP_MARKETPLACE_PLAN.md).
> Nothing here is active, no uploads are accepted, and no payments flow. This file
> records the intended shape of the terms so the code, the provenance ledger and the
> legal review can be built to match. Not legal advice.

## 1. Creators keep their work

If you create a ship chassis, skin, decal, or other catalogue item and it is accepted into
the SaucerJam marketplace:

- **You own it.** No copyright in your creation is assigned to the project, and the
  project does not become its author.
- **You license it to the project** under §2, so the project can actually display and
  distribute it. That licence is the whole basis of the arrangement.
- **You keep the right to publish it elsewhere**, unless you separately agree otherwise for
  an exclusive launch item.

## 2. The licence you grant the project

By submitting a creation, you grant SaucerJam a **worldwide, non-exclusive, royalty-free
(unless a separate written revenue-share agreement says otherwise), sublicensable licence**
to:

1. **host, store, cache and serve** the creation from project-operated storage and CDNs;
2. **display it in-game**, in marketplaces, catalogues, previews and thumbnails, to any
   player who has access to it;
3. **transmit it to clients** so players who own or preview it can load it — this includes
   copies resident in browser caches and local storage;
4. **adapt it technically** as required to operate: format conversion, compression, LOD
   generation, texture atlas packing, thumbnail rendering, scaling and mirroring;
5. **promote the game** using screenshots, renders or clips that incidentally feature it;
6. **detect, review and enforce**: scan for malicious content, moderate it, and remove it.

The licence ends when you or the project removes the item from the marketplace, **except**
for copies already distributed to players, already cached, and already used in published
promotional material. Those do not have to be clawed back.

The licence does **not** include: the right to sell your creation as a standalone
product outside SaucerJam, the right to sublicense it to another game, or the right to
register it as a trademark. If the project ever wants any of those, it asks.

## 3. What the license does not cover

- **The SaucerJam mark.** Marketplace listings carry the mark; that stays the project's
  ([`../TRADEMARK.md`](../TRADEMARK.md)).
- **Your identity as a creator.** You are credited as the creator of what you upload.
- **Platform fees.** Any split, fee or revenue share is a separate commercial term,
  documented and agreed separately before it applies. Mockups, renders or plans in this
  repository that show a percentage split are placeholders, not offers.
- **Physical goods.** 3D-printable output and merchandise are a separate decision with
  separate rights — if a creation is ever offered as a physical print, that needs its own
  written terms, because the print licence and the in-game licence are different grants.

## 4. What may be uploaded

Deliberately narrow for the first version:

- **Cosmetic chassis and colour/material variants** built against the validated hardpoint
  contract and the fixed collision envelope.
- Nothing that changes gameplay: no scripts, no executables, no weapons, no hitboxes, no
  physics data, no stats, no economy items.
- Nothing you do not own or have not licensed: no ripped, traced, scraped or
  unclear-provenance material. The rule from
  [`ASSET-PROVENANCE.md`](ASSET-PROVENANCE.md) applies unchanged:
  **no provenance = no acceptance.**
- Nothing that recreates another game's character, logo, ship or art closely enough to
  confuse. See [`PUBLIC-LAUNCH-FOUNDATION.md`](PUBLIC-LAUNCH-FOUNDATION.md)
  §Non-negotiable IP rules.
- **AI-generated uploads must be disclosed** — tool, version, date, and any source or
  reference material supplied. Disclosed AI work may be accepted; undisclosed AI work is a
  removal and a strike, because it is a provenance failure, not an aesthetic one.

## 5. Moderation and removal

The project may reject, hide, restrict or remove any creation at any time, with or without
reason, but in practice for: provenance failure, IP complaint, malicious content,
performance cost, technical non-compliance with the hardpoint contract, or content that
breaks the Code of Conduct.

Creators are expected to respond to a provenance challenge. Failure to do so means the item
comes down until it is answered.

## 6. Copyright complaints

If you believe a marketplace item infringes your rights, report it through a GitHub
security advisory (for anything private or exploitable) or open a Discussion for a public
provenance dispute — see [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Reporting. The project
will remove the item pending resolution rather than argue about it while it stays live.
A formal designated-agent process for takedown notices is required before the marketplace
opens to payments. **[OPEN — see [`LEGAL-REVIEW.md`](./LEGAL-REVIEW.md).]**

## 7. Prerequisites before this file becomes active

From the marketplace plan, plus the licensing work:

- [ ] an attorney-reviewed version of these terms;
- [ ] the CLA signing flow live ([`../CLA.md`](../CLA.md)) so creator grants are recorded;
- [ ] provenance validation and malicious-upload scanning in the pipeline;
- [ ] moderation, appeal and takedown processes, with a designated agent;
- [ ] storage, CDN, and download limits costed;
- [ ] payments, tax, refunds and any revenue share designed and tested;
- [ ] the pricing and split placeholders in concept material replaced with real terms.
