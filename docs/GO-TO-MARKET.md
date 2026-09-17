# SaucerJam — Go-To-Market, Community, and Monetization

> Last reviewed: September 2026.

## Positioning

Core story:

> SaucerJam is a free browser arena game inspired by the lost feeling of early online multiplayer, shaped openly by its players.

Primary CTA:

> **Join the Jam.**

Do not lead with "AI-made game."

Lead with:
- instant browser play
- fast saucer battles
- skill-based weapons
- evolving world
- community-driven evolution

AI is an enabling layer, not the value proposition.

## Marketing pillars

### 1. Lost-game nostalgia

Story:

> I spent years remembering a multiplayer game from childhood that I could never find. It turned out to be ARC. Instead of remaking it, we're building what that feeling could become today.

### 2. UAP / disclosure zeitgeist

Use current UAP interest as **theme**, not factual endorsement.

Good:
- retro saucers
- classified-program aesthetic
- infrared/sensor-inspired UI
- "unknown craft" seasonal skins
- redacted lore drops
- "declassified" dev updates
- playful phrases like "unidentified playable object"

Avoid:
- claiming government confirmation of aliens
- presenting rumors as facts
- using actual agency seals/logos
- suggesting endorsement by DoD/AARO
- copying official documents closely enough to imply authenticity

Reference (context only, not an asset source — do not reuse AARO imagery, seals, or document formatting):
- https://www.aaro.mil/UAP-Cases/Official-UAP-Imagery/

Campaign:
**THE ARCHIVE OPENS**

Fictional telemetry, craft schematics, sightings, community-created vehicles, and limited events. Every "declassified"/redacted-style drop must carry an explicit fiction label (e.g. "fictional in-game lore" in the post or asset itself) so it cannot be mistaken for a real government document.

### 3. Open evolution

Tagline territory:
- **Join the Jam.**
- **Play it. Fork it. Evolve it.**
- **Build a Saucer. Enter the Jam.**

Community ideas become prototypes; prototypes become temporary servers; proven ideas can become canonical.

### 4. Scale as an event

**Later target: 128 concurrent players. First prove a small public Jam Night.**

Public milestones:
- 32-player test
- 64-player Jam Night
- 128-player **Big Jam**

Do not market "thousands" as current capability.

Thousands becomes the next research direction **only after 128 is stable and real demand exists**.

Every scale milestone should generate:
- a playable event
- engineering measurements
- gameplay feedback
- a public devlog/story

## Player acquisition

Initial channels after the public play URL passes the [hosting checks](HOSTING.md):
1. playable website first — no install
2. itch.io browser release
3. GitHub
4. Show HN when the engineering story is strong
5. game-dev communities
6. relevant Reddit communities without spamming
7. Discord once activity can sustain it
8. LinkedIn for the engineering/portfolio story

The first CTA is **PLAY / JOIN THE JAM**, not "read the repo."

## Cold-start solution

An empty multiplayer game feels dead.

Use:
- bots for immediate action
- scheduled Jam Nights
- one public arena initially
- a clearly posted next event time
- easy invite links
- population-gated world expansion so low concurrency still feels dense

## Community model

Use GitHub Discussions first.

Suggested categories:
- Ideas
- Balance
- Ships & Art
- AI Agents
- Lore
- Performance / Scale
- Playtest Feedback

Popular ideas can graduate into RFCs and experimental builds.

## AI-agent angle

Long-term differentiator:
- agents can play through a supported interface
- agents can build experimental changes through branches/PRs
- agent-created changes never auto-merge
- community can play experimental versions
- maintainers decide canonical adoption

Possible events:
- Human vs Agent Jam
- autonomous pilot tournament
- best ricochet bot
- community-agent co-design challenge

## Monetization sequence

Do not monetize aggressively before people care.

### Phase 1 — audience
Free game, contributors, public Jam Nights.

### Phase 2 — identity
Cosmetics, supporter badges/packs, optional founder items.

### Phase 3 — creators
Community ships, skins, lore packs, marketplace revenue share.

### Phase 4 — physical
Approved 3D-printable saucers and collectibles.

### Phase 5 — platform
Official hosted worlds, tournaments, private/community servers, commercial support.

No pay-to-win.

## Community sentiment / AI backlash

Some communities will dislike AI-generated content. Do not argue with them.

Policy:
- disclose AI use
- value human contributors
- keep provenance
- reward good work regardless of tool
- judge submissions by originality, legality, performance, and player value
- never imply AI makes artists unnecessary

Message:

> **Tools are open. Standards are high.**

## First public playtest

Run a 6–8-person private rehearsal with first-time players, then a scheduled public Jam Night within measured host capacity. Share short gameplay clips and direct invitations with one link to play. After each event, post the main finding and the next date.

Track counts as well as rates: successful joins, time from page load to play, round completion, active second-round play, next-event return, invites that lead to joins, and fatal errors/disconnects. A round auto-restarts, so count replay only when a player stays active in the next round. Use this data to choose the next fix.

Before broad promotion:

- [ ] SaucerJam passes final live trademark/domain/handle clearance
- [ ] questionable assets are replaced/documented
- [ ] licensing decision recorded (MIT retained; revisit conditions met and attorney-reviewed before any change — see `docs/PUBLIC-LAUNCH-FOUNDATION.md`)
- [ ] contributor terms exist
- [ ] official play URL works with near-zero friction
- [ ] two real remote clients complete a round and saved results survive restart
- [ ] bots solve the empty-server problem
- [ ] basic moderation/reporting exists
- [ ] analytics measure joins, retention, match completion, and invites
- [ ] first event attendance stays within capacity measured on the actual host
- [ ] private rehearsal shows newcomers can enter combat without coaching

Measure 64-player capacity before claiming it, and test 128 players before promoting the Big Jam.

## North-star sentence

> Build the arena game we remember wanting: instant to enter, chaotic at scale, endlessly replayable, and able to evolve with the people who play it.
