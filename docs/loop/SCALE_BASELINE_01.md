# Scale baseline 01

Command: `node scripts/verification/scale.cjs` on 2026-09-17.

| Pilots | Spawn ms | One simulated second ms | Full snapshot bytes |
| ---: | ---: | ---: | ---: |
| 8 | 7.81 | 1.82 | 2,945 |
| 32 | 27.46 | 2.78 | 11,270 |
| 64 | 56.03 | 4.77 | 22,372 |
| 128 | 199.96 | 9.05 | 44,652 |

The authoritative simulation can retain finite 128-player state for one simulated second, but this is **not** a 128-player server pass. Admission still limits rooms to eight pilots, each client receives a full snapshot at 20 Hz, and the benchmark is idle local simulation.

At 128 pilots, full-state replication is roughly 893 KB/s per recipient before Socket.IO framing, projectiles, events, or packet loss. The current next packet is recipient-specific spatial snapshots; capacity is not raised first.

## Idle socket replication 01

Command: `node scripts/verification/scale-server.cjs`. One local Socket.IO client was sampled for 300 ms while 8/32/64/128 idle clients joined a staging-configured 128-pilot room. This is a local sample, not a capacity pass.

| Pilots | Mean snapshot bytes | Mean visible pilots |
| ---: | ---: | ---: |
| 8 | 906 | 2 |
| 32 | 3,571 | 10 |
| 64 | 7,289 | 21 |
| 128 | 17,063 | 50 |

Recipient snapshots now retain the local pilot, nearby combat, and the local canonical identity only; they remove server-only fire/damage timing and other pilots' stable IDs. At 128 this is a 62% raw-state reduction from 44,652 bytes, but still about 341 KB/s per sampled recipient at 20 Hz before events. No public cap was raised.

The re-critic found the next integrity gap: combat events and round recaps are still room-wide, and AOI-filtered state would undercount pilots in the HUD. Scope location-bearing events and public recaps before any active 128-pilot load test.

## Independent critic triage

- Architecture: the eight-pilot room limit, 96-connection deployment cap, full-state broadcast, projectile/player all-pairs checks, and superlinear spawn search block a credible 128-player claim.
- Gameplay: Confluence is connected but still FFA; teams, flags, portals, pickups, and objective state are concept-only. A portal follows, but only after the zone contract.
- UX: touch instructions falsely imply that any first touch fires; weapon choices become unlabeled icon buttons on touch.

Real-player/community feedback reinforced the order: make movement/control roles explicit, use map-control incentives so players cannot safely orbit an edge forever, and greybox/rebalance route decisions before ornate art. Sources: [Feedback Friday](https://www.reddit.com/r/gamedev/comments/ln6ird/feedback_friday_432_new_functions/), [Shooter map control](https://www.reddit.com/r/gamedesign/comments/u64epc/shooter_design_map_control/), [multiplayer level-design discussion](https://www.reddit.com/r/gamedev/comments/vl1luz/need_fps_level_design_documentations_to_learn/).

## Guardrails for the next packet

- Preserve server-authoritative input/simulation and shared collision map data.
- Do not raise the public room cap or promise 128 support before a recipient-specific snapshot test and a live socket measurement.
- Keep one Confluence zone in-process. No sharding, database, cross-zone transfer, teams, flags, or pickup system in this packet.
