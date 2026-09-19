// Cross-device UX/UI audit: lobby + in-game HUD, measured on a device matrix.
// Usage: npm run build && node scripts/verification/ux-audit.cjs
// Writes docs/ux-audit/measurements.json and docs/ux-audit/shots/*.png.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { createGameServer } = require("../../server/server");

const out = path.join(__dirname, "../../docs/ux-audit");
const shots = path.join(out, "shots");
fs.mkdirSync(shots, { recursive: true });

const DEVICES = [
  // phones, portrait
  { name: "phone-se-375x667", w: 375, h: 667, dpr: 2, mobile: true },
  { name: "phone-320x568", w: 320, h: 568, dpr: 2, mobile: true },
  { name: "phone-12-390x844", w: 390, h: 844, dpr: 3, mobile: true },
  { name: "phone-14pm-430x932", w: 430, h: 932, dpr: 3, mobile: true },
  { name: "pixel5-393x851", w: 393, h: 851, dpr: 2.75, mobile: true },
  { name: "galaxy-s8-360x740", w: 360, h: 740, dpr: 3, mobile: true },
  // phones, landscape (short height)
  { name: "phone-12-land-844x390", w: 844, h: 390, dpr: 3, mobile: true },
  { name: "phone-14pm-land-932x430", w: 932, h: 430, dpr: 3, mobile: true },
  { name: "pixel5-land-851x393", w: 851, h: 393, dpr: 2.75, mobile: true },
  { name: "phone-568x320", w: 568, h: 320, dpr: 2, mobile: true },
  // tablets
  { name: "ipad-mini-744x1133", w: 744, h: 1133, dpr: 2, mobile: true },
  { name: "ipad-10-810x1080", w: 810, h: 1080, dpr: 2, mobile: true },
  { name: "ipad-air-820x1180", w: 820, h: 1180, dpr: 2, mobile: true },
  { name: "ipad-pro11-834x1194", w: 834, h: 1194, dpr: 2, mobile: true },
  { name: "ipad-land-1180x820", w: 1180, h: 820, dpr: 2, mobile: true },
  { name: "ipad-land-1024x768", w: 1024, h: 768, dpr: 2, mobile: true },
  // desktop
  { name: "desktop-1280x720", w: 1280, h: 720, dpr: 1 },
  { name: "desktop-1366x768", w: 1366, h: 768, dpr: 1 },
  { name: "desktop-1440x900", w: 1440, h: 900, dpr: 1 },
  { name: "desktop-1920x1080", w: 1920, h: 1080, dpr: 1 },
  { name: "desktop-2560x1440", w: 2560, h: 1440, dpr: 1 },
  { name: "ultrawide-3440x1440", w: 3440, h: 1440, dpr: 1 },
  { name: "4k-3840x2160", w: 3840, h: 2160, dpr: 1 },
  { name: "4k-3840x2160@2x", w: 3840, h: 2160, dpr: 2 },
];

const HUD_CHROME = [
  ["topbar", "#hud .top-bar"],
  ["brand", "#hud .match-brand"],
  ["clock", "#hud .match-clock"],
  ["vitals", "#hud .vitals"],
  ["radar", "#hud .radar"],
  ["killfeed", "#hud #kill-feed"],
  ["notice", "#hud #notice"],
  ["comms", "#hud #chat-toggle"],
  ["weapons", "#hud .weapons"],
  ["tools", "#hud .flight-tools"],
  ["hint", "#hud .flight-hint"],
];

const rectOverlap = (a, b) => {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return Math.round(x * y);
};

function measure(page, viewport) {
  return page.evaluate(({ HUD_CHROME, viewport }) => {
    const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const offscreen = (r) => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    const rectOverlap = (a, b) => {
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return Math.round(x * y);
    };

    const result = {
      innerWidth,
      innerHeight,
      dpr: devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      touchActive: document.body.classList.contains("touch-active"),
      hudVisible: !document.getElementById("hud").hidden,
      overlaps: [],
      chrome: {},
      tapTargets: [],
      smallText: [],
      offscreen: [],
    };

    const boxes = {};
    for (const [name, sel] of HUD_CHROME) {
      const el = document.querySelector(sel);
      if (visible(el)) { boxes[name] = { sel, r: rect(el) }; result.chrome[name] = boxes[name].r; }
    }
    const contains = (outer, inner) =>
      outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom;
    const keys = Object.keys(boxes);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = boxes[keys[i]].r, b = boxes[keys[j]].r;
        // Parent/child containment is expected; only true collisions count.
        if (contains(a, b) || contains(b, a)) continue;
        const area = rectOverlap(a, b);
        if (area > 4) result.overlaps.push({ a: keys[i], b: keys[j], area });
      }
    for (const [name, b] of Object.entries(boxes)) if (offscreen(b.r)) result.offscreen.push({ name, r: b.r });

    // Tap targets (visible interactive elements)
    const interactive = document.querySelectorAll("button, input, select, textarea, a[href], summary, [role=button]");
    for (const el of interactive) {
      if (!visible(el)) continue;
      if (el.closest("[hidden]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.pointerEvents === "none") continue;
      const label = (el.getAttribute("aria-label") || el.textContent || el.value || el.id || el.tagName).trim().slice(0, 28);
      if (r.width < 44 || r.height < 44)
        result.tapTargets.push({ id: el.id || el.className || el.tagName, label, w: Math.round(r.width), h: Math.round(r.height) });
    }

    // Small text (visible text-bearing elements)
    const textEls = document.querySelectorAll("body *");
    for (const el of textEls) {
      if (!visible(el)) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      if (el.children.length > 0 && [...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) result.smallText.push({ id: el.id || el.className || el.tagName, fs: Math.round(fs * 10) / 10, text: el.textContent.trim().slice(0, 22) });
    }
    result.smallText = result.smallText.slice(0, 12);
    return result;
  }, { HUD_CHROME, viewport });
}

(async () => {
  const game = createGameServer();
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling"] });
  const report = { generatedAt: new Date().toISOString(), devices: [] };
  const errors = [];
  try {
    for (const d of DEVICES) {
      const ctx = await browser.newContext({
        viewport: { width: d.w, height: d.h },
        deviceScaleFactor: d.dpr,
        isMobile: !!d.mobile,
        hasTouch: !!d.mobile,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${d.name}: ${e.message}`));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__qd, null, { timeout: 30000 });
      await page.waitForTimeout(250);

      const lobby = await measure(page, d);
      await page.screenshot({ path: path.join(shots, `${d.name}-lobby.png`) });

      const practice = page.locator("#practice");
      if (d.mobile) await practice.tap();
      else await practice.click();
      await page.waitForFunction(() => window.__qd.getSnapshot().mode === "practice");
      await page.waitForTimeout(400);
      // Capture the one-time touch guide, then dismiss it so HUD measurements
      // and screenshots show the playable state.
      const guide = page.locator("#touch-onboarding");
      if (await guide.isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(shots, `${d.name}-touch-guide.png`) });
        // A real finger tap, not .click() -- a mouse-flavored event would
        // (correctly) turn the touch chrome back off.
        await page.tap("#dismiss-touch-onboarding");
        await page.waitForTimeout(150);
      }
      const hud = await measure(page, d);
      await page.screenshot({ path: path.join(shots, `${d.name}-practice.png`) });

      report.devices.push({ name: d.name, viewport: { w: d.w, h: d.h, dpr: d.dpr, mobile: !!d.mobile }, lobby, hud });
      const issues = [];
      if (lobby.horizontalOverflow) issues.push("LOBBY-HSCROLL");
      if (hud.horizontalOverflow) issues.push("HUD-HSCROLL");
      if (hud.overlaps.length) issues.push("HUD-OVERLAP:" + hud.overlaps.map((o) => `${o.a}/${o.b}`).join(","));
      if (hud.offscreen.length) issues.push("HUD-OFFSCREEN:" + hud.offscreen.map((o) => o.name).join(","));
      if (hud.tapTargets.length) issues.push(`SMALL-TAPS:${hud.tapTargets.length}`);
      if (hud.smallText.length) issues.push(`SMALL-TEXT:${hud.smallText.length}`);
      console.log(`${d.name.padEnd(26)} ${issues.length ? issues.join(" ") : "ok"}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await game.close();
  }
  report.pageErrors = errors;
  fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${path.join(out, "measurements.json")} (${report.devices.length} devices)`);
  if (errors.length) console.log("Page errors:", errors);
})().catch((e) => { console.error(e); process.exit(1); });
