# Agent pilots (RFC)

Status: prototype. Intent/reflex split, Tier-0 pilot, and the Jev brain ship in
this branch. The Agent Gateway is designed here but not built yet.

## Why this is not "drop an LLM into the game loop"

SaucerJam is a 60 Hz, server-authoritative simulation. Only inputs cross the
trust boundary (`shared/simulation.js` → `sanitizeInput`); clients never send
positions, health, or damage. A model round-trip is hundreds of milliseconds, so
a network brain cannot be a per-tick controller. Any design that calls a model
inside `step()` fails.

Jev makes the constraint sharper, not softer. Jev is a System One decision
model: you send structured `state` plus typed `questions` and get typed answers
with probabilities and confidence. It is fast and cheap and decidable in code,
but it makes atomic gut-check judgments, not multi-step plans. It is a bad text
LLM and a good tactician.

## The split: intent vs reflex

Every pilot has two halves.

| Layer | Runs at | Owns | Code |
| --- | --- | --- | --- |
| Reflex | every tick (60 Hz) | navigation, LOS pathing, aim lead, fire gating | `shared/brains.js` `reflexInput` |
| Intent | 0.5–4 Hz, event-triggered | target, stance, range band, weapon, aggression | `sanitizeIntent` + a brain |

A brain writes the latest intent; the reflex layer executes it. The simulation
never awaits a brain, exactly like a network input: last write wins. With no
intent, `reflexInput` reproduces the original heuristic bot byte-for-byte, so
existing bots and tests are unchanged.

Intent is untrusted input. `sanitizeIntent` drops unknown fields and clamps
numbers, so a malformed Jev answer or a hostile agent degrades to the heuristic
default instead of steering the ship with garbage.

## Tier 0: an agent that joins as a player (available now)

`scripts/agents/pilot.cjs` connects over the same Socket.IO interface a browser
uses, joins a room, reads the AOI-limited `snapshotFor()` view (it can never see
more than a human), and emits sanitized inputs. No server changes are required.

```sh
npm run agent:pilot -- --url http://localhost:8080 --name Hal --seconds 90
npm run agent:pilot -- --code ABC123 --name Hal
npm run agent:pilot -- --create --name Hal
```

The control policy (`scripts/agents/policy.cjs`) is deliberately simple and
deterministic: pick the nearest unshielded enemy, hold a firing band and orbit,
lead the target, retreat and regenerate under low hull, grab pickups. It is the
reference for "an agent that plays".

## Tier 1: Jev as the intent layer

`server/agents/jev.js` builds a compact tactical `state`, asks several atomic
questions in one request, and composes the typed answers into intent in code.

State (the model never sees wire snapshots or map geometry):

```json
{
  "self": { "hull": 62, "energy": 38, "weapon": "LASER", "district": "core", "under_fire": true },
  "enemies": [
    { "id": "e1", "range_band": "mid", "metres": 11, "hull": 100, "closing": 0.8, "angle": "front", "visible": true }
  ],
  "objective": { "mode": "deathmatch", "my_kills": 4, "leader_kills": 7, "frag_limit": 20, "seconds_left": 96 },
  "recent": { "hull_lost": 38, "last_damage_seconds_ago": 1 }
}
```

Questions (one call, mixed types):

| id | type | drives |
| --- | --- | --- |
| `stance` | choice | `press` / `trade` / `disengage` / `reposition` / `heal` |
| `desired_range` | score | the range band the pilot tries to hold |
| `weapon` | choice | LASER / GRENADE / BOUNCE (code vetoes on energy) |
| `focus_<id>` | score (per enemy) | re-ranking: score all candidates, pick `argmax` in code |
| `trapped` | noul | overrides an aggressive stance to `reposition` |

Rules baked into `composeIntent`:

- Confidence gates every field. A shaky answer leaves that field to the
  heuristic instead of acting on it.
- `focus_*` scores are the TypeSafe re-ranking pattern: score every candidate
  together, choose in code.
- Personas are weights and thresholds in code, not prompts. `press` maps to
  aggression 1.0, `heal` to 0.2, and so on.

Execution rules:

- Triggered by a timer, never by `step()`. `JevRunner` never overlaps a
  player's in-flight request; a slow or failed call leaves the previous intent
  in place so the pilot keeps playing on the last good decision.
- Low confidence, timeouts, `429`, and `529` fall back to the heuristic. The
  client retries `429`/`529` with backoff and fails fast on other `4xx`.
- Server-side only. The API key never reaches the browser.

Enable it:

```sh
TYPESAFE_API_KEY=... JEV_BOTS=true npm start
# optional: JEV_BOT_INTERVAL_MS=600
```

Without a key, or with `JEV_BOTS` unset, the server behaves exactly as before.

## Hybrid policy: agents expand, records stay separate

Decision: agent pilots count toward world population but not human records.

- `pilotClass` is `human`, `bot`, or `agent` (`addPlayer` options). `bot`
  remains a derived flag for existing bot-fill and snapshot paths.
- Agents are `bot: false`, so Confluence opens territory for them exactly like
  humans. Bots never expand the map; that rule is unchanged.
- At round end the server splits players into two ledgers: the human
  `RankingStore` (`!bot && pilotClass !== "agent"`) and a separate agent
  `RankingStore`. The winner only scores in the ledger that contains them.
- `GET /api/leaderboard?class=agent` reads the agent ledger; anything else is
  human.

Enabling agents:

```sh
AGENT_PILOTS=true npm start
# optional: AGENT_RANKINGS_FILE=server/data/agent-rankings.json
```

With `AGENT_PILOTS` unset, `agent: true` on a join request is ignored and the
pilot is classed human. The flag is a prototype gate; the gateway replaces it
with real credentials.

## Tier 2: the Agent Gateway

The supported interface for third-party agents. A thin HTTP facade over the
existing room and input path, with a decision-ready digest instead of the raw
wire snapshot. This is what lets a slow model play: it makes a few coarse
decisions per second and the server's reflex layer fills in the 60 Hz control.

```
POST   /agent/v1/sessions             -> { playerId, sessionId, sessionToken, roomCode, observation }
GET    /agent/v1/sessions/:id/observe -> { tick, time, self, enemies[], objective, recent, alive, intent_age_ms }
POST   /agent/v1/sessions/:id/act     -> { accepted, applied, tick }
DELETE /agent/v1/sessions/:id         -> { ok }
GET    /agent/v1/status               -> { enabled, sessions, rooms }
```

Every route requires `Authorization: Bearer <AGENT_GATEWAY_TOKEN>`. Each
session additionally carries `x-agent-session: <sessionId>:<sessionToken>`, so
one operator token can host several agents without them acting as each other.

`action` accepts two modes:

- `{ type: "intent", intent: { targetId, stance, desiredRange, weapon, aggression } }`
  — a slow LLM's decision. The server's reflex layer executes it every tick.
- `{ type: "input", input: { seq, move, aim, fire, weapon } }` — direct control
  for a programmatic bot. `seq` must increase; stale packets are rejected.

Enable it:

```sh
AGENT_PILOTS=true AGENT_GATEWAY_TOKEN=<operator-token> npm start
# optional: MAX_AGENTS_PER_ROOM=4
```

An agent is **never** counted as a human: it lives in `room.agents`, not
`room.humans`, so bot fill, room capacity, the public online count, and
map-expansion population all stay human-only. It does receive the same
authoritative snapshots a browser does.

### Scoring harness

`npm run agent:score` measures whether an agent is actually any good, instead of
assuming it. It opens a room with heuristic bots, seats one agent, drives it,
and reports the authoritative outcome.

```sh
AGENT_GATEWAY_TOKEN=... npm run agent:score -- --url http://localhost:8080 --driver intent --runs 4 --seconds 20
```

A reference result from the scripted intent driver (5 decisions/second) against
three heuristic bots:

| run | kills | deaths | damage | accuracy |
| --- | --- | --- | --- | --- |
| 1 | 2 | 1 | 190 | 60% |
| 2 | 0 | 1 | 168 | 47% |
| 3 | 0 | 2 | 120 | 50% |
| 4 | 1 | 2 | 148 | 70% |

### Driving with Jev

The `jev` driver sends the observation to the real TypeSafe API and plays the
composed intent. The API key stays in the harness process; only the intent
crosses to the game server.

```sh
TYPESAFE_API_KEY=... AGENT_GATEWAY_TOKEN=... \
  npm run agent:score -- --url https://<preview> --driver jev --runs 3 --seconds 25 --hz 2
```

Measured against three heuristic bots, 2 decisions/second:

| run | kills | deaths | damage | accuracy | jev calls | avg latency | gated out | failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 1 | 264 | 46% | 28 | 217 ms | 0 | 0 |
| 2 | 0 | 1 | 96 | 25% | 28 | 223 ms | 0 | 0 |
| 3 | 1 | 0 | 210 | 50% | 32 | 199 ms | 0 | 0 |

Notes from that run:

- ~213 ms per full tactical request (state plus all questions), so Jev can decide
  roughly 2–4 times per second. This is why intent is asynchronous: a model
  round-trip is fast, but still 13 times slower than a 60 Hz tick.
- `gated out` counts answers whose confidence fell below `--min-confidence`. It
  was 0, meaning every Jev answer was confident enough to act on. A run where
  this climbs is Jev silently degrading to the heuristic, which the outcome
  alone would not reveal.
- `failures` counts transport errors. Retries are handled by the client.

The `policy` driver is the deterministic Tier-0 baseline, `intent` is a scripted
slow decision sequence, and `jev` is the real model. Comparing them on the same
room and duration tells you whether a question or threshold change actually
helped.

Non-goals: agents as authoritative state writers, model calls on the tick loop,
or secrets in the browser.

## Files

- `shared/brains.js` — `reflexInput`, `sanitizeIntent`, `chooseTarget`.
- `shared/simulation.js` — `pilotClass`, `intent`, `botInput` delegates to reflex.
- `server/agents/jev.js` — state builder, question set, answer composer, client,
  brain, runner.
- `scripts/agents/policy.cjs`, `scripts/agents/pilot.cjs` — Tier-0 pilot.
- `scripts/agents/score.cjs` — scoring harness (`policy`, `intent`, `jev` drivers).
- `tests/agents.test.js`, `tests/docker-image.test.js` — all of the above, offline.

## Verification

```sh
npm test                              # includes tests/agents.test.js
npm run agent:pilot -- --create       # run against a local server
```

Local smoke: start the server, run the Tier-0 pilot with `--create`, and confirm
it joins, moves, fires, and appears on the scoreboard.

## Enabling the gateway on a preview

The gateway needs two environment variables. Set them preview-scoped so
production is unaffected:

```sh
AGENT_PILOTS=true
AGENT_GATEWAY_TOKEN=<operator-token>
```

`MAX_AGENTS_PER_ROOM` (default 4) caps concurrent agents in one room. The
operator token authorizes session creation; each session then uses its own
`x-agent-session` token, so agents cannot act as one another.

## Cost control

Jev spends the operator's API credit per decision, so it is never left running
by default:

- The preview environment carries no `TYPESAFE_API_KEY` and no `JEV_BOTS`, so no
  container spends credit between sessions.
- To try it, set both preview-scoped, play, then remove them and redeploy. Env
  changes only take effect on a new deploy.
- `JEV_BOT_MAX_PER_MINUTE` is a hard server-wide ceiling; bots keep playing their
  last intent when it is spent.
