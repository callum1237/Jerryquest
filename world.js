// Static world: ground, lake, paths, village buildings, forest, mountains, clouds, campfire.
import { THREE, scene, gradient, stylize, registerMesh, toon, rng, foliageMat, puffNormals } from './engine.js?v=a02cfd5f5a4e7ddbc1a90ede421519f7e86d3286';

export const S_BUILD = 5.9, S_NATURE = 4.5, S_PROP = 2.6; // v84: houses a bit bigger to suit the taller heroes
export const LAKE = { x: 37, z: -7, r: 12 };
export const CAMP = { x: -22, z: 31 };
// the Old Quarry: a big open pit out east past the dragon's cave, with copper, iron, silver and gold
export const MINE = { x: 96, z: -48, r: 19 };
export const WORLD_R = 205; // v76: was 150; the outer ring holds the outskirt towns
// Little towns out in the woods that monsters have taken over. Free them to fly your flag there.
// stars = how tough the monsters are (they range from a bit tougher than the camp to really nasty).
export const TOWNS = [
  { id: 'thornbury', name: 'Thornbury', x: 64, z: 62, r: 15, stars: 1 },
  { id: 'mossbrook', name: 'Mossbrook', x: -66, z: 62, r: 15, stars: 2 },
  { id: 'cinderholt', name: 'Cinderholt', x: -62, z: -70, r: 15, stars: 3 },
  // v76 outskirts: four more towns out past the old forest edge
  { id: 'fernhallow', name: 'Fernhallow', x: 168, z: 52, r: 15, stars: 2, outer: true },
  { id: 'willowmere', name: 'Willowmere', x: 72, z: 160, r: 15, stars: 2, outer: true },
  { id: 'brackenford', name: 'Brackenford', x: -166, z: 60, r: 15, stars: 3, outer: true },
  { id: 'crowsnest', name: "Crow's Nest", x: -84, z: -160, r: 15, stars: 3, outer: true },
  // Chapter 2: Frostwhisker Peaks (the land sits at x = 1000). Each faces the road it's reached by.
  { id: 'iciclehollow', name: 'Icicle Hollow', x: 1050, z: 46, r: 14, stars: 1, land: 'frost', home: [1000, 50] },
  { id: 'pinecrest', name: 'Pinecrest', x: 950, z: 46, r: 14, stars: 2, land: 'frost', home: [1000, 50] },
  { id: 'glaciergate', name: 'Glacier Gate', x: 1036, z: -14, r: 14, stars: 3, land: 'frost', home: [1000, 8] },
  { id: 'frostmere', name: 'Frostmere', x: 916, z: -30, r: 14, stars: 2, land: 'frost', home: [1000, 8], outer: true },
  { id: 'hailstone', name: 'Hailstone Hold', x: 1084, z: -30, r: 14, stars: 3, land: 'frost', home: [1000, 8], outer: true },
  { id: 'bogbottom', name: 'Bogbottom', x: 1950, z: 44, r: 14, stars: 2, land: 'marsh', home: [2000, 50] },
  { id: 'reedwhistle', name: 'Reedwhistle', x: 2052, z: 40, r: 14, stars: 3, land: 'marsh', home: [2000, 50] },
  { id: 'mudwallow', name: 'Mudwallow', x: 1916, z: 10, r: 14, stars: 2, land: 'marsh', home: [2000, 10], outer: true },
  { id: 'toadstool', name: 'Toadstool Hollow', x: 1946, z: -74, r: 14, stars: 3, land: 'marsh', home: [2000, 10], outer: true },
  { id: 'dunecrest', name: 'Dunecrest', x: 2954, z: 30, r: 14, stars: 2, land: 'sands', home: [3000, 30] },
  { id: 'copperspring', name: 'Copperspring', x: 3046, z: 32, r: 14, stars: 3, land: 'sands', home: [3000, 30] },
  { id: 'rustwater', name: 'Rustwater', x: 2916, z: -4, r: 14, stars: 2, land: 'sands', home: [3000, 30], outer: true },
  { id: 'gearhaven', name: 'Gearhaven', x: 3086, z: -6, r: 14, stars: 3, land: 'sands', home: [3000, 30], outer: true },
];
// which way a town's open side faces: towards its land's main village
export const townFacing = (T) => Math.atan2((T.home ? T.home[1] : 0) - T.z, (T.home ? T.home[0] : 0) - T.x);
// The four lands beyond the valley forest. Each has its own colour, mood, monsters and a miniboss.
// The village is spread out a little: every village building and prop sits VS times further from the well.
export const VS = 1.95; // v84: more room round the spawn
export const ZONES = {
  glimmer: { name: 'Glimmerwood', x: 108, z: 6, r: 42, grass: '#5aa6a0', grass2: '#7d7fd6' },
  crags: { name: 'Grumble Crags', x: -106, z: -4, r: 42, grass: '#9a9a78', grass2: '#b5a27e' },
  meadow: { name: 'Honeymeadow', x: 4, z: 108, r: 40, grass: '#8fc24e', grass2: '#c6c25c' },
  hollow: { name: 'Haunted Hollow', x: -10, z: -112, r: 38, grass: '#4f6b58', grass2: '#6a5f78' },
};
// Boss stages: a big cleared ring in the middle of each land, kept free of trees, rocks and props.
export const VALLEY_ARENAS = [
  { boss: 'boss_crusher', x: ZONES.crags.x, z: ZONES.crags.z, r: 27, col: '#c8b48a', rim: '#8a7a5a' },
  { boss: 'boss_gloom', x: ZONES.glimmer.x + 4, z: ZONES.glimmer.z, r: 27, col: '#8ac8c0', rim: '#bfa8ff' },
  { boss: 'boss_rattle', x: ZONES.hollow.x, z: ZONES.hollow.z + 2, r: 25, col: '#6a7a6a', rim: '#a7a3ad' },
];
// Roads out of the valley: [toX, toZ, fromX, fromZ]
export const ROADS = [[MINE.x - MINE.r + 1, MINE.z + 3, 44, -38], [58, 58, 2, 46], [-60, 58, 1, 40], [-56, -66, -16, -58], [62, -55, 25, -21], [ZONES.glimmer.x - 20, 6, 22, 10], [-86, -4, -28, -4], [4, 86, 0, 30], [-16, -58, 0, -40], [-10, -92, -16, -58],
  // v76 outskirt towns, each reached from its nearest old town (or Honeymeadow)
  [154, 54, 78, 62], [62, 150, 26, 128], [-152, 60, -80, 62], [-79, -146, -64, -84]];
const nearRoad = (x, z, pad) => ROADS.some(([tx, tz, fx, fz]) => {
  const dx = tx - fx, dz = tz - fz, L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - fx) * dx + (z - fz) * dz) / L2));
  return Math.hypot(x - (fx + dx * t), z - (fz + dz * t)) < pad;
});
const inZone = (x, z, pad = 0) => Object.values(ZONES).some((Z) => Math.hypot(x - Z.x, z - Z.z) < Z.r + pad);
export const colliders = []; // {x,z,r}
export const clouds = [];
export const dynamic = { waterMat: null, fireLight: null, flames: [], crystals: [], signs: [] };
export let lib = {};

export const M = (x, y, z, s = 1, ry = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));

// A copy of a model with its colours multiplied by a tint (the original stays untouched).
export function tinted(tpl, col) {
  const c = tpl.clone(true);
  c.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(col); } });
  return c;
}
export function instanced(template, matrices, opts = {}) {
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const group = new THREE.Group();
  template.traverse((o) => {
    if (!o.isMesh) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    const tmp = new THREE.Matrix4();
    const lift = new THREE.Matrix4();
    matrices.forEach((m, i) => { const e = m.elements, h = opts.flat ? 0 : terrainH(e[12], e[14]); lift.makeTranslation(0, h, 0); im.setMatrixAt(i, tmp.multiplyMatrices(lift, m).multiply(rel)); });
    // nature-kit parts come with their own painted materials and layer (see natural())
    if (o.userData.mats) { registerMesh(im, o.userData.mats); im.layers.mask = o.layers.mask; im.castShadow = opts.cast !== false && o.castShadow; im.receiveShadow = true; }
    if (opts.colors) { matrices.forEach((m, i) => im.setColorAt(i, opts.colors[i])); }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  stylize(group, opts);
  scene.add(group);
  return group;
}

export function place(name, x, z, s, ry = 0, { collide = true, y = 0, shrink = 0.75 } = {}) {
  const src = lib[name];
  if (!src) { console.warn('missing', name); return null; }
  const o = src.clone(true);
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
  stylize(o);
  scene.add(o);
  if (collide) {
    const b = new THREE.Box3().setFromObject(o);
    const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 * shrink;
    o.userData.collider = { x, z, r };
    colliders.push(o.userData.collider);
  }
  return o;
}

// ---------- v81 nature kit (Quaternius Stylized Nature MegaKit, CC0) ----------
// Painted trees, bushes, grass, flowers and rocks. natural() returns a ready-to-instance template:
// the leaves get the soft painted colour ramp and round "puffy" normals (engine.js foliageMat),
// bark and rocks keep their hand-painted textures with the toon shading.
export const PAL = {
  valley: ['#12503a', '#86c43a'], deep: ['#0f4636', '#62a832'], spring: ['#1f6a34', '#b4d43e'],
  glimmer: ['#33287e', '#e07ac4'], glimmer2: ['#15566e', '#6cd8c4'], pine: ['#123f38', '#5c9a46'],
  grass: ['#3d9032', '#d4ee6a'], bush: ['#1f6a40', '#9cd64c'], plant: ['#2b7a3a', '#a8dc52'],
  meadow: ['#5aa634', '#eef07a'], dry: ['#7a8a48', '#e0d488'],
};
const natCache = new Map();
export function natural(name, { pal = PAL.valley, h = 0, w = 0, fit = null, sway = 0, bark = null, paint = true, puff = true, cast = true, mul = 1, small = false } = {}) {
  const key = [name, pal.join(), h, w, fit && fit.uuid, sway, bark, paint, puff, cast, mul, small].join('|');
  if (natCache.has(key)) return natCache.get(key);
  const src = lib[name];
  if (!src) { console.warn('missing nature model', name); return new THREE.Group(); }
  const root = new THREE.Group(), o = src.clone(true);
  o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
  root.add(o); root.updateMatrixWorld(true);
  if (fit) { const a = new THREE.Box3().setFromObject(fit), b = new THREE.Box3().setFromObject(o), sa = a.getSize(new THREE.Vector3()), sb = b.getSize(new THREE.Vector3());
    o.scale.setScalar(Math.max(sa.x, sa.y, sa.z) / Math.max(0.001, sb.x, sb.y, sb.z)); root.updateMatrixWorld(true); }
  if (w) { const sb = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); o.scale.setScalar(w / Math.max(0.001, sb.x, sb.y, sb.z)); root.updateMatrixWorld(true); }
  if (h) { const b = new THREE.Box3().setFromObject(o); o.scale.setScalar(h / Math.max(0.001, b.max.y - b.min.y)); root.updateMatrixWorld(true); }
  o.traverse((m) => {
    if (!m.isMesh) return;
    const std = m.material, ud = std.userData || {};
    const leafy = ud.cut && /leaves|pine|plants|flowers/.test(ud.tex || '') || /grass/.test(ud.tex || '');
    if (leafy) {
      const flower = /flowers/.test(ud.tex || '');
      const geo = m.geometry.clone();
      if (puff && !flower) puffNormals(geo); else if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.computeBoundingBox();
      m.geometry = geo;
      registerMesh(m, foliageMat(std.map, { lo: pal[0], hi: pal[1], y0: geo.boundingBox.min.y, y1: geo.boundingBox.max.y, sway, cut: ud.cut ? 0.5 : 0, paint: paint && !flower, mul, puff: puff && !flower }));
      // small plants go on layer 3: drawn in colour only (no ink, no shadow) to keep things quick
      m.layers.set(small ? 3 : 2); m.castShadow = cast && !small; m.receiveShadow = true;
    } else {
      if (bark) { const c = std.clone(); c.color.set(bark); m.material = c; }
      stylize(m, { cast });
    }
  });
  natCache.set(key, root);
  return root;
}
// v81: hand-painted ground. World-space noise adds soft brushy light and dark patches, sunny
// yellow dapples and fine blade streaks over the ground's own colours (so every land keeps its palette).
export function paintGround(mats, { k = 1 } = {}) {
  for (const key of ['std', 'toon']) {
    const m = mats[key], prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.vertexShader = 'varying vec3 vGW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGW = (modelMatrix * vec4(position, 1.)).xyz;');
      sh.fragmentShader = `varying vec3 vGW;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
        float gf(vec2 p){ return gn(p) * .55 + gn(p * 2.1 + 3.7) * .3 + gn(p * 4.3 + 1.3) * .15; }
      ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vGW.xz;
          float big = gf(p * 0.045);                       // broad light and shade
          float mid = gf(p * 0.16 + big * 2.);              // brushy patches
          float streak = gn(vec2(p.x * 0.9 + p.y * 0.35, p.y * 3.1 - p.x * 0.6)); // little blade strokes
          float sh = (big - .5) * .7 + (mid - .5) * .45 + (streak - .5) * .14;
          vec3 c = diffuseColor.rgb * (1. + sh * ${k.toFixed(2)});
          float sun = smoothstep(.55, .7, mid) * smoothstep(.4, .62, big);
          c = mix(c, c * vec3(1.2, 1.15, .72), sun * .7 * ${k.toFixed(2)});
          diffuseColor.rgb = c; }`);
    };
    const pk = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => pk() + 'paint' + k;
  }
  return mats;
}
// A one-off (not instanced) copy of a nature template, keeping its painted materials and layers.
// Leaves are marked so the ink-hull outliner leaves them alone (a hull of leaf cards would be squares).
export function naturalCopy(tpl) {
  const c = tpl.clone(true), src = [], dst = [];
  tpl.traverse((o) => src.push(o)); c.traverse((o) => dst.push(o));
  src.forEach((o, i) => { if (o.isMesh && o.userData.mats) { const d = dst[i]; d.userData = { mats: null }; registerMesh(d, o.userData.mats); d.layers.mask = o.layers.mask; d.castShadow = o.castShadow; d.receiveShadow = true; if (o.layers.mask !== 1) d.userData.hasInk = true; } });
  return c;
}
// v83: a painted rock crag (a tall rock with two smaller ones leaning on it), the same size as the
// KayKit hill it replaces. Used for the Grumble Crags hills and the mountains round the edge of each land.
const cragCache = new Map();
export function crag(tint, like = lib.mountain_C_grass) {
  const key = tint + (like && like.uuid);
  if (cragCache.has(key)) return cragCache.get(key);
  const g = new THREE.Group();
  for (const [n, x, y, z, sx, sy, sz, ry] of [['Rock_Medium_1', 0, 0, 0, 1, 1.9, 1, 0], ['Rock_Medium_3', 0.55, 0, 0.3, 0.8, 1.2, 0.8, 1.7], ['Rock_Medium_2', -0.6, 0, -0.2, 0.75, 1.0, 0.85, 3.1], ['Rock_Medium_2', 0.1, 0, -0.55, 0.6, 0.7, 0.6, 4.4]]) {
    const r = naturalCopy(natural(n, { h: 1, bark: tint })); r.position.set(x, y, z); r.scale.set(sx, sy, sz); r.rotation.y = ry; g.add(r);
  }
  const out = new THREE.Group(); out.add(g); out.updateMatrixWorld(true);
  if (like) { const a = new THREE.Box3().setFromObject(like).getSize(new THREE.Vector3()), b = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()); g.scale.multiplyScalar(Math.max(a.x, a.z) / Math.max(b.x, b.z)); g.scale.y *= 1.15; out.updateMatrixWorld(true); }
  cragCache.set(key, out);
  return out;
}
// a stable 0..1 number for a spot on the map (so picking tree kinds doesn't touch the world's dice)
// KayKit rock -> painted rock of the same size
const ROCKS = { rock_single_A: 'Rock_Medium_1', rock_single_B: 'Rock_Medium_2', rock_single_C: 'Rock_Medium_3' };
const natRock = (k, tint = null) => natural(ROCKS[k], { fit: lib[k], bark: tint });
export const hOf = (tpl) => { const b = new THREE.Box3().setFromObject(tpl); return b.max.y - b.min.y; };
export const spotHash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
// split one list of tree spots into several kinds, by spot
function splitKinds(list, kinds) {
  const out = kinds.map(() => []), p = new THREE.Vector3();
  for (const m of list) { p.setFromMatrixPosition(m); const h = spotHash(p.x, p.z); let i = 0, acc = kinds[0][1]; while (h > acc && i < kinds.length - 1) acc += kinds[++i][1]; out[i].push(m); }
  return out;
}
export function forestOf(list, kinds, opts = {}) {
  splitKinds(list, kinds).forEach((l, i) => {
    if (!l.length) return;
    const p = new THREE.Vector3();
    // each tree a touch lighter, darker or warmer than its neighbours
    const colors = l.map((m) => { p.setFromMatrixPosition(m); const h = spotHash(p.z * 1.7, p.x * 0.9); return new THREE.Color(0.9 + h * 0.25, 0.94 + h * 0.12, 1.02 - h * 0.18); });
    instanced(kinds[i][0], l, { ...opts, colors });
  });
}
const faceCenter = (x, z) => Math.atan2(-x, -z);
export const blocked = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3 || Math.hypot(x - CAMP.x, z - CAMP.z) < 11
  || TOWNS.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 3) || Math.hypot(x - 4, z + 66) < 18 || Math.hypot(x - 62, z + 63) < 11 || Math.hypot(x - MINE.x, z - MINE.z) < MINE.r + 4
  || VALLEY_ARENAS.some((A) => Math.hypot(x - A.x, z - A.z) < A.r + 2);
// v84: rolling hills. A smooth height field that stays flat on roads, in the village, towns, the lake, the camp,
// the quarry and every boss stage, and rises into soft grassy hills in the open country between them.
const roadDist = (x, z) => { let m = 1e9; for (const [tx, tz, fx, fz] of ROADS) { const dx = tx - fx, dz = tz - fz, L2 = dx * dx + dz * dz; const t = Math.max(0, Math.min(1, ((x - fx) * dx + (z - fz) * dz) / L2)); m = Math.min(m, Math.hypot(x - (fx + dx * t), z - (fz + dz * t))); } return m; };
const sstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export const HILL_H = 4.2;
export function terrainH(x, z) {
  const d = Math.hypot(x, z);
  if (d > WORLD_R - 6 || d < 62) return 0;
  // a few broad lumps (sum of soft waves), only the tops of them are kept
  const n = Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.039 - 0.7) + 0.6 * Math.sin(x * 0.081 - z * 0.067 + 2.1) + 0.35 * Math.cos(x * 0.13 + z * 0.11);
  let h = sstep(0.35, 1.25, n);
  if (h <= 0) return 0;
  h *= sstep(62, 92, d) * (1 - sstep(WORLD_R - 30, WORLD_R - 6, d));
  h *= sstep(9, 22, roadDist(x, z));
  for (const Z of VALLEY_ARENAS) h *= sstep(Z.r + 4, Z.r + 18, Math.hypot(x - Z.x, z - Z.z));
  for (const T of TOWNS) h *= sstep(T.r + 6, T.r + 22, Math.hypot(x - T.x, z - T.z));
  h *= sstep(LAKE.r + 5, LAKE.r + 18, Math.hypot(x - LAKE.x, z - LAKE.z));
  h *= sstep(MINE.r + 5, MINE.r + 18, Math.hypot(x - MINE.x, z - MINE.z));
  h *= sstep(14, 28, Math.hypot(x - CAMP.x, z - CAMP.z));
  return h * HILL_H;
}
export const isFree = (x, z, pad = 0) => !colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad);

export function buildWorld(library) {
  lib = library;
  // painted ground
  const gGeo = new THREE.PlaneGeometry(560, 560, 240, 240);
  gGeo.rotateX(-Math.PI / 2);
  const zc = new THREE.Color(), zc2 = new THREE.Color();
  const gc = [], cA = new THREE.Color('#58a046'), cB = new THREE.Color('#8ec25a'), cC = new THREE.Color('#3c8442'), tmpc = new THREE.Color();
  const pos = gGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = Math.sin(x * 0.07) * Math.cos(z * 0.06) + 0.5 * Math.sin(x * 0.19 + z * 0.13) + 0.3 * Math.cos(z * 0.23 - x * 0.05);
    tmpc.copy(cA).lerp(n > 0 ? cB : cC, Math.min(1, Math.abs(n) * 0.55));
    for (const Z of Object.values(ZONES)) {
      const k = 1 - THREE.MathUtils.smoothstep(Math.hypot(x - Z.x, z - Z.z), Z.r * 0.6, Z.r * 1.35);
      if (k > 0) tmpc.lerp(zc.set(Z.grass).lerp(zc2.set(Z.grass2), (n + 1.5) / 3), k * 0.7);
    }
    const d = Math.hypot(x, z);
    const hh = terrainH(x, z);
    pos.setY(i, (d > WORLD_R + 4 ? (d - WORLD_R - 4) * 0.25 * (1 + 0.5 * Math.sin(x * 0.11 + z * 0.07)) : 0) + hh);
    if (hh > 0.3) tmpc.lerp(zc.set('#9cce62'), Math.min(0.35, hh * 0.08)); // sunny hilltops
    gc.push(tmpc.r, tmpc.g, tmpc.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo);
  ground.receiveShadow = true;
  registerMesh(ground, paintGround(toon('#ffffff', { vertexColors: true })));
  scene.add(ground);

  // lake
  const shore = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 1.6, 48));
  shore.rotation.x = -Math.PI / 2; shore.position.set(LAKE.x, 0.02, LAKE.z); shore.receiveShadow = true;
  registerMesh(shore, toon('#f1d79c', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  scene.add(shore);
  dynamic.waterMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, deep: { value: new THREE.Color('#1f6fc8') }, shallow: { value: new THREE.Color('#79e6e8') } },
    vertexShader: `varying vec2 vP; varying float vR; void main(){ vP = position.xy; vR = length(position.xy); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float time; uniform vec3 deep, shallow; varying vec2 vP; varying float vR;
      float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }
      void main(){
        // v81 storybook water: a deep middle fading to bright shallows, painted ripple bands that drift,
        // a wobbly foam ring at the shore and little twinkles
        float r = vR / ${LAKE.r.toFixed(1)};
        float wob = wn(vP * 0.45 + time * 0.15) - .5;
        vec3 c = mix(deep, shallow, smoothstep(0.35, 1.0, r + wob * 0.12));
        float rip = wn(vec2(vP.x * 0.5 + time * 0.25, vP.y * 1.4 - time * 0.12)) + wn(vP * 1.1 - time * 0.2) * 0.5;
        c = mix(c, c * 1.18 + vec3(0.04, 0.06, 0.06), smoothstep(0.95, 1.05, rip) * 0.7);
        c = mix(c, deep * 0.82, smoothstep(0.25, 0.1, rip) * 0.35);
        float spark = step(0.985, wn(vP * 3.1 + vec2(time * 0.6, -time * 0.4))) * (1. - smoothstep(0.7, 0.95, r));
        c += vec3(1.) * spark * 0.7;
        float edge = r + wob * 0.05 + sin(atan(vP.y, vP.x) * 9. + time * 1.5) * 0.008;
        float foam = smoothstep(0.9, 0.93, edge) * (1. - smoothstep(0.965, 0.985, edge));
        float foam2 = smoothstep(0.975, 0.99, edge);
        c = mix(c, vec3(1.), max(foam * 0.85, foam2 * 0.95));
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 48), dynamic.waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set(LAKE.x, 0.05, LAKE.z);
  scene.add(water);
  colliders.push({ x: LAKE.x, z: LAKE.z, r: LAKE.r - 0.5 });
  const lilies = [];
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2, rr = 2 + rng() * (LAKE.r - 5);
    lilies.push(M(LAKE.x + Math.cos(a) * rr, 0.06, LAKE.z + Math.sin(a) * rr, 3, rng() * 6));
  }
  instanced(lib.waterlily_A, lilies, { cast: false });

  // sandy paths
  const pathMats = paintGround(toon('#e9c98f', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { k: 0.8 });
  const addPath = (geo, x, z, ry = 0) => {
    const m = new THREE.Mesh(geo);
    m.rotation.set(-Math.PI / 2, 0, ry); m.position.set(x, 0.03, z); m.receiveShadow = true;
    registerMesh(m, pathMats); scene.add(m);
  };
  addPath(new THREE.CircleGeometry(9.5, 40), 0, 0);
  const spoke = (tx, tz, w = 2.6, fx = 0, fz = 0) => {
    const dx = tx - fx, dz = tz - fz, len = Math.hypot(dx, dz);
    addPath(new THREE.PlaneGeometry(w, len), fx + dx / 2, fz + dz / 2, Math.atan2(dx, dz));
  };
  for (const [tx, tz, fx, fz] of ROADS) spoke(tx, tz, 2.8, fx, fz);
  spoke(4, -50); spoke(-22 * VS, 26 * VS); spoke(-28 * VS, -4 * VS); spoke(22 * VS, 10 * VS, 2.2); spoke(10 * VS, 14 * VS, 2);
  spoke(0, 52, 2.4, 0, 0);

  // village
  place('building_well_blue', 0, 0, S_BUILD);
  const ring = [
    ['building_tavern_blue', -4, -17, 7.6], ['building_home_A_blue', -15, -9, S_BUILD], ['building_home_B_blue', -16, 8, S_BUILD],
    ['building_home_A_red', 11, -15, S_BUILD], ['building_home_B_yellow', 14, 6, S_BUILD], ['building_market_yellow', 7, 15.5, S_BUILD * 1.5],
    ['building_blacksmith_red', 9, -24, S_BUILD], ['building_church_yellow', -14, -28, 7], ['building_windmill_green', -30, -12, 7.2],
    ['building_lumbermill_green', -27, 14, S_BUILD], ['building_tower_A_red', 22, -26, 7],
  ];
  for (const [n, x0, z0, s] of ring) { const x = x0 * VS, z = z0 * VS; place(n, x, z, s, faceCenter(x, z)); }
  shopSign(7 * VS, 15.5 * VS);
  buildQuarry();
  place('building_castle_blue', 4, -66, 14, 0); // big enough to feel like a king lives there
  wheatField(20 * VS, 14 * VS, 9, 7, 0.6);
  for (let i = 0; i < 5; i++) place(i === 2 ? 'fence_wood_straight_gate' : 'fence_wood_straight', 16 * VS + i * 3.4, 22 * VS, S_PROP + 1.4, 0, { collide: false });
  // just a few props that say what each building is for
  const props = [['weaponrack', 13, -21], ['resource_lumber', -24, 18], ['bucket_water', 2.6, 2.2]];
  for (const [n, x, z] of props) place(n, x * VS, z * VS, S_PROP, rng() * 6, { shrink: 0.6 });

  // skeleton camp
  tentAt(CAMP.x - 5, CAMP.z + 1, 0.8);
  tentAt(CAMP.x + 4, CAMP.z + 6, -0.6, '#4a7ac8');
  buildCampfire(CAMP.x, CAMP.z - 2);
  for (const T of TOWNS) buildTown(T);
  // bubbling lava pools in the Crags and round Cinderholt
  const Cr = ZONES.crags;
  for (const [dx, dz, r] of [[20, -14, 3.2], [-22, 12, 2.6], [10, 24, 2.4]]) lavaPool(Cr.x + dx, Cr.z + dz, r);
  for (const A of VALLEY_ARENAS) bossStage(A);
  const Ci = TOWNS.find((T) => T.id === 'cinderholt');
  const ash = new THREE.Mesh(new THREE.CircleGeometry(Ci.r + 2, 40)); ash.rotation.x = -Math.PI / 2; ash.position.set(Ci.x, 0.025, Ci.z);
  registerMesh(ash, toon('#9a6a58', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); ash.receiveShadow = true; scene.add(ash);
  for (const [dx, dz, r] of [[-15, 6, 2.4], [8, -16, 2], [15, 10, 2.2]]) lavaPool(Ci.x + dx, Ci.z + dz, r);

  // forest belt around the valley, with gaps where the roads leave
  const kinds = { trees_A_large: [], trees_B_large: [], trees_A_medium: [], trees_B_medium: [] };
  const rounds = { A: [], B: [], C: [] };
  const treeAt = (x, z, big) => {
    if ((dynamic.lavas || []).some((L) => Math.hypot(x - L.x, z - L.z) < L.r + 3)) return;
    // mostly round, bouncy storybook trees, with a few pines mixed in
    if (rng() < 0.7) { rounds['ABC'[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (big ? 1.15 : 0.95) * (0.85 + rng() * 0.35), rng() * 6)); colliders.push({ x, z, r: big ? 1.35 : 1.0 }); return; }
    // (sharp pines are kept for the snowy north; the valley is all round toy trees now)
    rounds['ABC'[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (big ? 1.15 : 0.95) * (0.85 + rng() * 0.35), rng() * 6));
    colliders.push({ x, z, r: big ? 1.35 : 1.0 });
  };
  for (let i = 0; i < 2100; i++) {
    const a = rng() * Math.PI * 2, rr = 56 + rng() * (WORLD_R - 44);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || (Math.abs(x) < 4 && z > 0 && z < 40) || Math.hypot(x - 4, z + 48) < 14 || Math.hypot(x - 4, z + 66) < 22 || Math.hypot(x - 62, z + 63) < 13 || (Math.abs(x - 2) < 5 && z < 0 && z > -50)) continue;
    if (nearRoad(x, z, 6) || inZone(x, z, 2) || !isFree(x, z, 2)) continue;
    // a belt round the valley, thinner woods further out, open glades between
    const belt = rr < 72 ? 0.75 : 0.3 + 0.3 * Math.sin(x * 0.05) * Math.cos(z * 0.04);
    if (rng() > belt) continue;
    treeAt(x, z, rr > 52);
  }
  // zones get their own trees
  const glimmerTrees = [], glimmerBig = [];
  for (let i = 0; i < 50; i++) {
    const Z = ZONES.glimmer, a = rng() * Math.PI * 2, rr = 23 + rng() * (Z.r - 12);
    const x = Z.x + Math.cos(a) * rr, z = Z.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 4) || blocked(x, z) || !isFree(x, z, 2)) continue;
    (rng() > 0.5 ? glimmerBig : glimmerTrees).push(M(x, 0, z, S_NATURE * (0.9 + rng() * 0.5), rng() * 6));
    colliders.push({ x, z, r: 1.0 });
  }
  // v81: the Glimmerwood grows twisty painted trees in magic pinks and teals
  forestOf(glimmerBig, [[natural('TwistedTree_1', { pal: PAL.glimmer, h: hOf(lib.trees_B_large) * 1.4 }), 1]]);
  forestOf(glimmerTrees, [[natural('CommonTree_3', { pal: PAL.glimmer2, h: hOf(lib.trees_A_medium) * 1.35 }), 1]]);
  for (const [k, list] of Object.entries(kinds)) if (list.length) instanced(lib[k], list);
  // v81: painted Quaternius trees stand where the round toy trees stood (same spots, same sizes)
  const TH = 1.9; // v84: taller trees
  forestOf(rounds.A, [[natural('CommonTree_1', { h: TH }), 0.6], [natural('CommonTree_3', { h: TH * 1.1 }), 0.4]]);
  forestOf(rounds.B, [[natural('CommonTree_2', { h: TH, pal: PAL.deep }), 0.85], [natural('TwistedTree_1', { h: TH * 1.3 }), 0.15]]);
  forestOf(rounds.C, [[natural('CommonTree_5', { h: TH * 0.95, pal: PAL.spring }), 1]]);

  // scenery rocks, more of them in the Crags
  const rocks = { rock_single_A: [], rock_single_B: [], rock_single_C: [] };
  const addRockAt = (x, z, s) => { rocks[Object.keys(rocks)[Math.floor(rng() * 3)]].push(M(x, 0, z, s, rng() * 6)); colliders.push({ x, z, r: s * 0.18 }); };
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2, rr = 34 + rng() * 22;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || !isFree(x, z, 1)) continue;
    // v65: no loose boulders on or beside the roads (the dice are still rolled so the rest of the world stays put)
    if (nearRoad(x, z, 5)) { rng(); rng(); rng(); continue; }
    rocks[Object.keys(rocks)[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (0.8 + rng() * 0.8), rng() * 6));
  }
  for (let i = 0; i < 34; i++) {
    const Z = ZONES.crags, a = rng() * Math.PI * 2, rr = 22 + rng() * (Z.r - 14);
    const x = Z.x + Math.cos(a) * rr, z = Z.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 3.5) || blocked(x, z) || !isFree(x, z, 1.5)) continue;
    addRockAt(x, z, S_NATURE * (1 + rng() * 1.6));
  }
  const cragHills = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, Z = ZONES.crags; const x = Z.x + Math.cos(a) * (Z.r + 6), z = Z.z + Math.sin(a) * (Z.r + 6); if (!nearRoad(x, z, 8)) cragHills.push(M(x, 0, z, 7 + rng() * 3, rng() * 6)); }
  // warm the crag hills so their grassy tops read as dry ochre, not acid green
  instanced(crag('#f0cfa2'), cragHills); // v83 painted rock crags
  for (const [k, list] of Object.entries(rocks)) instanced(natRock(k), list); // v81 painted rocks

  // Honeymeadow hamlet: homes, windmill, fields
  const H = ZONES.meadow;
  const hamlet = [['building_home_A_red', -9, -3], ['building_home_B_yellow', 9, -5], ['building_home_A_blue', -11, 9], ['building_windmill_green', 15, 10], ['building_well_blue', 0, 2]];
  wheatField(H.x - 2, H.z + 14, 7, 5, 0);
  for (const [n, dx, dz] of hamlet) place(n, H.x + dx, H.z + dz, n === 'building_windmill_green' ? 6 : S_BUILD, Math.atan2(-dx, -dz));
  wheatField(H.x + 26.5, H.z - 7.5, 13, 9, 0);
  for (let i = 0; i < 6; i++) place('fence_wood_straight', H.x + 18.5 + i * 3.4, H.z - 15, S_PROP + 1.4, 0, { collide: false });
  for (const [n, dx, dz] of [['wheelbarrow', -5, 5], ['sack', 5, 6]]) place(n, H.x + dx, H.z + dz, S_PROP, rng() * 6, { shrink: 0.6 });
  addPath(new THREE.CircleGeometry(6, 32), H.x, H.z);
  // Honeymeadow is the land of honey: giant flowers, beehives, haystacks and a pumpkin patch
  const spots = (n, rMin, rMax, pad) => { const out = []; for (let i = 0; i < n * 4 && out.length < n; i++) { const a = rng() * Math.PI * 2, rr = rMin + rng() * (rMax - rMin); const x = H.x + Math.cos(a) * rr, z = H.z + Math.sin(a) * rr; if (nearRoad(x, z, 3) || !isFree(x, z, pad)) continue; out.push([x, z]); } return out; };
  const flowerKinds = { pink: [], yellow: [], blue: [] };
  for (const [x, z] of spots(14, 12, H.r + 2, 1.6)) flowerKinds[['pink', 'yellow', 'blue'][Math.floor(rng() * 3)]].push(M(x, 0, z, 2.2 + rng() * 1.4, rng() * 6));
  for (const [k, list] of Object.entries(flowerKinds)) instanced(giantFlower(k), list);
  const hives = spots(4, 12, H.r - 4, 2.5).map(([x, z]) => { colliders.push({ x, z, r: 0.9 }); return M(x, 0, z, 1.7, rng() * 6); });
  instanced(beehive(), hives);
  const hay = spots(4, 14, H.r, 2.5).map(([x, z]) => { colliders.push({ x, z, r: 1.3 }); return M(x, 0, z, 1.6 + rng() * 0.5, rng() * 6); });
  instanced(haystack(), hay);
  const pumpkins = [];
  for (let i = 0; i < 12; i++) { const x = H.x - 22 + (i % 6) * 2.2 + rng() * 0.6, z = H.z - 8 + Math.floor(i / 6) * 2.4 + rng() * 0.6; if (isFree(x, z, 0.8)) pumpkins.push(M(x, 0, z, 0.9 + rng() * 0.5, rng() * 6)); }
  instanced(pumpkin(), pumpkins);

  // Haunted Hollow: dead-grey trees, gravestones, tents
  const W = ZONES.hollow, dead = [];
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2, rr = 21 + rng() * (W.r - 12);
    const x = W.x + Math.cos(a) * rr, z = W.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 4) || blocked(x, z) || !isFree(x, z, 2)) continue;
    dead.push(M(x, 0, z, S_NATURE * (0.9 + rng() * 0.4), rng() * 6)); colliders.push({ x, z, r: 1.0 });
  }
  { const dh = hOf(deadTree()) * 1.35; forestOf(dead, [[natural('DeadTree_1', { h: dh, bark: '#c9b8d8' }), 0.5], [natural('DeadTree_2', { h: dh, bark: '#c9b8d8' }), 0.5]]); }
  // spooky purple mist and glowing pumpkin lanterns
  const mist = new THREE.Mesh(new THREE.CircleGeometry(W.r + 6, 48), new THREE.MeshBasicMaterial({ color: '#8a6ad8', transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
  mist.rotation.x = -Math.PI / 2; mist.position.set(W.x, 0.06, W.z); mist.layers.set(1); scene.add(mist);
  const lanterns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3, rr = 19.5, x = W.x + Math.cos(a) * rr, z = W.z + 2 + Math.sin(a) * rr; if (isFree(x, z, 1) && !nearRoad(x, z, 2.5)) lanterns.push(M(x, 0, z, 1.4, rng() * 6)); }
  instanced(pumpkin(true), lanterns);
  const stoneM = toon('#a7a3ad'), dirtM = toon('#6a4a3a'), carveM = toon('#4a4552');
  for (let i = 0; i < 12; i++) {
    const x = W.x - 34 + (i % 4) * 3.8, z = W.z - 6 + Math.floor(i / 4) * 4.6;
    const g = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.35)); g.position.set(x + (rng() - 0.5), 0.7, z); g.rotation.set((rng() - 0.5) * 0.2, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.25);
    g.castShadow = true; registerMesh(g, stoneM); scene.add(g);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 12, 1, false, 0, Math.PI)); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.set(0, 0.75, 0); registerMesh(top, stoneM); g.add(top);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8)); mound.scale.set(0.75, 0.22, 1.1); mound.position.set(x, 0.02, z + 1.2); registerMesh(mound, dirtM); scene.add(mound);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.06)); cross.position.set(0, 0.15, 0.19); registerMesh(cross, carveM); g.add(cross);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06)); bar.position.set(0, 0.25, 0.19); registerMesh(bar, carveM); g.add(bar);
    colliders.push({ x, z, r: 0.7 });
  }
  tentAt(W.x + 24, W.z + 12, 2.2, '#6a5a8a');

  // Glimmerwood: glowing mushrooms and floating crystals
  const G = ZONES.glimmer;
  const capCols = ['#ff7eb6', '#7fe3f0', '#c58bff', '#ffd23f'];
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, rr = 23 + rng() * (G.r - 12);
    const x = G.x + Math.cos(a) * rr, z = G.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 3) || blocked(x, z) || !isFree(x, z, 1.2)) continue;
    const s2 = 0.8 + rng() * 1.6, col = capCols[i % 4];
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s2, 0.26 * s2, 0.9 * s2, 8)); stem.position.set(x, 0.45 * s2, z); stem.castShadow = true; registerMesh(stem, toon('#fff1d6'));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62 * s2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)); cap.position.set(x, 0.85 * s2, z); cap.castShadow = true;
    registerMesh(cap, toon(col, { emissive: col, emissiveIntensity: 0.35 }));
    scene.add(stem, cap);
    if (s2 > 1.6) colliders.push({ x, z, r: 0.6 * s2 });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = G.x + 4 + Math.cos(a) * 21.5, z = G.z + Math.sin(a) * 21.5;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0)); c.scale.set(0.7, 1.4, 0.7); c.position.set(x, 2.4, z);
    registerMesh(c, toon('#bfa8ff', { emissive: '#7a5cff', emissiveIntensity: 0.6 })); scene.add(c); dynamic.crystals.push(c);
  }
  const gl = new THREE.PointLight('#b48cff', 40, 30, 1.4); gl.position.set(G.x + 4, 5, G.z); scene.add(gl);

  // signposts at each road's end
  for (const Z of Object.values(ZONES)) dynamic.signs.push({ name: Z.name, x: Z.x, z: Z.z, r: Z.r });

  // mountains around the edge of the world
  const far = { mountain_A_grass_trees: [], mountain_B_grass_trees: [], mountain_C_grass: [] };
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + rng() * 0.08, rr = WORLD_R + 14 + rng() * 10;
    far[['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass'][i % 3]].push(M(Math.cos(a) * rr, -1, Math.sin(a) * rr, 14 + rng() * 5, rng() * 6));
  }
  // soften the mountain tops from acid yellow to a calm sage green
  // v83: painted rock crags round the edge, in soft blue-grey and lilac so they sit back in the haze
  instanced(crag('#c8d0dc'), far.mountain_A_grass_trees, { cast: false }); instanced(crag('#d8c8e0'), far.mountain_B_grass_trees, { cast: false }); instanced(crag('#c8d8c4'), far.mountain_C_grass, { cast: false });

  for (let i = 0; i < 20; i++) {
    const c = place(i % 2 ? 'cloud_big' : 'cloud_small', -200 + rng() * 400, -200 + rng() * 400, 4 + rng() * 2, rng() * 6, { collide: false, y: 26 + rng() * 6 });
    c.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    clouds.push(c);
  }
}

export function buildFlowers() {
  // (the dice are rolled exactly as before so everything placed after this stays put)
  const N = 45, FN = 70, tuftM = [], flowerM = [];
  const free = (x, z) => Math.hypot(x, z) > 16 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 1 && isFree(x, z);
  let ti = 0, fi = 0, guard = 0;
  while ((ti < N || fi < FN) && guard++ < 20000) {
    const a = rng() * Math.PI * 2, rr = 6 + rng() * 52;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    rng(); // (used to pick a flower colour)
    for (let k = 0; k < 6; k++) {
      const x = cx + (rng() - 0.5) * 3, z = cz + (rng() - 0.5) * 3;
      if (!free(x, z)) continue;
      if (ti < N && rng() > 0.55) { tuftM.push(M(x, 0, z, 0.6 + rng() * 0.9, rng() * 6)); ti++; }
      if (fi < FN && rng() > 0.45) { flowerM.push(M(x + 0.3, 0, z + 0.2, 0.8 + rng() * 0.6, rng() * 6)); fi++; }
    }
  }
  // v81: painted bushes and flower clumps from the nature kit
  const bushes = tuftM.slice(0, 28), flowers = flowerM.slice(0, 42);
  forestOf(bushes, [[natural('Bush_Common', { h: 1.1, pal: PAL.bush }), 0.6], [natural('Bush_Common_Flowers', { h: 1.1, pal: PAL.bush }), 0.4]], { cast: false });
  forestOf(flowers, [[natural('Flower_3_Group', { h: 0.9, sway: 0.06, small: true }), 0.5], [natural('Flower_4_Group', { h: 0.8, sway: 0.06, small: true }), 0.5]], { cast: false });
}

// v81: a carpet of painted grass tufts, clover, ferns, wildflowers, bushes, toadstools and pebbles over the
// valley, in clumps, kept off the roads, paths, buildings and water. Uses its own dice, so nothing else moves.
export function buildMeadow() {
  let seed = 20241124; const nr = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const spokes = [[4, -50, 0, 0], [-22 * VS, 26 * VS, 0, 0], [-28 * VS, -4 * VS, 0, 0], [22 * VS, 10 * VS, 0, 0], [10 * VS, 14 * VS, 0, 0], [0, 52, 0, 0]];
  const onSpoke = (x, z, pad) => spokes.some(([tx, tz, fx, fz]) => { const dx = tx - fx, dz = tz - fz, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - fx) * dx + (z - fz) * dz) / L2)); return Math.hypot(x - fx - dx * t, z - fz - dz * t) < pad; });
  const zoneAt = (x, z) => { for (const [k, Z] of Object.entries(ZONES)) if (Math.hypot(x - Z.x, z - Z.z) < Z.r + 2) return k; return ''; };
  const ok = (x, z, pad = 0.4) => Math.hypot(x, z) > 11 && Math.hypot(x, z) < WORLD_R - 2 && !blocked(x, z) && !nearRoad(x, z, 2.2) && !onSpoke(x, z, 2.1)
    && isFree(x, z, pad) && !(dynamic.lavas || []).some((L) => Math.hypot(x - L.x, z - L.z) < L.r + 2);
  const lists = {};
  const put = (k, x, z, s) => (lists[k] = lists[k] || []).push(M(x, 0, z, s, nr() * 6.28));
  // grass clumps
  for (let i = 0; i < 700; i++) {
    const a = nr() * Math.PI * 2, rr = Math.sqrt(nr()) * WORLD_R, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const zn = zoneAt(cx, cz); if (zn === 'hollow' || zn === 'crags') continue;
    const n = 4 + Math.floor(nr() * 5);
    for (let k = 0; k < n; k++) {
      const x = cx + (nr() - 0.5) * 2.6, z = cz + (nr() - 0.5) * 2.6; if (!ok(x, z)) continue;
      const r = nr(), s = 0.8 + nr() * 0.5;
      put(zn === 'glimmer' ? 'gGrass' : zn === 'meadow' ? 'mGrass' : r < 0.72 ? 'grass' : r < 0.82 ? 'wispy' : r < 0.94 ? 'clover' : 'fern', x, z, s);
    }
  }
  // wildflower patches
  for (let i = 0; i < 130; i++) {
    const a = nr() * Math.PI * 2, rr = 14 + Math.sqrt(nr()) * (WORLD_R - 14), cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const zn = zoneAt(cx, cz); if (zn === 'hollow' || zn === 'crags') continue;
    const kind = nr() < 0.5 ? 'fl3' : 'fl4';
    for (let k = 0; k < 2; k++) { const x = cx + (nr() - 0.5) * 2.4, z = cz + (nr() - 0.5) * 2.4; if (ok(x, z)) put(kind, x, z, 0.8 + nr() * 0.5); }
  }
  // bushes, ferns and toadstools along the edge of the woods
  for (let i = 0; i < 240; i++) {
    const a = nr() * Math.PI * 2, rr = 44 + nr() * (WORLD_R - 46), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const zn = zoneAt(x, z); if (zn === 'hollow' || zn === 'crags') continue;
    const r = nr(); if (!ok(x, z, r < 0.4 ? 1.2 : 0.5)) continue;
    put(r < 0.25 ? 'bush' : r < 0.4 ? 'bushF' : r < 0.6 ? 'bigFern' : r < 0.78 ? 'plant' : 'shroom', x, z, 0.8 + nr() * 0.5);
  }
  // pebbles along the roads
  for (const [tx, tz, fx, fz] of ROADS) {
    const dx = tx - fx, dz = tz - fz, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    for (let d = 3; d < L; d += 2.2 + nr() * 3) for (const side of [-1, 1]) {
      if (nr() < 0.45) continue;
      const off = side * (1.75 + nr() * 0.5), x = fx + ux * d - uz * off, z = fz + uz * d + ux * off;
      if (isFree(x, z, 0.2) && !blocked(x, z)) put('peb' + (1 + Math.floor(nr() * 5)), x, z, 0.7 + nr() * 0.6);
    }
  }
  const T = {
    grass: natural('Grass_Common_Short', { small: true, h: 0.8, pal: PAL.grass, sway: 0.1, cast: false }),
    wispy: natural('Grass_Wispy_Short', { small: true, h: 0.85, pal: PAL.grass, sway: 0.1, cast: false }),
    tall: natural('Grass_Common_Tall', { small: true, h: 1.2, pal: PAL.grass, sway: 0.12, cast: false }),
    mGrass: natural('Grass_Common_Short', { small: true, h: 0.8, pal: PAL.meadow, sway: 0.12, cast: false }),
    gGrass: natural('Grass_Common_Short', { small: true, h: 0.75, pal: PAL.glimmer2, sway: 0.1, cast: false }),
    clover: natural('Clover_1', { small: true, w: 0.9, pal: PAL.plant, cast: false }),
    fern: natural('Fern_1', { small: true, w: 1.1, pal: PAL.plant, sway: 0.05, cast: false }),
    bigFern: natural('Plant_1_Big', { small: true, w: 1.5, pal: PAL.plant, sway: 0.05, cast: false }),
    plant: natural('Plant_7_Big', { small: true, w: 1.2, pal: PAL.plant, sway: 0.05, cast: false }),
    fl3: natural('Flower_3_Group', { small: true, h: 0.85, sway: 0.08, cast: false }),
    fl4: natural('Flower_4_Single', { small: true, h: 0.75, sway: 0.08, cast: false }),
    bush: natural('Bush_Common', { h: 1.3, pal: PAL.bush }),
    bushF: natural('Bush_Common_Flowers', { h: 1.3, pal: PAL.bush }),
    shroom: natural('Mushroom_Common', { h: 0.7, cast: false }),
  };
  for (let i = 1; i <= 5; i++) T['peb' + i] = natural('Pebble_Round_' + i, { w: 0.75, cast: false });
  for (const [k, list] of Object.entries(lists)) if (T[k] && list.length) instanced(T[k], list, { cast: !/grass|wispy|tall|clover|fern|fl|peb|shroom/i.test(k) });
}

function buildCampfire(x, z) {
  const logs = toon('#7a4a2a'), stoneC = toon('#9a96a0');
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0)); st.scale.set(1, 0.6, 1); st.position.set(x + Math.cos(a) * 1.25, 0.18, z + Math.sin(a) * 1.25); st.rotation.y = a; st.castShadow = true; registerMesh(st, stoneC); scene.add(st); }
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.0, 8));
    log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
    log.position.set(x, 0.25, z); log.castShadow = true; registerMesh(log, logs); scene.add(log);
  }
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.0, 7), new THREE.MeshBasicMaterial({ color: '#ff7a1f', fog: false }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 7), new THREE.MeshBasicMaterial({ color: '#ffe36b', fog: false }));
  outer.position.set(x, 1.1, z); inner.position.set(x, 0.85, z);
  const side1 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 7), new THREE.MeshBasicMaterial({ color: '#ff9a2f', fog: false })); side1.position.set(x + 0.45, 0.75, z + 0.2);
  const side2 = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 7), new THREE.MeshBasicMaterial({ color: '#ff5a1f', fog: false })); side2.position.set(x - 0.4, 0.65, z - 0.25);
  for (const f of [outer, inner, side1, side2]) { f.layers.set(1); scene.add(f); dynamic.flames.push(f); }
  dynamic.fireLight = new THREE.PointLight('#ff8a3a', 30, 18, 1.6);
  dynamic.fireLight.position.set(x, 2.2, z);
  scene.add(dynamic.fireLight);
  colliders.push({ x, z, r: 1.4 });
}

// A town: a sandy square, a ring of houses facing it, a big flag in the middle and fences round the edge.
// While monsters hold it there are tents, junk and a red flag. Freeing it swaps in the blue flag.
function buildTown(T) {
  const sq = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40));
  sq.rotation.x = -Math.PI / 2; sq.position.set(T.x, 0.035, T.z); sq.receiveShadow = true;
  registerMesh(sq, toon('#e9c98f', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  scene.add(sq);
  const houses = ['building_home_A_red', 'building_home_B_yellow', 'building_home_A_blue', 'building_market_yellow', 'building_home_B_blue'];
  const n = houses.length, spin = T.x * 0.37;
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * Math.PI * 2;
    // leave the side facing the village open as the way in
    const toVillage = townFacing(T); let gap = a - toVillage; gap = Math.atan2(Math.sin(gap), Math.cos(gap));
    if (Math.abs(gap) < 0.5) continue;
    const x = T.x + Math.cos(a) * 11.5, z = T.z + Math.sin(a) * 11.5;
    place(houses[(i + T.stars) % houses.length], x, z, S_BUILD, Math.atan2(T.x - x, T.z - z));
  }
  T.flagRed = place('flag_red', T.x, T.z, S_PROP * 2.4, 0, { shrink: 0.25 });
  T.flagBlue = place('flag_blue', T.x, T.z, S_PROP * 2.4, 0, { collide: false });
  T.flagBlue.visible = false;
  // the monsters' mess: tents, crates, barrels and bones
  T.junk = [];
  const junk = [['tent', 5.5, 0.8, S_PROP + 1], ['tent', -5, 2.2, S_PROP + 1], ['crate_A_big', 3, 4.5, S_PROP], ['barrel', -3.2, -4.6, S_PROP], ['barrel', -2.2, -5.4, S_PROP], ['crate_B_small', 4.4, -3.8, S_PROP], ['resource_stone', 1.6, 5.6, S_PROP]];
  for (const [nm, dx, dz, sc] of junk) { const o = nm === 'tent' ? tentAt(T.x + dx, T.z + dz, rng() * 6, '#7a3a8a') : place(nm, T.x + dx, T.z + dz, sc, rng() * 6, { shrink: 0.6 }); if (o) T.junk.push(o); }
  // a few homely things that appear once the town is free
  T.homely = [];
  const homely = [['bucket_water', 2.2, -2.4], ['sack', -4.6, 3.4], ['sack', -4, 4.2], ['wheelbarrow', 5.2, 3.6], ['resource_lumber', -6.2, -2]];
  for (const [nm, dx, dz] of homely) { const o = place(nm, T.x + dx, T.z + dz, S_PROP, rng() * 6, { collide: false }); if (o) { o.visible = false; T.homely.push(o); } }
}

// ---------- chunky storybook props, built in code ----------
const stdMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
function giantFlower(kind) {
  const petal = { pink: '#ff7eb6', yellow: '#ffd23f', blue: '#7fb8ff' }[kind];
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 6), stdMat('#3fa340')); stem.position.y = 0.6; g.add(stem);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), stdMat('#4cbf45')); leaf.scale.set(1, 0.25, 0.5); leaf.position.set(0.15, 0.45, 0); g.add(leaf);
  const head = new THREE.Group(); head.position.y = 1.25; head.rotation.x = -0.5; g.add(head);
  const pm = stdMat(petal), pg = new THREE.SphereGeometry(0.16, 10, 8);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, p = new THREE.Mesh(pg, pm); p.scale.set(1, 0.35, 0.7); p.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2); p.rotation.y = -a; head.add(p); }
  const mid = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), stdMat('#ffb21f')); mid.scale.y = 0.6; mid.position.y = 0.04; head.add(mid);
  return g;
}
function beehive() {
  const g = new THREE.Group(), y = stdMat('#f4b62a'), dk = stdMat('#c98a14');
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), stdMat('#7a4a2a')); post.position.y = 0.25; g.add(post);
  [[0.62, 0.32], [0.88, 0.28], [1.1, 0.22], [1.27, 0.14]].forEach(([h, r], i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8), i % 2 ? dk : y); m.scale.y = 0.62; m.position.y = h; g.add(m); });
  const door = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), stdMat('#3a2210')); door.position.set(0, 0.62, 0.3); g.add(door);
  return g;
}
function haystack() {
  const g = new THREE.Group(), h = stdMat('#e8c050');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.55, 12), h); base.position.y = 0.27; g.add(base);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat('#f2d26a')); top.position.y = 0.54; top.scale.y = 0.8; g.add(top);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.04, 6, 20), stdMat('#a5762c')); band.rotation.x = Math.PI / 2; band.position.y = 0.4; g.add(band);
  return g;
}
function pumpkin(lantern = false) {
  const g = new THREE.Group(), o = lantern ? new THREE.MeshBasicMaterial({ color: '#ff9a2a' }) : stdMat('#f08a24'), og = new THREE.SphereGeometry(0.22, 10, 8);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, m = new THREE.Mesh(og, o); m.scale.set(0.8, 1, 1.2); m.position.set(Math.cos(a) * 0.12, 0.22, Math.sin(a) * 0.12); m.rotation.y = -a; g.add(m); }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5), stdMat('#4a7a2a')); st.position.y = 0.46; g.add(st);
  return g;
}

// A striped A-frame tent with a dark doorway.
export function tentAt(x, z, ry = 0, col = '#d8433a') {
  const g = new THREE.Group();
  const tri = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.closePath(); return sh; };
  const prism = (w, h, d) => { const geo = new THREE.ExtrudeGeometry(tri(w, h), { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2); return geo; };
  const body = new THREE.Mesh(prism(2.8, 2.2, 3)); registerMesh(body, toon(col)); body.castShadow = true; g.add(body);
  // cream stripes running across the canvas
  for (const sz of [-0.75, 0.75]) { const st = new THREE.Mesh(prism(2.86, 2.23, 0.32)); st.position.z = sz; registerMesh(st, toon('#fff1d6')); g.add(st); }
  const door = new THREE.Mesh(new THREE.ShapeGeometry(tri(1.15, 1.45))); door.position.set(0, 0.01, 1.52); registerMesh(door, toon('#3a2210')); g.add(door);
  const flap = new THREE.Mesh(new THREE.ShapeGeometry(tri(0.7, 1.1))); flap.position.set(0.5, 0.01, 1.53); flap.rotation.y = -0.5; registerMesh(flap, toon('#fff1d6')); g.add(flap);
  for (const sz of [-1.6, 1.6]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 6)); pole.position.set(0, 1.35, sz); registerMesh(pole, toon('#7a4a2a')); g.add(pole); }
  const pen = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3)); pen.rotation.z = -Math.PI / 2; pen.position.set(0.22, 2.55, 1.6); registerMesh(pen, toon('#ffd23f')); g.add(pen);
  g.position.set(x, 0, z); g.rotation.y = ry; g.name = 'tent';
  scene.add(g); colliders.push({ x, z, r: 1.6 });
  return g;
}
// A twisty, leafless spooky tree.
function deadTree() {
  const g = new THREE.Group(), bark = stdMat('#6a5a72');
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.9, 6), bark); trunk.position.y = 0.45; trunk.rotation.z = 0.08; g.add(trunk);
  for (const [y, a, l, tilt] of [[0.62, 0, 0.42, 0.9], [0.72, 2.1, 0.36, 0.8], [0.82, 4.2, 0.32, 1.0], [0.9, 1.0, 0.26, 0.5]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, l, 5), bark);
    const holder = new THREE.Group(); holder.position.y = y; holder.rotation.y = a; g.add(holder);
    b.position.set(0, l / 2, 0); const piv = new THREE.Group(); piv.rotation.z = tilt; piv.add(b); holder.add(piv);
  }
  return g;
}
// A bubbling lava pool: a glowing disc with dark crust bits and a black rock rim.
function lavaPool(x, z, r) {
  const lava = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ color: '#ff7a1f', fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  lava.rotation.x = -Math.PI / 2; lava.position.set(x, 0.07, z); scene.add(lava);
  const hot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.55, 20), new THREE.MeshBasicMaterial({ color: '#ffd23f', fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  hot.rotation.x = -Math.PI / 2; hot.position.set(x + r * 0.1, 0.08, z - r * 0.1); scene.add(hot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 6, 24)); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.1, z); rim.scale.z = 0.5; registerMesh(rim, toon('#3a2a2e')); scene.add(rim);
  const crustM = toon('#4a2a1e');
  for (let i = 0; i < 4; i++) { const a = rng() * 6.28, rr = rng() * r * 0.7, c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.25, 0)); c.scale.y = 0.3; c.position.set(x + Math.cos(a) * rr, 0.1, z + Math.sin(a) * rr); registerMesh(c, crustM); scene.add(c); }
  const glow = new THREE.PointLight('#ff6a1f', 14, r * 4, 1.6); glow.position.set(x, 1.2, z); scene.add(glow);
  colliders.push({ x, z, r: r * 0.9 });
  dynamic.lavas = dynamic.lavas || []; dynamic.lavas.push({ x, z, r, hot });
}
// A field of chunky wheat: instanced stalk clusters on a strip of brown soil.
function wheatField(x, z, cols, rows, ry = 0) {
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(cols * 1.25 + 1, rows * 1.25 + 1)); soil.rotation.set(-Math.PI / 2, 0, ry); soil.position.set(x, 0.04, z);
  registerMesh(soil, toon('#9a6a3a', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); soil.receiveShadow = true; scene.add(soil);
  const tpl = new THREE.Group(), stalk = stdMat('#e8c040'), ear = stdMat('#f6d65a');
  for (const [dx, dz, h] of [[0, 0, 1.15], [0.22, 0.12, 1.0], [-0.2, 0.1, 0.95], [0.05, -0.22, 1.05]]) {
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 5), stalk); s1.position.set(dx, h / 2, dz); tpl.add(s1);
    const e1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 3, 6), ear); e1.position.set(dx, h + 0.1, dz); tpl.add(e1);
  }
  const mats = [], c = Math.cos(ry), sn = Math.sin(ry);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lx = (i - (cols - 1) / 2) * 1.25 + (rng() - 0.5) * 0.3, lz = (j - (rows - 1) / 2) * 1.25 + (rng() - 0.5) * 0.3;
    mats.push(M(x + lx * c + lz * sn, 0, z - lx * sn + lz * c, 1.5 + rng() * 0.3, rng() * 6));
  }
  instanced(tpl, mats);
}

// A boss stage: a big flat ring of trampled ground with a painted border and a few standing stones.
export function bossStage(A) {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(A.r, 56));
  floor.rotation.x = -Math.PI / 2; floor.position.set(A.x, 0.028, A.z); floor.receiveShadow = true;
  registerMesh(floor, toon(A.col, { polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 })); scene.add(floor);
  const edge = new THREE.Mesh(new THREE.RingGeometry(A.r - 0.7, A.r, 64));
  edge.rotation.x = -Math.PI / 2; edge.position.set(A.x, 0.032, A.z);
  registerMesh(edge, toon(A.rim, { polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -2.5 })); scene.add(edge);
  const n = Math.round(A.r * 0.6), stoneM = toon(A.rim);
  for (let i = 0; i < n; i++) {
    if (i % 4 === 3) continue; // gaps to walk in through
    const a = (i / n) * Math.PI * 2, x = A.x + Math.cos(a) * (A.r + 0.9), z = A.z + Math.sin(a) * (A.r + 0.9);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.1 + (i % 3) * 0.35, 6)); st.position.set(x, 0.5, z); st.castShadow = true;
    registerMesh(st, stoneM); scene.add(st);
  }
}
// A big tall signpost in front of Marta's market, so the shop is easy to spot from across the village.
function shopSign(mx, mz) {
  const d = Math.hypot(mx, mz), x = mx - (mx / d) * 7.2 - 3.2, z = mz - (mz / d) * 7.2;
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z);
  const wood = toon('#7a4a2a');
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.6, 8)); post.position.y = 2.3; post.castShadow = true; registerMesh(post, wood); g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18)); arm.position.set(1, 4.3, 0); registerMesh(arm, wood); g.add(arm);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const c = cv.getContext('2d');
  c.fillStyle = '#4a2a17'; c.beginPath(); c.roundRect(0, 0, 256, 160, 26); c.fill();
  c.fillStyle = '#ffd23f'; c.beginPath(); c.roundRect(10, 10, 236, 140, 20); c.fill();
  c.fillStyle = '#e8a417'; c.beginPath(); c.arc(64, 80, 34, 0, 7); c.fill(); c.lineWidth = 6; c.strokeStyle = '#4a2a17'; c.stroke();
  c.font = '900 40px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#4a2a17'; c.fillText('$', 64, 82);
  c.font = '900 50px system-ui, sans-serif'; c.lineWidth = 8; c.strokeStyle = '#4a2a17'; c.strokeText('SHOP', 166, 82); c.fillStyle = '#fff'; c.fillText('SHOP', 166, 82);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  for (const side of [0, Math.PI]) { const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: tex })); board.position.set(1.4, 3.4, side ? -0.02 : 0.02); board.rotation.y = side; g.add(board); }
  scene.add(g); colliders.push({ x, z, r: 0.35 });
  dynamic.shop = { x, z };
}
// The Old Quarry: a dusty pit ringed by boulders, open towards the road, with the old mine shaft at the back.
function buildQuarry() {
  const Q = MINE;
  const disc = (r, col, y, f) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48)); m.rotation.x = -Math.PI / 2; m.position.set(Q.x, y, Q.z); m.receiveShadow = true; registerMesh(m, toon(col, { polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f })); scene.add(m); };
  disc(Q.r + 1.5, '#b89a72', 0.026, -1); disc(Q.r - 5, '#a8865e', 0.03, -2);
  const rocks = { rock_single_A: [], rock_single_B: [], rock_single_C: [] }, keys = Object.keys(rocks);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.5) continue; // the way in, facing the road
    const rr = Q.r + 2 + (i % 2) * 1.2, x = Q.x + Math.cos(a) * rr, z = Q.z + Math.sin(a) * rr, s = S_NATURE * (1.8 + (i % 3) * 0.4);
    rocks[keys[i % 3]].push(M(x, 0, z, s, i * 1.7)); colliders.push({ x, z, r: s * 0.17 });
  }
  for (const [k, list] of Object.entries(rocks)) instanced(natRock(k, '#ecd6b4'), list);
  place('building_mine_green', Q.x + Q.r - 3, Q.z - 2, 7, -Math.PI / 2);
  for (const [n, dx, dz, ry] of [['wheelbarrow', -13, -6, 0.6], ['resource_stone', -12, 7, 0], ['crate_A_big', 11, 9, 0.3]]) place(n, Q.x + dx, Q.z + dz, S_PROP, ry, { shrink: 0.6 });
  dynamic.signs.push({ name: 'Old Quarry', x: Q.x, z: Q.z, r: Q.r });
}
