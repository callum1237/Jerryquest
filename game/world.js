// Static world: ground, lake, paths, village buildings, forest, mountains, clouds, campfire.
import { THREE, scene, gradient, stylize, registerMesh, toon, rng } from './engine.js';

export const S_BUILD = 5, S_NATURE = 4.5, S_PROP = 2.6;
export const LAKE = { x: 30, z: -6, r: 12 };
export const CAMP = { x: -22, z: 31 };
export const MINE = { x: -36, z: -24 };
export const WORLD_R = 150;
// Little towns out in the woods that monsters have taken over. Free them to fly your flag there.
// stars = how tough the monsters are (they range from a bit tougher than the camp to really nasty).
export const TOWNS = [
  { id: 'thornbury', name: 'Thornbury', x: 64, z: 62, r: 15, stars: 1 },
  { id: 'mossbrook', name: 'Mossbrook', x: -66, z: 62, r: 15, stars: 2 },
  { id: 'cinderholt', name: 'Cinderholt', x: -62, z: -70, r: 15, stars: 3 },
];
// The four lands beyond the valley forest. Each has its own colour, mood, monsters and a miniboss.
// The village is spread out a little: every village building and prop sits VS times further from the well.
export const VS = 1.22;
export const ZONES = {
  glimmer: { name: 'Glimmerwood', x: 108, z: 6, r: 34, grass: '#5aa6a0', grass2: '#7d7fd6' },
  crags: { name: 'Grumble Crags', x: -106, z: -4, r: 34, grass: '#9a9a78', grass2: '#b5a27e' },
  meadow: { name: 'Honeymeadow', x: 4, z: 108, r: 34, grass: '#8fc24e', grass2: '#c6c25c' },
  hollow: { name: 'Haunted Hollow', x: -10, z: -112, r: 30, grass: '#4f6b58', grass2: '#6a5f78' },
};
// Roads out of the valley: [toX, toZ, fromX, fromZ]
export const ROADS = [[58, 58, 2, 46], [-60, 58, 1, 40], [-56, -66, -16, -58], [62, -55, 25, -21], [ZONES.glimmer.x - 20, 6, 22, 10], [-86, -4, -28, -4], [4, 86, 0, 30], [-16, -58, 0, -40], [-10, -92, -16, -58]];
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

export function instanced(template, matrices, opts = {}) {
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const group = new THREE.Group();
  template.traverse((o) => {
    if (!o.isMesh) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    const tmp = new THREE.Matrix4();
    matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, rel)));
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
const faceCenter = (x, z) => Math.atan2(-x, -z);
export const blocked = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3 || Math.hypot(x - CAMP.x, z - CAMP.z) < 11
  || TOWNS.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 3) || Math.hypot(x - 4, z + 66) < 18 || Math.hypot(x - 62, z + 63) < 11 || Math.hypot(x - MINE.x, z - MINE.z) < 9;
export const isFree = (x, z, pad = 0) => !colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad);

export function buildWorld(library) {
  lib = library;
  // painted ground
  const gGeo = new THREE.PlaneGeometry(440, 440, 200, 200);
  gGeo.rotateX(-Math.PI / 2);
  const zc = new THREE.Color(), zc2 = new THREE.Color();
  const gc = [], cA = new THREE.Color('#5ea83e'), cB = new THREE.Color('#86bf52'), cC = new THREE.Color('#438f38'), tmpc = new THREE.Color();
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
    pos.setY(i, d > WORLD_R + 4 ? (d - WORLD_R - 4) * 0.25 * (1 + 0.5 * Math.sin(x * 0.11 + z * 0.07)) : 0);
    gc.push(tmpc.r, tmpc.g, tmpc.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo);
  ground.receiveShadow = true;
  registerMesh(ground, toon('#ffffff', { vertexColors: true }));
  scene.add(ground);

  // lake
  const shore = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 1.6, 48));
  shore.rotation.x = -Math.PI / 2; shore.position.set(LAKE.x, 0.02, LAKE.z); shore.receiveShadow = true;
  registerMesh(shore, toon('#f1d79c', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  scene.add(shore);
  dynamic.waterMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, deep: { value: new THREE.Color('#2f8fd8') }, shallow: { value: new THREE.Color('#7fe3f0') } },
    vertexShader: `varying vec2 vP; varying float vR; void main(){ vP = position.xy; vR = length(position.xy); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float time; uniform vec3 deep, shallow; varying vec2 vP; varying float vR;
      void main(){
        float r = vR / ${LAKE.r.toFixed(1)};
        vec3 c = mix(deep, shallow, smoothstep(0.55, 1.0, r));
        float w = sin(vP.x*0.9 + time*1.3) * sin(vP.y*0.8 - time*1.1) + 0.5*sin((vP.x+vP.y)*1.7 + time*2.0);
        c += vec3(0.9,1.,1.) * step(1.05, w) * 0.35;
        c = mix(c, vec3(1.), smoothstep(0.93, 0.97, r) * (1.-smoothstep(0.97,1.0,r)) * 0.8);
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
  const pathMats = toon('#e9c98f', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const addPath = (geo, x, z, ry = 0) => {
    const m = new THREE.Mesh(geo);
    m.rotation.set(-Math.PI / 2, 0, ry); m.position.set(x, 0.03, z); m.receiveShadow = true;
    registerMesh(m, pathMats); scene.add(m);
  };
  addPath(new THREE.CircleGeometry(8, 40), 0, 0);
  const spoke = (tx, tz, w = 2.6, fx = 0, fz = 0) => {
    const dx = tx - fx, dz = tz - fz, len = Math.hypot(dx, dz);
    addPath(new THREE.PlaneGeometry(w, len), fx + dx / 2, fz + dz / 2, Math.atan2(dx, dz));
  };
  for (const [tx, tz, fx, fz] of ROADS) spoke(tx, tz, 2.8, fx, fz);
  spoke(4, -50); spoke(-22 * VS, 26 * VS); spoke(-28 * VS, -4 * VS); spoke(22 * VS, 10 * VS, 2.2); spoke(10 * VS, 14 * VS, 2); spoke(MINE.x + 4, MINE.z + 4, 2.4, -28, -4);
  spoke(0, 52, 2.4, 0, 0);

  // village
  place('building_well_blue', 0, 0, S_BUILD);
  const ring = [
    ['building_tavern_blue', -4, -17, 6.5], ['building_home_A_blue', -15, -9, S_BUILD], ['building_home_B_blue', -16, 8, S_BUILD],
    ['building_home_A_red', 13, -12, S_BUILD], ['building_home_B_yellow', 15, 2, S_BUILD], ['building_market_yellow', 7, 15, S_BUILD],
    ['building_blacksmith_red', 9, -24, S_BUILD], ['building_church_yellow', -14, -28, 6], ['building_windmill_green', -30, -12, 6],
    ['building_lumbermill_green', -27, 14, S_BUILD], ['building_tower_A_red', 22, -26, 6], ['building_mine_green', MINE.x - 6, MINE.z - 6, 6],
  ];
  for (const [n, x0, z0, s] of ring) { const mine = /mine/.test(n), x = mine ? x0 : x0 * VS, z = mine ? z0 : z0 * VS; place(n, x, z, s, faceCenter(x, z)); }
  place('building_castle_blue', 4, -66, 14, 0); // big enough to feel like a king lives there
  place('building_grain', 20 * VS, 14 * VS, S_BUILD, 0.6);
  for (let i = 0; i < 5; i++) place(i === 2 ? 'fence_wood_straight_gate' : 'fence_wood_straight', 16 * VS + i * 3.4, 22 * VS, S_PROP + 1.4, 0, { collide: false });
  const props = [
    ['barrel', -7, -12], ['barrel', -8.5, -12.5], ['crate_A_big', -9, -14], ['sack', 5, 11], ['sack', 6, 10.6], ['crate_B_small', 10, 11],
    ['weaponrack', 13, -21], ['target', 15, -17], ['wheelbarrow', -23, 11], ['resource_lumber', -24, 18], ['resource_stone', MINE.x - 1, MINE.z - 3],
    ['bucket_water', 2.6, 2.2], ['flag_red', -3, -9], ['flag_blue', 3, -9], ['crate_A_big', 18, 6], ['barrel', 19, 7.5],
  ];
  for (const [n, x, z] of props) { const v = n === 'resource_stone' ? 1 : VS; place(n, x * v, z * v, S_PROP, rng() * 6, { shrink: 0.6 }); }

  // skeleton camp
  place('tent', CAMP.x - 5, CAMP.z + 1, S_PROP + 1, 0.8);
  place('tent', CAMP.x + 4, CAMP.z + 6, S_PROP + 1, -0.6);
  buildCampfire(CAMP.x, CAMP.z - 2);
  for (const T of TOWNS) buildTown(T);

  // forest belt around the valley, with gaps where the roads leave
  const kinds = { trees_A_large: [], trees_B_large: [], trees_A_medium: [], trees_B_medium: [] };
  const rounds = { A: [], B: [], C: [] };
  const treeAt = (x, z, big) => {
    // mostly round, bouncy storybook trees, with a few pines mixed in
    if (rng() < 0.7) { rounds['ABC'[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (big ? 1.15 : 0.95) * (0.85 + rng() * 0.35), rng() * 6)); colliders.push({ x, z, r: big ? 1.35 : 1.0 }); return; }
    const k = big ? (rng() > 0.5 ? 'trees_A_large' : 'trees_B_large') : (rng() > 0.5 ? 'trees_A_medium' : 'trees_B_medium');
    kinds[k].push(M(x, 0, z, S_NATURE * (0.85 + rng() * 0.35), rng() * 6));
    colliders.push({ x, z, r: big ? 1.35 : 1.0 });
  };
  for (let i = 0; i < 1400; i++) {
    const a = rng() * Math.PI * 2, rr = 48 + rng() * (WORLD_R - 36);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || (Math.abs(x) < 4 && z > 0 && z < 40) || Math.hypot(x - 4, z + 48) < 14 || Math.hypot(x - 4, z + 66) < 22 || Math.hypot(x - 62, z + 63) < 13 || (Math.abs(x - 2) < 5 && z < 0 && z > -50)) continue;
    if (nearRoad(x, z, 6) || inZone(x, z, 2)) continue;
    // a dense belt near the valley, thinner woods further out, open glades between
    const belt = rr < 70 ? 1 : 0.38 + 0.3 * Math.sin(x * 0.05) * Math.cos(z * 0.04);
    if (rng() > belt) continue;
    treeAt(x, z, rr > 52);
  }
  // zones get their own trees
  const glimmerTrees = [], glimmerBig = [];
  for (let i = 0; i < 70; i++) {
    const Z = ZONES.glimmer, a = rng() * Math.PI * 2, rr = 8 + rng() * (Z.r + 6);
    const x = Z.x + Math.cos(a) * rr, z = Z.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 4) || Math.hypot(x - Z.x, z - Z.z) < 10 || !isFree(x, z, 1.5)) continue;
    (rng() > 0.5 ? glimmerBig : glimmerTrees).push(M(x, 0, z, S_NATURE * (0.9 + rng() * 0.5), rng() * 6));
    colliders.push({ x, z, r: 1.0 });
  }
  // recolour the leaves by rotating the texture's hue (trunks stay brown-ish)
  const tintTrees = (group, hue, sat = 1, bright = 1) => group.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.userData.mats;
    for (const key of ['std', 'toon']) {
      const mat = m[key].clone(), prev = m[key].onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          { vec3 c = diffuseColor.rgb; float g = dot(c, vec3(0.299, 0.587, 0.114));
            float a = ${hue.toFixed(3)}; float cs = cos(a), sn = sin(a);
            mat3 R = mat3(0.299+0.701*cs+0.168*sn, 0.587-0.587*cs+0.330*sn, 0.114-0.114*cs-0.497*sn,
                          0.299-0.299*cs-0.328*sn, 0.587+0.413*cs+0.035*sn, 0.114-0.114*cs+0.292*sn,
                          0.299-0.300*cs+1.250*sn, 0.587-0.588*cs-1.050*sn, 0.114+0.886*cs-0.203*sn);
            float leaf = smoothstep(0.02, 0.12, c.g - max(c.r, c.b));
            vec3 h = mix(vec3(g), c * R, ${sat.toFixed(2)}) * ${bright.toFixed(2)};
            diffuseColor.rgb = mix(c, h, leaf); }`);
      };
      mat.customProgramCacheKey = () => `hue${hue}${sat}${bright}`;
      m[key] = mat;
    }
    o.material = m.toon;
  });
  tintTrees(instanced(lib.trees_B_large, glimmerBig), -2.6, 0.85, 1.05);
  tintTrees(instanced(lib.trees_A_medium, glimmerTrees), -0.9, 1.1, 1.1);
  for (const [k, list] of Object.entries(kinds)) if (list.length) instanced(lib[k], list);
  for (const [k, list] of Object.entries(rounds)) if (list.length) instanced(roundTree(k), list);

  // scenery rocks, more of them in the Crags
  const rocks = { rock_single_A: [], rock_single_B: [], rock_single_C: [] };
  const addRockAt = (x, z, s) => { rocks[Object.keys(rocks)[Math.floor(rng() * 3)]].push(M(x, 0, z, s, rng() * 6)); colliders.push({ x, z, r: s * 0.18 }); };
  for (let i = 0; i < 50; i++) {
    const a = rng() * Math.PI * 2, rr = 12 + rng() * 40;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || !isFree(x, z, 1)) continue;
    rocks[Object.keys(rocks)[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (0.8 + rng() * 0.8), rng() * 6));
  }
  for (let i = 0; i < 70; i++) {
    const Z = ZONES.crags, a = rng() * Math.PI * 2, rr = 6 + rng() * (Z.r + 8);
    const x = Z.x + Math.cos(a) * rr, z = Z.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 3.5) || Math.hypot(x - Z.x, z - Z.z) < 9 || !isFree(x, z, 1)) continue;
    addRockAt(x, z, S_NATURE * (1 + rng() * 1.6));
  }
  const cragHills = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, Z = ZONES.crags; const x = Z.x + Math.cos(a) * (Z.r + 6), z = Z.z + Math.sin(a) * (Z.r + 6); if (!nearRoad(x, z, 8)) cragHills.push(M(x, 0, z, 7 + rng() * 3, rng() * 6)); }
  instanced(lib.mountain_C_grass, cragHills);
  for (const [k, list] of Object.entries(rocks)) instanced(lib[k], list);

  // Honeymeadow hamlet: homes, windmill, fields
  const H = ZONES.meadow;
  const hamlet = [['building_home_A_red', -9, -3], ['building_home_B_yellow', 9, -5], ['building_home_A_blue', -11, 9], ['building_windmill_green', 15, 10], ['building_grain', -2, 14], ['building_well_blue', 0, 2]];
  for (const [n, dx, dz] of hamlet) place(n, H.x + dx, H.z + dz, n === 'building_windmill_green' ? 6 : S_BUILD, Math.atan2(-dx, -dz));
  for (let r2 = 0; r2 < 3; r2++) for (let i = 0; i < 5; i++) place('building_grain', H.x + 20 + i * 3.2, H.z - 12 + r2 * 4.5, 3, 0, { collide: false });
  for (let i = 0; i < 6; i++) place('fence_wood_straight', H.x + 18.5 + i * 3.4, H.z - 15, S_PROP + 1.4, 0, { collide: false });
  for (const [n, dx, dz] of [['sack', 4, 6], ['crate_A_big', 6, 6], ['wheelbarrow', -5, 5], ['barrel', 7, -1], ['resource_lumber', -14, 2]]) place(n, H.x + dx, H.z + dz, S_PROP, rng() * 6, { shrink: 0.6 });
  addPath(new THREE.CircleGeometry(6, 32), H.x, H.z);

  // Haunted Hollow: dead-grey trees, gravestones, tents
  const W = ZONES.hollow, dead = [];
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, rr = 10 + rng() * (W.r + 4);
    const x = W.x + Math.cos(a) * rr, z = W.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 4) || !isFree(x, z, 1.5)) continue;
    dead.push(M(x, 0, z, S_NATURE * (0.9 + rng() * 0.4), rng() * 6)); colliders.push({ x, z, r: 1.0 });
  }
  tintTrees(instanced(lib.trees_A_medium, dead), 2.6, 0.2, 0.85);
  const stoneM = toon('#a7a3ad');
  for (let i = 0; i < 18; i++) {
    const x = W.x - 9 + (i % 6) * 3.6, z = W.z - 4 + Math.floor(i / 6) * 4.5;
    const g = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.35)); g.position.set(x + (rng() - 0.5), 0.7, z); g.rotation.set((rng() - 0.5) * 0.2, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.25);
    g.castShadow = true; registerMesh(g, stoneM); scene.add(g);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 12, 1, false, 0, Math.PI)); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.set(0, 0.75, 0); registerMesh(top, stoneM); g.add(top);
    colliders.push({ x, z, r: 0.7 });
  }
  place('tent', W.x + 12, W.z + 8, S_PROP + 1, 2.2);

  // Glimmerwood: glowing mushrooms and floating crystals
  const G = ZONES.glimmer;
  const capCols = ['#ff7eb6', '#7fe3f0', '#c58bff', '#ffd23f'];
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, rr = 4 + rng() * G.r;
    const x = G.x + Math.cos(a) * rr, z = G.z + Math.sin(a) * rr;
    if (nearRoad(x, z, 3) || !isFree(x, z, 0.8)) continue;
    const s2 = 0.8 + rng() * 1.6, col = capCols[i % 4];
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s2, 0.26 * s2, 0.9 * s2, 8)); stem.position.set(x, 0.45 * s2, z); stem.castShadow = true; registerMesh(stem, toon('#fff1d6'));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62 * s2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)); cap.position.set(x, 0.85 * s2, z); cap.castShadow = true;
    registerMesh(cap, toon(col, { emissive: col, emissiveIntensity: 0.35 }));
    scene.add(stem, cap);
    if (s2 > 1.6) colliders.push({ x, z, r: 0.6 * s2 });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = G.x + Math.cos(a) * 9, z = G.z + Math.sin(a) * 9;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0)); c.scale.set(0.7, 1.4, 0.7); c.position.set(x, 2.4, z);
    registerMesh(c, toon('#bfa8ff', { emissive: '#7a5cff', emissiveIntensity: 0.6 })); scene.add(c); dynamic.crystals.push(c);
  }
  const gl = new THREE.PointLight('#b48cff', 40, 30, 1.4); gl.position.set(G.x, 5, G.z); scene.add(gl);

  // signposts at each road's end
  for (const Z of Object.values(ZONES)) dynamic.signs.push({ name: Z.name, x: Z.x, z: Z.z, r: Z.r });

  // mountains around the edge of the world
  const far = { mountain_A_grass_trees: [], mountain_B_grass_trees: [], mountain_C_grass: [] };
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + rng() * 0.08, rr = WORLD_R + 14 + rng() * 10;
    far[['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass'][i % 3]].push(M(Math.cos(a) * rr, -1, Math.sin(a) * rr, 14 + rng() * 5, rng() * 6));
  }
  for (const [k, list] of Object.entries(far)) instanced(lib[k], list, { cast: false });

  for (let i = 0; i < 20; i++) {
    const c = place(i % 2 ? 'cloud_big' : 'cloud_small', -150 + rng() * 300, -150 + rng() * 300, 4 + rng() * 2, rng() * 6, { collide: false, y: 26 + rng() * 6 });
    c.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    clouds.push(c);
  }
}

export function buildFlowers() {
  const tuft = new THREE.IcosahedronGeometry(0.55, 1);
  tuft.scale(1, 0.75, 1); tuft.translate(0, 0.3, 0);
  const N = 260, FN = 420;
  const tufts = new THREE.InstancedMesh(tuft, undefined, N);
  const flowerGeo = new THREE.IcosahedronGeometry(0.22, 0);
  flowerGeo.scale(1, 0.55, 1); flowerGeo.translate(0, 0.55, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, undefined, FN);
  const palette = ['#ff7eb6', '#ffd23f', '#ffffff', '#b78cff', '#ff9a4d', '#7fd3ff'].map((c) => new THREE.Color(c));
  const free = (x, z) => Math.hypot(x, z) > 8.5 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 1 && isFree(x, z);
  let ti = 0, fi = 0, guard = 0;
  while ((ti < N || fi < FN) && guard++ < 20000) {
    const a = rng() * Math.PI * 2, rr = 6 + rng() * 52;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const col = palette[Math.floor(rng() * palette.length)];
    for (let k = 0; k < 6; k++) {
      const x = cx + (rng() - 0.5) * 3, z = cz + (rng() - 0.5) * 3;
      if (!free(x, z)) continue;
      if (ti < N && rng() > 0.55) tufts.setMatrixAt(ti++, M(x, 0, z, 0.6 + rng() * 0.9, rng() * 6));
      if (fi < FN && rng() > 0.45) { flowers.setColorAt(fi, col); flowers.setMatrixAt(fi++, M(x + 0.3, 0, z + 0.2, 0.8 + rng() * 0.6, rng() * 6)); }
    }
  }
  tufts.count = ti; flowers.count = fi;
  tufts.castShadow = true; tufts.receiveShadow = true; flowers.receiveShadow = true;
  registerMesh(tufts, toon('#4f9d3a')); registerMesh(flowers, toon('#ffffff'));
  scene.add(tufts, flowers);
}

function buildCampfire(x, z) {
  const logs = toon('#7a4a2a');
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 6));
    log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
    log.position.set(x, 0.25, z); log.castShadow = true; registerMesh(log, logs); scene.add(log);
  }
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.0, 7), new THREE.MeshBasicMaterial({ color: '#ff7a1f', fog: false }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 7), new THREE.MeshBasicMaterial({ color: '#ffe36b', fog: false }));
  outer.position.set(x, 1.1, z); inner.position.set(x, 0.85, z);
  for (const f of [outer, inner]) { f.layers.set(1); scene.add(f); dynamic.flames.push(f); }
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
    const toVillage = Math.atan2(-T.z, -T.x); let gap = a - toVillage; gap = Math.atan2(Math.sin(gap), Math.cos(gap));
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
  for (const [nm, dx, dz, sc] of junk) { const o = place(nm, T.x + dx, T.z + dz, sc, rng() * 6, { shrink: 0.6 }); if (o) T.junk.push(o); }
  // a few homely things that appear once the town is free
  T.homely = [];
  const homely = [['bucket_water', 2.2, -2.4], ['sack', -4.6, 3.4], ['sack', -4, 4.2], ['wheelbarrow', 5.2, 3.6], ['resource_lumber', -6.2, -2]];
  for (const [nm, dx, dz] of homely) { const o = place(nm, T.x + dx, T.z + dz, S_PROP, rng() * 6, { collide: false }); if (o) { o.visible = false; T.homely.push(o); } }
}

// A chunky, toy-like round tree built in code: a stubby trunk and a cluster of fat leafy balls.
function roundTree(kind) {
  const leaf = { A: '#46b83a', B: '#7cd043', C: '#2f9a48' }[kind];
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#8a5530', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: leaf, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 8), trunkMat); trunk.position.y = 0.27; g.add(trunk);
  const ball = new THREE.SphereGeometry(1, 14, 10);
  const blobs = kind === 'B' ? [[0, 0.82, 0, 0.36], [0, 1.18, 0, 0.26]] : [[0, 0.78, 0, 0.36], [0.24, 0.66, 0.05, 0.25], [-0.22, 0.68, -0.06, 0.24], [0.02, 1.06, 0, 0.24]];
  for (const [x, y, z, r] of blobs) { const m = new THREE.Mesh(ball, leafMat); m.position.set(x, y, z); m.scale.set(r, r * 0.92, r); g.add(m); }
  if (kind === 'B') { // a few red apples
    const apple = new THREE.MeshStandardMaterial({ color: '#e8402f', roughness: 1 });
    for (const [x, y, z] of [[0.2, 0.75, 0.27], [-0.25, 0.9, 0.18], [0.05, 0.6, -0.32], [0.3, 0.95, -0.1]]) { const a = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), apple); a.position.set(x, y, z); g.add(a); }
  }
  return g;
}
