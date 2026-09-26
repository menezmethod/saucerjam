# SaucerJam Accessibility Plan — Adaptive Flight

Status: planning / implementation branch  
Branch: `accessibility/adaptive-flight`  
Goal: make SaucerJam playable by as many people as practical across visual, hearing, motor, cognitive, motion-sensitivity, and combined-access needs without fragmenting the core game.

## North star

A blind player, a deaf player, a one-handed player, a player with tremors, and a neurodivergent player should be able to enter the same SaucerJam match and receive the same underlying game information through different channels.

Accessibility is a gameplay architecture, not a settings page.

Core rule:

> Every gameplay-critical fact must have at least two usable presentation channels.

Examples:
- visual + audio
- visual + haptic
- speech + haptic
- DOM text + audio

Never color alone. Never sound alone. Never canvas alone.

## Why SaucerJam is a strong fit

SaucerJam already has the primitives needed:
- server-authoritative 2D combat state rendered in 3D
- independent `src/input`, `src/interface`, `src/audio`, `src/view`, and `src/core`
- keyboard movement plus keyboard-only IJKL aiming and Space fire
- touch / pen / pointer role handling
- reduced-motion support
- haptics
- screen-reader battle narration
- threat arrows
- accessible DOM UI and live regions
- structured simulation events such as hit, kill, fire, explosion, portal entry, respawn, and round end

The work is primarily to normalize those capabilities into reusable input, perception, and assistance layers.

## Architecture

### 1. Accessibility Event Bus

Create a semantic event layer between simulation/game state and presentation.

Suggested module:
`src/accessibility/AccessibilityEventBus.js`

The bus should emit normalized events such as:

```
THREAT_NEAR
THREAT_APPROACHING
PROJECTILE_NEAR
DAMAGE_FROM
TARGET_ACQUIRED
TARGET_LOST
LOW_HULL
LOW_ENERGY
WEAPON_READY
WEAPON_BLOCKED
PICKUP_NEAR
PORTAL_NEAR
BOUNDARY_NEAR
OBSTACLE_NEAR
HIT_CONFIRMED
ELIMINATION
DESTROYED
RESPAWN
ROUND_END
```

Each event should carry only semantic game data:
- source/target ids where appropriate
- bearing / clock direction
- distance bucket and exact distance when appropriate
- urgency
- category
- timestamp / simulation time
- optional world position
- optional value/percentage

Adapters subscribe to the bus:
- visual cues
- screen-reader / DOM narration
- captions
- spatial audio / earcons
- haptics
- coaching

Do not make the simulation depend on accessibility presentation.

### 2. Semantic Action Input

Create a normalized action layer before the current input packet is formed.

Suggested module:
`src/input/ActionInput.js`

Canonical actions:

```
MOVE_X
MOVE_Y
AIM_X
AIM_Y
FIRE
FIRE_TOGGLE
TARGET_NEXT
TARGET_PREVIOUS
TARGET_NEAREST
WEAPON_NEXT
WEAPON_PREVIOUS
WEAPON_1
WEAPON_2
WEAPON_3
SONAR
PING
MENU
SCORES
CHAT
```

Input sources may include:
- keyboard
- mouse
- touch
- pen
- Gamepad API
- accessibility switches that emulate keys
- dwell/pointer activation
- future external controller integrations

ActionInput owns:
- rebinding
- chords
- hold vs toggle
- repeat suppression
- sticky movement
- sensitivity curves
- dead zones
- tremor debounce
- long-press thresholds
- one-hand presets
- sequential-control mode

The existing authoritative network input remains movement + aim + fire + weapon. Accessibility must translate into the existing legal simulation contract unless a server-reviewed assist explicitly changes mechanics.

### 3. Accessibility Profile Engine

Suggested modules:

```
src/accessibility/AccessibilityProfile.js
src/accessibility/defaults.js
src/accessibility/storage.js
```

Do not ask users for diagnoses.

First-run choices should be capability based:

- I need larger / clearer visuals
- I do not rely on sound
- I do not rely on vision
- I use one hand / limited controls
- Fast motion or flashing bothers me
- I need fewer distractions / clearer instructions
- Customize everything

Profiles are combinable.

Example settings schema:

```js
{
  version: 1,
  visual: {
    hudScale: 1,
    textScale: 1,
    highContrast: false,
    worldDetail: 1,
    enemyOutline: "normal",
    projectileScale: 1,
    reticleScale: 1,
    reticleThickness: 1,
    colorScheme: "default",
    usePatterns: false,
    soundRadar: false
  },
  hearing: {
    captions: false,
    directionalCaptions: false,
    soundRadar: false,
    captionDensity: "important"
  },
  vision: {
    screenNarration: false,
    spatialCombatAudio: false,
    sonar: false,
    navigationAudio: false,
    announceThreats: true,
    announceVitals: true,
    targetNarration: false
  },
  motor: {
    oneHandPreset: "off",
    fireMode: "hold",
    stickyMovement: false,
    targetCycle: false,
    autoFireOnTarget: false,
    switchScan: false,
    tremorDebounceMs: 0,
    gamepadDeadZone: 0.15,
    aimSensitivity: 1
  },
  cognitive: {
    focusHud: false,
    coaching: false,
    reducedEffects: false,
    replayInstructions: true
  },
  motion: {
    reducedMotion: "system",
    screenShake: 1,
    cameraDamping: 1,
    particles: 1,
    flashIntensity: 1,
    animatedWorld: true
  },
  haptics: {
    enabled: true,
    intensity: 1,
    directionalPatterns: true
  }
}
```

Persist locally for guests. If account/profile persistence is later added, keep accessibility preferences private and portable but never expose diagnosis-like labels to other players.

## Disability / capability coverage

### Blind and severe low vision — Blind Flight

Goal acceptance test:

> With the display hidden, a skilled player can spawn, orient, acquire a target, move, fire, understand damage, die, respawn, and finish a practice match.

Build:

#### Spatial combat audio
- enemies have directional positional signatures
- incoming projectiles have direction and urgency
- ricochets travel perceptibly through space
- pickup beacons are distinct
- portal beacons are distinct
- arena boundaries have a warning
- nearby obstacle proximity can be represented by subtle pulses
- avoid audio clutter; prioritize by urgency and proximity

#### Target system
- nearest target
- next / previous target
- announce: name or identifier, clock direction, distance
- optional target lock indicator through audio and haptic channels
- do not add hidden enemy information that sighted players do not receive

#### Sonar
User-triggered semantic sweep:
- nearby threats
- pickups
- portals
- open-route / obstacle information
- boundaries

Prefer learnable earcons over constant spoken coordinates.

#### Navigation assistance
Optional commands:
- face target
- face pickup
- face open space
- return to center
- target nearest threat

For public matches, navigation assistance should remain bounded so it does not become autonomous play.

#### Screen reader model
Maintain a structured DOM representation of:
- player hull and energy
- weapon and availability
- selected target
- nearest meaningful threat
- round state
- death / respawn
- important pickups / portal proximity

Throttle updates. Do not rewrite live regions every frame.

### Deaf and hard of hearing — Visual Sound Radar

Add a directional visual cue system for critical sounds.

Examples:
- LASER · 2 O'CLOCK · NEAR
- EXPLOSION · BEHIND · FAR
- PORTAL · LEFT
- HIT · RIGHT

Requirements:
- shape + icon + text, never color alone
- configurable persistence
- configurable density
- direction arrow / clock direction
- optional minimalist mode
- captions for non-directional gameplay audio
- no critical information exclusively in music or SFX

Future communications:
- text chat remains first-class
- speech-to-text and text-to-speech can plug into the same communication layer later

### Motor disabilities

Support a spectrum from normal twin-stick play to one/two-switch play.

#### Complete rebinding
- every gameplay action remappable
- multiple physical inputs can map to one action
- no mandatory simultaneous key combinations
- conflict detection
- restore defaults

#### One-handed presets
Examples:
- left-hand keyboard
- right-hand keyboard
- mouse-only assisted mode
- gamepad one-stick + target cycle
- touch one-hand mode

#### Hold/toggle alternatives
- toggle fire
- sticky movement
- weapon cycling instead of direct keys
- target cycling instead of precision aim
- optional auto-fire when selected target is within valid reticle bounds

#### Tremor support
- configurable debounce
- pointer smoothing
- dead zones
- sensitivity curves
- accidental double-activation suppression
- larger touch controls
- movable touch controls

#### Sequential control mode
Permit:
1. choose movement direction
2. choose target
3. fire

No requirement to move, aim, and hold fire simultaneously.

#### Switch scanning
Optional mode for one/two switch devices:

```
MOVE
AIM/TARGET
FIRE
WEAPON
SONAR
MENU
```

Auto-scan with configurable speed and manual advance/select bindings.

### Low vision / color perception — Tactical Contrast

Do not rely on post-process color filters alone.

Add semantic visual controls:
- world detail 100 / 50 / 10%
- desaturate/de-emphasize decorative environment
- strong enemy outlines
- distinct player outline
- enlarged projectile silhouettes
- portal / pickup shape differences
- pattern / icon identity in addition to hue
- HUD scale
- text scale
- reticle scale / thickness / shape / color
- high contrast UI
- forced-colors-friendly DOM
- configurable edge/threat arrows
- minimum text size and contrast targets
- 200% zoom/reflow verification

### Cognitive, ADHD, learning, and processing needs — Focus Flight

Optional simplified mode:
- hide non-critical kill-feed noise
- reduce decorative effects
- emphasize local ship, threats, projectiles, vitals, current weapon
- replayable controls at any time
- one concept at a time in onboarding
- weapon behavior demonstrations instead of dense copy
- consistent icons and vocabulary
- optional contextual coach

Coach examples:
- “Grenade needs 100 energy.”
- “Energy is recharging.”
- “Try moving while aiming.”
- “Bounce shots ricochet from walls.”

Coach must be deterministic and transparent, not hidden adaptive difficulty.

### Motion sensitivity and photosensitivity — Calm Arena

Expand current reduced-motion support into explicit persistent settings:
- system / on / off
- camera damping off
- screen shake slider
- idle bob off
- projectile trail reduction
- particle density slider
- portal animation reduction
- HUD pulse reduction
- flash intensity control
- explosion brightness reduction
- static world animation option
- stable Arena camera preset

Create automated tests for reduced motion and manual flashing review.

### Haptics as a first-class channel

Current vibration support should become semantic patterns.

Examples:
- light short pulse: hit confirmed
- stronger pulse: player damaged
- left/right differentiated patterns where device support allows
- double pulse: target acquired
- long pulse: critical hull
- distinct portal/sonar pattern

Haptics are configurable and can be disabled globally.

## Adaptive Flight onboarding

Add an Accessibility entry on first launch and in the Flight menu.

Suggested flow:

### “How do you want to play?”

Player selects any combination:
- clearer visuals
- no sound dependence
- no vision dependence
- limited controls / one hand
- calm motion
- fewer distractions
- customize

Then optionally enter a short calibration arena.

Calibration prompts:
- move the ship
- aim at a target
- press/hold a control
- distinguish two target styles
- identify left/right sound
- confirm motion comfort
- confirm text/UI size

The system recommends a profile. It does not infer or store a medical diagnosis.

Saved local profiles may be named:
- Default
- One Hand
- Low Vision
- Screen Reader
- Calm
- Custom

## Competitive fairness and privacy

Separate features into two internal classes.

### Presentation / input equivalence
Normally always legal:
- remapping
- captions
- screen narration
- spatial audio
- haptics
- larger UI
- high contrast
- reduced motion
- toggle controls
- alternate controllers
- target announcements of already-visible information

### Mechanics-changing assists
Require explicit rules:
- strong aim magnetism
- steering assistance
- auto-target fire
- slowed game simulation
- automation beyond input equivalence

Policy:
- Practice: allow broad assists, including slow game speed and paused aiming.
- Private rooms: host-configurable if mechanics are affected.
- Public matches: bounded legal assist values only.
- Never transmit or expose “disabled”, diagnosis, accessibility profile name, or medical-style classifications.
- If the server needs a value, transmit only the actual mechanical parameter required to validate gameplay.

## File / module plan

Suggested additions:

```
src/accessibility/
  AccessibilityEventBus.js
  AccessibilityProfile.js
  AccessibilitySettings.js
  AccessibilityNarrator.js
  CaptionAdapter.js
  HapticAdapter.js
  SpatialAudioAdapter.js
  SonarSystem.js
  FocusCoach.js
  defaults.js
  storage.js

src/input/
  ActionInput.js
  KeyboardSource.js
  PointerSource.js
  TouchSource.js
  GamepadSource.js
  SwitchScanSource.js

src/interface/
  AccessibilityPanel.js
  AccessibilityPanel.css
```

Do not force this exact split if the existing architecture suggests a cleaner one, but preserve the separation of:
1. semantic state/events
2. input translation
3. presentation adapters
4. settings/profile storage
5. simulation authority

## Delivery sequence

### PR A — Foundation
Deliver:
- profile/settings schema + migration/versioning
- accessibility settings UI
- semantic ActionInput
- AccessibilityEventBus
- adapters contract
- persistence
- existing behavior unchanged by default
- tests

Exit gate:
- zero regressions in keyboard/mouse/touch/network input
- settings can combine
- semantic events are generated without presentation coupling

### PR B — Motor + input
Deliver:
- full remapping
- Gamepad API
- hold/toggle fire
- sticky movement
- sensitivity/dead-zone configuration
- one-hand presets
- target cycling
- tremor debounce
- switch-friendly sequential controls

Exit gate:
- entire practice match playable without pointer
- one-hand test flow passes
- no stuck-input regressions
- disconnect/reconnect clears assist state safely

### PR C — Visual + hearing
Deliver:
- Tactical Contrast
- HUD/text/reticle scaling
- icon/pattern alternatives
- directional captions / Visual Sound Radar
- semantic haptic patterns
- forced-colors/high-contrast support

Exit gate:
- no critical color-only cue
- no critical sound-only cue
- 200% UI usable
- touch layouts remain collision-free

### PR D — Blind Flight
Deliver:
- spatial threat audio
- target narration
- sonar
- obstacle/boundary cues
- structured battle model
- blind navigation assistance

Exit gate:
- display-hidden practice run is independently playable
- screen-reader updates are throttled and usable
- audio overload review passes

### PR E — Cognitive + motion
Deliver:
- Focus Flight
- deterministic coaching
- Calm Arena controls
- explicit motion/effect sliders
- replayable instructions

Exit gate:
- reduced-motion mode covers CSS + WebGL + camera + effects
- Focus Flight contains all critical gameplay information

### PR F — Accessibility Gauntlet
Deliver:
- automated accessibility matrix
- evidence captures
- keyboard-only test
- pointer-free test
- touch-only test
- gamepad test
- reduced-motion test
- high-contrast / forced-colors test
- 200% zoom test
- screen-reader semantic-state test
- input fuzz/stuck-state regression
- event coverage test
- documented human playtest protocol

Exit gate:
- every critical gameplay event maps to at least two channels
- no accessibility setting changes authoritative combat secretly
- known limitations documented rather than hidden

## Testing strategy

Automated tests should include:

### Input
- remapping
- duplicate/conflict bindings
- hold/toggle
- sticky movement
- keyup after focus changes
- blur/orientation/visibility cleanup
- pointer capture loss
- controller disconnect
- one-hand preset
- switch scanning
- tremor debounce

### Presentation
- accessibility settings keyboard navigation
- screen reader live-region throttling
- captions
- sound radar
- high contrast
- forced colors
- 200% zoom
- reduced motion
- touch safe-area and target sizes

### Gameplay invariants
- accessibility output never mutates simulation state unless an explicitly reviewed assist is enabled
- no client-side accessibility adapter can create illegal fire/movement packets
- stale input still times out
- reconnect clears transient assistance state
- authoritative server remains source of combat truth

### Blind Flight verification
Create a test harness that can hide the canvas and inspect semantic outputs.
Human verification is still required for actual blind-play usability.

## Telemetry and privacy

Only collect feature-level, non-medical telemetry if needed, such as:
- accessibility panel opened
- profile activated
- setting category changed
- onboarding completed

Avoid transmitting:
- diagnosis labels
- disability labels
- inferred medical information
- raw assistive-technology identifiers

Accessibility should work without telemetry.

## Documentation

Update:
- README controls/accessibility section
- `docs/ACCESSIBILITY-PLAN.md`
- `docs/STATUS.json` as stages complete
- help / onboarding copy
- any input integration contracts affected

Document limitations honestly.

## Implementation constraints

- Work only on `accessibility/adaptive-flight` or descendant feature branches.
- Do not directly modify `main`.
- Preserve server-authoritative combat.
- Existing controls remain the default.
- Do not break touch, keyboard, mouse, auth, multiplayer, reconnect, or current tests.
- Prefer small composable modules over making `src/index.js` larger.
- Keep adapters deterministic and testable.
- No diagnosis inference.
- No “accessibility mode” that bundles mutually exclusive assumptions.
- Profiles must be combinable.
- Do not claim support for a disability until the corresponding acceptance test and human validation exist.
- Preserve performance budgets; accessibility must not make lower-end hardware less usable.

## Definition of done

The project is not “accessible” merely because the menu contains options.

The milestone is reached when:
1. critical information is multimodal
2. every gameplay action can be produced through the semantic input layer
3. profiles combine safely
4. a keyboard-only player can play fully
5. a one-handed / reduced-input flow is viable
6. a deaf player can understand critical audio events visually
7. a low-vision player can meaningfully simplify and amplify the arena
8. reduced-motion affects the entire render experience
9. a skilled blind player can complete the core practice loop without relying on the display
10. CI verifies the architectural invariants and regressions
11. disabled players have been involved in human validation before broad claims are made

The goal is not to make a separate accessible version of SaucerJam.

The goal is one SaucerJam whose information, controls, and feedback can be translated to fit the player.
