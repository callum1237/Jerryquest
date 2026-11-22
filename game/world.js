// Static world: ground, lake, paths, village buildings, forest, mountains, clouds, campfire.
import { THREE, scene, gradient, stylize, registerMesh, toon, rng } from './engine.js';

export const S_BUILD = 5, S_NATURE = 4.5, S_PROP = 2.6;
export const LAKE = { x: 30, z: -6, r: 12 };
export const CAMP = { x: -22, z: 31 };
export const MINE = { x: -36, z: -24 };
export const colliders = []; // {x,z,r}
export const clouds = [];
export const dynamic = { waterMat: null, fireLight: null, flames: [] };
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
  || Math.hypot(x - 4, z + 62) < 12 || Math.hypot(x - MINE.x, z - MINE.z) < 9;
export const isFree = (x, z, pad = 0) => !colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad);

export function buildWorld(library) {
  lib = library;
  // painted ground
  const gGeo = new THREE.PlaneGeometry(240, 240, 120, 120);
  gGeo.rotateX(-Math.PI / 2);
  const gc = [], cA = new THREE.Color('#5ea83e'), cB = new THREE.Color('#86bf52'), cC = new THREE.Color('#438f38'), tmpc = new THREE.Color();
  const pos = gGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = Math.sin(x * 0.07) * Math.cos(z * 0.06) + 0.5 * Math.sin(x * 0.19 + z * 0.13) + 0.3 * Math.cos(z * 0.23 - x * 0.05);
    tmpc.copy(cA).lerp(n > 0 ? cB : cC, Math.min(1, Math.abs(n) * 0.55));
    const d = Math.hypot(x, z);
    pos.setY(i, d > 66 ? (d - 66) * 0.12 * (1 + 0.5 * Math.sin(x * 0.11 + z * 0.07)) : 0);
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
  spoke(4, -50); spoke(-22, 26); spoke(-28, -4); spoke(22, 10, 2.2); spoke(10, 14, 2); spoke(MINE.x + 4, MINE.z + 4, 2.4, -28, -4);
  spoke(0, 52, 2.4, 0, 0);

  // village
  place('building_well_blue', 0, 0, S_BUILD);
  const ring = [
    ['building_tavern_blue', -4, -17, 6.5], ['building_home_A_blue', -15, -9, S_BUILD], ['building_home_B_blue', -16, 8, S_BUILD],
    ['building_home_A_red', 13, -12, S_BUILD], ['building_home_B_yellow', 15, 2, S_BUILD], ['building_market_yellow', 7, 15, S_BUILD],
    ['building_blacksmith_red', 9, -24, S_BUILD], ['building_church_yellow', -14, -28, 6], ['building_windmill_green', -30, -12, 6],
    ['building_lumbermill_green', -27, 14, S_BUILD], ['building_tower_A_red', 22, -26, 6], ['building_mine_green', MINE.x - 6, MINE.z - 6, 6],
  ];
  for (const [n, x, z, s] of ring) place(n, x, z, s, faceCenter(x, z));
  place('building_castle_blue', 4, -62, 10, 0);
  place('building_grain', 20, 14, S_BUILD, 0.6);
  for (let i = 0; i < 5; i++) place(i === 2 ? 'fence_wood_straight_gate' : 'fence_wood_straight', 16 + i * 3.4, 22, S_PROP + 1.4, 0, { collide: false });
  const props = [
    ['barrel', -7, -12], ['barrel', -8.5, -12.5], ['crate_A_big', -9, -14], ['sack', 5, 11], ['sack', 6, 10.6], ['crate_B_small', 10, 11],
    ['weaponrack', 13, -21], ['target', 15, -17], ['wheelbarrow', -23, 11], ['resource_lumber', -24, 18], ['resource_stone', MINE.x - 1, MINE.z - 3],
    ['bucket_water', 2.6, 2.2], ['flag_red', -3, -9], ['flag_blue', 3, -9], ['crate_A_big', 18, 6], ['barrel', 19, 7.5],
  ];
  for (const [n, x, z] of props) place(n, x, z, S_PROP, rng() * 6, { shrink: 0.6 });

  // skeleton camp
  place('tent', CAMP.x - 5, CAMP.z + 1, S_PROP + 1, 0.8);
  place('tent', CAMP.x + 4, CAMP.z + 6, S_PROP + 1, -0.6);
  buildCampfire(CAMP.x, CAMP.z - 2);

  // forest ring (scenery only)
  const kinds = { trees_A_large: [], trees_B_large: [], trees_A_medium: [], trees_B_medium: [] };
  for (let i = 0; i < 380; i++) {
    const a = rng() * Math.PI * 2, rr = 42 + rng() * 58;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || (Math.abs(x) < 4 && z > 0) || Math.hypot(x - 4, z + 48) < 14 || (Math.abs(x - 2) < 5 && z < 0 && z > -50)) continue;
    const big = rr > 52;
    const k = big ? (rng() > 0.5 ? 'trees_A_large' : 'trees_B_large') : (rng() > 0.5 ? 'trees_A_medium' : 'trees_B_medium');
    kinds[k].push(M(x, 0, z, S_NATURE * (0.85 + rng() * 0.35), rng() * 6));
    if (rr < 64) colliders.push({ x, z, r: big ? 3.5 : 2.2 });
  }
  for (const [k, list] of Object.entries(kinds)) if (list.length) instanced(lib[k], list);

  // scenery rocks
  const rocks = { rock_single_A: [], rock_single_B: [], rock_single_C: [] };
  for (let i = 0; i < 50; i++) {
    const a = rng() * Math.PI * 2, rr = 12 + rng() * 40;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (blocked(x, z) || !isFree(x, z, 1)) continue;
    rocks[Object.keys(rocks)[Math.floor(rng() * 3)]].push(M(x, 0, z, S_NATURE * (0.8 + rng() * 0.8), rng() * 6));
  }
  for (const [k, list] of Object.entries(rocks)) instanced(lib[k], list);

  // distant mountains and hills
  const far = { mountain_A_grass_trees: [], mountain_B_grass_trees: [], mountain_C_grass: [], hills_A_trees: [], hills_B_trees: [] };
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.2, rr = 98 + rng() * 14;
    far[['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass'][i % 3]].push(M(Math.cos(a) * rr, -1, Math.sin(a) * rr, 12 + rng() * 5, rng() * 6));
  }
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2, rr = 76 + rng() * 14;
    far[i % 2 ? 'hills_A_trees' : 'hills_B_trees'].push(M(Math.cos(a) * rr, 0, Math.sin(a) * rr, 9 + rng() * 3, rng() * 6));
  }
  for (const [k, list] of Object.entries(far)) instanced(lib[k], list, { cast: false });

  for (let i = 0; i < 9; i++) {
    const c = place(i % 2 ? 'cloud_big' : 'cloud_small', -80 + rng() * 160, -70 + rng() * 140, 4 + rng() * 2, rng() * 6, { collide: false, y: 26 + rng() * 6 });
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
