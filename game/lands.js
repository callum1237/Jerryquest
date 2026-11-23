// Continents: each story chapter takes you to a new land, reached by ship.
// Every land is built far away from the valley (x ≈ 1000+), and sailing moves you there through a fade.
import { THREE, scene, registerMesh, toon, rng } from './engine.js';
import { M, instanced, place, colliders, tinted, lib, S_BUILD, S_PROP, LAKE, TOWNS } from './world.js';

const FX = 1000, FZ = 0;
export const LANDS = {
  frost: {
    id: 'frost', name: 'Frostwhisker Peaks', x: FX, z: FZ, r: 70,
    arrive: { x: FX, z: FZ + 49 }, captain: { x: FX + 4, z: FZ + 51 },
    village: { x: FX, z: FZ + 32 }, elder: { x: FX - 4, z: FZ + 30 },
    pond: { x: FX - 30, z: FZ + 10, r: 9 },
    zones: {
      woods: { name: 'Icicle Woods', x: FX - 36, z: FZ - 20, r: 17 },
      hills: { name: 'Snowman Hills', x: FX + 36, z: FZ + 4, r: 16 },
      palace: { name: 'Ice Palace', x: FX, z: FZ - 44, r: 13 },
    },
  },
};
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

export function buildLands() {
  const L = LANDS.frost, R = L.r;
  const rel = (dx, dz) => [FX + dx, FZ + dz];
  // snowy ground that rises into hills at the edge, with a sunken bay to the south for the harbour
  const gGeo = new THREE.PlaneGeometry(250, 250, 110, 110); gGeo.rotateX(-Math.PI / 2);
  const pos = gGeo.attributes.position, cols = [], cA = new THREE.Color('#eef5ff'), cB = new THREE.Color('#dbe8f7'), cC = new THREE.Color('#ffffff'), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) + 0.5 * Math.sin(x * 0.21 + z * 0.15);
    t.copy(cA).lerp(n > 0 ? cC : cB, Math.min(1, Math.abs(n) * 0.6));
    const bay = z > 44 && Math.abs(x) < 34;
    let y = d > R + 4 ? (d - R - 4) * 0.28 * (1 + 0.5 * Math.sin(x * 0.13 + z * 0.09)) : 0;
    if (bay) y = z > 56 ? -0.7 : 0;
    if (bay && z > 54) t.set('#e9dcc0');
    pos.setY(i, y); cols.push(t.r, t.g, t.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo); ground.position.set(FX, 0, FZ); ground.receiveShadow = true;
  registerMesh(ground, toon('#ffffff', { vertexColors: true })); scene.add(ground);
  // the sea in the bay
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(68, 70)); sea.rotation.x = -Math.PI / 2; sea.position.set(FX, -0.05, FZ + 92);
  registerMesh(sea, toon('#4fb0e8')); scene.add(sea);
  for (let i = 0; i < 14; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + rng(), 0.18)); w.rotation.x = -Math.PI / 2; w.position.set(FX - 28 + rng() * 56, 0.0, FZ + 60 + rng() * 40); registerMesh(w, toon('#d6f2ff')); scene.add(w); }

  // trampled snow paths
  const pathM = toon('#c9d8ea', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const path = (x1, z1, x2, z2, w = 3) => { const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len)); m.rotation.set(-Math.PI / 2, 0, Math.atan2(dx, dz)); m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2); registerMesh(m, pathM); m.receiveShadow = true; scene.add(m); };
  const disc = (x, z, r, col = '#c9d8ea') => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.035, z); registerMesh(m, toon(col, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.receiveShadow = true; scene.add(m); };
  const V = L.village, Z = L.zones;
  path(L.arrive.x, L.arrive.z + 5, V.x, V.z);
  path(V.x, V.z, Z.palace.x, Z.palace.z + Z.palace.r);
  path(V.x, V.z, Z.woods.x + 8, Z.woods.z + 10);
  path(V.x, V.z, Z.hills.x - 8, Z.hills.z + 4);
  const landTowns = TOWNS.filter((T) => T.land === L.id);
  for (const T of landTowns) path(V.x, V.z, T.x, T.z);
  disc(V.x, V.z, 7);

  // Snowdrop village
  const homes = [['building_home_A_blue', -10, -3], ['building_home_B_blue', 10, -4], ['building_home_A_red', -11, 8], ['building_market_yellow', 11, 7]];
  for (const [n, dx, dz] of homes) { const x = V.x + dx, z = V.z + dz; const o = place(n, x, z, S_BUILD, Math.atan2(V.x - x, V.z - z)); if (o) o.traverse((m) => { if (m.isMesh && m.userData.mats) { for (const k of ['std', 'toon']) { m.userData.mats[k] = m.userData.mats[k].clone(); m.userData.mats[k].color.set('#eef4ff'); } m.material = m.userData.mats.toon; } }); }
  place('building_well_blue', V.x, V.z - 1, S_BUILD);
  for (const [n, dx, dz] of [['barrel', 6, 3], ['crate_A_big', -6, 4], ['sack', 7, 4]]) place(n, V.x + dx, V.z + dz, S_PROP, rng() * 6, { shrink: 0.6 });
  // harbour: pier and the ship
  pier(FX, FZ + 52, 10, 0);
  makeShip(FX, FZ + 66, 0, '#fff1d6', '#4a7ac8');
  colliders.push({ x: FX, z: FZ + 66, r: 3 });

  // frozen pond
  const P = L.pond;
  const ice = new THREE.Mesh(new THREE.CircleGeometry(P.r, 36)); ice.rotation.x = -Math.PI / 2; ice.position.set(P.x, 0.05, P.z); registerMesh(ice, toon('#a8dcf6', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); scene.add(ice);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.5 + rng() * 2)); s.rotation.set(-Math.PI / 2, 0, rng() * 3); s.position.set(P.x - 5 + rng() * 10, 0.07, P.z - 5 + rng() * 10); registerMesh(s, toon('#e8f8ff')); scene.add(s); }

  // trees: a belt of snowy pines, thicker in Icicle Woods
  const nearPath = (x, z) => {
    if (landTowns.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 2)) return true;
    const segs = [[L.arrive.x, L.arrive.z + 5, V.x, V.z], [V.x, V.z, Z.palace.x, Z.palace.z + Z.palace.r], [V.x, V.z, Z.woods.x + 8, Z.woods.z + 10], [V.x, V.z, Z.hills.x - 8, Z.hills.z + 4], ...landTowns.map((T) => [V.x, V.z, T.x, T.z])];
    for (const [x1, z1, x2, z2] of segs) { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz, k = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)); if (Math.hypot(x - x1 - k * dx, z - z1 - k * dz) < 4) return true; }
    return false;
  };
  const free = (x, z, pad) => colliders.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + pad);
  const pines = [];
  const pineAt = (x, z, s) => { pines.push(M(x, 0, z, s, rng() * 6)); colliders.push({ x, z, r: 0.25 * s }); };
  for (let i = 0; i < 340; i++) {
    const a = rng() * Math.PI * 2, rr = 50 + rng() * 26, x = FX + Math.cos(a) * rr, z = FZ + Math.sin(a) * rr;
    if (z - FZ > 40 && Math.abs(x - FX) < 38) continue;
    if (rng() > 0.55 || nearPath(x, z) || !free(x, z, 1.2)) continue;
    pineAt(x, z, 4.2 + rng() * 1.6);
  }
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2, rr = 5 + rng() * (Z.woods.r + 6), x = Z.woods.x + Math.cos(a) * rr, z = Z.woods.z + Math.sin(a) * rr;
    if (nearPath(x, z) || Math.hypot(x - Z.woods.x, z - Z.woods.z) < 7 || !free(x, z, 1.4)) continue;
    pineAt(x, z, 3.8 + rng() * 1.8);
  }
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, rr = 16 + rng() * 32, x = FX + Math.cos(a) * rr, z = FZ + Math.sin(a) * rr;
    if (nearPath(x, z) || Math.hypot(x - V.x, z - V.z) < 16 || Math.hypot(x - P.x, z - P.z) < P.r + 2 || Math.hypot(x - Z.palace.x, z - Z.palace.z) < Z.palace.r + 4 || !free(x, z, 2)) continue;
    pineAt(x, z, 4 + rng() * 1.2);
  }
  instanced(snowPine(), pines);

  // Snowman Hills: lots of snowmen (they're friendly... probably) and igloos
  const men = [], igl = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + rng() * 0.4, rr = 6 + rng() * (Z.hills.r - 4), x = Z.hills.x + Math.cos(a) * rr, z = Z.hills.z + Math.sin(a) * rr; if (!free(x, z, 1)) continue; men.push(M(x, 0, z, 1.5 + rng() * 0.5, Math.atan2(FX - x, FZ + 30 - z))); colliders.push({ x, z, r: 0.5 }); }
  for (const [dx, dz, ry] of [[-6, -10, 0.4], [7, -8, -0.6], [12, 6, -1.6]]) { const x = Z.hills.x + dx, z = Z.hills.z + dz; igl.push(M(x, 0, z, 2.2, ry)); colliders.push({ x, z, r: 2 }); }
  for (const [dx, dz] of [[-14, 6], [13, -6], [-9, 14]]) { const x = V.x + dx, z = V.z + dz; if (free(x, z, 1)) { men.push(M(x, 0, z, 1.5, Math.atan2(V.x - x, V.z - z))); colliders.push({ x, z, r: 0.5 }); } }
  instanced(snowman(), men); instanced(igloo(), igl);
  // snow-capped rocks
  const rocks = [];
  for (let i = 0; i < 16; i++) { const a = rng() * Math.PI * 2, rr = 14 + rng() * 40, x = FX + Math.cos(a) * rr, z = FZ + Math.sin(a) * rr; if (nearPath(x, z) || Math.hypot(x - V.x, z - V.z) < 14 || !free(x, z, 1.5)) continue; rocks.push(M(x, 0, z, 3.5 + rng() * 2, rng() * 6)); colliders.push({ x, z, r: 0.7 }); }
  if (lib.rock_single_B) instanced(tinted(lib.rock_single_B, '#dfe9f6'), rocks);

  // the Ice Palace: a ring of crystal spires around a glassy floor
  const IP = Z.palace;
  disc(IP.x, IP.z, IP.r + 1, '#bfe6fb');
  const spires = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.3) continue; const x = IP.x + Math.cos(a) * IP.r, z = IP.z + Math.sin(a) * IP.r; spires.push(M(x, 0, z, 2.6 + (i % 3) * 0.6, a)); colliders.push({ x, z, r: 1 }); }
  instanced(crystal('#9fe6ff'), spires);
  const loose = [];
  for (let i = 0; i < 14; i++) { const a = rng() * Math.PI * 2, rr = 8 + rng() * 40, x = FX + Math.cos(a) * rr, z = FZ + Math.sin(a) * rr; if (nearPath(x, z) || Math.hypot(x - V.x, z - V.z) < 14 || !free(x, z, 1)) continue; loose.push(M(x, 0, z, 1.2 + rng() * 0.8, rng() * 6)); colliders.push({ x, z, r: 0.5 }); }
  instanced(crystal('#c8b8ff'), loose);
  const throne = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 1)); throne.position.set(IP.x, 1.6, IP.z - 6); add(throne, '#bfe6ff'); scene.add(throne);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.6)); seat.position.set(IP.x, 0.5, IP.z - 5.2); add(seat, '#9fd8f8'); scene.add(seat);
  colliders.push({ x: IP.x, z: IP.z - 5.6, r: 1.4 });

  // white mountains all round
  const far = [];
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2 + rng() * 0.1; if (Math.abs(a - Math.PI / 2) < 0.55) continue; const rr = R + 30 + rng() * 8; far.push(M(FX + Math.cos(a) * rr, -1, FZ + Math.sin(a) * rr, 12 + rng() * 5, rng() * 6)); }
  if (lib.mountain_C_grass) instanced(tinted(lib.mountain_C_grass, '#f2f7ff'), far, { cast: false });

  // ---------- Jerry Valley harbour on the lake ----------
  const D = VALLEY_DOCK;
  pier(D.x + 1.2, D.z + 1.2, 8, Math.PI / 4);
  makeShip(D.ship.x, D.ship.z, Math.PI / 4);
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
