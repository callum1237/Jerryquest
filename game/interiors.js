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
function room(cx, cz, w, d, floor, { windows = false } = {}) {
  const x0 = cx - (w * T) / 2, z0 = cz - (d * T) / 2;
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) put(floor, x0 + T / 2 + i * T, z0 + T / 2 + j * T);
  for (let i = 0; i < w; i++) put(windows && i % 2 ? 'wall_window_open' : 'wall', x0 + T / 2 + i * T, z0 - 0.5);
  for (let j = 0; j < d; j++) { put('wall', x0 - 0.5, z0 + T / 2 + j * T, { ry: Math.PI / 2 }); put('wall', x0 + w * T + 0.5, z0 + T / 2 + j * T, { ry: Math.PI / 2 }); }
  put('wall_corner', x0 - 0.5, z0 - 0.5); put('wall_corner', x0 + w * T + 0.5, z0 - 0.5);
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
  const r = room(cx, cz, 5, 7, 'floor_tile_large', { windows: true });
  // royal carpet down the middle
  flat(4.2, r.z1 - r.z0 - 4, '#e8b54a', cx, (r.z0 + r.z1) / 2 + 2, 0.07);
  flat(3.4, r.z1 - r.z0 - 4, '#b8323a', cx, (r.z0 + r.z1) / 2 + 2, 0.08);
  // pillars and banners
  for (let j = 0; j < 3; j++) {
    const z = r.z0 + 8 + j * 7;
    for (const sx of [-1, 1]) {
      put('pillar_decorated', cx + sx * 6.5, z);
      colliders.push({ x: cx + sx * 6.5, z, r: 1.1 });
    }
  }
  for (let i = 0; i < 5; i++) if (i !== 2) put(i % 2 ? 'banner_shield_blue' : 'banner_patternA_red', r.x0 + 2 + i * T, r.z0 + 0.15);
  for (const z of [r.z0 + 6, r.z0 + 16]) { put('torch_mounted', r.x0 + 0.1, z, { ry: Math.PI / 2 }); put('torch_mounted', r.x1 - 0.1, z, { ry: -Math.PI / 2 }); }
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
const rngPick = (v) => Math.abs(Math.sin(v * 12.9898)) > 0.5;

function addLight(x, y, z, col, intensity, dist) {
  const l = new THREE.PointLight(col, intensity, dist, 1.4); l.position.set(x, y, z); scene.add(l); lights.push(l);
}

export function buildInteriors(library, doors) {
  lib = library;
  // darkness around the rooms
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(260, 120), new THREE.MeshBasicMaterial({ color: '#1c120c' }));
  dark.rotation.x = -Math.PI / 2; dark.position.set(330, -0.08, 0); scene.add(dark);
  castle();
  tavern();
  // where each building's front door is in the valley
  Object.assign(INTERIORS.tavern, doors.tavern);
}
