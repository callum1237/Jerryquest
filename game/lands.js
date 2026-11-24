// Continents: each story chapter takes you to a new land, reached by ship.
// Every land is built far away from the valley (x ≈ 1000+), and sailing moves you there through a fade.
import { THREE, scene, registerMesh, toon, rng } from './engine.js';
import { M, instanced, place, colliders, tinted, lib, S_BUILD, S_PROP, LAKE, TOWNS, natural, naturalCopy, PAL, paintGround } from './world.js';

const FX = 1000, FZ = 0, MX = 2000, MZ = 0, DX = 3000, DZ = 0, KX = 4000, KZ = 0;
// Every land is a round board: the harbour bay in the south (from z + coast), the village just above it,
// a main road north to a crossroads, and side roads out to towns, hunting grounds and big boss stages.
export const LANDS = {
  // Chapter 2. Towns sit either side of the village; Icicle Woods (west) and Snowman Hills (east) are hunting
  // grounds; the Ogre's Pass (north-west), the Twins' Ridge (north-east) and the Ice Palace (north) are boss stages.
  frost: {
    id: 'frost', name: 'Frostwhisker Peaks', x: FX, z: FZ, r: 150, coast: 66,
    arrive: { x: FX, z: FZ + 71 }, captain: { x: FX + 4, z: FZ + 73 },
    village: { x: FX, z: FZ + 50 }, elder: { x: FX - 4, z: FZ + 48 },
    pond: { x: FX - 26, z: FZ - 14, r: 8 },
    cross: { x: FX, z: FZ + 8 },
    zones: {
      woods: { name: 'Icicle Woods', x: FX - 60, z: FZ + 4, r: 18 },
      hills: { name: 'Snowman Hills', x: FX + 64, z: FZ + 6, r: 17 },
      palace: { name: 'Ice Palace', x: FX, z: FZ - 70, r: 17 },
    },
  },
  // Chapter 3. Mire Hollow (west), the Sunken Ruins (east) and Gobbler's Pool (north) are each a boss's own
  // big stage, far apart; the bog's monsters roam the ground between them, off the boardwalks.
  marsh: {
    id: 'marsh', name: 'Gobbler Marsh', x: MX, z: MZ, r: 150, coast: 66, villageName: 'Lilypad Landing',
    arrive: { x: MX, z: MZ + 71 }, captain: { x: MX + 4, z: MZ + 73 },
    village: { x: MX, z: MZ + 50 }, elder: { x: MX - 4, z: MZ + 47 },
    pond: { x: MX + 24, z: MZ + 16, r: 8, name: 'Deep Pool' },
    cross: { x: MX, z: MZ + 10 },
    zones: {
      mire: { name: 'Mire Hollow', x: MX - 56, z: MZ - 18, r: 19 },
      ruins: { name: 'Sunken Ruins', x: MX + 56, z: MZ - 16, r: 18 },
      gobbler: { name: "Gobbler's Pool", x: MX, z: MZ - 66, r: 18 },
      goon: { name: "Goonshoe's Bog", x: MX + 44, z: MZ - 54, r: 18 },
    },
    // where the bog's monsters live: out in the open between the stages, never on a road or in a town
    camps: [{ x: MX - 30, z: MZ - 20, r: 6 }, { x: MX + 32, z: MZ - 24, r: 6 }, { x: MX - 16, z: MZ - 40, r: 5 }, { x: MX - 22, z: MZ + 22, r: 5 }],
    map: { bg: '#5e8a5a', sea: '#3f8a80', ground: '#8fb86a', zone: '#7aa65a', boss: '#4f8a78', pond: '#3f7a6a', tree: '#3f6a3a', treeHi: '#9fd07a', town: '#a8c880' },
  },
};
LANDS.sands = {
  id: 'sands', name: 'Brassbolt Sands', x: DX, z: DZ, r: 135, villageName: 'Oasis Rest',
  arrive: { x: DX, z: DZ + 49 }, captain: { x: DX + 4, z: DZ + 51 },
  village: { x: DX, z: DZ + 30 }, elder: { x: DX - 4, z: DZ + 27 },
  pond: { x: DX + 9, z: DZ + 22, r: 5, name: 'The Oasis' },
  zones: {
    sphinx: { name: 'Sphinx Engine', x: DX - 38, z: DZ - 14, r: 15 },
    workshop: { name: 'Rustwind Yard', x: DX + 41, z: DZ - 11, r: 17 },
    colossus: { name: 'Colossus Plaza', x: DX, z: DZ - 46, r: 18 },
  },
  map: { bg: '#d8b878', sea: '#4fa8c8', ground: '#f0d8a0', zone: '#e6c888', boss: '#d8b070', pond: '#5fc0d0', tree: '#5a8a3a', treeHi: '#a8d860', town: '#f5e2b0' },
  boss: 'colossus',
  // where you watch the Floating Castle rise after the Colossus falls
  lookout: { x: DX, z: DZ - 22 },
};
LANDS.frost.map = { bg: '#c8d8ea', sea: '#4fb0e8', ground: '#f2f7ff', zone: '#e2ecf8', boss: '#bfe6fb', pond: '#a8dcf6', tree: '#2f7a6a', treeHi: '#ffffff', town: '#dce8f2' };
LANDS.frost.villageName = 'Snowdrop';
LANDS.frost.pond.name = 'Frozen Pond';
LANDS.frost.boss = 'palace';
// boss stages: open, cleared rings far apart, so fighting one boss never wakes another
LANDS.frost.arenas = {
  grumble: { name: "Ogre's Pass", x: FX - 46, z: FZ - 48, r: 18 },
  twins: { name: "Twins' Ridge", x: FX + 46, z: FZ - 48, r: 18 },
};
LANDS.marsh.boss = 'gobbler';
// v68: Magma Caverns, an optional land (not part of the story) full of flaming skeletons and dragons.
// Its monsters are far above Chapter 4, so it is the place to go once you are strong.
LANDS.magma = {
  id: 'magma', name: 'Magma Caverns', x: KX, z: KZ, r: 115, villageName: 'Cinder Camp', optional: true,
  arrive: { x: KX, z: KZ + 49 }, captain: { x: KX + 4, z: KZ + 51 },
  village: { x: KX, z: KZ + 30 }, elder: { x: KX - 4, z: KZ + 27 },
  pond: { x: KX + 2, z: KZ - 8, r: 7, name: 'Lava Lake' },
  zones: {
    bones: { name: 'Burning Bonefield', x: KX - 40, z: KZ + 2, r: 16 },
    ash: { name: 'Ashen Hollow', x: KX + 40, z: KZ, r: 15 },
    roost: { name: "Dragon's Roost", x: KX - 30, z: KZ - 44, r: 16 },
    heart: { name: 'The Molten Heart', x: KX + 28, z: KZ - 46, r: 17 },
  },
  boss: 'heart',
  map: { bg: '#3a2622', sea: '#2a4250', ground: '#5a463e', zone: '#6a4e42', boss: '#8a4a30', pond: '#ff7a2a', tree: '#2a1e1e', treeHi: '#ff9a4a', town: '#7a5a4a' },
  lava: [],
};
// v78 (Callum: "maps a good deal bigger, boss areas bigger, more room to roam"): everything north of the
// crossroads and out to the sides spreads 1.35x further from the middle, and every hunting ground, boss stage and
// monster camp gets bigger. The harbour, village and crossroads stay put, so the south (the bay) is unchanged.
export const LAND_SPREAD = 1.35, STAGE_GROW = 1.4;
export const landPt = (L, dx, dz) => [L.x + dx * LAND_SPREAD, L.z + (dz < 0 ? dz * LAND_SPREAD : dz)];
for (const L of Object.values(LANDS)) {
  const mv = (o, grow) => { const [x, z] = landPt(L, o.x - L.x, o.z - L.z); o.x = x; o.z = z; if (grow && o.r) o.r = Math.round(o.r * grow); };
  for (const Z of Object.values(L.zones)) mv(Z, STAGE_GROW);
  for (const A of Object.values(L.arenas || {})) mv(A, STAGE_GROW);
  for (const C of L.camps || []) mv(C, 1.6);
  if (L.pond) mv(L.pond);
  if (L.lookout) mv(L.lookout);
  for (const T of TOWNS) if (T.land === L.id) mv(T);
}
const coastOf = (L) => L.coast ?? 44;
export { coastOf };
// roads, shared by the land builder and the map. The two big lands have a hand-laid network;
// the others run straight from the village out to each zone and town.
export function landRoads(L) {
  if (L.roadNet) return L.roadNet;
  const V = L.village, out = [[L.arrive.x, L.arrive.z + 5, V.x, V.z]];
  if (L.cross) {
    const C = L.cross, edge = (P, r, from) => { const dx = P.x - from.x, dz = P.z - from.z, d = Math.hypot(dx, dz); return [P.x - (dx / d) * (r - 1), P.z - (dz / d) * (r - 1)]; };
    out.push([V.x, V.z, C.x, C.z]);
    for (const T of TOWNS) if (T.land === L.id) out.push(T.home && T.home[1] === C.z ? [C.x, C.z, T.x, T.z] : [V.x, V.z, T.x, T.z]);
    const B = L.zones[L.boss], mid = { x: C.x, z: (C.z + B.z) / 2 };
    out.push([C.x, C.z, ...edge(B, B.r, C)]);
    for (const [k, Z] of Object.entries(L.zones)) if (k !== L.boss) out.push([C.x, C.z, ...edge(Z, Z.r, C)]);
    for (const A of Object.values(L.arenas || {})) out.push([mid.x, mid.z, ...edge(A, A.r, mid)]);
    return (L.roadNet = out);
  }
  for (const [k, Z] of Object.entries(L.zones)) out.push(k === L.boss ? [V.x, V.z, Z.x, Z.z + Z.r] : [V.x, V.z, Z.x + Math.sign(V.x - Z.x) * 8, Z.z + Math.sign(V.z - Z.z) * 8]);
  for (const T of TOWNS) if (T.land === L.id) out.push([V.x, V.z, T.x, T.z]);
  return out;
}
// where you board the ship in Jerry Valley: the little pier on the lake's west shore
export const VALLEY_DOCK = { x: LAKE.x - 10.5, z: LAKE.z - 10.5, ship: { x: LAKE.x - 2, z: LAKE.z - 1 }, arrive: { x: LAKE.x - 12, z: LAKE.z - 8 } };

export function landAt(x) { for (const L of Object.values(LANDS)) if (Math.abs(x - L.x) < 200) return L; return null; }

const mat = (c) => toon(c);
function add(mesh, col, { cast = true } = {}) { registerMesh(mesh, mat(col)); mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; }

// A chunky toy ship with a striped sail.
export function makeShip(x, z, ry = 0, sail = '#fff1d6', stripe = '#d8433a') {
  const g = new THREE.Group();
  const sh = new THREE.Shape(); sh.moveTo(-1.6, 0.6); sh.lineTo(1.6, 0.6); sh.lineTo(1.15, -0.5); sh.lineTo(-1.15, -0.5); sh.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(sh, { depth: 6, bevelEnabled: false }); hullGeo.translate(0, 0, -3);
  g.add(add(new THREE.Mesh(hullGeo), '#8a5230'));
  const prow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 4)); prow.rotation.set(Math.PI / 2, Math.PI / 4, 0); prow.scale.set(1, 1, 0.55); prow.position.set(0, 0.15, 3.9); g.add(add(prow, '#8a5230'));
  const rim = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.2, 6.1)); rim.position.y = 0.66; g.add(add(rim, '#5a3018'));
  const stripeH = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.22, 5.9)); stripeH.position.y = 0.2; g.add(add(stripeH, '#ffd23f'));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.1, 5.6)); deck.position.y = 0.55; g.add(add(deck, '#c89058'));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 5.2, 8)); mast.position.y = 3.1; g.add(add(mast, '#6a3a1a'));
  const sailM = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8, 6, 4));
  const sp = sailM.geometry.attributes.position; for (let i = 0; i < sp.count; i++) sp.setZ(i, 0.35 * Math.cos((sp.getX(i) / 1.6) * 1.4));
  sailM.geometry.computeVertexNormals(); sailM.position.set(0, 3.4, 0.25);
  registerMesh(sailM, toon(sail, { side: THREE.DoubleSide })); g.add(sailM);
  const band = new THREE.Mesh(new THREE.PlaneGeometry(3.24, 0.6, 6, 1));
  const bp = band.geometry.attributes.position; for (let i = 0; i < bp.count; i++) bp.setZ(i, 0.36 * Math.cos((bp.getX(i) / 1.6) * 1.4) + 0.01);
  band.position.set(0, 3.4, 0.25); registerMesh(band, toon(stripe, { side: THREE.DoubleSide })); g.add(band);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 3)); flag.rotation.z = -Math.PI / 2; flag.position.set(0.45, 5.6, 0); g.add(add(flag, stripe));
  g.position.set(x, 0.1, z); g.rotation.y = ry; g.name = 'ship';
  scene.add(g);
  return g;
}
// A wooden pier from (x, z) running `len` units along the direction ry.
function pier(x, z, len, ry) {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, len)); deck.position.set(0, 0.35, len / 2); g.add(add(deck, '#b07a48'));
  for (let i = 0; i <= len; i += 2.5) for (const sx of [-1.1, 1.1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 6)); post.position.set(sx, 0.2, i); g.add(add(post, '#6a3a1a')); }
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  return g;
}

// A crossroads signpost with three painted arrows.
function signpost(x, z, wood, paint) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 3, 7)); post.position.y = 1.5; g.add(add(post, wood));
  for (const [y, ry] of [[2.6, 0.2], [2.15, 1.9], [1.7, -1.3]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.1)); b.position.set(0.55, 0, 0); const h = new THREE.Group(); h.position.y = y; h.rotation.y = ry; h.add(b); add(b, paint); g.add(h); }
  scene.add(g); colliders.push({ x, z, r: 0.3 });
}
// ---------- Frostwhisker Peaks props ----------
function snowPine() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 6), new THREE.MeshStandardMaterial({ color: '#6a4a3a' })); trunk.position.y = 0.2; g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: '#2f7a6a' }), snow = new THREE.MeshStandardMaterial({ color: '#f4f9ff' });
  for (const [y, r, h] of [[0.42, 0.42, 0.55], [0.72, 0.33, 0.48], [0.98, 0.23, 0.4]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), leaf); c.position.y = y + h / 2 - 0.1; g.add(c);
    const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h * 0.5, 7), snow); s.position.y = y + h - 0.2; g.add(s);
  }
  return g;
}
function snowman() {
  const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: '#fbfdff' }), coal = new THREE.MeshStandardMaterial({ color: '#2a2230' });
  for (const [y, r] of [[0.32, 0.34], [0.78, 0.25], [1.13, 0.18]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), white); b.position.y = y; g.add(b); }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), new THREE.MeshStandardMaterial({ color: '#ff8a2a' })); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.12, 0.26); g.add(nose);
  for (const sx of [-0.07, 0.07]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), coal); e.position.set(sx, 1.19, 0.16); g.add(e); }
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10), coal); hat.position.y = 1.36; g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12), coal); brim.position.y = 1.27; g.add(brim);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 6, 14), new THREE.MeshStandardMaterial({ color: '#d8433a' })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.97; g.add(scarf);
  return g;
}
function igloo() {
  const g = new THREE.Group(), ice = new THREE.MeshStandardMaterial({ color: '#e6f4ff' });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), ice); g.add(dome);
  const tun = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12, 1, false, 0, Math.PI), ice); tun.rotation.set(Math.PI / 2, 0, Math.PI / 2); tun.position.set(0, 0, 0.95); g.add(tun);
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#3a4a6a' })); door.position.set(0, 0.01, 1.31); g.add(door);
  return g;
}
function crystal(col = '#9fe6ff') {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: col });
  for (const [x, z, h, t] of [[0, 0, 1.6, 0], [0.35, 0.1, 1.0, 0.35], [-0.3, 0.2, 0.8, -0.4], [0.05, -0.32, 0.7, 0.25]]) {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), m); c.scale.set(1, h / 0.56, 1); c.position.set(x, h / 2, z); c.rotation.z = t; g.add(c);
  }
  return g;
}

// Shared bits for the big lands: rolling ground with a harbour bay, the sea, flat paths and discs.
function landGround(L, cols3, rise, colourAt) {
  const R = L.r, C = coastOf(L), size = (R + 70) * 2;
  const gGeo = new THREE.PlaneGeometry(size, size, 140, 140); gGeo.rotateX(-Math.PI / 2);
  const pos = gGeo.attributes.position, cols = [], [cA, cB, cC] = cols3.map((c) => new THREE.Color(c)), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) + 0.5 * Math.sin(x * 0.21 + z * 0.15);
    t.copy(cA).lerp(n > 0 ? cC : cB, Math.min(1, Math.abs(n) * 0.6));
    if (colourAt) colourAt(x, z, t);
    const bay = z > C && Math.abs(x) < 34;
    let y = d > R + 4 ? (d - R - 4) * rise * (1 + 0.5 * Math.sin(x * 0.13 + z * 0.09)) : 0;
    if (bay) y = z > C + 12 ? -0.7 : 0;
    pos.setY(i, y); cols.push(t.r, t.g, t.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo); ground.position.set(L.x, 0, L.z); ground.receiveShadow = true;
  registerMesh(ground, paintGround(toon('#ffffff', { vertexColors: true }))); scene.add(ground);
}
function landSea(L, col, sand) {
  const C = coastOf(L);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(68, 12)); beach.rotation.x = -Math.PI / 2; beach.position.set(L.x, 0.01, L.z + C + 6);
  registerMesh(beach, toon(sand, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); scene.add(beach);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(68, 90)); sea.rotation.x = -Math.PI / 2; sea.position.set(L.x, -0.05, L.z + C + 57);
  registerMesh(sea, toon(col)); scene.add(sea);
  pier(L.x, L.z + C + 8, 10, 0);
  colliders.push({ x: L.x, z: L.z + C + 22, r: 3 });
}
function landKit(L, pathCol) {
  const pathM = toon(pathCol, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const path = (x1, z1, x2, z2, w = 3.2) => { const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len)); m.rotation.set(-Math.PI / 2, 0, Math.atan2(dx, dz)); m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2); registerMesh(m, pathM); m.receiveShadow = true; scene.add(m);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 16)); cap.rotation.x = -Math.PI / 2; cap.position.set(x2, 0.03, z2); registerMesh(cap, pathM); scene.add(cap); };
  const disc = (x, z, r, col = pathCol, y = 0.035) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); registerMesh(m, toon(col, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.receiveShadow = true; scene.add(m); return m; };
  const roads = landRoads(L), landTowns = TOWNS.filter((T) => T.land === L.id);
  const nearPath = (x, z, pad = 4.5) => {
    if (landTowns.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 2)) return true;
    for (const [x1, z1, x2, z2] of roads) { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz, k = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)); if (Math.hypot(x - x1 - k * dx, z - z1 - k * dz) < pad) return true; }
    return false;
  };
  const stages = [...Object.values(L.zones), ...Object.values(L.arenas || {}), ...(L.camps || [])];
  const free = (x, z, pad) => colliders.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + pad);
  // open ground: not on a road, a town, the village, the pond, a stage or the beach
  const open = (x, z, pad, zonePad = 2) => !nearPath(x, z) && Math.hypot(x - L.village.x, z - L.village.z) > 17 && Math.hypot(x - L.pond.x, z - L.pond.z) > L.pond.r + 3
    && stages.every((q) => Math.hypot(x - q.x, z - q.z) > q.r + zonePad) && z - L.z < coastOf(L) - 4 && free(x, z, pad);
  const rnd = (rMin, rMax) => { const a = rng() * Math.PI * 2, rr = rMin + rng() * (rMax - rMin); return [L.x + Math.cos(a) * rr, L.z + Math.sin(a) * rr]; };
  for (const r of roads) path(...r);
  disc(L.village.x, L.village.z, 8);
  if (L.cross) disc(L.cross.x, L.cross.z, 4.5);
  return { path, disc, roads, nearPath, free, open, rnd, landTowns };
}
// The forest belt round a land's edge, leaving the bay and every road open.
function edgeBelt(L, tries, place2, nearPath, free, dens = 0.55) {
  const R = L.r, C = coastOf(L);
  // v76: the lands grew, so the belt also thins out inwards across the new outskirts (sparser groves there)
  for (let i = 0; i < tries * 1.8; i++) {
    const a = rng() * Math.PI * 2, rr = R - 44 + rng() * 64, x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
    if (z - L.z > C - 6 && Math.abs(x - L.x) < 40) continue;
    if (rng() > (rr < R - 14 ? dens * 0.3 : dens) || nearPath(x, z) || !free(x, z, 1.4)) continue;
    if ([...Object.values(L.zones), ...Object.values(L.arenas || {}), ...(L.camps || [])].some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 3)) continue;
    place2(x, z);
  }
}

export function buildLands() {
  const L = LANDS.frost, R = L.r;
  landGround(L, ['#eef5ff', '#dbe8f7', '#ffffff'], 0.28);
  landSea(L, '#4fb0e8', '#e9dcc0');
  makeShip(FX, FZ + coastOf(L) + 22, 0, '#fff1d6', '#4a7ac8');
  for (let i = 0; i < 10; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + rng(), 0.18)); w.rotation.x = -Math.PI / 2; w.position.set(FX - 28 + rng() * 56, 0.0, FZ + coastOf(L) + 16 + rng() * 40); registerMesh(w, toon('#d6f2ff')); scene.add(w); }
  const V = L.village, Z = L.zones, P = L.pond;
  const { disc, nearPath, free, open, rnd } = landKit(L, '#c9d8ea');

  // Snowdrop village: four snowy houses round a well
  const homes = [['building_home_A_blue', -12, -4], ['building_home_B_blue', 12, -5], ['building_home_A_red', -13, 8], ['building_market_yellow', 13, 7]];
  for (const [n, dx, dz] of homes) { const x = V.x + dx, z = V.z + dz; const o = place(n, x, z, S_BUILD, Math.atan2(V.x - x, V.z - z)); if (o) o.traverse((m) => { if (m.isMesh && m.userData.mats) { for (const k of ['std', 'toon']) { m.userData.mats[k] = m.userData.mats[k].clone(); m.userData.mats[k].color.set('#eef4ff'); } m.material = m.userData.mats.toon; } }); }
  place('building_well_blue', V.x, V.z - 1, S_BUILD);
  place('barrel', V.x + 7, V.z + 4, S_PROP, 0.4, { shrink: 0.6 });

  // frozen pond, a little skating spot by the woods road
  const ice = new THREE.Mesh(new THREE.CircleGeometry(P.r, 36)); ice.rotation.x = -Math.PI / 2; ice.position.set(P.x, 0.05, P.z); registerMesh(ice, toon('#a8dcf6', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); scene.add(ice);
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.5 + rng() * 2)); s.rotation.set(-Math.PI / 2, 0, rng() * 3); s.position.set(P.x - 4 + rng() * 8, 0.07, P.z - 4 + rng() * 8); registerMesh(s, toon('#e8f8ff')); scene.add(s); }

  // boss stages: a trampled snow floor with a ring of ice shards round the edge (gaps to walk in)
  const arenas = Object.values(L.arenas || {});
  for (const A of arenas) {
    disc(A.x, A.z, A.r, '#dbe6f4');
    const n = 20;
    for (let i = 0; i < n; i++) { if (i % 5 === 4) continue; const a = (i / n) * Math.PI * 2 + 0.2, x = A.x + Math.cos(a) * (A.r + 1), z = A.z + Math.sin(a) * (A.r + 1); const sp = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6 + (i % 3) * 0.6, 5)); sp.position.set(x, 0.7, z); sp.rotation.z = (rng() - 0.5) * 0.3; registerMesh(sp, toon('#bfe8ff')); scene.add(sp); }
  }
  const pines = [];
  const pineAt = (x, z, s) => { pines.push(M(x, 0, z, s, rng() * 6)); colliders.push({ x, z, r: 0.25 * s }); };
  // the Ice Palace first, so nothing grows on it
  const IP = Z.palace;
  disc(IP.x, IP.z, IP.r + 1, '#bfe6fb');
  const spires = [];
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.35) continue; const x = IP.x + Math.cos(a) * (IP.r + 0.5), z = IP.z + Math.sin(a) * (IP.r + 0.5); spires.push(M(x, 0, z, 2.6 + (i % 3) * 0.6, a)); colliders.push({ x, z, r: 1 }); }
  instanced(crystal('#9fe6ff'), spires);
  const throne = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 1)); throne.position.set(IP.x, 1.6, IP.z - 10); add(throne, '#bfe6ff'); scene.add(throne);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.6)); seat.position.set(IP.x, 0.5, IP.z - 9.2); add(seat, '#9fd8f8'); scene.add(seat);
  colliders.push({ x: IP.x, z: IP.z - 9.6, r: 1.4 });
  // Snowman Hills: a ring of snowmen and three igloos (frostsilver rocks fill the gaps)
  const men = [], igl = [], H = Z.hills;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5, x = H.x + Math.cos(a) * 9.5, z = H.z + Math.sin(a) * 9.5; if (!free(x, z, 1)) continue; men.push(M(x, 0, z, 1.6, Math.atan2(V.x - x, V.z - z))); colliders.push({ x, z, r: 0.5 }); }
  for (const [dx, dz, ry] of [[-6, -10, 0.4], [7, -8, -0.6], [12, 6, -1.6]]) { const x = H.x + dx, z = H.z + dz; igl.push(M(x, 0, z, 2.2, ry)); colliders.push({ x, z, r: 2 }); }
  for (const [dx, dz] of [[-15, 7], [14, 6]]) { const x = V.x + dx, z = V.z + dz; if (free(x, z, 1)) { men.push(M(x, 0, z, 1.5, Math.atan2(V.x - x, V.z - z))); colliders.push({ x, z, r: 0.5 }); } }
  instanced(snowman(), men); instanced(igloo(), igl);

  // trees: a belt of snowy pines round the edge, thick in Icicle Woods, a few lone ones in between
  edgeBelt(L, 420, (x, z) => pineAt(x, z, 4.2 + rng() * 1.6), nearPath, (x, z, p) => free(x, z, p) && arenas.every((A) => Math.hypot(A.x - x, A.z - z) > A.r + 3));
  const W = Z.woods;
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2, rr = 7 + rng() * (W.r + 4), x = W.x + Math.cos(a) * rr, z = W.z + Math.sin(a) * rr;
    if (nearPath(x, z) || !free(x, z, 1.6)) continue;
    pineAt(x, z, 3.8 + rng() * 1.8);
  }
  for (let i = 0; i < 26; i++) { const [x, z] = rnd(20, R - 16); if (!open(x, z, 3, 5)) continue; pineAt(x, z, 4 + rng() * 1.2); }
  // v81: painted pines whose tips are frosted with snow (same spots and sizes as the old cone pines)
  { const ph = (() => { const b = new THREE.Box3().setFromObject(snowPine()); return b.max.y - b.min.y; })() * 1.15;
    const P = new THREE.Vector3(), lists = [[], []];
    for (const m of pines) { P.setFromMatrixPosition(m); lists[(Math.sin(P.x * 12.99 + P.z * 78.2) * 43758.5 % 1 + 1) % 1 < 0.5 ? 0 : 1].push(m); }
    if (lists[0].length) instanced(natural('Pine_1', { h: ph, pal: ['#173f4a', '#eef6ff'] }), lists[0]);
    if (lists[1].length) instanced(natural('Pine_2', { h: ph, pal: ['#1a4a48', '#dcefff'] }), lists[1]); }
  // a few snow-capped rocks and lilac crystals, well apart
  const rocks = [], loose = [];
  for (let i = 0; i < 12 && rocks.length < 6; i++) { const [x, z] = rnd(20, R - 14); if (!open(x, z, 5)) continue; rocks.push(M(x, 0, z, 3.5 + rng() * 2, rng() * 6)); colliders.push({ x, z, r: 0.7 }); }
  instanced(natural('Rock_Medium_2', { fit: lib.rock_single_B, bark: '#e8f0fa' }), rocks);
  for (let i = 0; i < 12 && loose.length < 5; i++) { const [x, z] = rnd(16, R - 14); if (!open(x, z, 5)) continue; loose.push(M(x, 0, z, 1.3 + rng() * 0.7, rng() * 6)); colliders.push({ x, z, r: 0.5 }); }
  instanced(crystal('#c8b8ff'), loose);
  // a signpost at the crossroads
  signpost(L.cross.x + 3.2, L.cross.z - 3.2, '#6a4a3a', '#f2f7ff');

  // white mountains all round
  const far = [];
  for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2 + rng() * 0.1; if (Math.abs(a - Math.PI / 2) < 0.45) continue; const rr = R + 30 + rng() * 8; far.push(M(FX + Math.cos(a) * rr, -1, FZ + Math.sin(a) * rr, 13 + rng() * 5, rng() * 6)); }
  if (lib.mountain_C_grass) instanced(tinted(lib.mountain_C_grass, '#f2f7ff'), far, { cast: false });

  // ---------- Jerry Valley harbour on the lake ----------
  const D = VALLEY_DOCK;
  pier(D.x + 1.2, D.z + 1.2, 8, Math.PI / 4);
  makeShip(D.ship.x, D.ship.z, Math.PI / 4);
  buildMarsh();
  buildSands();
  buildMagma();
}

// ---------- Gobbler Marsh props ----------
// A droopy willow: a fat trunk, a round mossy crown and hanging green strands.
function willow() {
  const g = new THREE.Group(), bark = new THREE.MeshStandardMaterial({ color: '#5a4a32' }), leaf = new THREE.MeshStandardMaterial({ color: '#5f8f3a' }), hang = new THREE.MeshStandardMaterial({ color: '#79a84a' });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 0.7, 7), bark); trunk.position.y = 0.35; trunk.rotation.z = 0.08; g.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 9), leaf); crown.scale.set(1, 0.62, 1); crown.position.y = 0.85; g.add(crown);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, st = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 3, 6), hang); st.position.set(Math.cos(a) * 0.42, 0.6, Math.sin(a) * 0.42); g.add(st); }
  return g;
}
function reeds() {
  const g = new THREE.Group(), stem = new THREE.MeshStandardMaterial({ color: '#7aa84a' }), tip = new THREE.MeshStandardMaterial({ color: '#7a4a2a' });
  for (const [x, z, h] of [[0, 0, 0.9], [0.12, 0.08, 0.7], [-0.1, 0.1, 0.8], [0.05, -0.12, 0.6], [-0.12, -0.06, 0.75]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, h, 4), stem); s.position.set(x, h / 2, z); g.add(s);
    if (h > 0.7) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 2, 6), tip); c.position.set(x, h + 0.02, z); g.add(c); }
  }
  return g;
}
function lilyPad() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18, 0.35, Math.PI * 2 - 0.7), new THREE.MeshStandardMaterial({ color: '#5fae4a' })); pad.rotation.x = -Math.PI / 2; g.add(pad);
  return g;
}
function lilyFlower() {
  const g = new THREE.Group(), pet = new THREE.MeshStandardMaterial({ color: '#ffb8d8' });
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), pet); const a = (i / 6) * Math.PI * 2; p.position.set(Math.cos(a) * 0.06, 0.08, Math.sin(a) * 0.06); p.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); g.add(p); }
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffe066' })); c.position.y = 0.1; g.add(c);
  return g;
}
function toadstool(cap = '#e0444f') {
  const g = new THREE.Group();
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#f4ead0' })); st.position.y = 0.15; g.add(st);
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: cap })); c.position.y = 0.28; c.scale.y = 0.75; g.add(c);
  for (const [x, z] of [[0.08, 0.05], [-0.07, 0.08], [0, -0.1]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshStandardMaterial({ color: '#fff8e8' })); d.position.set(x, 0.4, z); g.add(d); }
  return g;
}
// A little hut on stilts, the way everyone in Lilypad Landing lives.
function stiltHut(x, z, ry, wall = '#c89a5a', roof = '#6a8a3a') {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.25, 4.6)); deck.position.y = 1.3; g.add(add(deck, '#9a6a3a'));
  for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.5, 6)); p.position.set(px, 0.6, pz); g.add(add(p, '#6a4a2a')); }
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2)); hut.position.y = 2.5; g.add(add(hut, wall));
  const rf = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.1, 4)); rf.position.y = 4.6; rf.rotation.y = Math.PI / 4; g.add(add(rf, roof));
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.1)); door.position.set(0, 2.1, 1.62); g.add(add(door, '#5a3a22'));
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.1)); win.position.set(1, 2.8, 1.62); g.add(add(win, '#ffe6a0'));
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 2)); step.position.set(0, 0.65, 3.1); step.rotation.x = 0.55; g.add(add(step, '#9a6a3a'));
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  colliders.push({ x, z, r: 2.6 });
  return g;
}
export function buildMarsh() {
  const L = LANDS.marsh, R = L.r;
  // mossy, lumpy ground with a few muddy patches; rising into reedy banks at the edge
  const mud = new THREE.Color('#8a7a52');
  landGround(L, ['#8fb86a', '#7aa35a', '#a3c476'], 0.22, (x, z, t) => { if (Math.sin(x * 0.31 + 1) * Math.cos(z * 0.27) > 0.82) t.lerp(mud, 0.4); });
  landSea(L, '#3f8a80', '#a89a6a');
  makeShip(MX, MZ + coastOf(L) + 22, 0, '#f0f8e0', '#4a8a4a');
  const V = L.village, Z = L.zones, P = L.pond;
  const { disc, nearPath, free, open, rnd } = landKit(L, '#b8a070');

  // Lilypad Landing: huts on stilts round the square
  for (const [dx, dz, w, r] of [[-12, -4, '#c89a5a', '#6a8a3a'], [12, -5, '#b8c88a', '#8a5a3a'], [-12, 9, '#d8b070', '#5a7a4a'], [13, 8, '#a8c0a0', '#7a5a8a']]) stiltHut(V.x + dx, V.z + dz, Math.atan2(-dx, -dz), w, r);
  place('building_well_blue', V.x, V.z - 1, S_BUILD);
  place('barrel', V.x + 7, V.z + 4, S_PROP, 0.4, { shrink: 0.6 });

  // the Deep Pool (where Mireiron is fished up) and a handful of puddles out in the open
  disc(P.x, P.z, P.r + 0.6, '#5a6a3a', 0.04); disc(P.x, P.z, P.r, '#3f7a6a', 0.05);
  const pads = [], flowers = [];
  for (let i = 0; i < 8; i++) { const a = rng() * 6.28, rr = rng() * (P.r - 1.5), x = P.x + Math.cos(a) * rr, z = P.z + Math.sin(a) * rr; pads.push(M(x, 0.07, z, 1 + rng() * 0.6, rng() * 6)); if (i % 3 === 0) flowers.push(M(x, 0.07, z, 1.6, 0)); }
  const puddles = [];
  for (let i = 0; i < 30 && puddles.length < 9; i++) {
    const [x, z] = rnd(16, R - 12); if (!open(x, z, 2, 4)) continue;
    const r = 2 + rng() * 2; disc(x, z, r, '#4f7f6a', 0.045); puddles.push([x, z, r]);
    pads.push(M(x + (rng() - 0.5) * r, 0.06, z + (rng() - 0.5) * r, 0.9 + rng() * 0.5, rng() * 6));
  }
  // Gobbler's Pool: a big round pond covered in lily pads, with a wide rim of mud to fight on
  const GP = Z.gobbler;
  disc(GP.x, GP.z, GP.r + 1.5, '#6a5a3a', 0.035); disc(GP.x, GP.z, GP.r * 0.55, '#3a6a5a', 0.05);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, x = GP.x + Math.cos(a) * GP.r * 0.72, z = GP.z + Math.sin(a) * GP.r * 0.72; pads.push(M(x, 0.06, z, 3.2, rng() * 6)); }
  instanced(lilyPad(), pads, { cast: false }); instanced(lilyFlower(), flowers);
  // a ring of reed clumps marks each boss's stage
  const rd = [], ring = (Q, n, rr) => { for (let i = 0; i < n; i++) { if (i % 4 === 3) continue; const a = (i / n) * Math.PI * 2 + 0.2; rd.push(M(Q.x + Math.cos(a) * rr, 0, Q.z + Math.sin(a) * rr, 1.8, rng() * 6)); } };
  ring(GP, 22, GP.r + 2.2);

  // Mother Mire's crooked hut at the back of her hollow, with a bubbling cauldron
  const MH = Z.mire;
  disc(MH.x, MH.z, MH.r, '#7a6a4a', 0.033);
  const hut = stiltHut(MH.x - 4, MH.z - MH.r + 5, 0.3, '#6a5a7a', '#3a4a2a'); hut.rotation.z = 0.06;
  const cx = MH.x + 6, cz = MH.z - MH.r + 6;
  const caul = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65)); caul.position.set(cx, 0.9, cz); scene.add(add(caul, '#2a2a32'));
  const brew = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20)); brew.rotation.x = -Math.PI / 2; brew.position.set(cx, 1.42, cz); registerMesh(brew, toon('#8aff6a', { emissive: '#2a6a1a' })); scene.add(brew);
  colliders.push({ x: cx, z: cz, r: 1.1 });
  ring(MH, 24, MH.r + 1.5);
  // the Sunken Ruins: a shallow flooded court ringed by tilted broken pillars
  const SR = Z.ruins;
  disc(SR.x, SR.z, SR.r, '#5f8a70', 0.033); disc(SR.x, SR.z, SR.r - 5, '#4f7f6a', 0.045);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3; if (i % 5 === 2) continue;
    const x = SR.x + Math.cos(a) * (SR.r + 0.8), z = SR.z + Math.sin(a) * (SR.r + 0.8), h = 2 + (i * 1.7) % 3;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 10)); col.position.set(x, h / 2 - 0.2, z); col.rotation.set(rng() * 0.2 - 0.1, 0, rng() * 0.2 - 0.1); scene.add(add(col, '#a8b0a0'));
    const moss = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.4, 10)); moss.position.set(x, h - 0.3, z); scene.add(add(moss, '#6a9a4a'));
    colliders.push({ x, z, r: 0.8 });
  }

  // Goonshoe's Bog: a wide, squelchy mud ring with his big shack at the back and a heap of used hankies
  const GB = Z.goon;
  disc(GB.x, GB.z, GB.r, '#7a6440', 0.033); disc(GB.x, GB.z, GB.r - 6, '#6a5636', 0.04);
  const shack = stiltHut(GB.x + 5, GB.z - GB.r + 4, -0.4, '#e08a3a', '#5a3a22'); shack.scale.multiplyScalar(1.5);
  const hank = new THREE.SphereGeometry(0.45, 8, 6);
  for (let i = 0; i < 9; i++) { const h = new THREE.Mesh(hank); h.scale.set(1, 0.55, 1); h.position.set(GB.x - 6 + (i % 3) * 0.8 + rng() * 0.3, 0.25 + Math.floor(i / 3) * 0.35, GB.z - GB.r + 6 + (i % 2) * 0.6); scene.add(add(h, '#f4f0e6')); }
  colliders.push({ x: GB.x - 5.2, z: GB.z - GB.r + 6.3, r: 1.4 }, { x: GB.x + 5, z: GB.z - GB.r + 4, r: 3.9 });
  ring(GB, 24, GB.r + 1.6);
  // willows: a belt round the edge, a dark grove behind Mire Hollow, a few lone ones in the open
  const wil = [], willowAt = (x, z, sc) => { wil.push(M(x, 0, z, sc, rng() * 6)); colliders.push({ x, z, r: 0.35 * sc }); };
  edgeBelt(L, 380, (x, z) => willowAt(x, z, 3.6 + rng() * 1.4), nearPath, (x, z, p) => free(x, z, p) && Object.values(Z).every((q) => Math.hypot(q.x - x, q.z - z) > q.r + 3), 0.5);
  for (let i = 0; i < 40; i++) {
    const a = Math.PI + (rng() - 0.5) * 2.4, rr = MH.r + 3 + rng() * 10, x = MH.x + Math.cos(a) * rr, z = MH.z + Math.sin(a) * rr;
    if (nearPath(x, z) || !free(x, z, 1.8)) continue;
    willowAt(x, z, 3.2 + rng() * 1.4);
  }
  for (let i = 0; i < 24; i++) { const [x, z] = rnd(18, R - 16); if (!open(x, z, 3, 5)) continue; willowAt(x, z, 3.4 + rng()); }
  instanced(willow(), wil);
  // reeds round the puddles and pools, a few toadstools in Mire Hollow, a couple of mossy rocks
  const ts = [], tsB = [], rocks = [];
  for (const [x, z, r] of puddles) for (let j = 0; j < 3; j++) { const a = rng() * 6.28; rd.push(M(x + Math.cos(a) * (r + 0.3), 0, z + Math.sin(a) * (r + 0.3), 1.6, rng() * 6)); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.4; rd.push(M(P.x + Math.cos(a) * (P.r + 0.8), 0, P.z + Math.sin(a) * (P.r + 0.8), 1.7, rng() * 6)); }
  for (let i = 0; i < 14; i++) { const a = rng() * 6.28, rr = MH.r + 1 + rng() * 5, x = MH.x + Math.cos(a) * rr, z = MH.z + Math.sin(a) * rr; if (nearPath(x, z) || !free(x, z, 0.5)) continue; (i % 3 ? ts : tsB).push(M(x, 0, z, 1.8 + rng() * 1.4, rng() * 6)); }
  for (let i = 0; i < 12 && rocks.length < 5; i++) { const [x, z] = rnd(18, R - 14); if (!open(x, z, 5)) continue; rocks.push(M(x, 0, z, 3 + rng() * 2, rng() * 6)); colliders.push({ x, z, r: 0.7 }); }
  instanced(reeds(), rd, { cast: false }); instanced(toadstool('#e0444f'), ts); instanced(toadstool('#a86ad8'), tsB);
  instanced(natural('Rock_Medium_1', { fit: lib.rock_single_B, bark: '#a8b88a' }), rocks);
  signpost(L.cross.x + 3.2, L.cross.z - 3.2, '#5a3a22', '#e8d8a0');
  // far hills
  const far = [];
  for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2 + rng() * 0.1; if (Math.abs(a - Math.PI / 2) < 0.45) continue; const rr = R + 30 + rng() * 8; far.push(M(MX + Math.cos(a) * rr, -1, MZ + Math.sin(a) * rr, 11 + rng() * 4, rng() * 6)); }
  if (lib.mountain_C_grass) instanced(tinted(lib.mountain_C_grass, '#6a8a5a'), far, { cast: false });
}

// Gentle snowfall that follows the camera while you're in a snowy land.
export function makeSnow() {
  const N = 420, geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 80; p[i * 3 + 1] = Math.random() * 30; p[i * 3 + 2] = (Math.random() - 0.5) * 80; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 32; const dg = dot.getContext('2d');
  const grd = dg.createRadialGradient(16, 16, 0, 16, 16, 16); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = grd; dg.fillRect(0, 0, 32, 32);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.36, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  pts.frustumCulled = false; pts.layers.set(1); pts.visible = false; scene.add(pts);
  pts.userData.tick = (dt, cx, cz) => {
    const a = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) - dt * (2 + (i % 5) * 0.4);
      if (y < 0) y += 30;
      a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(y * 0.5 + i) * dt * 0.4);
    }
    a.needsUpdate = true; pts.position.set(cx, 0, cz);
  };
  return pts;
}

// ---------- Chapter 4: Brassbolt Sands ----------
function palm() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.15 - i * 0.012, 0.18 - i * 0.012, 0.55, 7)); seg.position.set(i * 0.06, 0.28 + i * 0.52, 0); seg.rotation.z = -0.06 * i; g.add(add(seg, i % 2 ? '#a8784a' : '#b8885a')); }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, leaf = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.9, 4)); leaf.scale.set(1, 1, 0.25);
    leaf.position.set(0.3 + Math.cos(a) * 0.75, 2.75, Math.sin(a) * 0.75); leaf.rotation.set(Math.sin(a) * 1.25, -a, -Math.cos(a) * 1.25 + 0.05);
    g.add(add(leaf, i % 2 ? '#5a9a3a' : '#6aae44'));
  }
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6)); nut.position.set(0.32, 2.55, 0.12); g.add(add(nut, '#6a4a2a'));
  return g;
}
function cactus() {
  const g = new THREE.Group(), col = '#6aa04a';
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.5, 4, 10)); trunk.position.y = 1.05; g.add(add(trunk, col));
  for (const [sx, h] of [[1, 1.1], [-1, 0.8]]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8)); arm.position.set(sx * 0.55, h + 0.35, 0); g.add(add(arm, col));
    const join = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.3, 4, 8)); join.rotation.z = Math.PI / 2; join.position.set(sx * 0.36, h, 0); g.add(add(join, col));
  }
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6)); fl.position.set(0, 1.95, 0); g.add(add(fl, '#ff7ab0'));
  return g;
}
function tent(x, z, ry, cloth = '#e86a4a', trim = '#f5e2b0') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 2.2, 8)); body.position.y = 1.1; g.add(add(body, trim));
  const top = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.4, 8)); top.position.y = 3.4; g.add(add(top, cloth));
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.7)); flag.position.set(0, 4.9, 0.35); g.add(add(flag, cloth));
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.1)); door.position.set(0, 0.8, 2.55); g.add(add(door, '#6a3a22'));
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); colliders.push({ x, z, r: 2.7 });
  return g;
}
function gear(r, teeth = 10, col = '#c8984a') {
  const sh = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) { const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r * 0.82 : r; i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(rr, 0); }
  const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.3, 0, Math.PI * 2, true); sh.holes.push(hole);
  return add(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: r * 0.22, bevelEnabled: false })), col);
}
export const SANDS_FX = { castle: null };
// a choppable desert palm for Woodcutting: the full tree and its stump
// A choppable round toy tree (matches the round forest trees): oak ones are bigger and carry apples.
export function roundNode(x, z, oak = false, sc = 2.4) {
  // v81: a painted Quaternius tree (oaks are the big dark ones, with red apples)
  const g = new THREE.Group();
  g.add(naturalCopy(natural(oak ? 'CommonTree_2' : 'CommonTree_1', { h: oak ? 1.75 : 1.5, pal: oak ? PAL.deep : PAL.spring })));
  if (oak) for (const [ax, ay, az] of [[0.3, 1.05, 0.28], [-0.32, 1.2, 0.16], [0.1, 0.95, -0.36], [-0.12, 1.4, 0.28]]) { const a = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6)); a.position.set(ax, ay, az); g.add(add(a, '#e8402f')); }
  g.scale.setScalar(sc * (0.9 + rng() * 0.2)); g.position.set(x, 0, z); g.rotation.y = rng() * 6; scene.add(g);
  const cut = new THREE.Group(); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.22, 10)); st.position.y = 0.11; cut.add(add(st, '#8a5530'));
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12)); top.rotation.x = -Math.PI / 2; top.position.y = 0.225; cut.add(add(top, '#f0d8a0'));
  cut.scale.setScalar(sc); cut.position.set(x, 0, z); scene.add(cut);
  colliders.push({ x, z, r: 0.8 });
  return { full: g, cut };
}
export function palmNode(x, z, sc = 1.8) {
  const full = palm(); full.scale.setScalar(sc); full.position.set(x, 0, z); full.rotation.y = rng() * 6; scene.add(full);
  const cut = new THREE.Group(); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.35, 8)); st.position.y = 0.17; cut.add(add(st, '#a8784a'));
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.19, 10)); top.rotation.x = -Math.PI / 2; top.position.y = 0.36; cut.add(add(top, '#f0d8a0'));
  cut.scale.setScalar(sc); cut.position.set(x, 0, z); scene.add(cut);
  colliders.push({ x, z, r: 0.5 });
  return { full, cut };
}
export function buildSands() {
  const L = LANDS.sands, R = L.r;
  // rolling golden dunes, flat in the middle, rising at the edge, with a sandy bay for the harbour
  const gGeo = new THREE.PlaneGeometry(250, 250, 110, 110); gGeo.rotateX(-Math.PI / 2);
  const pos = gGeo.attributes.position, cols = [], cA = new THREE.Color('#f0d8a0'), cB = new THREE.Color('#e6c486'), cC = new THREE.Color('#f8e6b8'), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    const n = Math.sin(x * 0.07 + z * 0.03) * Math.cos(z * 0.06) + 0.4 * Math.sin(x * 0.19 - z * 0.13);
    t.copy(cA).lerp(n > 0 ? cC : cB, Math.min(1, Math.abs(n) * 0.7));
    const bay = z > 44 && Math.abs(x) < 34;
    let y = d > R + 4 ? (d - R - 4) * 0.25 * (1 + 0.6 * Math.sin(x * 0.11 + z * 0.07)) : 0;
    const wx = x + DX, wz = z + DZ, flat = Object.values(L.zones).some((q) => Math.hypot(wx - q.x, wz - q.z) < q.r + 5) || Math.hypot(wx - L.pond.x, wz - L.pond.z) < L.pond.r + 4 || Math.hypot(wx - L.village.x, wz - L.village.z) < 14 || TOWNS.some((T) => T.land === 'sands' && Math.hypot(wx - T.x, wz - T.z) < T.r + 2)
      || landRoads(L).some(([x1, z1, x2, z2]) => { const dx = x2 - x1, dz = z2 - z1, k = Math.max(0, Math.min(1, ((wx - x1) * dx + (wz - z1) * dz) / (dx * dx + dz * dz))); return Math.hypot(wx - x1 - k * dx, wz - z1 - k * dz) < 4; });
    if (!bay && !flat && d > 20 && d < R) y += Math.max(0, Math.sin(x * 0.09 + Math.cos(z * 0.05) * 2)) * 0.35 * Math.min(1, (d - 20) / 8);
    if (bay) y = z > 56 ? -0.7 : 0;
    pos.setY(i, y); cols.push(t.r, t.g, t.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo); ground.position.set(DX, 0, DZ); ground.receiveShadow = true;
  registerMesh(ground, paintGround(toon('#ffffff', { vertexColors: true }))); scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(68, 70)); sea.rotation.x = -Math.PI / 2; sea.position.set(DX, -0.05, DZ + 92);
  registerMesh(sea, toon('#4fa8c8')); scene.add(sea);

  const pathM = toon('#d8b070', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const path = (x1, z1, x2, z2, w = 3) => { const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len)); m.rotation.set(-Math.PI / 2, 0, Math.atan2(dx, dz)); m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2); registerMesh(m, pathM); m.receiveShadow = true; scene.add(m); };
  const disc = (x, z, r, col = '#d8b070', y = 0.035) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); registerMesh(m, toon(col, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.receiveShadow = true; scene.add(m); return m; };
  const V = L.village, Z = L.zones, roads = landRoads(L);
  for (const [x1, z1, x2, z2] of roads) path(x1, z1, x2, z2);
  disc(V.x, V.z, 7, '#e8c890');
  const landTowns = TOWNS.filter((T) => T.land === L.id);
  const nearPath = (x, z) => {
    if (landTowns.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 2)) return true;
    for (const [x1, z1, x2, z2] of roads) { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz, k = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)); if (Math.hypot(x - x1 - k * dx, z - z1 - k * dz) < 4) return true; }
    return false;
  };
  const free = (x, z, pad) => colliders.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + pad);
  const away = (x, z, pad) => !nearPath(x, z) && Math.hypot(x - V.x, z - V.z) > 15 && Object.values(Z).every((q) => Math.hypot(x - q.x, z - q.z) > q.r + 3) && Math.hypot(x - L.pond.x, z - L.pond.z) > L.pond.r + 2 && free(x, z, pad);

  // Oasis Rest: striped tents round a well, and a little palm-ringed pool
  for (const [dx, dz, c, tr] of [[-11, -3, '#e86a4a', '#f5e2b0'], [11, -4, '#4a8ad8', '#f5e2b0'], [-11, 9, '#e8b03a', '#fff1d6'], [-2, 13, '#a85ad8', '#f5e2b0']]) tent(V.x + dx, V.z + dz, Math.atan2(-dx, -dz), c, tr);
  place('building_well_blue', V.x, V.z - 1, S_BUILD);
  for (const [n, dx, dz] of [['barrel', 6, 3], ['sack', -6, 4]]) place(n, V.x + dx, V.z + dz, S_PROP, rng() * 6, { shrink: 0.6 });
  pier(DX, DZ + 52, 10, 0);
  makeShip(DX, DZ + 66, 0, '#fff1d6', '#d89a3a');
  colliders.push({ x: DX, z: DZ + 66, r: 3 });
  const P = L.pond;
  disc(P.x, P.z, P.r + 1.2, '#b8a060', 0.04); disc(P.x, P.z, P.r, '#5fc0d0', 0.05);
  const palms = [], palmAt = (x, z, sc) => { palms.push(M(x, 0, z, sc, rng() * 6)); colliders.push({ x, z, r: 0.25 * sc }); };
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3, x = P.x + Math.cos(a) * (P.r + 2.2), z = P.z + Math.sin(a) * (P.r + 2.2); if (free(x, z, 1)) palmAt(x, z, 1.6 + rng() * 0.4); }
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2, rr = 52 + rng() * 22, x = DX + Math.cos(a) * rr, z = DZ + Math.sin(a) * rr;
    if (z - DZ > 40 && Math.abs(x - DX) < 38) continue;
    if (rng() > 0.45 || nearPath(x, z) || !free(x, z, 2)) continue;
    palmAt(x, z, 1.5 + rng() * 0.6);
  }
  instanced(palm(), palms);
  const cacti = [], rocks = [], bones = [];
  for (let i = 0; i < 30 && cacti.length < 14; i++) { const a = rng() * 6.28, rr = 16 + rng() * 50, x = DX + Math.cos(a) * rr, z = DZ + Math.sin(a) * rr; if (!away(x, z, 3)) continue; cacti.push(M(x, 0, z, 1 + rng() * 0.6, rng() * 6)); colliders.push({ x, z, r: 0.5 }); }
  for (let i = 0; i < 16 && rocks.length < 7; i++) { const a = rng() * 6.28, rr = 14 + rng() * 48, x = DX + Math.cos(a) * rr, z = DZ + Math.sin(a) * rr; if (!away(x, z, 4)) continue; rocks.push(M(x, 0, z, 3 + rng() * 2.5, rng() * 6)); colliders.push({ x, z, r: 0.8 }); }
  instanced(cactus(), cacti);
  instanced(natural('Rock_Medium_3', { fit: lib.rock_single_B, bark: '#f0c888' }), rocks);
  // half-buried brass gears: the old Brassbolt kingdom is under the sand
  for (let i = 0, n = 0; i < 16 && n < 6; i++) {
    const a = rng() * 6.28, rr = 14 + rng() * 50, x = DX + Math.cos(a) * rr, z = DZ + Math.sin(a) * rr; if (!away(x, z, 4)) continue; n++;
    const r = 1 + rng() * 1.8, g = gear(r, 8 + Math.floor(rng() * 6), rng() > 0.5 ? '#c8984a' : '#b87a4a');
    g.position.set(x, r * 0.45, z); g.rotation.set(0.15 - rng() * 0.3, rng() * 6, 0); scene.add(g); colliders.push({ x, z, r: r * 0.5 });
  }

  // the Sphinx Engine: a great sandstone cat with a brass face and glowing eyes
  const SP = Z.sphinx;
  disc(SP.x, SP.z, SP.r - 2, '#e0c088');
  const sg = new THREE.Group(); sg.position.set(SP.x, 0, SP.z - 6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 9)); body.position.set(0, 1.5, -1); sg.add(add(body, '#e0b878'));
  for (const sx of [-1.6, 1.6]) { const paw = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 4)); paw.position.set(sx, 0.5, 4.5); sg.add(add(paw, '#d8b070')); }
  const chest = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4, 2.6)); chest.position.set(0, 3, 2.6); sg.add(add(chest, '#e0b878'));
  const head = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2.8)); head.position.set(0, 6.4, 2.6); sg.add(add(head, '#c8984a'));
  const hood = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.6, 4)); hood.rotation.y = Math.PI / 4; hood.position.set(0, 6.6, 2.2); hood.scale.set(1.1, 1, 0.8); sg.add(add(hood, '#4a8ad8'));
  sg.add(head);
  for (const sx of [-0.7, 0.7]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8)); eye.position.set(sx, 6.7, 4.02); registerMesh(eye, toon('#7fe8ff', { emissive: '#3fb8d8' })); sg.add(eye); }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.2)); plate.position.set(0, 5.6, 4.02); sg.add(add(plate, '#8a5a2a'));
  scene.add(sg); colliders.push({ x: SP.x, z: SP.z - 7, r: 4.2 }, { x: SP.x, z: SP.z - 2.2, r: 2.6 });
  for (let i = 0; i < 6; i++) { const a = Math.PI * 0.15 + (i / 5) * Math.PI * 0.7, x = SP.x + Math.cos(a) * (SP.r - 2), z = SP.z + Math.sin(a) * (SP.r - 2); const h = 3 + (i % 3); const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, h, 8)); col.position.set(x, h / 2, z); scene.add(add(col, '#e8c890')); colliders.push({ x, z, r: 0.75 }); }

  // Rustwind Yard: a junk heap of pipes and gears where Pompington tinkers with his battle suit
  const WY = Z.workshop;
  disc(WY.x, WY.z, WY.r, '#b89a68');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, x = WY.x + Math.cos(a) * (WY.r + 1), z = WY.z + Math.sin(a) * (WY.r + 1);
    if (Math.abs(a - Math.PI) < 0.5) continue;
    const g = gear(1.4 + (i % 3) * 0.5, 10, i % 2 ? '#c8984a' : '#a86a3a'); g.position.set(x, 1.2 + (i % 3) * 0.4, z); g.rotation.y = a + Math.PI / 2; scene.add(g); colliders.push({ x, z, r: 1.2 });
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8, 12)); pipe.rotation.z = Math.PI / 2; pipe.position.set(WY.x + 4, 0.5, WY.z - WY.r - 2); scene.add(add(pipe, '#b87a4a'));
  colliders.push({ x: WY.x + 4, z: WY.z - WY.r - 2, r: 1.5 });
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6, 10)); chimney.position.set(WY.x - 6, 3, WY.z - WY.r - 1.5); scene.add(add(chimney, '#8a5a3a'));
  colliders.push({ x: WY.x - 6, z: WY.z - WY.r - 1.5, r: 1.1 });

  // Colossus Plaza: a round brass-tiled arena where the giant sleeps
  const CP = Z.colossus;
  disc(CP.x, CP.z, CP.r + 1, '#b8884a', 0.034); disc(CP.x, CP.z, CP.r - 1, '#d8a858', 0.036);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const g = gear(0.9, 8, '#a86a3a'); g.rotation.x = -Math.PI / 2; g.position.set(CP.x + Math.cos(a) * (CP.r - 0.2), 0.05, CP.z + Math.sin(a) * (CP.r - 0.2)); scene.add(g); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; if (Math.abs(a - Math.PI / 2) < 0.4) continue; const x = CP.x + Math.cos(a) * (CP.r + 3), z = CP.z + Math.sin(a) * (CP.r + 3), h = 4 + (i % 2) * 2; const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 8)); col.position.set(x, h / 2, z); scene.add(add(col, '#c8984a')); const cap = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8)); cap.position.set(x, h + 0.4, z); scene.add(add(cap, '#ffd23f')); colliders.push({ x, z, r: 0.8 }); }

  // the Floating Castle: hidden until the Colossus falls, then it rises over the far dunes
  const fc = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.ConeGeometry(9, 12, 7)); rock.rotation.x = Math.PI; rock.position.y = -6; fc.add(add(rock, '#6a5a7a'));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.2, 7)); fc.add(add(base, '#5a4a6a'));
  for (const [x, z, h, r] of [[0, 0, 9, 2.4], [-5, -2, 6, 1.4], [5, -2, 6, 1.4], [-3, 4, 4.5, 1.2], [3, 4, 4.5, 1.2]]) {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 8)); tw.position.set(x, h / 2 + 0.6, z); fc.add(add(tw, '#3a2a4a'));
    const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, r * 2.2, 8)); sp.position.set(x, h + 0.6 + r * 1.1, z); fc.add(add(sp, '#7a3aa8'));
    const win = new THREE.Mesh(new THREE.BoxGeometry(r * 0.6, r * 0.8, 0.1)); win.position.set(x, h * 0.7, z + r + 0.02); registerMesh(win, toon('#ff5adc', { emissive: '#a8248a' })); fc.add(win);
  }
  fc.position.set(DX, 15, DZ - 64); fc.scale.setScalar(1.2); fc.visible = false; scene.add(fc);
  SANDS_FX.castle = fc;
  // far mesas
  const far = [];
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2 + rng() * 0.1; if (Math.abs(a - Math.PI / 2) < 0.55) continue; const rr = R + 30 + rng() * 8; far.push(M(DX + Math.cos(a) * rr, -1, DZ + Math.sin(a) * rr, 10 + rng() * 4, rng() * 6)); }
  if (lib.mountain_C_grass) instanced(tinted(lib.mountain_C_grass, '#d8a060'), far, { cast: false });
}

// ---------- Magma Caverns (optional land) ----------
// A dark basalt cave floor with glowing lava pools, stalagmites, obsidian and ember crystals,
// ringed by black cliffs. Lava pools are listed in LANDS.magma.lava so the game can make them burn.
export const MAGMA_FX = { lava: null, glow: [] };
function stalagmite() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#3a2e2e' }), tip = new THREE.MeshStandardMaterial({ color: '#5a4440' });
  for (const [x, z, h, r] of [[0, 0, 1.8, 0.42], [0.42, 0.18, 1.1, 0.28], [-0.32, 0.26, 0.8, 0.22]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), x === 0 ? m : tip); c.position.set(x, h / 2, z); g.add(c);
  }
  return g;
}
function basalt() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#2e2628' }), top = new THREE.MeshStandardMaterial({ color: '#4a3c3a' });
  for (const [x, z, h] of [[0, 0, 1.4], [0.46, 0.1, 1.0], [-0.4, 0.22, 0.7], [0.1, -0.44, 0.9]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, h, 6), m); c.position.set(x, h / 2, z); g.add(c);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 6), top); t.position.set(x, h + 0.01, z); g.add(t);
  }
  return g;
}
export function buildMagma() {
  const L = LANDS.magma, R = L.r, P = L.pond, Z = L.zones;
  const lavaAt = [{ x: P.x, z: P.z, r: P.r }];
  landGround(L, ['#4c464c', '#3c373d', '#585056'], 0.34, (x, z, t) => {
    // the floor warms to a deep ember red near the lava lake
    const d = Math.hypot(x - (P.x - L.x), z - (P.z - L.z));
    if (d < P.r + 9) t.lerp(new THREE.Color('#6a3428'), Math.max(0, 1 - (d - P.r) / 9) * 0.6);
  });
  landSea(L, '#2a4250', '#3e3230');
  makeShip(KX, KZ + coastOf(L) + 22, 0, '#3a2a2a', '#ff6a2a');
  const { disc, nearPath, free, open, rnd } = landKit(L, '#6a544a');
  const V = L.village;
  // the lava material glows and slowly pulses (the game nudges its strength each frame)
  const lavaM = toon('#ff7a1a', { emissive: new THREE.Color('#ff4a0a'), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  MAGMA_FX.lava = lavaM;
  const crustM = toon('#2a2020', { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const pool = (x, z, r) => {
    const rim = new THREE.Mesh(new THREE.CircleGeometry(r + 0.9, 28)); rim.rotation.x = -Math.PI / 2; rim.position.set(x, 0.04, z); registerMesh(rim, crustM); scene.add(rim);
    const lv = new THREE.Mesh(new THREE.CircleGeometry(r, 28)); lv.rotation.x = -Math.PI / 2; lv.position.set(x, 0.06, z); registerMesh(lv, lavaM); scene.add(lv);
    const glow = new THREE.PointLight('#ff6a2a', 1.3, r * 2 + 6, 1.5); glow.position.set(x, 2.5, z); scene.add(glow); MAGMA_FX.glow.push(glow);
  };
  pool(P.x, P.z, P.r);
  // Cinder Camp: two dark tents round a fire pit, a barrel and a crate
  for (const [dx, dz, c] of [[-10, -2, '#5a2a2a'], [10, -3, '#3a2a3a']]) tent(V.x + dx, V.z + dz, Math.atan2(-dx, -dz), c, '#8a6a5a');
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.4, 10)); pit.position.set(V.x, 0.2, V.z - 1); scene.add(add(pit, '#3a3030'));
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16)); coals.rotation.x = -Math.PI / 2; coals.position.set(V.x, 0.42, V.z - 1); registerMesh(coals, lavaM); scene.add(coals);
  colliders.push({ x: V.x, z: V.z - 1, r: 1.3 });
  for (const [n, dx, dz] of [['barrel', 6, 4], ['resource_stone', -6, 5]]) place(n, V.x + dx, V.z + dz, S_PROP, rng() * 6, { shrink: 0.6 });
  // more small lava pools out in the open, never on a road
  for (let i = 0, n = 0; i < 60 && n < 6; i++) { const [x, z] = rnd(14, R - 12); if (!open(x, z, 5, 4)) continue; const r = 2 + rng() * 1.6; pool(x, z, r); lavaAt.push({ x, z, r }); colliders.push({ x, z, r: 0.01 }); n++; }
  // glowing cracks running out from the lava lake
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, len = 5 + rng() * 6, cx = P.x + Math.cos(a) * (P.r + len / 2), cz = P.z + Math.sin(a) * (P.r + len / 2);
    if (nearPath(cx, cz, 2)) continue;
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.22, len)); c.rotation.set(-Math.PI / 2, 0, -a + Math.PI / 2); c.position.set(cx, 0.05, cz); registerMesh(c, lavaM); scene.add(c);
  }
  L.lava = lavaAt;
  // Burning Bonefield and Ashen Hollow: scorched floors with scattered bone piles
  const boneM = toon('#d8ccb8');
  for (const key of ['bones', 'ash']) {
    const Q = Z[key]; disc(Q.x, Q.z, Q.r, key === 'bones' ? '#4a3a34' : '#5a5250');
    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28, rr = 4 + rng() * (Q.r - 5), x = Q.x + Math.cos(a) * rr, z = Q.z + Math.sin(a) * rr;
      for (let b = 0; b < 3; b++) { const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 3, 6)); bone.rotation.set(Math.PI / 2, 0, rng() * 3); bone.position.set(x + rng() - 0.5, 0.1, z + rng() - 0.5); registerMesh(bone, boneM); scene.add(bone); }
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6)); skull.position.set(x, 0.18, z); registerMesh(skull, boneM); scene.add(skull);
    }
  }
  // Dragon's Roost: a ring of dark boulders round a nest of glowing eggs
  const RO = Z.roost; disc(RO.x, RO.z, RO.r, '#3e302c');
  const nest = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.6, 8, 20)); nest.rotation.x = -Math.PI / 2; nest.position.set(RO.x, 0.3, RO.z - 6); scene.add(add(nest, '#4a3a30'));
  for (const [dx, dz, c] of [[-0.6, 0.2, '#ffcf5a'], [0.7, -0.3, '#ff8a3a'], [0.1, 0.8, '#ffb04a']]) { const egg = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10)); egg.scale.y = 1.3; egg.position.set(RO.x + dx, 0.6, RO.z - 6 + dz); registerMesh(egg, toon(c, { emissive: new THREE.Color(c).multiplyScalar(0.35) })); scene.add(egg); }
  colliders.push({ x: RO.x, z: RO.z - 6, r: 2.6 });
  // The Molten Heart: an obsidian floor inside a ring of lava (gaps to walk in), home of the elder dragons
  const HT = Z.heart; disc(HT.x, HT.z, HT.r + 2.6, '#2a2020', 0.033); disc(HT.x, HT.z, HT.r, '#3a2c2c', 0.036);
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 1) continue;
    const a0 = (i / 16) * Math.PI * 2, seg = new THREE.Mesh(new THREE.RingGeometry(HT.r + 0.5, HT.r + 2, 6, 1, a0, (Math.PI * 2) / 16));
    seg.rotation.x = -Math.PI / 2; seg.position.set(HT.x, 0.05, HT.z); registerMesh(seg, lavaM); scene.add(seg);
  }
  const hglow = new THREE.PointLight('#ff6a2a', 1.4, 26, 1.5); hglow.position.set(HT.x, 4, HT.z); scene.add(hglow); MAGMA_FX.glow.push(hglow);
  // stalagmites, basalt columns, obsidian and ember crystals, well apart
  const tall = [], cols = [], obs = [], emb = [];
  edgeBelt(L, 300, (x, z) => { if (rng() < 0.5) { tall.push(M(x, 0, z, 3.2 + rng() * 2.4, rng() * 6)); colliders.push({ x, z, r: 1.1 }); } else { cols.push(M(x, 0, z, 2.6 + rng() * 1.6, rng() * 6)); colliders.push({ x, z, r: 1.1 }); } }, nearPath, free, 0.5);
  for (let i = 0; i < 40 && tall.length < 160; i++) { const [x, z] = rnd(18, R - 14); if (!open(x, z, 4, 3)) continue; tall.push(M(x, 0, z, 2.4 + rng() * 1.4, rng() * 6)); colliders.push({ x, z, r: 0.9 }); }
  for (let i = 0; i < 30 && obs.length < 7; i++) { const [x, z] = rnd(16, R - 14); if (!open(x, z, 5, 3)) continue; obs.push(M(x, 0, z, 1.4 + rng() * 0.8, rng() * 6)); colliders.push({ x, z, r: 0.5 }); }
  for (let i = 0; i < 30 && emb.length < 6; i++) { const [x, z] = rnd(16, R - 14); if (!open(x, z, 5, 3)) continue; emb.push(M(x, 0, z, 1.2 + rng() * 0.6, rng() * 6)); colliders.push({ x, z, r: 0.5 }); }
  instanced(stalagmite(), tall); instanced(basalt(), cols); instanced(crystal('#3a2a4a'), obs);
  instanced(crystal('#ffa040'), emb);
  // the cavern walls: black cliffs all round
  const far = [];
  for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2 + rng() * 0.1; if (Math.abs(a - Math.PI / 2) < 0.5) continue; const rr = R + 28 + rng() * 8; far.push(M(KX + Math.cos(a) * rr, -1, KZ + Math.sin(a) * rr, 13 + rng() * 5, rng() * 6)); }
  if (lib.mountain_C_grass) instanced(tinted(lib.mountain_C_grass, '#2e2426'), far, { cast: false });
}
// rising embers for the Magma Caverns (like the snow, but warm and floating upward)
export function makeEmbers() {
  const N = 160, geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 70; p[i * 3 + 1] = Math.random() * 18; p[i * 3 + 2] = (Math.random() - 0.5) * 70; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 32; const dg = dot.getContext('2d');
  const grd = dg.createRadialGradient(16, 16, 0, 16, 16, 16); grd.addColorStop(0, 'rgba(255,230,160,1)'); grd.addColorStop(0.4, 'rgba(255,140,40,.8)'); grd.addColorStop(1, 'rgba(255,80,0,0)');
  dg.fillStyle = grd; dg.fillRect(0, 0, 32, 32);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.32, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  pts.frustumCulled = false; pts.layers.set(1); pts.visible = false; scene.add(pts);
  pts.userData.tick = (dt, cx, cz) => {
    const a = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + dt * (0.8 + (i % 5) * 0.25);
      if (y > 18) y -= 18;
      a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(y * 0.7 + i) * dt * 0.5);
    }
    a.needsUpdate = true; pts.position.set(cx, 0, cz);
  };
  return pts;
}
