// Rooms you can walk into. Each one is built far away from the valley (x ≈ 300+) and the
// player is moved there through a short fade when they step on a doorway.
import { THREE, scene, stylize, registerMesh, toon } from './engine.js';
import { colliders } from './world.js';

let lib = {};
const T = 4; // dungeon tiles are 4 × 4 units

function put(name, x, z, { s = 1, ry = 0, y = 0, tint = null } = {}) {
  const src = lib[name];
  if (!src) { console.warn('missing', name); return null; }
  const o = src.clone(true);
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
  stylize(o);
  if (tint) o.traverse((m) => { if (m.isMesh) { m.userData.mats.std = m.userData.mats.std.clone(); m.userData.mats.toon = m.userData.mats.toon.clone(); m.userData.mats.std.color.set(tint); m.userData.mats.toon.color.set(tint); m.material = m.userData.mats.toon; } });
  scene.add(o);
  return o;
}
const wallCollider = (x1, z1, x2, z2) => {
  const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 1.2);
  for (let i = 0; i <= n; i++) colliders.push({ x: x1 + ((x2 - x1) * i) / n, z: z1 + ((z2 - z1) * i) / n, r: 0.9 });
};
const boxMesh = (w, h, d, col, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true; registerMesh(m, toon(col)); scene.add(m); return m;
};
const flat = (w, d, col, x, z, y = 0.06) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
  m.receiveShadow = true; registerMesh(m, toon(col)); scene.add(m); return m;
};

// A rectangular room: floor, side and back walls, open front (the camera looks in from the south).
function room(cx, cz, w, d, floor, { windows = false, tint = null } = {}) {
  const x0 = cx - (w * T) / 2, z0 = cz - (d * T) / 2;
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) put(floor, x0 + T / 2 + i * T, z0 + T / 2 + j * T, { tint });
  for (let i = 0; i < w; i++) put(windows && i % 2 ? 'wall_window_open' : 'wall', x0 + T / 2 + i * T, z0 - 0.5, { tint });
  for (let j = 0; j < d; j++) { put('wall', x0 - 0.5, z0 + T / 2 + j * T, { ry: Math.PI / 2, tint }); put('wall', x0 + w * T + 0.5, z0 + T / 2 + j * T, { ry: Math.PI / 2, tint }); }
  put('wall_corner', x0 - 0.5, z0 - 0.5, { tint }); put('wall_corner', x0 + w * T + 0.5, z0 - 0.5, { tint });
  // low front edge so the room reads as a room without hiding the inside
  const half = (w * T) / 2 - 2.2;
  boxMesh(half + 0.5, 0.7, 0.8, '#8d8a86', x0 - 0.5 + (half + 0.5) / 2, 0.35, z0 + d * T + 0.4);
  boxMesh(half + 0.5, 0.7, 0.8, '#8d8a86', x0 + w * T + 0.5 - (half + 0.5) / 2, 0.35, z0 + d * T + 0.4);
  wallCollider(x0, z0 - 0.4, x0 + w * T, z0 - 0.4);
  wallCollider(x0 - 0.4, z0, x0 - 0.4, z0 + d * T);
  wallCollider(x0 + w * T + 0.4, z0, x0 + w * T + 0.4, z0 + d * T);
  wallCollider(x0, z0 + d * T + 0.5, cx - 2.2, z0 + d * T + 0.5);
  wallCollider(cx + 2.2, z0 + d * T + 0.5, x0 + w * T, z0 + d * T + 0.5);
  // the doorway out, at the middle of the front edge
  return { x0, z0, x1: x0 + w * T, z1: z0 + d * T, door: { x: cx, z: z0 + d * T + 0.2 } };
}

export const INTERIORS = {};
export const lights = [];

function castle() {
  const cx = 300, cz = 0;
  const r = room(cx, cz, 7, 9, 'floor_tile_large', { windows: true });
  // royal carpet down the middle
  flat(4.2, r.z1 - r.z0 - 4, '#e8b54a', cx, (r.z0 + r.z1) / 2 + 2, 0.07);
  flat(3.4, r.z1 - r.z0 - 4, '#b8323a', cx, (r.z0 + r.z1) / 2 + 2, 0.08);
  // pillars and banners
  for (let j = 0; j < 4; j++) {
    const z = r.z0 + 8 + j * 7;
    for (const sx of [-1, 1]) {
      put('pillar_decorated', cx + sx * 7.5, z);
      colliders.push({ x: cx + sx * 7.5, z, r: 1.1 });
    }
  }
  for (let i = 0; i < 7; i++) if (i !== 3) put(i % 2 ? 'banner_shield_blue' : 'banner_patternA_red', r.x0 + 2 + i * T, r.z0 + 0.15);
  for (const z of [r.z0 + 6, r.z0 + 16, r.z0 + 26]) { put('torch_mounted', r.x0 + 0.1, z, { ry: Math.PI / 2 }); put('torch_mounted', r.x1 - 0.1, z, { ry: -Math.PI / 2 }); }
  // dais and throne
  boxMesh(10, 0.6, 5, '#a59f97', cx, 0.3, r.z0 + 3);
  boxMesh(7, 0.6, 3.6, '#c4beb4', cx, 0.8, r.z0 + 2.6);
  flat(6, 3, '#b8323a', cx, r.z0 + 2.6, 1.11);
  const throne = put('chair', cx, r.z0 + 2.4, { s: 2.1, y: 1.1, tint: '#ffcf4a' });
  colliders.push({ x: cx, z: r.z0 + 2.8, r: 3.2 });
  for (const sx of [-1, 1]) {
    put('chest_gold', cx + sx * 7.5, r.z0 + 2.2, { ry: Math.PI });
    put('coin_stack_large', cx + sx * 9, r.z0 + 3.6);
    put('candle_triple', cx + sx * 4.2, r.z0 + 5.2);
    colliders.push({ x: cx + sx * 7.5, z: r.z0 + 2.2, r: 1.2 });
  }
  put('sword_shield_gold', r.x0 + 0.4, r.z0 + 11, { ry: Math.PI / 2 });
  put('sword_shield_gold', r.x1 - 0.4, r.z0 + 11, { ry: -Math.PI / 2 });
  addLight(cx, 4, r.z0 + 4, '#ffcf8a', 60, 18);
  addLight(cx, 4, r.z0 + 16, '#ffb070', 40, 18);
  addLight(cx, 4, r.z0 + 28, '#ffb070', 36, 18);
  // grand side tables with feasts for the court
  for (const sx of [-1, 1]) { put('table_long_tablecloth_decorated_A', cx + sx * 11, r.z0 + 20, { ry: Math.PI / 2 }); colliders.push({ x: cx + sx * 11, z: r.z0 + 19, r: 1.4 }, { x: cx + sx * 11, z: r.z0 + 21.5, r: 1.4 }); }
  INTERIORS.castle = { name: 'Castle throne room', room: r, outside: { x: 4, z: -52.4, face: Math.PI }, exitTo: { x: 4, z: -48.2 }, king: { x: cx, z: r.z0 + 7 }, guards: [[cx - 4, r.z1 - 6], [cx + 4, r.z1 - 6]] };
  void throne;
}

function tavern() {
  const cx = 360, cz = 0;
  const r = room(cx, cz, 5, 4, 'floor_wood_large');
  // bar counter along the back
  boxMesh(12, 1.4, 1.4, '#6e4426', cx - 1, 0.7, r.z0 + 3.4);
  boxMesh(12.4, 0.2, 1.8, '#86532f', cx - 1, 1.5, r.z0 + 3.4);
  colliders.push({ x: cx - 5, z: r.z0 + 3.4, r: 1.2 }, { x: cx - 1, z: r.z0 + 3.4, r: 1.2 }, { x: cx + 3, z: r.z0 + 3.4, r: 1.2 });
  put('wall_shelves', cx - 4, r.z0 + 0.1); put('shelf_large', cx + 3, r.z0 + 0.6);
  for (const x of [r.x1 - 2, r.x1 - 3.6]) put('keg', x, r.z0 + 2);
  for (const [x, z] of [[cx - 5, r.z0 + 9], [cx + 4, r.z0 + 9], [cx - 5, r.z0 + 13.5], [cx + 4, r.z0 + 13.5]]) {
    put(rngPick(x + z) ? 'table_medium_tablecloth_decorated_B' : 'table_long_tablecloth_decorated_A', x, z);
    for (const sx of [-1.6, 1.6]) put('stool', x + sx, z + 1.6);
    colliders.push({ x, z, r: 1.6 });
  }
  put('barrel_large', r.x0 + 1.5, r.z1 - 2); put('crates_stacked', r.x1 - 1.6, r.z1 - 2.4);
  colliders.push({ x: r.x0 + 1.5, z: r.z1 - 2, r: 1 }, { x: r.x1 - 1.6, z: r.z1 - 2.4, r: 1.3 });
  put('torch_mounted', r.x0 + 0.1, r.z0 + 8, { ry: Math.PI / 2 }); put('torch_mounted', r.x1 - 0.1, r.z0 + 8, { ry: -Math.PI / 2 });
  addLight(cx, 4, r.z0 + 6, '#ffc890', 30, 20);
  INTERIORS.tavern = { name: 'The Sleepy Boar tavern', room: r, outside: null, exitTo: null, barkeep: { x: cx - 1, z: r.z0 + 1.8 } };
}
// The Ember Cave: Gagron the Hideous sleeps on a hoard at the back, between pools of lava.
function cave() {
  const cx = 420, cz = 0;
  const r = room(cx, cz, 8, 9, 'floor_tile_large', { tint: '#8a7466' });
  const rock = toon('#6e5a4c'), lava = new THREE.MeshBasicMaterial({ color: '#ff7a24', fog: false }), lavaHot = new THREE.MeshBasicMaterial({ color: '#ffd04a', fog: false });
  // stalagmites and boulders around the edges
  const spike = (x, z, h) => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.6 + h * 0.18, h, 6)); m.position.set(x, h / 2, z); m.castShadow = true; registerMesh(m, rock); scene.add(m); colliders.push({ x, z, r: 0.7 + h * 0.12 }); };
  const edgeSpots = [[r.x0 + 2, r.z0 + 3, 3.4], [r.x0 + 3.5, r.z0 + 12, 2.4], [r.x0 + 2, r.z0 + 22, 3], [r.x1 - 2, r.z0 + 4, 3.6], [r.x1 - 3, r.z0 + 14, 2.2], [r.x1 - 2, r.z0 + 25, 3.2], [r.x0 + 8, r.z0 + 2, 2.6], [r.x1 - 8, r.z0 + 2, 2.8]];
  for (const [x, z, h] of edgeSpots) spike(x, z, h);
  for (const [x, z, s] of [[r.x0 + 4, r.z1 - 5, 3], [r.x1 - 4, r.z1 - 6, 3.4], [r.x0 + 6, r.z0 + 7, 2.4]]) { const o = put(['rock_single_A', 'rock_single_B', 'rock_single_C'][Math.floor(s) % 3], x, z, { s, tint: '#7a6656' }); if (o) colliders.push({ x, z, r: s * 0.45 }); }
  // lava pools (glowing; walking on them is fine, they're just very warm-looking)
  for (const [x, z, w2, d2] of [[r.x0 + 6, r.z0 + 17, 5, 3], [r.x1 - 7, r.z0 + 9, 4, 3.5], [r.x1 - 6, r.z0 + 21, 3.5, 2.5]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), lava); m.rotation.x = -Math.PI / 2; m.scale.set(w2, d2, 1); m.position.set(x, 0.08, z); m.layers.set(1); scene.add(m);
    const m2 = new THREE.Mesh(new THREE.CircleGeometry(1, 24), lavaHot); m2.rotation.x = -Math.PI / 2; m2.scale.set(w2 * 0.55, d2 * 0.5, 1); m2.position.set(x, 0.09, z); m2.layers.set(1); scene.add(m2);
    addLight(x, 1.5, z, '#ff7a30', 30, 12);
    lavaPools.push(m2);
  }
  // Gagron's hoard
  for (const sx of [-1, 0, 1]) put('coin_stack_large', cx + sx * 3, r.z0 + 3.5, { s: 1.6 });
  put('chest_gold', cx - 5.5, r.z0 + 3, { ry: 0.4 }); put('chest_gold', cx + 5.5, r.z0 + 3.2, { ry: -0.5 });
  colliders.push({ x: cx - 5.5, z: r.z0 + 3, r: 1.2 }, { x: cx + 5.5, z: r.z0 + 3.2, r: 1.2 });
  for (const z of [r.z0 + 8, r.z0 + 20]) { put('torch_mounted', r.x0 + 0.1, z, { ry: Math.PI / 2 }); put('torch_mounted', r.x1 - 0.1, z, { ry: -Math.PI / 2 }); }
  addLight(cx, 6, r.z0 + 8, '#ff9a50', 50, 26);
  addLight(cx, 5, r.z1 - 6, '#ffb070', 30, 18);
  INTERIORS.cave = { name: 'The Ember Cave', room: r, outside: { x: CAVE.x, z: CAVE.z + 2.6 }, exitTo: { x: CAVE.x, z: CAVE.z + 5.4 }, lair: { x: cx, z: r.z0 + 11 } };
  caveMouth();
}
export const CAVE = { x: 62, z: -60 };
export const lavaPools = [];
// The way in, out in the valley: a rocky hill with a dark, glowing archway.
function caveMouth() {
  const { x, z } = CAVE;
  const hill = put('mountain_C_grass', x, z - 12, { s: 6.5 });
  if (hill) colliders.push({ x, z: z - 12, r: 6 });
  for (const [dx, dz, s] of [[-4.6, -0.6, 3.2], [4.6, -0.4, 3.4], [-6.5, -3, 3.8], [6.8, -3.2, 3.6]]) { const o = put('rock_single_C', x + dx, z + dz, { s, ry: dx }); if (o) colliders.push({ x: x + dx, z: z + dz, r: s * 0.42 }); }
  const archMat = toon('#7a6a5c');
  const arch = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.85, 8, 20, Math.PI)); arch.position.set(x, 0, z - 0.6); arch.castShadow = true; registerMesh(arch, archMat); scene.add(arch);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(2.9, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#160c08', fog: false })); hole.position.set(x, 0, z - 0.7); scene.add(hole);
  const glow = new THREE.PointLight('#ff7a30', 18, 9, 1.5); glow.position.set(x, 1.4, z - 0.2); scene.add(glow);
  colliders.push({ x: x - 3.1, z: z - 0.6, r: 0.9 }, { x: x + 3.1, z: z - 0.6, r: 0.9 }, { x, z: z - 1.6, r: 1.6 });
}
const rngPick = (v) => Math.abs(Math.sin(v * 12.9898)) > 0.5;

function addLight(x, y, z, col, intensity, dist) {
  const l = new THREE.PointLight(col, intensity, dist, 1.4); l.position.set(x, y, z); scene.add(l); lights.push(l);
}

export function buildInteriors(library, doors) {
  lib = library;
  // darkness around the rooms
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(320, 140), new THREE.MeshBasicMaterial({ color: '#1c120c' }));
  dark.rotation.x = -Math.PI / 2; dark.position.set(360, -0.08, 0); scene.add(dark);
  castle();
  tavern();
  cave();
  // where each building's front door is in the valley
  Object.assign(INTERIORS.tavern, doors.tavern);
}
