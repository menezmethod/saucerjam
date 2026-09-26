// Exercises the shipped production bundle through keyboard/mouse input in independent browsers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { createGameServer } = require("../server/server");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for authoritative state");
    await sleep(20);
  }
}
async function main() {
  const game = createGameServer();
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const chromePath =
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const launchOptions = {
    ...(chromePath && fs.existsSync(chromePath)
      ? { executablePath: chromePath }
      : {}),
    headless: true,
    args: [
      ...(process.env.CHROME_BACKEND === "native" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  };
  // One browser per client: each gets its own software GPU process, so one
  // page's rendering cannot starve another page's WebGL startup on a small CI runner.
  const browsers = [];
  const errors = [],
    contexts = [],
    out = path.join(__dirname, "../test-results");
  fs.mkdirSync(out, { recursive: true });
  async function newPage(options = {}) {
    const browser = await chromium.launch(launchOptions);
    browsers.push(browser);
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...options,
    });
    contexts.push(ctx);
    // Software WebGL on a CI runner draws 1-2 fps at full quality; input is sampled per frame.
    await ctx.addInitScript(() => { window.__SAUCERJAM_LOWGFX = true; });
    const page = await ctx.newPage();
    // Poll on a timer, not requestAnimationFrame: with several WebGL pages open,
    // headless Chromium stalls frames and a rAF poll never re-checks a true condition.
    const waitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = (fn, arg, options = {}) => waitForFunction(fn, arg, { polling: 100, ...options });
    page.on("pageerror", (e) => errors.push(e.message));
    const consoleLines = [];
    page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().endsWith("favicon.ico"))
        errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.__qd);
    } catch (error) {
      // Without this, a page that never boots fails as a bare timeout.
      const state = await page.evaluate(() => ({
        readyState: document.readyState,
        lobbyStatus: document.getElementById("lobby-status")?.textContent,
        uptimeMs: Math.round(performance.now()),
        resources: performance.getEntriesByType("resource").map((r) => `${r.name.replace(location.origin, "")} at ${Math.round(r.startTime)}ms took ${Math.round(r.duration)}ms ${r.responseStatus ?? ""}`),
      })).catch((e) => ({ evaluateFailed: e.message }));
      console.error("page never booted:", JSON.stringify({ errors, console: consoleLines.slice(-15), state }));
      throw error;
    }
    return page;
  }
  const snapshot = (page) => page.evaluate(() => window.__qd.getSnapshot());
  try {
    const a = await newPage();
    await a.screenshot({ path: path.join(out, "lobby.png") });
    await a.fill("#pilot-name", "Alpha");
    // One live world: the landing page selects it for the player, and room
    // controls live behind the "Play with friends" disclosure.
    await a.evaluate(() => { document.getElementById("lobby-friends").open = true; });
    await a.uncheck("#fill-bots");
    await a.click("#create-room");
    await a.waitForFunction(() => window.__qd.getSnapshot().mode === "online");
    const initialA = await snapshot(a),
      room = game.rooms.get(initialA.room),
      idA = initialA.playerId;
    const b = await newPage();
    await b.goto(`${url}?room=${initialA.room}`);
    await b.waitForFunction(() => window.__qd);
    assert.equal(await b.inputValue("#room-code"), initialA.room);
    await b.fill("#pilot-name", "Bravo");
    await b.click("#join-room");
    await b.waitForFunction(() => window.__qd.getSnapshot().mode === "online");
    let idB = (await snapshot(b)).playerId;
    await until(() => room.sim.players.has(idA) && room.sim.players.has(idB));
    Object.assign(room.sim.players.get(idA), { x: -50, z: -50, angle: 0, vx: 0, vz: 0, protectedUntil: 0 });
    Object.assign(room.sim.players.get(idB), { x: -50, z: -40, angle: 0, vx: 0, vz: 0, protectedUntil: 0 });
    await Promise.all([
      a.waitForFunction((id) => window.__qd.getSnapshot().state.players.some((p) => p.id === id), idB),
      b.waitForFunction((id) => window.__qd.getSnapshot().state.players.some((p) => p.id === id), idA),
    ]);
    console.log(
      "PASS: independent browser clients join the same room through an invite",
    );
    const startA = { x: room.sim.players.get(idA).x, z: room.sim.players.get(idA).z };
    // Input is sampled once per rendered frame (see fireOnce below): a slow
    // or loaded CI runner delivers fewer frames in a fixed wall-clock hold,
    // so less real movement accumulates in the same 500ms -- this held
    // intermittently on CI (never locally) across multiple unrelated PRs.
    // A longer hold, not a longer post-hoc wait, is the actual margin: once
    // the key is up, no further movement accrues no matter how long until()
    // waits afterward.
    await a.keyboard.down("KeyW");
    await sleep(900);
    await a.keyboard.up("KeyW");
    await until(
      () =>
        Math.hypot(
          room.sim.players.get(idA).x - startA.x,
          room.sim.players.get(idA).z - startA.z,
        ) > 2,
      8000,
    );
    await b.waitForFunction(
      ({ id, x, z }) => {
        const p = window.__qd
          .getSnapshot()
          .state.players.find((p) => p.id === id);
        return Math.hypot(p.x - x, p.z - z) > 2;
      },
      { id: idA, x: startA.x, z: startA.z },
    );
    const angle = room.sim.players.get(idA).angle;
    await a.keyboard.down("KeyA");
    await sleep(600);
    await a.keyboard.up("KeyA");
    await until(() => Math.abs(room.sim.players.get(idA).angle - angle) > 0.3, 8000);
    // Let the key-release packet arrive before repositioning the test ships.
    await until(() => {
      const input = room.sim.players.get(idA).input;
      return input.turn === 0 && input.thrust === 0 && (!input.move || Math.hypot(input.move.x,input.move.z)===0);
    });
    console.log("PASS: directional movement replicates to the other browser");
    const portal = room.sim.map.portals[0];
    Object.assign(room.sim.players.get(idA), {
      x: portal.x,
      z: portal.z,
      vx: 0,
      vz: 0,
      portalLockUntil: 0,
    });
    await a.waitForFunction(
      ({ id, x, z }) => {
        const player = window.__qd.getSnapshot().state.players.find((p) => p.id === id);
        return player && Math.hypot(player.x - x, player.z - z) < 0.1;
      },
      { id: idA, x: portal.exitX, z: portal.exitZ },
    );
    await a.waitForFunction(
      () => document.querySelector("#notice").textContent === "Slipstream jump",
      null,
      { timeout: 15000 },
    );
    await a.screenshot({ path: path.join(out, "portal-traversal.png") });
    console.log("PASS: authoritative portal traversal snaps the client with readable feedback");
    // Input is sampled once per rendered frame; on a slow CI runner a fixed
    // 100ms press can fall between frames. Hold until the server fires once.
    async function fireOnce(page, shooter) {
      const before = shooter.nextFire;
      await page.keyboard.down("Space");
      try { await until(() => shooter.nextFire !== before, 10000); }
      finally { await page.keyboard.up("Space"); }
    }
    function fixture(weapon, az, bz) {
      const pa = room.sim.players.get(idA),
        pb = room.sim.players.get(idB);
      Object.assign(pa, {
        x: -56,
        z: az - 30,
        angle: 0,
        vx: 0,
        vz: 0,
        aimAngle: 0,
        energy: 100,
        nextFire: 0,
        protectedUntil: 0,
        alive: true,
        health: 100,
      });
      Object.assign(pb, {
        x: -56,
        z: bz - 30,
        vx: 0,
        vz: 0,
        protectedUntil: 0,
        alive: true,
        health: 100,
        lastDamage: room.sim.time,
      });
      room.sim.projectiles.clear();
      return { pa, pb };
    }
    let { pa, pb } = fixture("LASER", -7, 4);
    await sleep(400);
    await a.keyboard.down("Space");
    await until(() => !pb.alive, 4000);
    await a.keyboard.up("Space");
    await b.waitForSelector("#death-panel:not([hidden])");
    assert.equal(pa.kills, 1);
    await a.keyboard.press("KeyT");
    await a.waitForSelector("#scoreboard:not([hidden])");
    await a.waitForFunction(() => /Alpha \(you\)1/.test(document.querySelector('#scores').textContent));
    assert.match(await a.textContent("#scores"), /Alpha \(you\)1/);
    await a.keyboard.press("Escape");
    await until(() => pb.alive, 4500);
    await b.waitForSelector("#death-panel[hidden]", { state: "attached" });
    assert.equal(pb.health, 100);
    console.log(
      "PASS: keyboard-fired lasers cause one kill, visible death, score, and automatic respawn",
    );
    ({ pa, pb } = fixture("GRENADE", -8, 8));
    await a.keyboard.press("Digit2");
    await a.waitForFunction(() => window.__qd.getSnapshot().weapon === "GRENADE");
    await until(() => pa.weapon === "GRENADE");
    await fireOnce(a, pa);
    await until(() => pb.health < 100);
    assert.equal(pb.health, 20);
    console.log("PASS: Nova Charge arc and authoritative area damage");
    ({ pa, pb } = fixture("BOUNCE", 27, 22));
    await a.keyboard.press("Digit3");
    await a.waitForFunction(() => window.__qd.getSnapshot().weapon === "BOUNCE");
    await until(() => pa.weapon === "BOUNCE");
    await fireOnce(a, pa);
    await until(() => pb.health < 100);
    assert.equal(pb.health, 66);
    console.log(
      "PASS: Ricochet Disc banks and damages the other player",
    );
    await a.keyboard.press("KeyV");
    assert.equal((await snapshot(a)).view, 2);
    await sleep(900);
    ({ pa, pb } = fixture("LASER", 0, 0));
    pb.x = -50;
    await a.keyboard.press("Digit1");
    await sleep(300);
    // Project the authoritative target using the actual camera matrices, so this
    // validates mouse aim independently of preset distance or field of view.
    const { Vector3, Matrix4 } = require('three');
    const camera = (await snapshot(a)).camera;
    const target = new Vector3(pb.x, 0.9, pb.z)
      .applyMatrix4(new Matrix4().fromArray(camera.matrix))
      .applyMatrix4(new Matrix4().fromArray(camera.projection));
    await a.mouse.move((target.x + 1) * 640, (1 - target.y) * 400);
    await a.mouse.down();
    await until(() => pb.health < 100);
    await a.mouse.up();
    assert.equal(pa.angle, 0);
    console.log("PASS: mouse aims and fires independently of ship heading");
    await a.screenshot({ path: path.join(out, "top-down.png") });
    await a.keyboard.press("Escape");
    await a.locator('.qd-advanced-camera summary').click();
    await a.locator('#qd-camera').selectOption('1');
    assert.equal((await snapshot(a)).view, 1);
    await a.locator('#qd-camera').selectOption('3');
    await a.click('#resume');
    assert.equal((await snapshot(a)).view, 3);
    await sleep(300);
    await a.screenshot({ path: path.join(out, "isometric.png") });
    await a.keyboard.press("KeyV");
    assert.equal((await snapshot(a)).view, 2);
    await a.keyboard.press("KeyV");
    assert.equal((await snapshot(a)).view, 0);
    await a.keyboard.press("KeyM");
    assert.ok(
      await a
        .locator(".radar")
        .evaluate((el) => el.classList.contains("collapsed")),
    );
    await a.keyboard.press("KeyM");
    console.log("PASS: all four cameras and radar toggle");
    const oldId = idB;
    await b.context().setOffline(true);
    await until(() => !room.sim.players.has(oldId), 8000);
    await b.context().setOffline(false);
    await b.waitForFunction(
      (oldId) => {
        const s = window.__qd.getSnapshot();
        return s.connected && s.playerId !== oldId;
      },
      oldId,
      { timeout: 15000 },
    );
    idB = (await snapshot(b)).playerId;
    assert.equal(room.humans.size, 2);
    assert.equal(room.sim.players.has(oldId), false);
    console.log(
      "PASS: network loss reconnects to the same room without a ghost player",
    );
    const lag = await newPage();
    // Engine.IO may keep HTTP polling when WebSocket upgrade is delayed.
    // Apply the same network latency to both supported transports.
    await lag.route('**/socket.io/**',async route=>{
      await sleep(60);const response=await route.fetch();await sleep(60);
      await route.fulfill({response});
    });
    await lag.routeWebSocket(/socket\.io/, (client) => {
      const server = client.connectToServer();
      const forward = (route, message) =>
        setTimeout(() => {
          try {
            route.send(message);
          } catch {
            /* Context may close while a packet is in flight. */
          }
        }, 60);
      client.onMessage((message) => forward(server, message));
      server.onMessage((message) => forward(client, message));
    });
    // Reload after interception is installed so the initial socket is delayed too.
    await lag.goto(url);
    await lag.waitForFunction(() => window.__qd);
    await lag.fill("#pilot-name", "Lag test");
    await lag.evaluate(() => { document.getElementById("lobby-friends").open = true; });
    await lag.fill("#room-code", initialA.room);
    await lag.click("#join-room");
    await lag.waitForFunction(
      () => window.__qd.getSnapshot().mode === "online",
    );
    await lag.waitForFunction(
      () =>
        parseInt(document.getElementById("connection").textContent, 10) >= 110,
    );
    const lagStart = await snapshot(lag);
    await lag.keyboard.down("KeyW");
    await sleep(800);
    await lag.keyboard.up("KeyW");
    await sleep(800);
    const lagEnd = await snapshot(lag),
      lagServer = room.sim.players.get(lagEnd.playerId);
    assert.ok(
      Math.hypot(
        lagServer.x - lagStart.predicted.x,
        lagServer.z - lagStart.predicted.z,
      ) > 1,
    );
    assert.ok(
      Math.hypot(
        lagEnd.predicted.x - lagServer.x,
        lagEnd.predicted.z - lagServer.z,
      ) < 0.75,
    );
    await lag.close();
    console.log(
      "PASS: movement prediction reconciles with 120ms simulated round-trip delay",
    );
    await a.keyboard.press("Escape");
    await a.click("#leave-game");
    await a.click("#practice");
    await a.waitForFunction(
      () => window.__qd.getSnapshot().mode === "practice",
    );
    await a.keyboard.press("Escape");
    const paused = (await snapshot(a)).state.tick;
    await sleep(300);
    assert.equal((await snapshot(a)).state.tick, paused);
    await a.click("#resume");
    await a.waitForFunction(
      (tick) => window.__qd.getSnapshot().state.tick > tick,
      paused,
    );
    await a.screenshot({ path: path.join(out, "practice.png") });
    console.log("PASS: leave/reenter and offline practice pause/resume");
    // Browser fetch failure for the cosmetic GLTF must never prevent play.
    const mobile = await newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.route("**/*.glb", (route) => route.abort());
    await mobile.reload();
    await mobile.waitForFunction(() => window.__qd);
    await mobile.screenshot({ path: path.join(out, "mobile-lobby.png") });
    assert.ok(await mobile.locator("#practice").isVisible());
    // .tap() dispatches a real touch-flavored pointer event; .click() sends
    // a mouse-flavored one, which now (correctly) hides the touch chrome.
    await mobile.tap("#practice");
    await mobile.waitForFunction(
      () => window.__qd.getSnapshot().mode === "practice",
    );
    assert.ok(await mobile.locator("#touch-controls").isVisible());
    assert.ok(await mobile.locator("#touch-onboarding").isVisible());
    await mobile.click("#dismiss-touch-onboarding");
    assert.ok(await mobile.locator("#touch-onboarding").isHidden());
    assert.equal(await mobile.locator('[data-weapon="LASER"]').getAttribute("aria-label"), "Plasma Beam — 25 energy");
    assert.ok(await mobile.locator('[data-weapon="LASER"] .weapon-icon').isVisible());
    for (const weapon of ["LASER", "GRENADE", "BOUNCE"])
      assert.ok(await mobile.locator(`[data-weapon="${weapon}"]`).isVisible());
    assert.equal(await mobile.locator("#weapon-prev").count(), 0);
    assert.equal(await mobile.locator("#weapon-next").count(), 0);
    assert.ok(await mobile.locator(".desktop-key").isHidden());
    await mobile.screenshot({ path: path.join(out, "mobile-practice.png") });
    assert.equal(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    // There is no Fire button and no bounded joystick zone: touch/mouse
    // input is dispatched on #arena with per-pointer roles instead. HUD
    // chrome (weapons vs. radar) must still never overlap itself.
    const noHudOverlap = async (page) =>
      page.evaluate(() => {
        const weapons = document.querySelector(".weapons").getBoundingClientRect();
        const radar = document.querySelector(".radar").getBoundingClientRect();
        const clear = (r1, r2) =>
          r1.right <= r2.left || r2.right <= r1.left || r1.bottom <= r2.top || r2.bottom <= r1.top;
        return clear(weapons, radar);
      });
    assert.ok(await noHudOverlap(mobile), "weapons overlap the radar (portrait)");
    // The first touch in the lower part of the screen claims movement; a
    // second finger anywhere fires -- dispatched as real touch input (CDP),
    // since a synthetic DOM PointerEvent can't hold the pointer capture the
    // arena handler needs.
    const cdp = await mobile.context().newCDPSession(mobile);
    const energyBefore = await mobile.evaluate(
      () => window.__qd.getSnapshot().state.players.find((p) => p.id === "local").energy,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 390 * 0.2, y: 844 * 0.8, id: 1 }],
    });
    await sleep(80);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 390 * 0.2, y: 844 * 0.8, id: 1 },
        { x: 390 * 0.8, y: 844 * 0.4, id: 2 },
      ],
    });
    await sleep(250);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const energyAfter = await mobile.evaluate(
      () => window.__qd.getSnapshot().state.players.find((p) => p.id === "local").energy,
    );
    assert.ok(energyAfter < energyBefore, "second finger did not fire (energy unchanged)");
    console.log(
      "PASS: mobile layout, HUD overlap-free, move+fire role assignment, and playable missing-model fallback",
    );
    // Touch fire is a relative stick, not a tap-at-a-point: a quick tap (no
    // drag) must not throw the grenade a fixed distance in a stale
    // direction -- it should snap to the nearest visible enemy instead.
    // Dragging past the dead zone should then scale the throw distance
    // with how far the stick is pushed, up to the weapon's range.
    await mobile.tap('[data-weapon="GRENADE"]');
    // Earlier in this test, the second-finger check fired the (default)
    // laser and spent energy; a grenade costs 100 and simply won't fire on
    // insufficient energy, regardless of the pulse -- wait for regen.
    await mobile.waitForFunction(
      () => window.__qd.getSnapshot().state.players.find((p) => p.id === "local").energy >= 100,
      null,
      { timeout: 8000 },
    );
    const before = await mobile.evaluate(() => window.__qd.getSnapshot());
    const me = before.predicted;
    // Grenade charges on touch-down instead of firing immediately -- energy
    // must not drop while the thumb is still down (that was the bug: the
    // one grenade you have got thrown at whatever pickTarget/stale aim
    // happened to be, before you had a chance to aim it), and must drop by
    // exactly one shot's cost the instant it's released.
    const energyBeforeCharge = before.state.players.find((p) => p.id === before.playerId).energy;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 390 * 0.7, y: 844 * 0.5, id: 3 }],
    });
    await sleep(150);
    const tapped = await mobile.evaluate(() => window.__qd.getSnapshot());
    const energyWhileCharging = tapped.state.players.find((p) => p.id === tapped.playerId).energy;
    // Energy regenerates continuously (RULES.energyRegen), so it can only
    // rise while charging -- a real premature throw would drop it by the
    // grenade's full 100 cost, not the couple of points regen adds.
    assert.ok(
      energyWhileCharging >= energyBeforeCharge - 1,
      `grenade must not fire while still charging on touch-down (before ${energyBeforeCharge.toFixed(1)}, while charging ${energyWhileCharging.toFixed(1)})`,
    );
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(150);
    const energyAfterRelease = (await mobile.evaluate(() => window.__qd.getSnapshot())).state.players.find(
      (p) => p.id === tapped.playerId,
    ).energy;
    assert.ok(energyAfterRelease < energyWhileCharging, "grenade should throw on release, not before");
    assert.ok(tapped.aim, "tap should have set an aim point, not left it null");
    const tapDist = Math.hypot(tapped.aim.x - me.x, tapped.aim.z - me.z);
    // Mirror pickTarget's own filters (alive, not spawn-protected) so this
    // doesn't flake if a bot happens to be mid-respawn at the exact moment.
    const candidateDists = tapped.state.players
      .filter((p) => p.id !== tapped.playerId && p.alive && !(p.protectedUntil > tapped.state.time))
      .map((p) => Math.hypot(p.x - me.x, p.z - me.z));
    assert.ok(candidateDists.length > 0, "expected at least one live, unprotected enemy for the tap to target");
    const nearestEnemyDist = Math.min(...candidateDists);
    assert.ok(
      Math.abs(tapDist - nearestEnemyDist) < 1,
      `tap should snap to the nearest enemy (aim ${tapDist.toFixed(1)} vs enemy ${nearestEnemyDist.toFixed(1)})`,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 390 * 0.7, y: 844 * 0.5, id: 4 }],
    });
    await sleep(40);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 390 * 0.7 + 200, y: 844 * 0.5, id: 4 }],
    });
    // Aim eases toward its target (~50ms time constant) instead of
    // snapping, so this needs a moment to actually converge on 20.
    await sleep(300);
    const dragged = await mobile.evaluate(() => window.__qd.getSnapshot());
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const dragDist = Math.hypot(dragged.aim.x - me.x, dragged.aim.z - me.z);
    assert.ok(Math.abs(dragDist - 20) < 0.5, `full drag should throw at max range 20, got ${dragDist.toFixed(1)}`);
    console.log("PASS: touch grenade taps snap to the nearest enemy and drag scales throw distance");
    // Regression: an external reset (round recap, blur, death) that fires
    // without a matching pointerup must not permanently lock the joystick
    // out. Headless tests never blur/hide/end a round mid-drag, which is
    // exactly how this shipped broken once.
    const dragPoint = await mobile.evaluate(() => ({ x: innerWidth * 0.25, y: innerHeight * 0.75 }));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: dragPoint.x, y: dragPoint.y, id: 9 }],
    });
    await sleep(80);
    // Force clearInput() without ever sending a touchEnd for id 9 -- the
    // exact "stale pointerId" scenario.
    await mobile.evaluate(() =>
      document.dispatchEvent(new CustomEvent("qd:interface-modal", { detail: { open: false } })),
    );
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(80);
    // A fresh drag afterward must still move the stick, not silently no-op.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: dragPoint.x, y: dragPoint.y, id: 10 }],
    });
    await sleep(60);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: dragPoint.x + 40, y: dragPoint.y, id: 10 }],
    });
    await sleep(150);
    const knobMoved = await mobile.evaluate(() => {
      const knob = document.querySelector("#touch-joystick .stick-knob");
      return knob.style.transform !== "";
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(80);
    assert.ok(knobMoved, "joystick stayed locked out after an external reset mid-drag");
    console.log("PASS: joystick survives an external input reset mid-drag (no stale pointerId lockout)");
    // A landscape phone (short viewport height) is a distinct failure mode
    // from portrait and was previously untested.
    const landscape = await newPage({
      viewport: { width: 852, height: 393 },
      isMobile: true,
      hasTouch: true,
    });
    await landscape.tap("#practice");
    await landscape.waitForFunction(
      () => window.__qd.getSnapshot().mode === "practice",
    );
    assert.ok(await noHudOverlap(landscape), "vitals overlap the radar (landscape)");
    await landscape.screenshot({ path: path.join(out, "mobile-landscape.png") });
    await landscape.close();
    console.log("PASS: landscape HUD has no overlap");
    assert.deepEqual(errors, []);
    console.log("PASS: no browser exceptions or broken application requests");
  } finally {
    for (const c of contexts) await c.close();
    for (const b of browsers) await b.close();
    await game.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
