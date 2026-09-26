# Astra Execution Prompt — SaucerJam Adaptive Flight

Use this prompt with Astra or another autonomous coding agent.

## Mission

Implement the complete SaucerJam accessibility architecture described in:

`docs/ACCESSIBILITY-PLAN.md`

Repository:

`menezmethod/saucerjam`

Working branch:

`accessibility/adaptive-flight`

Do not modify `main` directly.

The objective is not to add a cosmetic accessibility menu. Build a multimodal gameplay architecture so players with visual, hearing, motor, cognitive, motion-sensitivity, and combined access needs can play the same core SaucerJam game through different input and feedback channels.

## Read before writing code

Before implementation, inspect at minimum:

```
docs/ACCESSIBILITY-PLAN.md
docs/ux-audit/REPORT.md
docs/COMBAT-FIRST-PLAN.md
docs/STATUS.json
src/index.js
src/index.html
src/styles/main.css
src/input/stick.js
src/input/client.test.mjs
src/interface/Interface.js
src/interface/INTEGRATION.md
src/audio/MusicBus.js
src/view/CameraRig.js
src/view/ShipIndicators.js
src/view/ThreatArrows.js
src/core/ArenaRenderer.js
src/core/CombatFX.js
shared/simulation.js
tests/
```

Inspect current package scripts and existing browser verification harnesses before inventing new tooling.

## Existing capabilities that must be preserved

The current game already includes:
- server-authoritative combat
- keyboard movement
- keyboard-only IJKL aim
- Space fire
- mouse aim/fire
- touch/pen twin-role input
- pointer capture recovery
- screen-reader status narration
- threat arrows
- haptics
- reduced-motion handling
- accessible lobby and modal controls
- auth
- practice
- multiplayer
- reconnect
- weapon selection
- camera/view controls
- existing test and browser verification coverage

Do not regress any of these.

## Core architectural invariants

### A. One fact, many senses

Gameplay-critical facts must be represented semantically before presentation.

Create or equivalent:

`AccessibilityEventBus`

It should normalize information like:
- threat proximity/direction
- projectile danger
- damage direction
- target state
- hull/energy state
- weapon readiness
- pickups
- portals
- boundaries/obstacles
- hit/elimination/death
- respawn
- round end

Presentation adapters subscribe to these facts.

The simulation must not depend on presentation adapters.

### B. Semantic actions, not device keys

Create or equivalent:

`ActionInput`

It should normalize:
- move X/Y
- aim X/Y
- fire
- target navigation
- weapon navigation
- sonar
- menu/scores/chat

Keyboard, mouse, touch, pen, Gamepad API, switch-style controls, and future accessibility devices should feed the same semantic actions.

The final legal network/simulation packet remains authoritative movement/aim/fire/weapon unless an explicitly reviewed mechanic-changing assist requires more.

### C. Combinable capability profiles

Create a versioned accessibility settings/profile system.

Do not model diagnoses.

Settings should independently cover:
- visual clarity
- hearing alternatives
- nonvisual play
- motor/input
- cognitive/focus
- motion/photosensitivity
- haptics

Profiles must combine rather than exclude one another.

## Required implementation stages

Implement in bounded stages and keep the branch working after each stage.

### Stage A — Foundation

Build:
- accessibility settings schema
- migration/versioning
- local persistence
- accessibility settings UI
- `AccessibilityEventBus`
- semantic `ActionInput`
- adapter interfaces
- default behavior identical to current SaucerJam

Verification:
- existing keyboard/mouse/touch tests pass
- existing multiplayer/simulation tests pass
- no change to default mechanics
- settings UI fully keyboard usable
- profile combinations persist

Commit when green.

### Stage B — Motor and input

Build:
- complete remapping
- Gamepad API source
- hold/toggle fire
- sticky movement
- sensitivity/dead-zone controls
- one-hand presets
- target next/previous/nearest
- tremor debounce / accidental-repeat filtering
- sequential control mode
- switch-scanning foundation
- touch control sizing/placement settings where practical

Do not invent autonomous gameplay.

Verification:
- pointer-free practice flow
- one-hand flow
- controller connect/disconnect
- blur/focus/orientation cleanup
- no stuck inputs
- reconnect safety

Commit when green.

### Stage C — Visual and hearing

Build:
- Tactical Contrast
- HUD scale
- text scale
- reticle scale/thickness/shape/color where practical
- world-detail/de-emphasis controls
- enemy/projectile semantic outlines
- shape/pattern alternatives to color
- directional captions
- Visual Sound Radar
- semantic haptic patterns
- high-contrast / forced-colors-friendly DOM behavior

Critical sounds must have visual equivalents.

Critical visual-only state must have another usable channel.

Verification:
- 200% zoom/reflow
- forced-colors/high contrast
- no color-only critical signals
- no sound-only critical signals
- touch HUD remains collision-free

Commit when green.

### Stage D — Blind Flight

Build:
- spatial threat audio
- target selection narration
- target direction/distance
- sonar
- pickup/portal beacons
- boundary/obstacle warnings
- structured screen-reader battle model
- bounded navigation assistance
- audio prioritization so combat does not become noise

Blind Flight must use authoritative/visible game state only; do not reveal hidden information.

Primary acceptance goal:

With the canvas visually hidden, a skilled player should be able to:
1. spawn
2. orient
3. identify/acquire a target
4. move
5. fire
6. understand damage
7. understand weapon/energy state
8. die
9. understand respawn
10. continue and finish a practice round

Automated tests can verify semantic outputs; document that real blind-player validation is still required before claiming broad blind accessibility.

Commit when green.

### Stage E — Cognitive and motion

Build:
- Focus Flight simplified HUD
- reduced decorative noise
- replayable instructions
- deterministic contextual coach
- Calm Arena
- explicit reduced-motion setting overriding/following system preference
- camera damping setting
- screen-shake setting
- particle/effect density
- flash intensity
- idle/world animation controls

Coach must explain game rules and player state, not secretly alter difficulty.

Verification:
- reduced-motion covers CSS, camera, WebGL idle animation, particles/effects where applicable
- critical information remains present in Focus Flight
- default visual experience remains unchanged

Commit when green.

### Stage F — Accessibility Gauntlet

Extend the existing verification philosophy rather than creating unmaintainable tests.

Create automated coverage for:
- keyboard-only
- pointer-free
- touch-only
- gamepad
- one-hand preset
- remapping
- hold/toggle
- switch/sequential mode
- tremor debounce
- reduced motion
- high contrast / forced colors
- 200% zoom
- screen-reader semantic state
- directional captions
- accessibility event coverage
- stale/stuck input fuzz cases
- profile persistence and migration
- multiplayer simulation invariants

Add a semantic coverage test asserting that every gameplay-critical event defined by the accessibility contract has at least two configured presentation channels or an explicitly documented exception.

Document a human testing protocol for:
- blind / screen-reader users
- low-vision users
- deaf/hard-of-hearing users
- motor-impaired users
- photosensitive/motion-sensitive users
- cognitive/accessibility testing

Do not fabricate human validation.

## Design expectations

### Accessibility UI

Add an obvious Accessibility entry:
- lobby / first-run path
- Flight menu
- keyboard reachable

Suggested first-run language:

“How do you want to play?”

Options may include:
- clearer visuals
- no sound dependence
- no vision dependence
- limited controls / one hand
- calmer motion
- fewer distractions
- customize

Do not ask users to choose a diagnosis.

### Adaptive Flight calibration

If calibration is implemented, keep it optional and short.

Possible checks:
- movement
- aiming
- hold/toggle comfort
- visual distinction
- directional audio distinction
- UI/text size
- motion comfort

Recommend settings from explicit responses only.

Do not infer medical conditions.

### Public multiplayer fairness

Presentation/input-equivalence features may remain normal gameplay.

Mechanics-changing assists require explicit review and bounded rules.

Never send or expose:
- disability labels
- diagnosis
- profile names implying medical state
- assistive-tech fingerprints

If server validation needs a mechanic parameter, send only the parameter.

### Privacy

Accessibility should work without telemetry.

If telemetry exists, use only coarse feature-level events such as:
- accessibility panel opened
- profile activated
- onboarding completed

Do not transmit diagnosis-style information.

## Coding constraints

- Prefer new modules over enlarging `src/index.js`.
- Keep pure calculations outside DOM code when practical.
- Make action mapping and accessibility-event generation unit-testable.
- Keep client presentation separate from server authority.
- Preserve current input packet contract where possible.
- Do not weaken stale-input protection.
- Clear transient accessibility input state on blur, visibility change, orientation change, modal open/close, death, reconnect, and controller disconnect where appropriate.
- Avoid noisy live regions.
- Never update a screen-reader live region every frame.
- Avoid excessive synthetic speech.
- Prefer learnable earcons for frequently repeated information.
- Respect audio mixing so accessibility cues remain audible without destroying game audio.
- Accessibility output must not tank performance on lower-end devices.
- Default settings must preserve the existing SaucerJam feel.

## Evidence discipline

For every stage:
1. inspect before changing
2. implement
3. run targeted unit tests
4. run relevant existing suites
5. run browser verification when UI/input/rendering changes
6. record exact failures honestly
7. fix regressions
8. add/update documentation
9. commit a coherent green stage

Do not claim:
- “fully accessible”
- “WCAG compliant”
- “blind accessible”
- “supports all disabilities”

unless the evidence actually supports the claim.

Prefer:
- “implemented”
- “automated verification passes”
- “human validation pending”
- explicit known limitations

## Documentation updates

Keep current:
- `docs/ACCESSIBILITY-PLAN.md`
- `docs/STATUS.json`
- README accessibility/control documentation
- help/onboarding copy
- integration docs for changed input/interface contracts

Create an accessibility implementation status section that tracks:
- complete
- partially complete
- blocked
- needs human validation

## Git behavior

Work only on:
`accessibility/adaptive-flight`

or descendant branches explicitly created for stages.

Do not push to `main`.

Commit each green stage separately with clear messages.

Do not create a PR until the branch has at least Foundation implemented and tested unless explicitly asked.

Do not merge.

## Final deliverable

At the end of the full run, provide:

1. concise architecture summary
2. files added/changed
3. stage-by-stage status
4. exact tests run and results
5. browser/evidence paths
6. known limitations
7. human validation still required
8. commit SHAs
9. recommended next review
10. whether the branch is ready for a human accessibility test pass

The finish line is not the number of settings.

The finish line is one SaucerJam whose critical information and controls can be translated across visual, auditory, haptic, textual, and reduced-input channels while preserving authoritative competitive gameplay.

---

# One-line implementation prompt

Paste this into Astra after checking out the branch:

```
Read docs/ACCESSIBILITY-PLAN.md and docs/ACCESSIBILITY-ASTRA-PROMPT.md, inspect the current SaucerJam architecture and tests, then implement the entire Adaptive Flight accessibility plan on accessibility/adaptive-flight stage-by-stage (Foundation → Motor/Input → Visual/Hearing → Blind Flight → Cognitive/Motion → Accessibility Gauntlet), preserving server authority and current default behavior, running and fixing all relevant tests/browser verification after each stage, committing each green stage separately, documenting evidence/limitations honestly, never touching or merging main, and continue autonomously until every implementable acceptance criterion in the plan is complete or a genuinely external/human-validation blocker remains.
```

## Minimal CLI-style one liner

If your Astra CLI accepts a prompt argument, use the equivalent of:

```bash
astra "Read docs/ACCESSIBILITY-PLAN.md and docs/ACCESSIBILITY-ASTRA-PROMPT.md and execute the full Adaptive Flight plan autonomously on accessibility/adaptive-flight; implement every stage, test/fix/commit each green stage, preserve server authority/default behavior, never touch or merge main, and stop only for genuine external or human-validation blockers."
```

If Astra's CLI syntax differs, use the one-line prompt text unchanged in its normal prompt field.
