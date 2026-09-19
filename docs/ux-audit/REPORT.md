# SaucerJam — UX/UI & Device-Playability Audit (PR #3)

Date: 2026-09-19 · Branch: `design/confluence-v2-production-plan` (PR #3)
Goal under test: **100% playable on phones, tablets, iPads and desktop, at every
resolution; best view and icons per device; looks 2026+.**

## Method

- Built `scripts/verification/ux-audit.cjs`, a Playwright harness that opens the
  real production bundle, plays into Practice (touch tap vs mouse click), and
  measures every device: horizontal overflow, HUD-rect overlaps, off-screen
  chrome, tap targets < 44 px, and text < 11 px. It writes
  `docs/ux-audit/measurements.json` and screenshots to `docs/ux-audit/shots/`.
- 24 profiles: iPhone SE / 320 px / iPhone 12 / 14 Pro Max / Pixel 5 / Galaxy S8
  portrait; iPhone 12 / 14 PM / Pixel 5 / 568×320 landscape; iPad mini / 10 /
  Air / Pro 11 portrait; iPad 1180×820 and 1024×768 landscape; desktop 1280×720,
  1366×768, 1440×900, 1920×1080, 2560×1440, ultrawide 3440×1440, 4K @1x and @2x.
- Overlay surfaces captured too: touch guide, Flight menu, Help, Comms, desktop
  scoreboard.
- Four independent adversarial critics (fresh context) reviewed the evidence and
  code: mobile/touch playability, 2026 visual/art direction, WCAG 2.2 /
  assistive tech, and competitive game-feel. Their verified findings are merged
  below.

### Reproduce

```bash
npm run build
node scripts/verification/ux-audit.cjs        # writes measurements.json + shots/
```

## Scorecard

| Area | Result |
| --- | --- |
| Horizontal overflow (24 devices) | ✅ none |
| HUD element overlap (24 devices) | ✅ none |
| HUD chrome off-screen | ✅ none |
| Touch tap targets < 44 px | ✅ fixed to zero on all touch devices (was 5/device) |
| Text < 11 px | ⚠️ 1 element on touch, 8 on desktop |
| One-time touch onboarding | ✅ added (was missing; dead test reference) |
| Installable PWA | ⚠️ manifest now linked; icons still missing |
| Safe-area / notch on top bar | ✅ added for touch |
| Keyboard-only play | ❌ no independent aim; Tab hijacked in-game |
| Screen-reader play | ❌ no non-visual battle state |
| Visual art direction / brand | ❌ no logo, hero art, icon set, or motion system |

**Verdict:** geometry is solid — the game *fits* everywhere. It is not yet
*equally playable* everywhere: touch is missing information and teaching that
desktop gets, and the art layer above the (competent) HUD is unfinished.

## Implemented in this PR

1. **Independent music mute.** `MusicBus` now has separate `musicGain` and
   `sfxBus` nodes; stings route through the music bus. Two rail buttons —
   `Sound on/off` (effects) and `Music on/off` — persisted as `qd-sfx` /
   `qd-music` (migrating the old `qd-sound`). The Comms offset now *measures*
   the rail height instead of a hardcoded value, so adding the 4th button (and
   any future rail change) cannot recreate the earlier overlap.
2. **One-time touch onboarding** (`#touch-onboarding`), which two critics called
   the top bounce cause and which `tests/browser.cjs` already asserted but was
   never implemented.
3. **44 px touch targets** for the HUD rail and weapon pills on coarse pointers.
4. **Safe-area insets** on the top bar for touch (notch / Dynamic Island).
5. **Installable PWA**: linked `manifest.webmanifest` plus Apple web-app meta.
6. **Copy/repo truth**: retired "Quantum arena", and corrected README claims
   (dedicated Fire button → tap-to-fire; eight humans → `MAX_ROOM_PLAYERS`=32;
   audio toggles now Music + Sound).

## Priority 0 — fix next (decides whether a new player stays)

1. **Mobile has no radar and a narrow FOV; desktop gets a wallhack map.**
   `.radar{display:none}` under `@media (pointer: coarse)`
   (`src/styles/main.css:976`), while desktop draws every enemy through walls
   (`src/index.js` radar). Portrait vertical FOV ≈ 55° → ~27° horizontal. This
   is a fairness break, not a feature gap.
   *Fix:* off-screen threat arrows (reuse `ShipIndicators` projection) for **all**
   devices; give touch the compact 92 px radar only if arrows prove insufficient.
2. **No keyboard-only aiming.** Aim comes only from pointer position
   (`src/index.js` aim path; Help even says "Mouse Aim"), so keyboard players can
   move and fire forward but cannot aim while dodging.
   *Fix:* modifier + arrows/IJKL reticle slew, or "aim nearest threat" cycle,
   announced through a live region.
3. **Tab is hijacked in-game and HUD controls are unreachable by keyboard.**
   `e.preventDefault()` + scoreboard on Tab (`src/index.js:643,658`); Comms /
   Sound / Music have no shortcut.
   *Fix:* stop consuming unmodified Tab; give every HUD control a shortcut or a
   place in the tab order.
4. **No screen-reader representation of the battle.** The game is one
   `<canvas aria-label>`; death/respawn/round-result are hidden divs, not live
   regions; hull `aria-label`s sit on bare divs and rewrite every frame
   (`src/view/ShipIndicators.js:20,86`).
   *Fix:* a throttled `role="status"` channel — "Enemy 2 o'clock, 14 m",
   "Destroyed — respawn in 3", "Round over, Nova wins" — plus real roles on hull.
5. **Modal focus trap excludes the report textarea and links.**
   `panel()` traps `'button,input,select,summary,[tabindex="0"]'`
   (`src/index.js:607`) but not `textarea`/`a`, so the report form is
   keyboard-incomplete; background isn't `inert`.
   *Fix:* native `<dialog>`+`showModal()` (already used in `Interface.js`), or
   extend the trap and add `inert`.

## Priority 1 — high

- **Hull/energy feedback is too thin.** Hull is only a 52×6 px (42×5 under
  600 px) bar over the ship, and it is hidden when all placement slots are
  obstructed — exactly near cover. Energy is only a depleted-opacity + 0.3 s
  notice; touch hides the cost labels. *Add a fixed hull+energy readout in the
  top bar, and a low-hull (<25%) red vignette (condition already computed).*
- **Death is a dead end.** The death panel shows no killer or weapon even though
  the event carries both (`src/index.js` kill feed), and there is no spectate.
  *Add "Eliminated by <name> · <weapon>" + a 3 s killer camera — ~20 lines,
  highest learning-per-effort change.*
- **No visible reward or progression.** XP/level exist server-side but only in
  Pilot records / recap. *Surface one level/XP bar on the recap and lobby; add
  two or three ship tints/trails at fixed levels. No store, no currency.*
- **Practice is the emptiest mode.** New players land alone in the full
  120×120 four-district world with max-separation spawns, so the first opponent
  can be ~60–100 units away. *Start practice in the closed core (stage 0) and
  bias the first spawn toward a bot.*
- **No pre-commit population/ping signal**, and bots are only labelled in the
  scoreboard, not the kill feed. *Show "X pilots online", tag `(bot)` inline,
  offer "wait for humans".*
- **Camera scale ignores viewport.** Fixed camera offsets + `zoom=1` render the
  ship ~4% of an iPad's width; icons are a fixed 20 px. *Derive default zoom
  from `min(width,height)`; scale icons with `clamp()`.*
- **Text below legibility floor.** 8 px "YOU", 9 px `kbd`/round label, 10 px
  energy/radar. *Floor HUD text at ~11–12 px.*
- **Reduced-motion only disables CSS transitions**, not camera damping, ship
  bob, pickups, or up-to-240 particles/frame. *Honor the media query in the
  render loop; add a "reduce motion" toggle.*

## Priority 2 — polish / 2026 tier

- **Art direction is the big gap**: no logo/brand mark ("SJ" text + text
  favicon), generic wrong weapon icons (arrow/bomb/squiggle) that change identity
  per device (text cards on desktop, icon-only on touch), a marketing-claim hero
  instead of the game title, no city/gameplay proof on the landing, ad-hoc type
  tracking, and essentially no motion/juice in the HUD.
  *Order of execution:* one duotone icon set + a real logo mark → showroom lobby
  camera with the ship as hero + gameplay stills/loop on the landing → motion
  budget (hit pop, kill freeze, modal spring, `:active` press) → type/color
  tokens.
- **Map picker art is abstract line diagrams**, not the arena you'll play.
  *Bake simple top-down renders of the real footprints.*
- **Radar is low-contrast with a single white dot for everyone**; colour-code
  self/enemies and enlarge the self marker.
- **Comms button sits in the aim/fire zone** on phones; every tap outside the
  stick fires, so a stray tap opens chat instead of shooting. *Move Comms next
  to Menu in the top bar on touch.*
- **Accidental taps on the weapon rail fall through to `#arena` and fire.**
  *Swallow pointer events in a margin around the rail.*
- **Kill feed paints under the weapon pills** on 320–430 px portrait. *Reposition
  below the rail on touch.*
- **Idle/battery:** full-rate WebGL runs on the landing page and under modals,
  with `antialias:true` and DPR capped at 1.5. *Pause the RAF when not flying;
  consider 30 fps / no MSAA on small high-DPR screens.*
- **No retention telemetry** despite the roadmap's own D1/D7 goal. *Three server
  counters keyed on the existing profile token.*
- **Loading/empty states are one line of text.** *Skeletons + a branded loading
  overlay.*
- **Doc drift:** `README` controls table and `docs/AUDIO.md` still describe the
  old single `soundOn` toggle; `docs/STATUS.json` still says "Quantum Drift".

## Accessibility notes (WCAG 2.2)

The layout/contrast/target-size work is largely AA-clean: static text pairs
measure 5.6–16:1, the `fill-bots` 13 px checkbox is wrapped by a ≥44 px label,
and the 32 px HUD buttons exceed the 24 px AA minimum. The gates to the stated
goal are the P0 items above (non-visual state, keyboard aim, Tab, modal focus),
plus: small text / px-only type fails 1.4.4–1.4.10 at 200% zoom; color-only
signals (your-kill cyan, red-only damage flash, opacity-only depletion); canvas
overlay labels with no backing can drop below 4.5:1 over bright explosions;
report/auth errors are not tied to fields with `aria-invalid`/`aria-describedby`.

## What NOT to build (YAGNI)

No battle pass / store / currency / marketplace; no killcam replay or spectator
infra (the 1-line death attribution + 3 s camera covers ~90% of the value); no
new weapons, modes, or maps before the core retains; no friend graph, parties,
or clubs until concurrency exists; no ranked/MMR; no native wrappers. Protect the
strengths already present: server-authoritative combat, max-separation spawns,
auto next-round, the audio bus, accessible live-region plumbing, tap-to-fire.

## Method limitations

- Safe-area insets are not emulable in headless Chromium; the top-bar fix was
  verified by code review, not pixels.
- WebGL performance, thermal throttling and battery were not measured on real
  hardware — read battery/P0-perf items as hypotheses needing device traces.
- The audits judge a synthetic practice session; live multiplayer feel (latency,
  netcode under load) was out of scope.

---

## Implementation pass (this branch)

Shipped after the audit, verified by the harness above and a functional suite:

- **Information parity (P0):** `src/view/ThreatArrows.js` draws an edge arrow
  for every off-camera enemy on all devices, so touch players get spatial
  awareness without a minimap wallhack.
- **Keyboard-only play (P0):** `I J K L` aim independently of `W A S D`
  movement; `Space` fires. Help/README updated.
- **Tab restored to focus (P0):** in-game scoreboard moved to `T`; `Tab` now
  traverses HUD controls. Modal focus trap now includes `textarea` and links.
- **Screen-reader narration (P0):** a throttled `role="status"` region narrates
  nearest-threat bearing/distance, low hull, destruction/respawn and round end.
- **Vitals (P1):** a hull + energy readout with numbers and condition colouring
  in the top bar on every device.
- **Death attribution (P1):** the death panel now reads "Eliminated by
  <name> · <weapon>".
- **Practice contact (P1):** practice spawns ~14 units from the nearest bot
  instead of alone in the far corner of the 120×120 world.
- **Legibility:** HUD text floored at 11 px (round label, energy cost, radar
  legend, key hints, hull marker).
- **Reduced motion:** `prefers-reduced-motion` now snaps the camera and freezes
  idle bob/spin, not just CSS transitions.
- **Placement:** kill feed dropped below the touch weapon rail.
- **Identity:** saucer logo mark (favicon + wordmark) and recognisable,
  weapon-coloured weapon icons.
- **Motion budget:** hit-marker pop, modal rise, button press.

Deliberately deferred (larger, asset- or product-dependent): landing hero
rework/gameplay proof, map thumbnails as real renders, Comms relocation out of
the touch fire zone, pre-match population/ping signal, analytics counters,
skeleton loading states, and a native `<dialog>`/`inert` migration.
