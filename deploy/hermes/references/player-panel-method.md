# Decision method: the 100–1000 gamer panel

Use this for judgment calls that are **not** vote-gated: "should we build this",
"does this feel right", "what must not ship", positioning, pricing, first
impressions. Vote thresholds (see `deploy/hermes/preview-policy.json`) decide
"is this idea worth a day of my time"; this method decides "is our judgment
right".

## The move

Ask: **what would 100 gamers of all skills prefer?** If the call is
consequential or the population is large, widen to 1000.

Then answer it the way the panel would, which is not the way the loudest or
most-engaged players would.

## Segmentation (always run all four)

A panel of "gamers" is not one population. Report each segment separately:

| Segment | Share of panel | Who | What they optimize for |
| --- | --- | --- | --- |
| Casual | ~60 | play a few rounds when a link appears | does it work in 30 seconds, no account |
| Core | ~25 | play weekly, will learn a meta | depth, balance, match quality |
| Competitive | ~10 | want ranking, fair play, low latency | integrity, no pay-to-win, netcode |
| Content/creator | ~5 | will stream or post it | shareable moments, clip-ability |

A change that only pleases the Core and Competitive segments is a change that
optimizes for the people who already play — and loses the 60 who decide whether
the game has a population at all.

## Weighting

Record per segment: `n`, `prefer_yes`, `prefer_no`, `neutral`, and **why** in
their own words. Weight casual and core highest for anything upstream of the
first match; weight competitive highest for match integrity, never for
onboarding.

## Evidence the panel is already in

Public evidence is the panel's answers, recorded early. Triangulate before
deciding:

1. **Reviews** — recent Steam reviews of comparable arena/party games
   ("recent", not "overall": a live-service game's recent reviews are the
   current experience). Look for the top *complaints*, which are the panel
   telling you what it will not forgive.
2. **Retention signals** — Steam Charts / peak-player curves for comparables.
   A game that spikes at launch then flatlines usually had a first-impression
   problem, not a content problem.
3. **Comparable titles** — our neighbours are free instant-play browser/mobile
   arena games: *Battle Brawls*-style pick-up fights, .io arena games, Krunker,
   Slither-style instant-play arenas. What they all do that we don't is a
   candidate; what the market punished them for is a hard constraint.
4. **Their patch notes and community threads** — the complaints people repeated
   after a change are the cheapest simulation of a panel you will ever get.

State which of these you checked. "I did not check" is an acceptable answer;
"I assumed" is not.

## Rules

- **Never** substitute the panel's judgment for the user's explicit decision.
  This method informs a recommendation; it does not overrule the owner.
- **Never** fabricate panel data. If there is no survey and no comparable
  evidence, say so and mark the answer a prior, not a measurement.
- **First impressions are a spent resource.** Where the panel is split, prefer
  the option that protects the first 30 seconds for the casual 60.
- **Say when the panel would disagree with the user.** Agreement by default is
  useless.

## Output format

1. Panel answer (one line).
2. Segment split with n's.
3. Evidence checked (names, dates, numbers) or "none available — this is a prior".
4. Recommendation, and the one thing that would change your mind.
