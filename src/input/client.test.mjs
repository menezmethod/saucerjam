import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { stickVector, reanchor } from "./stick.js";

// Exercise the production methods without booting WebGL/audio/network. DOM
// shims test event routing, not native browser pointer-capture semantics.
const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fixture() {
  class Element {
    constructor() {
      this.listeners = new Map(); this.captured = new Set(); this.style = {};
      this.hidden = true; this.editable = false;
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.knob = { style: {} };
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, detail = {}) {
      for (const fn of this.listeners.get(type) || []) fn({ type, target: this, ...detail });
    }
    querySelector() { return this.knob; }
    closest() { return this.editable ? this : null; }
    getBoundingClientRect() { return { left: 100, width: 400, height: 800 }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) {
      this.captured.delete(id);
      this.emit("lostpointercapture", { pointerId: id });
    }
  }
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = new Element(), window = new Element();
  document.getElementById = $; document.querySelectorAll = () => [];
  document.hidden = false;
  const context = vm.createContext({ document, window, stickVector, reanchor, HTMLButtonElement: class {} });
  vm.runInContext(`const $ = id => document.getElementById(id);\n${source.slice(source.indexOf("class Game {"), source.lastIndexOf("\ntry {"))}\nglobalThis.Game = Game;`, context);
  const game = Object.create(context.Game.prototype);
  Object.assign(game, {
    mode: "practice", keys: new Set(), touchRoles: new Map(), firePointerId: null,
    firing: false, autoFire: false, oneHandMode: false,
    stick: { x: 0, z: 0, active: false }, stickOrigin: null,
    fireStick: { x: 0, z: 0, active: false }, fireStickOrigin: null,
    mouse: null, aim: null, seq: 0, weapon: "LASER",
    renderer: { screenMovement: (x, z) => ({ x, z }) },
    unlockAudio() {}, bindInputChrome() {},
  });
  game.bind();
  const pointer = (id, x, y = 650, pointerType = "touch") =>
    ({ pointerId: id, clientX: x, clientY: y, pointerType, button: 0, buttons: 1 });
  return { game, $, document, window, pointer, Element };
}

test("movement and aim are sampled independently on the next input tick", () => {
  const { game, $, pointer } = fixture(), arena = $("arena");
  arena.emit("pointerdown", pointer(1, 180));
  arena.emit("pointermove", pointer(1, 215));
  arena.emit("pointerdown", pointer(2, 400));
  arena.emit("pointermove", pointer(2, 420, 450));
  const input = game.input();
  assert.equal(input.move.x, 1); assert.equal(input.fire, true);
  assert.equal(game.fireStick.active, true); assert.equal(input.seq, 1);
  assert.equal(input.thrust, 0); assert.equal(input.turn, 0);
});

test("mouse wheel cycles weapons without affecting touch input", () => {
  const { game, window } = fixture();
  let prevented = false;
  window.emit("wheel", { deltaY: -1, preventDefault: () => { prevented = true; } });
  assert.equal(game.weapon, "BOUNCE");
  assert.equal(prevented, true);
  window.emit("wheel", { deltaY: 1, preventDefault: () => {} });
  assert.equal(game.weapon, "LASER");
});

test("cancel or lost capture releases only its owner, not the other thumb or keyboard", () => {
  for (const type of ["pointercancel", "lostpointercapture"]) {
    const { game, $, window, pointer } = fixture(), arena = $("arena");
    arena.emit("pointerdown", pointer(1, 180));
    arena.emit("pointermove", pointer(1, 215));
    arena.emit("pointerdown", pointer(2, 400));
    game.keys.add("KeyW");
    (type === "pointercancel" ? window : arena).emit(type, pointer(2, 400));
    assert.equal(game.firing, false); assert.equal(game.stick.active, true);
    assert.equal(game.keys.has("KeyW"), true);
    arena.emit("pointerdown", pointer(3, 410));
    (type === "pointercancel" ? window : arena).emit(type, pointer(1, 215));
    assert.equal(game.stick.active, false); assert.equal(game.firing, true);
    assert.equal(game.firePointerId, 3);
  }
});

test("extra touch and hybrid mouse cannot steal a firing finger's aim", () => {
  const { game, $, pointer } = fixture(), arena = $("arena");
  arena.emit("pointerdown", pointer(2, 400));
  arena.emit("pointerdown", pointer(3, 450));
  arena.emit("pointermove", pointer(3, 490));
  arena.emit("pointermove", pointer(4, 200, 400, "mouse"));
  assert.equal(game.firePointerId, 2); assert.equal(game.fireStickOrigin.x, 400);
  assert.equal(game.mouse, null);
  assert.equal(game.touchRoles.has(3), false);
});

test("mouse hover aims, primary fires, and secondary release does not stop primary", () => {
  const { game, $, window, pointer } = fixture(), arena = $("arena");
  arena.emit("pointermove", pointer(1, 220, 400, "mouse"));
  assert.equal(game.mouse.x, 220); assert.equal(game.firing, false);
  arena.emit("pointerdown", pointer(1, 250, 400, "mouse"));
  window.emit("pointerup", { ...pointer(1, 250, 400, "mouse"), button: 2 });
  assert.equal(game.firing, true);
  window.emit("pointerup", { ...pointer(1, 250, 400, "mouse"), buttons: 0 });
  assert.equal(game.firing, false); assert.equal(arena.captured.size, 0);
  arena.emit("pointerdown", pointer(1, 250, 400, "mouse"));
  arena.emit("pointermove", { ...pointer(1, 260, 400, "mouse"), buttons: 2 });
  assert.equal(game.firing, false, "primary release stops fire while secondary remains down");
});

test("blur, visibility loss and rotation release captures, reset aim and allow re-grip", () => {
  for (const event of ["blur", "visibilitychange", "orientationchange"]) {
    const { game, $, window, document, pointer } = fixture(), arena = $("arena");
    arena.emit("pointerdown", pointer(1, 180));
    arena.emit("pointermove", pointer(1, 220));
    arena.emit("pointerdown", pointer(2, 400));
    game.keys.add("KeyW"); game.aim = { x: 4, z: 8 };
    (event === "visibilitychange" ? document : window).emit(event);
    assert.equal(arena.captured.size, 0); assert.equal(game.touchRoles.size, 0);
    assert.equal(game.keys.size, 0); assert.equal(game.mouse, null);
    assert.equal(game.aim, null); assert.equal(game.stick.active, false);
    assert.equal(game.firing, false);
    arena.emit("pointerdown", pointer(7, 200));
    arena.emit("pointermove", pointer(7, 240));
    assert.equal(game.stick.active, true);
  }
});

test("keyup in an editable target releases movement and form focus clears held input", () => {
  const { game, document, Element } = fixture(), field = new Element();
  field.editable = true; game.keys.add("KeyW");
  game.key({ target: field, code: "KeyW" }, false);
  assert.equal(game.keys.has("KeyW"), false);
  game.key({ target: field, code: "Space" }, true);
  assert.equal(game.keys.has("Space"), false);
  game.keys.add("KeyW"); document.emit("focusin", { target: field });
  assert.equal(game.keys.size, 0);
});

test("touch split uses the canvas bounds and inactive play ignores new input", () => {
  const { game, $, pointer } = fixture(), arena = $("arena");
  arena.emit("pointerdown", pointer(1, 290)); // canvas midpoint is x=300
  assert.equal(game.touchRoles.get(1), "move");
  game.clearInput(); $("menu").hidden = false;
  arena.emit("pointerdown", pointer(2, 400));
  arena.emit("pointermove", pointer(3, 450, 600, "mouse"));
  assert.equal(game.firing, false); assert.equal(game.mouse, null);
});

test("canvas resize follows CSS dimensions, skips duplicate resize and updates DPR", () => {
  const rendererSource = readFileSync(new URL("../core/ArenaRenderer.js", import.meta.url), "utf8");
  const context = vm.createContext({ devicePixelRatio: 2 });
  vm.runInContext(rendererSource.slice(rendererSource.indexOf("export class")).replace("export class", "globalThis.ArenaRenderer = class"), context);
  const renderer = Object.create(context.ArenaRenderer.prototype);
  let rect = { width: 390, height: 700 }, updates = 0, resets = 0;
  const sizes = [], ratios = [];
  Object.assign(renderer, {
    canvas: { getBoundingClientRect: () => rect },
    renderer: { setSize: (...args) => sizes.push(args), setPixelRatio: ratio => ratios.push(ratio) },
    camera: { updateProjectionMatrix: () => updates++ }, rig: { reset: () => resets++ },
  });
  renderer.resize(); renderer.resize();
  assert.deepEqual(sizes, [[390, 700, false]]);
  assert.equal(renderer.camera.aspect, 390 / 700); assert.equal(updates, 1);
  rect = { width: 844, height: 390 }; renderer.resize();
  assert.equal(renderer.camera.aspect, 844 / 390); assert.equal(resets, 2);
  context.devicePixelRatio = 1; renderer.resize();
  assert.deepEqual(ratios, [1.5, 1.5, 1]);
  rect = { width: 0, height: 0 }; renderer.resize();
  assert.equal(renderer.camera.aspect, 1);
});
