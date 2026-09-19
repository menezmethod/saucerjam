// Play-first landing evidence: real page, real server, measured numbers.
// Usage: npm run build && node server/server.js & QD_AUTH_URL=... node scripts/verification/landing.cjs
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

const base = process.env.QD_URL || "http://127.0.0.1:8080";
const authBase = process.env.QD_AUTH_URL || "http://127.0.0.1:8081";
const out = path.join(__dirname, "../../docs/verification/landing-redesign");
fs.mkdirSync(out, { recursive: true });

const measurements = {
  generatedAt: new Date().toISOString(),
  base,
  authBase,
  viewports: {},
  checks: {},
  pageErrors: [],
  consoleErrors: [],
  failedRequests: [],
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

async function layout(page, viewport) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right),
      };
    };
    const heights = (selectors) =>
      selectors.map((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return {
          selector,
          text: (element?.textContent || "").trim().slice(0, 28),
          height: rect ? Math.round(rect.height) : null,
          visible: !!element && !!(element.offsetWidth || element.offsetHeight),
        };
      });
    const picker = document.querySelector(".qd-map-picker");
    const panel = document.querySelector(".lobby-panel");
    return {
      innerWidth,
      innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      panel: box(".lobby-panel"),
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      quickPlay: box("#quick-play"),
      quickPlayInViewport: (() => {
        const rect = document.getElementById("quick-play").getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      })(),
      practice: box("#practice"),
      picker: {
        hidden: picker?.hidden ?? null,
        display: picker ? getComputedStyle(picker).display : null,
        height: picker ? Math.round(picker.getBoundingClientRect().height) : null,
        cards: picker?.querySelectorAll(".qd-map-card").length ?? null,
      },
      arena: box("#arena"),
      landingControls: heights([
        "#quick-play",
        "#practice",
        "#pilot-name",
        "#lobby-friends > summary",
        "#lobby-account > summary",
        "#lobby-help",
        ".qd-records-link",
      ]),
      disclosureControls: heights([
        "#create-room",
        "#room-code",
        "#join-room",
        ".lobby-disclosure .check",
        "#fill-bots",
        "#email-toggle",
        "#auth-google",
        "#auth-apple",
        "#auth-email",
        "#auth-password",
        "#auth-sign-in",
        "#auth-sign-up",
      ]),
    };
  });
}

async function main() {
  const chrome = process.env.CHROME_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  const browser = await chromium.launch({
    headless: true,
    ...(chrome && fs.existsSync(chrome) ? { executablePath: chrome } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => measurements.pageErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") measurements.consoleErrors.push(`console: ${message.text()}`); });
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().endsWith("favicon.ico")) measurements.failedRequests.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__qd);
    await page.waitForFunction(() => window.__qd.getSnapshot().renderer.calls > 0);

    // 1. Per-viewport layout measurements.
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 900 },
      short: { width: 1024, height: 600 },
      mobile: { width: 390, height: 844 },
      narrow: { width: 320, height: 568 },
    })) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(180);
      const data = await layout(page, viewport);
      measurements.viewports[name] = { viewport, ...data };
      await shot(page, `landing-${name}-${viewport.width}x${viewport.height}`);
      assert.equal(data.horizontalOverflow, false, `horizontal overflow at ${viewport.width}x${viewport.height}: scrollWidth ${data.documentScrollWidth} > ${data.innerWidth}`);
      assert.equal(data.picker.hidden, true, `destination picker must be hidden with one live world at ${viewport.width}`);
      assert.equal(data.picker.display, "none", `destination picker must not be rendered at ${viewport.width}`);
      for (const control of data.landingControls) {
        assert.ok(control.height >= 44, `${control.selector} is ${control.height}px high at ${viewport.width}`);
      }
      if (name === "mobile") assert.equal(data.quickPlayInViewport, true, "primary CTA must be inside the 390x844 viewport without scrolling");
    }

    // 2. Disclosure contents are 44px+ too (measured with both open).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.getElementById("lobby-friends").open = true;
      document.getElementById("lobby-account").open = true;
      document.getElementById("email-auth").hidden = false;
    });
    await page.waitForTimeout(120);
    const opened = await layout(page, { width: 390, height: 844 });
    measurements.viewports.mobileDisclosuresOpen = opened;
    for (const control of opened.disclosureControls) {
      if (control.selector === "#fill-bots") continue; // native checkbox; its 44px+ label is measured as .check
      if (!control.visible) continue; // e.g. a provider /api/config disables: measured hidden on purpose
      assert.ok(control.height >= 44, `${control.selector} is ${control.height}px high inside the disclosure`);
    }
    const measuredControls = opened.disclosureControls.filter((control) => control.visible && control.selector !== "#fill-bots");
    assert.ok(measuredControls.length >= 10, `only ${measuredControls.length} disclosure controls were measurable`);
    assert.ok(measuredControls.every((control) => control.height >= 44), "a visible disclosure control is under 44px");
    assert.ok(opened.disclosureControls.find((c) => c.selector === ".lobby-disclosure .check").height >= 44, "checkbox row is not a 44px+ tap target");
    measurements.viewports.mobileWithDisclosuresOpenQuickPlay = { ...opened.quickPlay, inViewport: opened.quickPlayInViewport };
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.getElementById("lobby-account").open = true; document.getElementById("email-auth").hidden = false; });
    await shot(page, "landing-desktop-1440x900-auth-open");
    await page.evaluate(() => {
      document.getElementById("lobby-account").open = false;
      document.getElementById("lobby-friends").open = true;
      // Restore the shipped initial state for the remaining checks.
      document.getElementById("email-auth").hidden = true;
      document.getElementById("email-toggle").setAttribute("aria-expanded", "false");
    });
    await shot(page, "landing-desktop-1440x900-friends-open");
    await page.evaluate(() => { document.getElementById("lobby-friends").open = false; });

    // 3. Disclosure behaviour + email toggle + focus discipline.
    measurements.checks.initialFocus = await page.evaluate(() => document.activeElement.tagName + "." + (document.activeElement.className || ""));
    measurements.checks.disclosures = await page.evaluate(async () => {
      const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
      const result = {};
      for (const id of ["lobby-friends", "lobby-account"]) {
        const details = document.getElementById(id);
        const summary = details.querySelector("summary");
        summary.click();
        await wait();
        const open = details.open;
        const bodyVisible = !!document.querySelector(`#${id} .lobby-disclosure-body`)?.offsetHeight;
        summary.click();
        await wait();
        result[id] = { tag: details.tagName, openedUntoTrue: open, bodyVisible, closedAgain: !details.open, semantics: details.tagName === "DETAILS" && summary.tagName === "SUMMARY" };
      }
      return result;
    });
    assert.equal(measurements.checks.disclosures["lobby-friends"].openedUntoTrue, true, "friends disclosure did not open");
    assert.equal(measurements.checks.disclosures["lobby-account"].openedUntoTrue, true, "auth disclosure did not open");
    assert.equal(measurements.checks.disclosures["lobby-friends"].closedAgain, true, "friends disclosure did not close");
    assert.equal(measurements.checks.disclosures["lobby-account"].closedAgain, true, "auth disclosure did not close");

    await page.click("#lobby-account > summary");
    await page.click("#email-toggle");
    measurements.checks.emailToggleOpen = await page.evaluate(() => ({
      formHidden: document.getElementById("email-auth").hidden,
      expanded: document.getElementById("email-toggle").getAttribute("aria-expanded"),
      focused: document.activeElement.id,
    }));
    assert.equal(measurements.checks.emailToggleOpen.formHidden, false, "email form did not expand");
    await page.click("#email-toggle");
    measurements.checks.emailToggleClosed = await page.evaluate(() => ({
      formHidden: document.getElementById("email-auth").hidden,
      expanded: document.getElementById("email-toggle").getAttribute("aria-expanded"),
    }));
    assert.equal(measurements.checks.emailToggleClosed.formHidden, true, "email form did not collapse");
    // Native validation must block a bad email before any app code runs.
    await page.click("#email-toggle");
    await page.fill("#auth-email", "not-an-email");
    await page.fill("#auth-password", "password123");
    measurements.checks.nativeValidationValid = await page.evaluate(() =>
      [document.getElementById("auth-email"), document.getElementById("auth-password")].map((input) => ({ id: input.id, valid: input.checkValidity() })),
    );
    assert.equal(measurements.checks.nativeValidationValid.find((i) => i.id === "auth-email").valid, false, "native email validation is not active");
    await page.click("#email-toggle");

    // 4. Provider visibility follows /api/config on the unconfigured server.
    const config8080 = await (await fetch(`${base}/api/config`)).json();
    measurements.checks.config8080 = config8080;
    measurements.checks.providersUnconfigured = await page.evaluate(() => ["auth-google", "auth-apple"].map((id) => {
      const button = document.getElementById(id);
      return { id, hidden: button.hidden, disabled: button.disabled, rendered: !!button.offsetHeight };
    }));
    measurements.checks.providersMatchConfig = (() => {
      const configured = Boolean(config8080.authEnabled);
      const enabled = new Set(config8080.authProviders || []);
      return measurements.checks.providersUnconfigured.every((button) => {
        const provider = button.id.replace("auth-", "");
        return button.hidden === !enabled.has(provider) && button.disabled === !(configured && enabled.has(provider));
      });
    })();
    assert.equal(measurements.checks.providersMatchConfig, true, "provider buttons do not match /api/config");

    // 5. Keyboard reachability and visible focus on the launch path.
    // Reload first: a blurred element leaves the sequential-focus starting
    // point where it was, which would skip the start of the landing order.
    await page.reload();
    await page.waitForFunction(() => window.__qd);
    const order = [];
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id || document.activeElement.className}`));
    }
    measurements.checks.tabOrder = order;
    measurements.checks.quickPlayKeyboardReachable = order.includes("button#quick-play");
    assert.equal(measurements.checks.quickPlayKeyboardReachable, true, `Tab never reached the primary CTA: ${order.join(" -> ")}`);
    assert.deepEqual(order.slice(0, 3), ["input#pilot-name", "button#quick-play", "button#practice"], `unexpected landing tab order: ${order.join(" -> ")}`);
    assert.ok(order.includes("button#lobby-help") && order.includes("button#qd-records-link"), `landing links are not keyboard reachable: ${order.join(" -> ")}`);
    await page.keyboard.press("Shift+Tab");
    measurements.checks.focusVisible = await page.evaluate(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return { element: active.id, matchesFocusVisible: active.matches(":focus-visible"), outline: `${style.outlineStyle} ${style.outlineWidth}` };
    });
    assert.equal(measurements.checks.focusVisible.matchesFocusVisible, true, "keyboard focus is not visible");
    assert.notEqual(measurements.checks.focusVisible.outline, "none 0px", "keyboard focus has no outline");

    // 6. Recorded gameplay flows on the real server: records, practice, room create/join, online launch, lobby return, report.
    await page.evaluate(() => document.getElementById("lobby-account").open = false);
    await page.locator(".qd-records-link").click();
    await page.waitForSelector(".qd-records[open]");
    await page.waitForFunction(() => !document.querySelector(".qd-board-status").textContent.includes("Loading"));
    measurements.checks.records = await page.evaluate(() => ({
      open: document.querySelector(".qd-records").open,
      tabs: [...document.querySelectorAll(".qd-record-tab")].map((tab) => tab.textContent),
      status: document.querySelector(".qd-board-status").textContent,
      career: document.querySelector(".qd-career h3")?.textContent,
      careerBody: document.querySelector(".qd-career p")?.textContent,
      rows: document.querySelectorAll(".qd-leaderboard tbody tr").length,
      hadError: !!document.querySelector(".qd-records .qd-retry:not([hidden])"),
    }));
    assert.equal(measurements.checks.records.open, true, "records dialog did not open");
    assert.deepEqual(measurements.checks.records.tabs, ["Overall", "Confluence"], "records scopes changed");
    assert.equal(measurements.checks.records.hadError, false, `records returned an error: ${measurements.checks.records.status}`);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.querySelector(".qd-records").open), false, "records dialog did not close");

    await page.fill("#pilot-name", "Alpha");
    await page.locator("#lobby-friends > summary").click();
    assert.equal(await page.evaluate(() => document.getElementById("lobby-friends").open), true, "friends disclosure did not open for room controls");
    await page.click("#create-room");
    await page.waitForFunction(() => window.__qd.getSnapshot().mode === "online", null, { timeout: 15000 });
    const created = await page.evaluate(() => window.__qd.getSnapshot());
    measurements.checks.createRoom = { mode: created.mode, room: created.room, connected: created.connected };
    assert.equal(created.mode, "online", "create room did not enter online play");
    assert.ok(/^[A-Z0-9]{4,6}$/.test(created.room || ""), `unexpected room code ${created.room}`);

    // A second pilot needs its own browser profile: the pilot token lives in
    // localStorage, and the server rejects the same identity joining twice.
    const joinerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const joiner = await joinerContext.newPage();
    joiner.on("pageerror", (error) => measurements.consoleErrors.push(`joiner pageerror: ${error.message}`));
    await joiner.goto(`${base}?room=${created.room}`);
    await joiner.waitForFunction(() => window.__qd);
    measurements.checks.roomInvite = await joiner.evaluate(() => ({
      friendsOpen: document.getElementById("lobby-friends").open,
      roomCodeValue: document.getElementById("room-code").value,
      status: document.getElementById("lobby-status").textContent.trim(),
      quickPlayInViewport: (() => { const rect = document.getElementById("quick-play").getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })(),
    }));
    assert.equal(measurements.checks.roomInvite.friendsOpen, true, "?room= invite did not auto-open the friends disclosure");
    assert.equal(measurements.checks.roomInvite.roomCodeValue, created.room, "invite code not prefilled");
    await joiner.fill("#pilot-name", "Bravo");
    await joiner.click("#join-room");
    await joiner.waitForFunction(() => window.__qd.getSnapshot().mode === "online", null, { timeout: 15000 });
    measurements.checks.joinRoom = await joiner.evaluate(() => ({ mode: window.__qd.getSnapshot().mode, room: window.__qd.getSnapshot().room, connected: window.__qd.getSnapshot().connected }));
    assert.equal(measurements.checks.joinRoom.room, created.room, "joiner did not reach the created room");

    await joiner.keyboard.press("Escape");
    await joiner.waitForSelector("#menu:not([hidden])");
    await joiner.click("#report-button");
    measurements.checks.reportFlow = await joiner.evaluate(() => ({ reportVisible: !document.getElementById("report").hidden, status: document.getElementById("report-status").textContent.trim() }));
    assert.equal(measurements.checks.reportFlow.reportVisible, true, "report panel did not open");
    await joiner.click("#close-report");
    await joiner.keyboard.press("Escape");
    await joiner.click("#leave-game");
    await joiner.waitForFunction(() => window.__qd.getSnapshot().mode === "lobby");
    measurements.checks.returnToLobby = await joiner.evaluate(() => ({ mode: window.__qd.getSnapshot().mode, lobbyVisible: !document.getElementById("lobby").hidden, helpVisible: !document.getElementById("help").hidden }));
    assert.equal(measurements.checks.returnToLobby.lobbyVisible, true, "return-to-lobby did not restore the landing page");

    await joiner.click("#lobby-help");
    measurements.checks.helpPanel = await joiner.evaluate(() => ({ open: !document.getElementById("help").hidden, headings: [...document.querySelectorAll("#help h3")].map((h) => h.textContent) }));
    assert.equal(measurements.checks.helpPanel.open, true, "How to fly did not open the controls panel");
    await joiner.click("#close-help");

    await joiner.click("#practice");
    await joiner.waitForFunction(() => window.__qd.getSnapshot().mode === "practice");
    measurements.checks.practice = await joiner.evaluate(() => ({ mode: window.__qd.getSnapshot().mode, mapId: window.__qd.getSnapshot().mapId }));
    await joiner.keyboard.press("Escape");
    await joiner.click("#leave-game");
    await joiner.waitForFunction(() => window.__qd.getSnapshot().mode === "lobby");

    await joiner.click("#quick-play");
    await joiner.waitForFunction(() => window.__qd.getSnapshot().mode === "online", null, { timeout: 15000 });
    measurements.checks.onlineLaunch = await joiner.evaluate(() => ({ mode: window.__qd.getSnapshot().mode, connected: window.__qd.getSnapshot().connected }));
    assert.equal(measurements.checks.onlineLaunch.mode, "online", "Play online did not start online play");
    await joinerContext.close();

    // 7. Reduced motion, then auth-error visibility on a configured server.
    const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(base);
    await reducedPage.waitForFunction(() => window.__qd);
    measurements.checks.reducedMotion = await reducedPage.evaluate(() => {
      const summary = document.querySelector("#lobby-friends > summary");
      const after = getComputedStyle(summary, "::after");
      return { markerTransitionDuration: after.transitionDuration, cardTransition: getComputedStyle(document.querySelector(".qd-map-card")).transitionDuration };
    });
    assert.equal(measurements.checks.reducedMotion.markerTransitionDuration, "0s", "disclosure marker still animates under prefers-reduced-motion");
    await reduced.close();

    const authContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const authPage = await authContext.newPage();
    authPage.on("pageerror", (error) => measurements.consoleErrors.push(`auth pageerror: ${error.message}`));
    await authPage.route("**/auth/v1/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }) });
    });
    await authPage.goto(authBase);
    await authPage.waitForFunction(() => window.__qd);
    const config8081 = await (await fetch(`${authBase}/api/config`)).json();
    measurements.checks.config8081 = config8081;
    measurements.checks.providersConfigured = await authPage.evaluate(() => ["auth-google", "auth-apple"].map((id) => {
      const button = document.getElementById(id);
      return { id, hidden: button.hidden, disabled: button.disabled, rendered: !!button.offsetHeight };
    }));
    assert.equal(config8081.authEnabled, true, "the configured test server did not report authEnabled");
    assert.equal(measurements.checks.providersConfigured.find((b) => b.id === "auth-google").hidden, false, "Google provider was hidden although /api/config enables it");
    assert.equal(measurements.checks.providersConfigured.find((b) => b.id === "auth-google").disabled, false, "Google provider was disabled although /api/config enables it");
    assert.equal(measurements.checks.providersConfigured.find((b) => b.id === "auth-apple").hidden, true, "Apple provider shown although /api/config does not list it");

    await authPage.click("#lobby-account > summary");
    await authPage.click("#email-toggle");
    await authPage.waitForSelector("#auth-sign-in:not([disabled])", { state: "visible" });
    await authPage.fill("#auth-email", "pilot@example.com");
    await authPage.fill("#auth-password", "password123");
    await authPage.click("#auth-sign-in");
    // Collapse the disclosure while the (stubbed, failing) request is in flight.
    await authPage.evaluate(() => { document.getElementById("lobby-account").open = false; });
    measurements.checks.errorWhileCollapsed = { collapsedAtError: !(await authPage.evaluate(() => document.getElementById("lobby-account").open)) };
    await authPage.waitForFunction(() => document.getElementById("auth-status").textContent.trim() && document.getElementById("auth-status").textContent !== "Working…", null, { timeout: 15000 });
    const authError = await authPage.evaluate(() => {
      const details = document.getElementById("lobby-account");
      const status = document.getElementById("auth-status");
      const rect = status.getBoundingClientRect();
      return { open: details.open, status: status.textContent.trim(), statusHeight: Math.round(rect.height), statusInViewport: rect.top >= 0 && rect.bottom <= window.innerHeight };
    });
    measurements.checks.authErrorWhileCollapsed = authError;
    assert.equal(authError.open, true, "auth disclosure stayed collapsed while an auth error needed showing");
    assert.equal(authError.statusInViewport, true, `auth error was not visible: ${authError.status}`);
    assert.match(authError.status, /Invalid login credentials|not configured|failed/i, `unexpected auth error copy: ${authError.status}`);
    await shot(authPage, "landing-desktop-1440x900-auth-error");
    await authContext.close();

    // 8. Destination-picker threshold, mounting the module source the same way
    // src/interface/interface.test.cjs does (the live page only ever has one world).
    const sourceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const sourcePage = await sourceContext.newPage();
    await sourcePage.setContent(fs.readFileSync(path.join(__dirname, "../../src/index.html"), "utf8"));
    await sourcePage.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "../../src/styles/main.css"), "utf8") });
    await sourcePage.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "../../src/interface/Interface.css"), "utf8") });
    await sourcePage.addScriptTag({
      content: fs
        .readFileSync(path.join(__dirname, "../../src/interface/Interface.js"), "utf8")
        .replace("import './Interface.css';", "")
        .replace("export class Interface", "window.Interface = class Interface"),
    });
    measurements.checks.setMapsThreshold = await sourcePage.evaluate(() => {
      const ui = new window.Interface({ maps: [{ id: "confluence", name: "Confluence", subtitle: "Only live world" }], onMap: () => {} });
      const picker = document.querySelector(".qd-map-picker");
      const oneMap = { hidden: picker.hidden, display: getComputedStyle(picker).display, cards: picker.querySelectorAll(".qd-map-card").length };
      ui.setMaps([
        { id: "confluence", name: "Confluence", subtitle: "Only live world" },
        { id: "canopy", name: "Canopy", subtitle: "Research garden" },
      ]);
      const twoMaps = { hidden: picker.hidden, display: getComputedStyle(picker).display, cards: picker.querySelectorAll(".qd-map-card").length };
      ui.setMaps([{ id: "confluence", name: "Confluence", subtitle: "Only live world" }]);
      const backToOne = { hidden: picker.hidden, cards: picker.querySelectorAll(".qd-map-card").length };
      ui.dispose();
      return { oneMap, twoMaps, backToOne, pickerRemovedAfterDispose: document.querySelectorAll(".qd-map-picker").length === 0 };
    });
    assert.equal(measurements.checks.setMapsThreshold.oneMap.hidden, true, "picker must stay hidden for one live map");
    assert.equal(measurements.checks.setMapsThreshold.twoMaps.hidden, false, "picker must appear for two live maps");
    assert.equal(measurements.checks.setMapsThreshold.twoMaps.cards, 2, "picker must render one card per live map");
    assert.equal(measurements.checks.setMapsThreshold.backToOne.hidden, true, "picker must hide again when the world count drops");
    assert.equal(measurements.checks.setMapsThreshold.pickerRemovedAfterDispose, true, "dispose must remove the picker");
    await sourceContext.close();

    assert.deepEqual(measurements.pageErrors, [], `page errors: ${measurements.pageErrors.join("; ")}`);
    fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify(measurements, null, 2));
    console.log("PASS: landing verification complete");
    const summary = Object.fromEntries(
      ["desktop", "short", "mobile", "narrow"].map((key) => {
        const viewport = measurements.viewports[key];
        return [key, { width: viewport.innerWidth, height: viewport.innerHeight, scrollWidth: viewport.documentScrollWidth, quickPlay: viewport.quickPlay, picker: viewport.picker, panelWidth: viewport.panelWidth }];
      }),
    );
    console.log(JSON.stringify({ viewports: summary, checks: measurements.checks }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify({ ...measurements, FAILED: String(error && error.stack || error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
