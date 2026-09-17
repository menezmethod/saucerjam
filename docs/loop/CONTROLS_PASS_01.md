# Controls pass 01 — implementation evidence

Branch inspected: `codex/saucerjam-loop-v2`. Local working-tree changes only;
this pass did not commit, push, open a PR, merge, or deploy.

## Scope and improvements

- Independent movement and firing ownership. An extra touch or hybrid-device
  mouse cannot overwrite the firing finger's aim. One firing pointer owns aim
  until released; extra firing touches are deliberately ignored, not queued.
- Pointer cancellation/lost capture clears only that pointer's role. Movement,
  firing and keyboard input no longer all stop when one touch is cancelled.
- Blur, visibility change, orientation change and editable-field focus clear
  held input, stale aim and pointer captures; a fresh grip works immediately.
- Keyboard release clears held keys even if focus moved into a form field.
- Chorded mouse buttons stop firing when the primary button is released, even
  if the secondary button is still down.
- Canvas CSS uses dynamic viewport height with a `100vh` fallback. Rendering,
  camera aspect and ship indicators use the measured canvas dimensions.
  ResizeObserver catches CSS-surface changes; visual viewport changes catch
  mobile browser chrome changes; older browsers use the window resize fallback.
  Unchanged dimensions/DPR skip redundant resize work. The existing 1.5 DPR cap remains.

## Files authored by this pass

- `src/index.js`: input lifecycle, pointer ownership and focus handling.
- `src/core/ArenaRenderer.js`: measured, deduplicated viewport resizing.
- `src/styles/main.css`: dynamic viewport height.
- `src/input/client.test.mjs`: eight regression tests against production class
  methods using DOM shims, without starting WebGL/audio/network services.
- `docs/loop/CONTROLS_PASS_01.md`: this report.

Existing README/package changes were preserved. Other loop/PR files appearing
in the working tree were not authored or modified by this pass.

## Verification

| Command/check | Result |
| --- | --- |
| `npm run build` | Pass; production webpack bundle built. |
| `node --test src/input/*.test.mjs` | 13/13 pass: eight new client tests plus five existing stick tests. |
| `npm test` | Build succeeds; 91/93 tests pass. Two interface tests fail at browser launch because Chromium is missing. |
| `git diff --check` | Pass. |
| `git diff --exit-code -- shared server` | Pass; no authoritative simulation/server changes. |
| Direct Playwright Chromium launch | Blocked: missing `chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`. |
| Fresh critic review | No critical code defect; acceptance blocked pending native browser/device evidence. |

The regression cases cover simultaneous move/fire sampling, per-pointer cancel
and lost capture, stray-touch/hybrid aim interference, mouse button chords,
blur/visibility/orientation recovery, key release after focus changes, canvas
relative touch zones, inactive input, and portrait/landscape/DPR resizing.

## Evidence and limitations

Executable regression evidence: `src/input/client.test.mjs`. This report records
the command outcomes. No browser screenshots or measured latency/FPS evidence
were produced. Browser launch was attempted and failed; desktop and mobile
browser playtests were not completed. DOM shims do not prove native capture,
Safari layout, mobile browser-chrome behavior or real touch feel.

No regressions were found in the executed non-browser suite. This is not a
claim of full device compatibility. Orientation changes intentionally require
a fresh grip. Extra fingers do not take over an already-held firing gesture.
Fixed-step sampling, network cadence, prediction and authoritative rules remain
unchanged; this pass makes no millisecond latency-reduction claim. Very short
presses between simulation ticks are not newly buffered by this patch.

## NEXT_ACTION

Run `npm test` and `npm run test:browser` where Chromium is available, then do
real iPhone/iPad Safari checks before accepting or merging this slice. Cover
desktop mouse/keyboard, touch move+fire, cancelled/lost capture, hybrid input,
portrait/landscape changes while holding controls, browser chrome expansion,
focus loss and re-grip. Capture screenshots and input-to-visible-response
measurements with device/browser/DPR noted. Do not mark showcase-grade feel as
verified until that evidence exists.
