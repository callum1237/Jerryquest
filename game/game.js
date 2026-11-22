// JerryQuest: playable single-player slice. Classes, skills that level by use, gathering, combat and quests.
import { THREE, scene, camera, renderer, sun, PRESETS, env, applyPreset, styled, setStyled, stylize, toon, registerMesh,
  loadModel, burst, updateParticles, render, rng } from './engine.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildWorld, buildFlowers, place, colliders, clouds, dynamic, LAKE, CAMP, MINE, S_NATURE, blocked, isFree } from './world.js';
import { ICONS } from './icons.js';

const $ = (id) => document.getElementById(id);
const clock = new THREE.Clock();
let now = 0;

// ---------- rules ----------
const SKILLS = [
  ['melee', 'Melee'], ['magic', 'Magic'], ['ranged', 'Ranged'], ['speed', 'Speed'],
  ['woodcutting', 'Woodcutting'], ['mining', 'Mining'], ['fishing', 'Fishing'],
];
const SKILL_NAME = Object.fromEntries(SKILLS);
const XPT = [0, 0];
{ let pts = 0; for (let l = 1; l < 99; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); XPT[l + 1] = Math.floor(pts / 4); } }
const levelOf = (xp) => { let l = 1; while (l < 99 && xp >= XPT[l + 1]) l++; return l; };

const CLASSES = {
  knight: {
    name: 'Knight', model: 'knight', skill: 'melee', weapon: ['1H_Sword', 'Badge_Shield'],
    blurb: 'Sword and shield. Fights up close and shrugs off hits.', perk: 'Trains Melee. Starts with the most health.',
    atk: { anim: '1H_Melee_Attack_Slice_Diagonal', range: 2.8, cd: 1.25, hitAt: 0.32 }, hp: 60,
  },
  mage: {
    name: 'Mage', model: 'mage', skill: 'magic', weapon: ['2H_Staff'],
    blurb: 'Hurls glowing bolts from a safe distance.', perk: 'Trains Magic. Hits hardest of the three.',
    atk: { anim: 'Spellcast_Shoot', range: 12, cd: 1.6, hitAt: 0.35, proj: 'orb', bonus: 2 }, hp: 45,
  },
  archer: {
    name: 'Archer', model: 'archer', skill: 'ranged', weapon: ['1H_Crossbow'],
    blurb: 'Quick crossbow shots from range.', perk: 'Trains Ranged. Fastest attacks.',
    atk: { anim: '1H_Ranged_Shoot', range: 13, cd: 1.05, hitAt: 0.22, proj: 'bolt' }, hp: 50,
  },
};
const ITEMS = {
  logs: 'Logs', oak_logs: 'Oak logs', copper_ore: 'Copper ore', iron_ore: 'Iron ore', shrimp: 'Raw shrimp', trout: 'Raw trout', bones: 'Bones',
  bread: 'Bread', pie: 'Apple pie', stew: 'Hearty stew',
};
// Food heals; bought from Marta's stall in the market.
const FOOD = { bread: { heal: 8, price: 8 }, pie: { heal: 20, price: 20 }, stew: { heal: 40, price: 40 } };
// Weapons belong to the character. Each class has its own line, sold by its own shop.
const WEAPONS = {
  k_sword: { cls: 'knight', name: 'Knight sword', bonus: 0, price: 0 },
  k_steel: { cls: 'knight', name: 'Steel sword', bonus: 1, price: 45, model: 'sword_1handed' },
  k_axe: { cls: 'knight', name: 'Great axe', bonus: 3, price: 140, model: 'axe_2handed' },
  k_gold: { cls: 'knight', name: 'Golden sword', bonus: 5, price: 320, model: 'sword_1handed', tint: '#ffd84a' },
  k_royal: { cls: 'knight', name: 'Royal blade', bonus: 7, price: 600, model: 'sword_2handed_color' },
  m_staff: { cls: 'mage', name: 'Oak staff', bonus: 0, price: 0 },
  m_wand: { cls: 'mage', name: 'Apprentice wand', bonus: 1, price: 45, model: 'wand' },
  m_crystal: { cls: 'mage', name: 'Crystal staff', bonus: 3, price: 140, model: 'staff', tint: '#8ff0ff' },
  m_star: { cls: 'mage', name: 'Starlight wand', bonus: 5, price: 320, model: 'wand', tint: '#ffe27a' },
  m_ember: { cls: 'mage', name: 'Ember staff', bonus: 7, price: 600, model: 'staff', tint: '#ff8a5a' },
  a_xbow: { cls: 'archer', name: 'Crossbow', bonus: 0, price: 0 },
  a_hunter: { cls: 'archer', name: 'Hunter crossbow', bonus: 1, price: 45, model: 'crossbow_1handed', tint: '#a8f08a' },
  a_heavy: { cls: 'archer', name: 'Heavy crossbow', bonus: 3, price: 140, model: 'crossbow_2handed' },
  a_gold: { cls: 'archer', name: 'Golden crossbow', bonus: 5, price: 320, model: 'crossbow_1handed', tint: '#ffd84a' },
  a_shadow: { cls: 'archer', name: 'Shadow repeater', bonus: 7, price: 600, model: 'crossbow_2handed', tint: '#b896ff' },
};
const BASIC_WEAPON = { knight: 'k_sword', mage: 'm_staff', archer: 'a_xbow' };
const SELL = { logs: 3, oak_logs: 6, copper_ore: 4, iron_ore: 8, shrimp: 3, trout: 8, bones: 2 };
const NODES = {
  tree: { skill: 'woodcutting', req: 1, xp: 25, item: 'logs', name: 'Tree', verb: 'Chop', doing: 'Chopping', deplete: 0.3, respawn: 14 },
  oak: { skill: 'woodcutting', req: 5, xp: 40, item: 'oak_logs', name: 'Oak tree', verb: 'Chop', doing: 'Chopping', deplete: 0.22, respawn: 20 },
  copper: { skill: 'mining', req: 1, xp: 18, item: 'copper_ore', name: 'Copper rock', verb: 'Mine', doing: 'Mining', deplete: 0.6, respawn: 10 },
  iron: { skill: 'mining', req: 6, xp: 35, item: 'iron_ore', name: 'Iron rock', verb: 'Mine', doing: 'Mining', deplete: 0.7, respawn: 18 },
  shrimp: { skill: 'fishing', req: 1, xp: 12, item: 'shrimp', name: 'Shrimp spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
  trout: { skill: 'fishing', req: 5, xp: 45, item: 'trout', name: 'Trout spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
};
// How many hits of health each tree/rock has, and the size of its hitbox.
const NODE_HP = { tree: 8, oak: 14, copper: 7, iron: 11 };
const ENEMY_TYPES = {
  skel_minion: { name: 'Skeleton', hp: 16, maxHit: 3, weapon: 'Skeleton_Blade', xp: 15 },
  skel_warrior: { name: 'Skeleton Warrior', hp: 28, maxHit: 5, weapon: 'Skeleton_Blade', xp: 30 },
  skel_mage: { name: 'Skeleton Mage', hp: 22, maxHit: 4, weapon: 'Skeleton_Staff', xp: 25, ranged: true },
};
const QUESTS = {
  firewood: {
    name: 'Firewood for the Tavern', giver: 'bertha',
    intro: "The fire's nearly out and I've got a hall full of hungry folk! Bring me 5 logs from the trees around the village, would you?",
    ready: 'Oh, lovely dry logs! That will keep the stew bubbling for days.', done: "Fire's roaring, thanks to you. Come back when you're hungry!",
    need: { logs: 5 }, reward: { coins: 50, xp: { woodcutting: 150 } }, desc: 'Bring Bertha 5 logs.',
  },
  skeletons: {
    name: 'Bones in the Woods', giver: 'rowan',
    intro: 'Skeletons have made camp to the south-west, past the lumber mill. Knock down 4 of them and the road will be safe again.',
    ready: 'Four of them? Ha! You fight like a captain already.', done: "The camp keeps stirring, but you've shown them who's in charge.",
    need: { kills: 4 }, reward: { coins: 80, xp: { $class: 200 } }, desc: 'Defeat 4 skeletons at the camp.',
  },
  supper: {
    name: "The Wizard's Supper", giver: 'fenwick',
    intro: 'Ahem. A wizard cannot live on spells alone. Fetch me 3 raw shrimp from the lake, and 2 copper ore from the mine for my new cauldron.',
    ready: 'Shrimp AND copper! My cauldron and my belly thank you.', done: 'Mmm, shrimp stew. Truly the finest magic.',
    need: { shrimp: 3, copper_ore: 2 }, reward: { coins: 100, xp: { fishing: 150, mining: 150 } }, desc: 'Bring Fenwick 3 raw shrimp and 2 copper ore.',
  },
};

// ---------- saved state ----------
const SAVE_KEY = 'jerryquest_save_v1';
const fresh = () => ({
  cls: null, xp: Object.fromEntries(SKILLS.map(([k]) => [k, 0])), inv: {}, coins: 0,
  quests: Object.fromEntries(Object.keys(QUESTS).map((k) => [k, { state: 'todo', kills: 0 }])),
  hp: 50, pos: [0, 6], preset: 'day',
  look: { outfit: 'none', trim: 'none', hat: true, cape: true, hair: 'none', hairCol: 'chestnut' },
  owned: ['k_sword', 'm_staff', 'a_xbow'], equip: { knight: 'k_sword', mage: 'm_staff', archer: 'a_xbow' },
});
let S = fresh();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const d = JSON.parse(raw); const f = fresh(); S = { ...f, ...d, xp: { ...f.xp, ...d.xp }, quests: { ...f.quests, ...d.quests }, look: { ...f.look, ...d.look }, equip: { ...f.equip, ...d.equip }, owned: [...new Set([...f.owned, ...(d.owned || [])])] }; return true; }
  } catch (e) { /* storage unavailable */ }
  return false;
}
function save() {
  if (!S.cls || !player) return;
  S.pos = [player.root.position.x, player.root.position.z];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
}
const lvl = (k) => levelOf(S.xp[k]);
const maxHp = () => CLASSES[S.cls].hp + Math.floor((lvl('melee') + lvl('magic') + lvl('ranged') - 3) * 1.5);
const totalLevel = () => SKILLS.reduce((a, [k]) => a + lvl(k), 0);

// ---------- characters ----------
class Actor {
  constructor(gltf, { hide = [], scale = 1.3 } = {}) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.traverse((o) => { if (hide.includes(o.name)) o.visible = false; });
    stylize(this.root);
    this.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.root.scale.setScalar(scale);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    this.current = null; this.name = '';
    scene.add(this.root);
    this.mixer.addEventListener('finished', (e) => { if (e.action === this.current && this.onFinish) { const f = this.onFinish; this.onFinish = null; f(); } });
  }
  play(name, { once = false, fade = 0.18, speed = 1, clamp = false, onFinish = null } = {}) {
    const clip = this.clips[name];
    if (!clip) return 0;
    const a = this.mixer.clipAction(clip);
    if (this.current === a && !once) return clip.duration;
    a.reset(); a.setEffectiveTimeScale(speed); a.setEffectiveWeight(1);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = clamp;
    a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
    this.current = a; this.name = name; this.onFinish = onFinish;
    return clip.duration / speed;
  }
  slot() { let s = null; this.root.traverse((o) => { if (!s && /handslotr$/i.test(o.name)) s = o; }); return s; }
  attach(obj) { const s = this.slot(); if (s) s.add(obj); return obj; }
  face(x, z) { this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z); }
  get pos() { return this.root.position; }
}

const G = {}, lib = {};
let player = null;
const npcs = [];
const enemies = [];
const nodes = [];
let tool = null, rod = null, pick = null;

// ---------- boot ----------
const FILES = ['world', 'gear', 'knight', 'mage', 'archer', 'barbarian', 'skel_warrior', 'skel_minion', 'skel_mage'];
async function main() {
  let n = 0;
  const loaded = await Promise.all(FILES.map((f) => loadModel(f).then((g) => { $('loadmsg').textContent = `${++n} of ${FILES.length} models`; return g; })));
  FILES.forEach((f, i) => { G[f] = loaded[i]; });
  for (const c of G.world.scene.children) lib[c.name] = c;
  for (const c of G.gear.scene.children) lib[c.name] = c;
  buildWorld(lib);
  buildNodes();
  buildNpcs();
  buildEnemies();
  buildFlowers();
  buildTools();
  $('coinicon').src = ICONS.coins;
  const had = loadSave();
  applyPreset(S.preset || 'day');
  $('loading').style.opacity = '0';
  setTimeout(() => $('loading').remove(), 700);
  if (had && S.cls) startAs(S.cls); else showPick();
  renderer.setAnimationLoop(tick);
}

function showPick() {
  const cards = $('cards');
  cards.innerHTML = '';
  for (const [k, c] of Object.entries(CLASSES)) {
    const b = document.createElement('button');
    b.className = 'card panel'; b.id = `pick-${k}`;
    b.innerHTML = `<h3><img src="${ICONS[c.skill]}" alt="">${c.name}</h3><p>${c.blurb}</p><p class="perk">${c.perk}</p>`;
    b.addEventListener('click', () => {
      $('pick').hidden = true;
      if (!S.cls) { S.xp[c.skill] = XPT[5]; S.cls = k; S.hp = maxHp(); }
      startAs(k); save();
      if (!S.welcomed) { S.welcomed = true; toast('Welcome to Greenhollow! Look for villagers with a ! above their heads.', null, true); }
    });
    cards.appendChild(b);
  }
  $('pick').hidden = false;
}

function startAs(k) {
  const c = CLASSES[k];
  const prev = player;
  S.cls = k;
  player = new Actor(G[c.model]);
  if (prev) { player.root.position.copy(prev.root.position).setY(0); player.root.rotation.y = prev.root.rotation.y; scene.remove(prev.root); }
  else player.root.position.set(S.pos[0], 0, S.pos[1]);
  player.weapons = [];
  player.root.traverse((o) => { if (c.weapon.includes(o.name)) player.weapons.push(o); });
  equipWeapon();
  player.play('Idle');
  player.busyUntil = 0; player.task = null; player.nextHit = 0; player.dead = false;
  S.hp = Math.min(S.hp > 0 ? S.hp : maxHp(), maxHp());
  if (tool) { tool.removeFromParent(); player.attach(tool); tool.visible = false; }
  if (rod) { rod.removeFromParent(); player.attach(rod); rod.visible = false; }
  if (pick) { pick.removeFromParent(); player.attach(pick); pick.visible = false; }
  updateTitle();
  buildClassBar();
  applyLook();
  refreshUI();
}
const LOOK_COLOURS = {
  none: ['Original', '#ffffff'], ruby: ['Ruby', '#ff8f8f'], ocean: ['Ocean', '#8fc2ff'], meadow: ['Meadow', '#a8ec8a'],
  plum: ['Plum', '#d0a4ff'], sunny: ['Sunny', '#ffe27a'], rose: ['Rose', '#ffb8e0'], shadow: ['Shadow', '#9a93a8'],
};
const HAIR_COLOURS = {
  chestnut: ['Chestnut', '#8a4f2a'], black: ['Black', '#2e2630'], blonde: ['Blonde', '#f2c75c'], ginger: ['Ginger', '#e0742f'],
  snow: ['Snow', '#f1ece4'], pink: ['Pink', '#ff8fc8'], blue: ['Blue', '#5f9ef0'], green: ['Green', '#66c46a'],
};
const HAIR_STYLES = { none: 'None', short: 'Short', spiky: 'Spiky', long: 'Long', bun: 'Bun', mohawk: 'Mohawk' };
const hairMats = toon('#8a4f2a');
const hairCache = new Map();
function hairGroup(style) {
  if (hairCache.has(style)) return hairCache.get(style);
  const g = new THREE.Group();
  const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = true; registerMesh(m, hairMats); g.add(m); return m;
  };
  const cap = () => add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), 0, HAIR_Y, -0.03, -0.25, 0, 0, HAIR_R * 1.07, HAIR_R * 0.72, HAIR_R * 1.05);
  if (style === 'short') cap();
  if (style === 'spiky') {
    cap();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, r = i % 2 ? 0.28 : 0.12;
      add(new THREE.ConeGeometry(0.16, 0.42, 6), Math.cos(a) * r, HAIR_Y + HAIR_R * 0.62, Math.sin(a) * r - 0.05, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
    }
  }
  if (style === 'long') {
    cap();
    add(new THREE.CapsuleGeometry(0.3, 0.55, 4, 10), 0, HAIR_Y - 0.25, -HAIR_R * 0.62, 0.15, 0, 0, 1.9, 1, 0.75);
  }
  if (style === 'bun') {
    cap();
    add(new THREE.SphereGeometry(0.24, 14, 10), 0, HAIR_Y + HAIR_R * 0.72, -HAIR_R * 0.55);
  }
  if (style === 'mohawk') {
    for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.13, 0.5, 5), 0, HAIR_Y + HAIR_R * 0.82 - Math.abs(i - 1.5) * 0.06, 0.32 - i * 0.2, -0.35 + i * 0.18, 0, 0, 1, 1, 1.6);
  }
  hairCache.set(style, g);
  return g;
}
const HAIR_Y = 0.62, HAIR_R = 0.56;
function applyLook() {
  if (!player) return;
  const L = S.look;
  for (const g of hairCache.values()) g.removeFromParent();
  const hc = HAIR_COLOURS[L.hairCol] || HAIR_COLOURS.chestnut;
  hairMats.std.color.set(hc[1]); hairMats.toon.color.set(hc[1]);
  const showHair = L.hair !== 'none' && S.cls !== 'archer' && !L.hat;
  if (showHair) { let head; player.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; }); if (head) head.add(hairGroup(L.hair)); }
  player.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats) return;
    const n = o.name;
    const isCape = /_Cape$/.test(n), isBody = /_Body$/.test(n), isHat = /_(Helmet|Hat)$/.test(n);
    if (isHat) o.visible = L.hat;
    if (isCape) o.visible = L.cape;
    if (isCape || isBody) {
      if (!o.userData.ownMats) {
        o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
        o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
        o.userData.mats = o.userData.ownMats;
        o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std;
      }
      const col = LOOK_COLOURS[isCape ? L.trim : L.outfit][1];
      o.userData.mats.std.color.set(col); o.userData.mats.toon.color.set(col);
    }
  });
}
const weaponBonus = () => (WEAPONS[S.equip[S.cls]] || { bonus: 0 }).bonus;
function tinted(obj, col) {
  obj.traverse((o) => {
    if (!o.isMesh || !o.userData.mats) return;
    const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
    m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
    m.std.color.set(col); m.toon.color.set(col); registerMesh(o, m);
  });
  return obj;
}
// Swap the hand-held weapon model for the equipped one (the shield stays).
function equipWeapon() {
  if (!player) return;
  const W = WEAPONS[S.equip[S.cls]] || WEAPONS[BASIC_WEAPON[S.cls]];
  if (player.custom) { player.custom.removeFromParent(); player.weapons = player.weapons.filter((w) => w !== player.custom); player.custom = null; }
  const main = player.weapons.find((w) => !/Shield/.test(w.name));
  if (main) main.userData.hiddenByGear = !!W.model;
  if (main) main.visible = !W.model;
  if (W.model && lib[W.model]) {
    const m = lib[W.model].clone(true); stylize(m);
    if (W.tint) tinted(m, W.tint);
    player.attach(m); player.custom = m; player.weapons.push(m);
    if (main) player.weapons = player.weapons.filter((w) => w !== main);
  }
}
function buildClassBar() {
  const c = CLASSES[S.cls];
  $('classes').innerHTML = `<div class="classchip"><img src="${ICONS[c.skill]}" alt="">${c.name}<small>${WEAPONS[S.equip[S.cls]].name}</small></div><p class="hint">Talk to King Jerrold at the castle to change class.</p>`;
}
function switchClass(k) {
  const c = CLASSES[k];
  if (S.cls === k || !player || player.dead) return;
  cancelTask(); startAs(k); save();
  burst(player.pos.clone().setY(1.5), '#ffe07a', 40, 5, 1.2);
  toast(`You are now a ${c.name}. Your skills, bag and quests come with you.`, ICONS[c.skill]);
}
function updateTitle() {
  $('pname').textContent = CLASSES[S.cls].name;
  $('pclass').textContent = `Total level ${totalLevel()}`;
}

// ---------- gathering nodes ----------
const crystalGeo = new THREE.OctahedronGeometry(0.5, 0);
function hpNode(n) {
  n.maxHp = n.hp = NODE_HP[n.kind]; n.lastHit = -99;
  const bar = document.createElement('div'); bar.className = 'hpbar node'; bar.hidden = true; bar.innerHTML = '<i></i>';
  document.body.appendChild(bar); n.bar = bar;
  return n;
}
function buildNodes() {
  const addTree = (x, z, kind) => {
    if (blocked(x, z) || !isFree(x, z, 2.5) || Math.hypot(x, z) < 12) return;
    const v = kind === 'oak' ? 'B' : 'A';
    const s = kind === 'oak' ? S_NATURE * 1.25 : S_NATURE;
    const full = place(`tree_single_${v}`, x, z, s, rng() * 6, { shrink: 0.35 });
    const cut = place(`tree_single_${v}_cut`, x, z, s, full.rotation.y, { collide: false });
    cut.visible = false;
    nodes.push(hpNode({ kind, def: NODES[kind], x, z, full, cut, alive: true, respawnAt: 0, reach: 2.6, r: 1.1 }));
  };
  for (let i = 0; i < 80 && nodes.length < 18; i++) { const a = rng() * Math.PI * 2, r = 16 + rng() * 20; addTree(Math.cos(a) * r, Math.sin(a) * r, 'tree'); }
  for (let i = 0; i < 60 && nodes.filter((n) => n.kind === 'oak').length < 8; i++) addTree(6 + rng() * 26, 30 + rng() * 14, 'oak');

  const addRock = (x, z, kind) => {
    place(rng() > 0.5 ? 'rock_single_D' : 'rock_single_E', x, z, S_NATURE * 2.6, rng() * 6, { shrink: 0.5 });
    const gems = new THREE.Group();
    const mats = toon(kind === 'copper' ? '#ff9b3d' : '#a8c8f0', { emissive: kind === 'copper' ? '#5a2600' : '#1b2f52' });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(crystalGeo);
      const a = (i / 4) * Math.PI * 2 + rng();
      c.position.set(Math.cos(a) * 0.7, 0.35 + rng() * 0.35, Math.sin(a) * 0.7);
      c.scale.set(0.55, 0.9, 0.55).multiplyScalar(0.7 + rng() * 0.5);
      c.rotation.set(rng(), rng(), rng());
      c.castShadow = true; registerMesh(c, mats); gems.add(c);
    }
    gems.position.set(x, 0, z); scene.add(gems);
    nodes.push(hpNode({ kind, def: NODES[kind], x, z, full: gems, alive: true, respawnAt: 0, reach: 2.6, r: 1.3 }));
  };
  const rockSpots = [[-4, 2, 'copper'], [2, 4, 'copper'], [5, -2, 'copper'], [-2, -5, 'copper'], [-7, -3, 'iron'], [7, 4, 'iron'], [1, 9, 'iron'], [-6, 7, 'copper']];
  for (const [dx, dz, k] of rockSpots) addRock(MINE.x + dx, MINE.z + dz, k);

  const ringGeo = new THREE.RingGeometry(0.6, 0.9, 24);
  const spots = [[Math.PI * 0.82, 'shrimp'], [Math.PI * 1.02, 'shrimp'], [Math.PI * 0.6, 'trout']];
  for (const [a, kind] of spots) {
    const x = LAKE.x + Math.cos(a) * (LAKE.r - 1.4), z = LAKE.z + Math.sin(a) * (LAKE.r - 1.4);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.09, z); ring.layers.set(1);
    scene.add(ring);
    nodes.push({ kind, def: NODES[kind], x, z, full: ring, alive: true, reach: 3.6, ring });
  }
}

function buildTools() {
  tool = lib.axe_1handed.clone(true); stylize(tool); tool.visible = false;
  pick = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.5, 6));
  handle.position.y = 0.5; registerMesh(handle, toon('#8a5a32')); pick.add(handle);
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 14, Math.PI * 0.9));
  head.position.y = 0.95; head.rotation.z = Math.PI * 0.05; head.scale.set(1, 0.55, 1.4); registerMesh(head, toon('#c3cad3')); pick.add(head);
  pick.visible = false;
  rod = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6));
  pole.position.y = 1.1; registerMesh(pole, toon('#8a5a32')); rod.add(pole);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.6, 4));
  line.position.set(0, 1.6, 0.6); line.rotation.x = 0.9; registerMesh(line, toon('#f4f4f4')); rod.add(line);
  rod.rotation.x = 1.1; rod.visible = false;
}

// ---------- NPCs ----------
function markerSprite() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 96;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  sp.scale.set(1.0, 1.5, 1); sp.layers.set(1); sp.renderOrder = 5;
  sp.userData.draw = (ch) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 64, 96);
    if (!ch) { sp.visible = false; return; }
    sp.visible = true;
    g.font = '700 84px Fredoka, Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (ch === '$') {
      g.lineWidth = 7; g.strokeStyle = '#4a2a17'; g.fillStyle = '#ffcc33';
      g.beginPath(); g.arc(32, 52, 24, 0, 7); g.fill(); g.stroke();
      g.lineWidth = 4; g.beginPath(); g.arc(32, 52, 13, 0, 7); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.ellipse(22, 42, 6, 3.5, -0.6, 0, 7); g.fill();
    } else if (ch === '♛') {
      g.lineWidth = 6; g.strokeStyle = '#4a2a17'; g.fillStyle = '#ffcc33';
      g.beginPath(); g.moveTo(8, 70); g.lineTo(6, 34); g.lineTo(20, 50); g.lineTo(32, 26); g.lineTo(44, 50); g.lineTo(58, 34); g.lineTo(56, 70); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#e0444f'; g.beginPath(); g.arc(32, 58, 5, 0, 7); g.fill();
    } else { g.lineWidth = 10; g.strokeStyle = '#4a2a17'; g.strokeText(ch, 32, 52); g.fillStyle = ch === '?' ? '#9cff6b' : '#ffd23f'; g.fillText(ch, 32, 52); }
    tex.needsUpdate = true;
  };
  return sp;
}
function makeCrown() {
  const g = new THREE.Group(), gold = toon('#ffcc33', { emissive: '#4a2a00' }), gem = toon('#e0444f', { emissive: '#400' });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.46, 0.22, 16, 1, true)); band.material = gold.std;
  band.position.y = 1.05; registerMesh(band, gold); g.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4)); sp.position.set(Math.cos(a) * 0.47, 1.27, Math.sin(a) * 0.47); registerMesh(sp, gold); g.add(sp);
  }
  const j = new THREE.Mesh(new THREE.OctahedronGeometry(0.1)); j.position.set(0, 1.07, 0.5); registerMesh(j, gem); g.add(j);
  return g;
}
function buildNpcs() {
  const defs = [
    { id: 'bertha', name: 'Bertha the Innkeeper', model: 'barbarian', x: -2, z: -10.5, hide: [] },
    { id: 'rowan', name: 'Captain Rowan', model: 'knight', x: 12, z: -18, hide: [] },
    { id: 'fenwick', name: 'Old Fenwick', model: 'mage', x: 15, z: -4.5, hide: [] },
    { id: 'marta', name: 'Marta the Baker', model: 'barbarian', x: 7.5, z: 10.2, hide: [], shop: 'food', tint: '#bfe3ff' },
    { id: 'brom', name: 'Brom the Blacksmith', model: 'barbarian', x: 5.5, z: -19.8, hide: [], shop: 'knight', tint: '#ffb38a' },
    { id: 'wisteria', name: 'Madame Wisteria', model: 'mage', x: 18.4, z: -21.6, hide: [], shop: 'mage', tint: '#f0b0ff' },
    { id: 'hazel', name: 'Hazel the Fletcher', model: 'archer', x: -22, z: 10.5, hide: [], shop: 'archer', tint: '#d8f0a0' },
    { id: 'king', name: 'King Jerrold', model: 'knight', x: 4, z: -49, hide: ['Knight_Helmet'], king: true, tint: '#b98cff' },
  ];
  for (const d of defs) {
    const a = new Actor(G[d.model], { hide: d.hide, scale: 1.3 });
    a.root.position.set(d.x, 0, d.z);
    a.face(0, 0);
    a.play(d.id === 'fenwick' ? 'Spellcasting' : 'Idle');
    if (d.id === 'fenwick') a.mixer.timeScale = 0.4;
    if (d.king) a.root.traverse((o) => { if (o.isBone && o.name === 'head') o.add(makeCrown()); });
    if (d.tint) a.root.traverse((o) => {
      if (!o.isMesh || !/_(Body|Cape)$/.test(o.name)) return;
      if (/_Cape$/.test(o.name) && !d.king) return;
      const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
      m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
      m.std.color.set(d.tint); m.toon.color.set(d.tint); registerMesh(o, m);
    });
    const m = markerSprite(); m.position.set(d.x, 4.6, d.z); scene.add(m);
    colliders.push({ x: d.x, z: d.z, r: 0.9 });
    npcs.push({ ...d, actor: a, marker: m, reach: 3.2 });
  }
}
const npcIdle = (n) => n.actor.play(n.id === 'fenwick' ? 'Spellcasting' : 'Idle');

// ---------- enemies ----------
function buildEnemies() {
  const spots = [['skel_warrior', -3, -4], ['skel_minion', -6, 3], ['skel_mage', 2, 6], ['skel_minion', 5, -1], ['skel_minion', -1, 9]];
  for (const [k, dx, dz] of spots) {
    const T = ENEMY_TYPES[k];
    const e = new Actor(G[k]);
    const w = lib[T.weapon].clone(true); stylize(w); e.attach(w);
    e.type = k; e.T = T; e.home = new THREE.Vector2(CAMP.x + dx, CAMP.z + dz);
    e.root.position.set(e.home.x, 0, e.home.y); e.root.rotation.y = rng() * 6;
    e.hp = T.hp; e.state = 'idle'; e.timer = rng() * 3; e.target = new THREE.Vector2(); e.nextHit = 0;
    e.play('Idle');
    const bar = document.createElement('div'); bar.className = 'hpbar'; bar.hidden = true; bar.innerHTML = '<i></i>';
    document.body.appendChild(bar); e.bar = bar;
    enemies.push(e);
  }
}

// ---------- inventory, xp, quests ----------
function addItem(id, n = 1) { S.inv[id] = (S.inv[id] || 0) + n; refreshUI(); }
function takeItem(id, n) { S.inv[id] -= n; if (S.inv[id] <= 0) delete S.inv[id]; }
function giveXp(skill, amount, at) {
  const before = lvl(skill);
  S.xp[skill] += amount;
  const after = lvl(skill);
  if (at) floatText(at, `+${Math.round(amount)} ${SKILL_NAME[skill]}`, 'gain');
  if (after > before) {
    toast(`${SKILL_NAME[skill]} level ${after}!`, ICONS[skill], true);
    burst(player.pos.clone().setY(1.5), '#ffd23f', 50, 7, 1.4);
    if (!player.task && now > player.busyUntil && !player.dead) { player.play('Cheer', { once: true, onFinish: () => player.play('Idle') }); player.busyUntil = now + 1.2; }
    if (['melee', 'magic', 'ranged'].includes(skill)) S.hp = Math.min(maxHp(), S.hp + 5);
    updateTitle();
    refreshUI();
  }
  if (!$('sheet').hidden && sheetMode === 'skills' && skill !== 'speed') renderSheet();
}
function questReady(id) {
  const q = QUESTS[id], st = S.quests[id];
  if (st.state !== 'active') return false;
  return Object.entries(q.need).every(([k, n]) => (k === 'kills' ? st.kills : (S.inv[k] || 0)) >= n);
}
function questProgress(id) {
  const q = QUESTS[id], st = S.quests[id];
  return Object.entries(q.need).map(([k, n]) => {
    const have = Math.min(n, k === 'kills' ? st.kills : (S.inv[k] || 0));
    return `${k === 'kills' ? 'Skeletons' : ITEMS[k]} ${have}/${n}`;
  }).join(', ');
}

// ---------- UI ----------
let sheetMode = null;
function toast(text, icon, big = false) {
  const el = document.createElement('div');
  el.className = `toast${big ? ' big' : ''}`;
  el.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}<span></span>`;
  el.querySelector('span').textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), big ? 3600 : 2200);
}
function floatText(p, text, cls = '') {
  const v = p.clone().project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div');
  el.className = `float ${cls}`; el.textContent = text;
  el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
const npcName = (id) => npcs.find((n) => n.id === id).name;
function refreshUI() {
  if (!S.cls) return;
  const mh = maxHp();
  $('hpfill').style.width = `${Math.max(0, (S.hp / mh) * 100)}%`;
  $('hptext').textContent = `${Math.max(0, Math.ceil(S.hp))} / ${mh}`;
  $('coinval').textContent = S.coins;
  const active = Object.keys(QUESTS).filter((k) => S.quests[k].state === 'active');
  $('tracker').innerHTML = active.map((k) => `<div><b>${QUESTS[k].name}</b><br>${questReady(k) ? `Return to ${npcName(QUESTS[k].giver)}` : questProgress(k)}</div>`).join('');
  for (const n of npcs) {
    if (n.shop) { n.marker.userData.draw('$'); continue; }
    if (n.king) { n.marker.userData.draw('♛'); continue; }
    const qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === n.id);
    const st = S.quests[qid].state;
    n.marker.userData.draw(st === 'todo' ? '!' : questReady(qid) ? '?' : '');
  }
  if (!$('sheet').hidden && sheetMode !== 'opts' && sheetMode !== 'look') renderSheet();
}

function renderSheet() {
  const el = $('sheet');
  if (sheetMode === 'skills') {
    el.innerHTML = `<h3>Skills <small>Total level ${totalLevel()}</small></h3><div class="skills">${SKILLS.map(([k, nm]) => {
      const l = lvl(k), cur = XPT[l], next = XPT[Math.min(99, l + 1)];
      const pct = l >= 99 ? 100 : ((S.xp[k] - cur) / (next - cur)) * 100;
      return `<div class="skill" title="${Math.floor(S.xp[k])} XP"><img src="${ICONS[k]}" alt=""><span class="nm">${nm}</span><span class="lv">${l}</span><div class="xp"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}</div><p class="hint">Skills level up as you use them. Speed rises as you travel and makes you run faster.</p>`;
  } else if (sheetMode === 'bag') {
    const items = Object.entries(S.inv);
    const slots = [];
    for (let i = 0; i < 16; i++) {
      const it = items[i];
      slots.push(!it ? '<div class="slot empty"></div>' : FOOD[it[0]]
        ? `<button class="slot food" data-eat="${it[0]}" title="Eat ${ITEMS[it[0]]} (heals ${FOOD[it[0]].heal})"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></button>`
        : `<div class="slot" title="${ITEMS[it[0]]}"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></div>`);
    }
    el.innerHTML = `<h3>Bag <small>${S.coins} coins</small></h3><div class="bag">${slots.join('')}</div><p class="hint">Tap food to eat it and heal (or press H). Sell logs, ore, fish and bones to Marta at the market.</p>`;
    el.querySelectorAll('[data-eat]').forEach((b) => { b.onclick = () => eat(b.dataset.eat); });
  } else if (sheetMode === 'quests') {
    el.innerHTML = `<h3>Quests</h3>${Object.entries(QUESTS).map(([k, q]) => {
      const st = S.quests[k].state, ready = questReady(k);
      const tag = st === 'done' ? '<span class="tag done">Done</span>' : ready ? '<span class="tag ready">Hand in</span>' : st === 'active' ? '<span class="tag active">Active</span>' : '<span class="tag todo">New</span>';
      const body = st === 'todo' ? `Talk to ${npcName(q.giver)}.` : st === 'done' ? 'Completed.' : ready ? `Return to ${npcName(q.giver)}.` : `${q.desc} (${questProgress(k)})`;
      return `<div class="quest"><h4>${q.name}${tag}</h4><p>${body}</p></div>`;
    }).join('')}`;
  } else if (sheetMode === 'look') {
    const sw = (part, set = LOOK_COLOURS) => Object.entries(set).map(([k, [nm, c]]) => `<button class="swatch" data-part="${part}" data-col="${k}" title="${nm}" aria-label="${nm}" aria-pressed="${S.look[part] === k}" style="background:${c}"></button>`).join('');
    const styles = Object.entries(HAIR_STYLES).map(([k, nm]) => `<button class="hairbtn" data-hair="${k}" aria-pressed="${S.look.hair === k}">${nm}</button>`).join('');
    const hasHat = S.cls !== 'archer';
    el.innerHTML = `<h3>Look</h3><div class="look">
      <h4>Outfit colour</h4><div class="swatches">${sw('outfit')}</div>
      <h4>Cape colour</h4><div class="swatches">${sw('trim')}</div>
      <h4>Hair</h4><div class="toggles">${styles}</div>
      <div class="swatches">${sw('hairCol', HAIR_COLOURS)}</div>
      <p class="hint">${S.cls === 'archer' ? 'Your hood covers your hair. Switch to Knight or Mage to see it.' : S.look.hat ? `Take off your ${S.cls === 'knight' ? 'helmet' : 'hat'} to show your hair.` : ''}</p>
      <h4>Show</h4><div class="toggles">
        ${hasHat ? `<button id="l-hat" aria-pressed="${S.look.hat}">${S.cls === 'knight' ? 'Helmet' : 'Hat'}</button>` : ''}
        <button id="l-cape" aria-pressed="${S.look.cape}">Cape</button></div>
      <p class="hint">Your look belongs to your character and carries across classes. More outfits, faces, hats and gear are on the roadmap.</p></div>`;
    el.querySelectorAll('.swatch').forEach((b) => { b.onclick = () => { S.look[b.dataset.part] = b.dataset.col; applyLook(); save(); renderSheet(); }; });
    el.querySelectorAll('.hairbtn').forEach((b) => { b.onclick = () => { S.look.hair = b.dataset.hair; if (S.look.hair !== 'none') S.look.hat = false; applyLook(); save(); renderSheet(); }; });
    if (hasHat) $('l-hat').onclick = () => { S.look.hat = !S.look.hat; applyLook(); save(); renderSheet(); };
    $('l-cape').onclick = () => { S.look.cape = !S.look.cape; applyLook(); save(); renderSheet(); };
  } else if (sheetMode === 'opts') {
    el.innerHTML = `<h3>Options</h3><div class="opts">
      <button id="o-style" aria-pressed="${styled.on}">Storybook look: ${styled.on ? 'On' : 'Off'}</button>
      <button id="o-tod" aria-pressed="${env.preset === 'golden'}">${env.preset === 'golden' ? 'Switch to daytime' : 'Switch to golden hour'}</button>
            <button id="o-reset" class="danger">Start over</button>
      <p class="hint">Switch class any time with the buttons under your health bar. Skills, bag, coins and quests belong to your character, not your class. Progress saves in this browser for now. Accounts that save online come in the next step.</p></div>`;
    $('o-style').onclick = () => { setStyled(!styled.on); renderSheet(); };
    $('o-tod').onclick = () => { applyPreset(env.preset === 'golden' ? 'day' : 'golden'); S.preset = env.preset; save(); renderSheet(); };
    $('o-reset').onclick = () => {
      const b = $('o-reset');
      if (b.dataset.armed) { resetting = true; try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } location.reload(); }
      else { b.dataset.armed = '1'; b.textContent = 'Tap again to erase your progress'; }
    };
  }
}
let resetting = false;
function openSheet(mode) {
  if (sheetMode === mode && !$('sheet').hidden) { closeSheet(); return; }
  sheetMode = mode; $('sheet').hidden = false; renderSheet();
  for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', String(m === mode));
}
function closeSheet() { $('sheet').hidden = true; sheetMode = null; for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', 'false'); }
for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).addEventListener('click', () => openSheet(m));

// dialogue
let talking = null;
function openShop(npc) {
  talking = npc;
  const d = $('dialog');
  const goods = Object.entries(S.inv).filter(([k]) => SELL[k]);
  const worth = goods.reduce((a, [k, n]) => a + SELL[k] * n, 0);
  d.innerHTML = `<h3>${npc.name}</h3><p>Fresh from the oven! Food heals you when you eat it from your bag, or press H.</p>
    <div class="shop">${Object.entries(FOOD).map(([k, f]) => `<button class="buy" data-food="${k}" ${S.coins < f.price ? 'disabled' : ''}><img src="${ICONS[k]}" alt=""><b>${ITEMS[k]}</b><span>Heals ${f.heal}</span><em>${f.price} coins</em></button>`).join('')}</div>
    <p class="hint">You have ${S.coins} coins.${worth ? ` I'll also buy your logs, ore, fish and bones for ${worth} coins.` : ' Bring me logs, ore, fish or bones and I will buy them.'}</p>
    <div class="row">${worth ? `<button id="sellall">Sell goods (+${worth})</button>` : ''}<button id="shopbye">Goodbye</button></div>`;
  d.querySelectorAll('.buy').forEach((b) => { b.onclick = () => {
    const k = b.dataset.food, f = FOOD[k];
    if (S.coins < f.price) return;
    S.coins -= f.price; addItem(k);
    toast(`You buy ${ITEMS[k].toLowerCase()}.`, ICONS[k]);
    save(); openShop(npc);
  }; });
  if (worth) $('sellall').onclick = () => {
    for (const [k] of goods) delete S.inv[k];
    S.coins += worth; toast(`Sold your goods for ${worth} coins.`, ICONS.coins);
    refreshUI(); save(); openShop(npc);
  };
  $('shopbye').onclick = closeDialog;
  d.hidden = false;
  npc.actor.face(player.pos.x, player.pos.z);
}
let eatAt = -9;
function eat(k) {
  if (!player || player.dead || !FOOD[k] || !S.inv[k] || now < eatAt) return false;
  if (S.hp >= maxHp()) { toast("You're already at full health.", ICONS[k]); return false; }
  eatAt = now + 1.2;
  takeItem(k, 1);
  const heal = Math.min(FOOD[k].heal, maxHp() - S.hp);
  S.hp += heal;
  floatText(player.pos.clone().setY(3.6), `+${heal}`, 'gain');
  burst(player.pos.clone().setY(1.8), '#9cff6b', 18, 3, 1.2);
  if (!player.task && now > player.busyUntil) { const dur = player.play('Use_Item', { once: true, fade: 0.08, speed: 1.6, onFinish: () => player.play('Idle') }); player.busyUntil = now + Math.min(0.5, dur); }
  refreshUI(); save();
  return true;
}
function eatBest() {
  const missing = maxHp() - S.hp;
  const have = Object.keys(FOOD).filter((k) => S.inv[k]);
  if (!have.length) { toast('You have no food. Buy some from Marta at the market.', ICONS.bread); return; }
  // smallest food that covers what's missing, otherwise the biggest you have
  const fit = have.filter((k) => FOOD[k].heal >= missing).sort((a, b) => FOOD[a].heal - FOOD[b].heal)[0];
  eat(fit || have.sort((a, b) => FOOD[b].heal - FOOD[a].heal)[0]);
}
function openKing(npc) {
  talking = npc;
  const d = $('dialog');
  d.innerHTML = `<h3>${npc.name}</h3><p>Welcome, brave one! The realm needs heroes of every kind. Choose your calling, and you may change it whenever you visit me. Your skills, bag and coins stay with you.</p>
    <div class="shop">${Object.entries(CLASSES).map(([k, c]) => `<button class="buy" data-cls="${k}" ${S.cls === k ? 'disabled' : ''}><img src="${ICONS[c.skill]}" alt=""><b>${c.name}</b><span>${S.cls === k ? 'Your class now' : c.blurb}</span></button>`).join('')}</div>
    <div class="row"><button id="kingbye">Farewell</button></div>`;
  d.querySelectorAll('[data-cls]').forEach((b) => { b.onclick = () => { switchClass(b.dataset.cls); closeDialog(); npc.actor.play('Cheer', { once: true, onFinish: () => npcIdle(npc) }); }; });
  $('kingbye').onclick = closeDialog;
  d.hidden = false;
  npc.actor.face(player.pos.x, player.pos.z);
}
function openWeaponShop(npc) {
  talking = npc;
  const cls = npc.shop, d = $('dialog');
  const lines = { knight: 'Finest steel this side of the mountains! Sharper blade, harder hits.', mage: 'Wands and staves, darling, humming with power. Each one makes your spells hit harder.', archer: 'Crossbows I made myself. A better one hits harder.' };
  const list = Object.entries(WEAPONS).filter(([, w]) => w.cls === cls);
  d.innerHTML = `<h3>${npc.name}</h3><p>${lines[cls]}${S.cls !== cls ? ` (These are for the ${CLASSES[cls].name}. Buy them now and they'll be ready when you switch.)` : ''}</p>
    <div class="shop wide">${list.map(([k, w]) => {
      const own = S.owned.includes(k), eq = S.equip[cls] === k;
      const label = eq ? 'Equipped' : own ? 'Equip' : `${w.price} coins`;
      return `<button class="buy" data-w="${k}" ${eq || (!own && S.coins < w.price) ? 'disabled' : ''}><img src="${ICONS[CLASSES[cls].skill]}" alt=""><b>${w.name}</b><span>+${w.bonus} damage</span><em>${label}</em></button>`;
    }).join('')}</div>
    <p class="hint">You have ${S.coins} coins.</p><div class="row"><button id="wbye">Goodbye</button></div>`;
  d.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.w, w = WEAPONS[k];
    if (!S.owned.includes(k)) { if (S.coins < w.price) return; S.coins -= w.price; S.owned.push(k); toast(`You buy the ${w.name}!`, ICONS[CLASSES[cls].skill], true); }
    S.equip[cls] = k;
    if (S.cls === cls) { equipWeapon(); burst(player.pos.clone().setY(1.6), '#ffe07a', 24, 4); }
    buildClassBar(); refreshUI(); save(); openWeaponShop(npc);
  }; });
  $('wbye').onclick = closeDialog;
  d.hidden = false;
  npc.actor.face(player.pos.x, player.pos.z);
}
function openDialog(npc) {
  if (npc.king) { openKing(npc); return; }
  if (npc.shop && npc.shop !== 'food') { openWeaponShop(npc); return; }
  if (npc.shop) { openShop(npc); return; }
  talking = npc;
  const qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === npc.id);
  const q = QUESTS[qid], st = S.quests[qid];
  const parts = [`${q.reward.coins} coins`];
  for (const [k, v] of Object.entries(q.reward.xp)) parts.push(`${v} ${k === '$class' ? SKILL_NAME[CLASSES[S.cls].skill] : SKILL_NAME[k]} XP`);
  let text, buttons;
  if (st.state === 'todo') {
    text = q.intro;
    buttons = [['Accept quest', 'primary', () => { st.state = 'active'; toast(`Quest started: ${q.name}`); refreshUI(); save(); closeDialog(); }], ['Not now', '', closeDialog]];
  } else if (questReady(qid)) {
    text = q.ready;
    buttons = [['Hand it over', 'primary', () => {
      for (const [k, n] of Object.entries(q.need)) if (k !== 'kills') takeItem(k, n);
      st.state = 'done'; S.coins += q.reward.coins;
      for (const [k, v] of Object.entries(q.reward.xp)) giveXp(k === '$class' ? CLASSES[S.cls].skill : k, v);
      toast(`Quest complete: ${q.name}`, ICONS.coins, true);
      burst(npc.actor.pos.clone().setY(2), '#9cff6b', 50, 6, 1.4);
      npc.actor.play('Cheer', { once: true, onFinish: () => npcIdle(npc) });
      refreshUI(); save(); closeDialog();
    }]];
  } else if (st.state === 'active') { text = `${q.desc} So far: ${questProgress(qid)}.`; buttons = [['On my way', '', closeDialog]]; }
  else { text = q.done; buttons = [['Goodbye', '', closeDialog]]; }
  const d = $('dialog');
  d.innerHTML = `<h3></h3><p></p>${st.state === 'todo' ? `<div class="reward">Reward: ${parts.join(', ')}</div>` : ''}<div class="row"></div>`;
  d.querySelector('h3').textContent = npc.name;
  d.querySelector('p').textContent = text;
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn;
    d.querySelector('.row').appendChild(b);
  }
  d.hidden = false;
  npc.actor.face(player.pos.x, player.pos.z);
}
function closeDialog() { $('dialog').hidden = true; talking = null; }

// ---------- input ----------
const keys = new Set();
const KEYMAP = { ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
addEventListener('keydown', (e) => {
  if (!player || !$('pick').hidden) return;
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); if (KEYMAP[e.code] !== 'sprint') { cancelTask(); moveTarget = null; } e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') { if (!e.repeat) { held = true; doAction(); } e.preventDefault(); }
  if (e.code === 'Space') { if (!e.repeat) jump(); e.preventDefault(); }
  if (e.code === 'KeyH') eatBest();
  if (e.code === 'KeyM') toggleBigMap();
  if (e.code === 'KeyK') openSheet('skills');
  if (e.code === 'KeyI' || e.code === 'KeyB') openSheet('bag');
  if (e.code === 'KeyQ') openSheet('quests');
  if (e.code === 'Escape') { closeSheet(); closeDialog(); }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); if (e.code === 'KeyE' || e.code === 'KeyF') held = false; });
addEventListener('blur', () => { keys.clear(); held = false; });

let moveTarget = null, pending = null;
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 32), new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
marker.rotation.x = -Math.PI / 2; marker.layers.set(1); marker.visible = false; scene.add(marker);

function targetAt(x, z) {
  // Tapping only walks somewhere; it never locks on. People and fishing spots are the exceptions.
  let best = null, bd = 1e9;
  const consider = (t, tx, tz, r) => { const d = Math.hypot(tx - x, tz - z); if (d < r && d < bd) { bd = d; best = t; } };
  for (const n of npcs) consider({ type: 'npc', n }, n.x, n.z, 2);
  for (const n of nodes) if (n.alive && n.def.skill === 'fishing') consider({ type: 'node', n }, n.x, n.z, 2.2);
  return best;
}
const aim = { x: 0, z: 0, at: -99 };
const groundAt = (cx, cy) => {
  const v = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(v, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, p) ? p : null;
};
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const p = groundAt(e.clientX, e.clientY);
  if (p) { aim.x = p.x; aim.z = p.z; aim.at = now; }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
let mouseHeld = false;
addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) mouseHeld = false; });
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!player || player.dead) return;
  const p = groundAt(e.clientX, e.clientY);
  if (!p) return;
  if (e.pointerType === 'mouse' && e.button === 0) {
    // left click: talk to someone you clicked on, otherwise attack towards the cursor
    const t = targetAt(p.x, p.z);
    if (t) { cancelTask(); startTask(t); return; }
    aim.x = p.x; aim.z = p.z; aim.at = now; mouseHeld = true;
    if (talking) closeDialog();
    swing(); return;
  }
  cancelTask();
  const t = targetAt(p.x, p.z);
  pending = t;
  moveTarget = new THREE.Vector2(p.x, p.z);
  marker.position.set(p.x, 0.08, p.z); marker.visible = !t; marker.scale.setScalar(1.4);
});
let zoom = 1;
renderer.domElement.addEventListener('wheel', (e) => { zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.001, 0.6, 1.5); e.preventDefault(); }, { passive: false });
let held = false;
$('action').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (player && player.task && player.task.type === 'node') { cancelTask(); return; }
  held = true; doAction();
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('action').addEventListener(ev, () => { held = false; });

const targetPos = (t) => ({ x: t.n.x, z: t.n.z });
const reachOf = (t) => t.n.reach;

// ---------- free aim ----------
const fwdOf = (a) => new THREE.Vector3(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
// Is a round hitbox at (x, z) with radius r inside the swing in front of the player?
function inArc(x, z, r, reach, half = 0.95) {
  const p = player.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d - r > reach) return -1;
  if (d < r + 0.3) return d;
  let diff = Math.atan2(dx, dz) - player.root.rotation.y; diff = Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff)));
  return diff <= half + Math.atan2(r, d) ? d : -1;
}
const MELEE_REACH = 2.6, TOOL_REACH = 1.7;
function swingTarget() {
  if (!player) return null;
  const p = player.pos, A = CLASSES[S.cls].atk;
  if (!mouseHeld) for (const n of npcs) if (Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'npc', n };
  for (const n of nodes) if (n.alive && n.def.skill === 'fishing' && Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'node', n };
  let foe = null, fd = 1e9;
  const reach = A.proj ? A.range : MELEE_REACH;
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising') { const d = inArc(e.pos.x, e.pos.z, 0.8, reach, A.proj ? 0.3 : 0.95); if (d >= 0 && d < fd) { fd = d; foe = e; } }
  let node = null, nd = 1e9;
  for (const n of nodes) if (n.alive && n.def.skill !== 'fishing') { const d = inArc(n.x, n.z, n.r, TOOL_REACH, 0.8); if (d >= 0 && d < nd) { nd = d; node = n; } }
  if (node && (!foe || fd > 5)) return { type: 'gather', n: node };
  return { type: 'attack', e: foe };
}
function describe(t) {
  const hint = matchMedia('(pointer: coarse)').matches ? 'Tap here to swing at whatever is in front of you.' : 'Click to attack. Space jumps, Shift sprints.';
  if (!t) return { label: 'Attack', icon: ICONS[CLASSES[S.cls].skill], hint, ok: true };
  if (t.type === 'npc') return { label: 'Talk', icon: ICONS.magic, hint: t.n.name, ok: true };
  if (t.type === 'attack') return { label: 'Attack', icon: ICONS[CLASSES[S.cls].skill], hint: t.e ? `${t.e.T.name} (${t.e.hp} health)` : hint, ok: true };
  const d = t.n.def, l = lvl(d.skill);
  return { label: d.verb, icon: ICONS[d.skill], hint: l >= d.req ? `${d.name} · ${SKILL_NAME[d.skill]} ${d.req}+` : `${d.name} needs ${SKILL_NAME[d.skill]} level ${d.req}`, ok: l >= d.req };
}
function doAction() {
  if (!player || player.dead || !$('pick').hidden) return;
  if (talking) { closeDialog(); return; }
  swing();
}
const GRAV = 34;
function jump() {
  if (!player || player.dead || !$('pick').hidden || player.air) return;
  if (talking) closeDialog();
  if (player.task) cancelTask();
  player.air = true; player.vy = 11;
  player.play(player.clips.Jump_Full_Short ? 'Jump_Full_Short' : 'Cheer', { once: true, fade: 0.06, speed: 1.35 });
  burst(player.pos.clone().setY(0.2), '#f3e2bd', 8, 2);
}
function showGear(which) {
  tool.visible = which === 'axe'; pick.visible = which === 'pick'; rod.visible = which === 'rod';
  player.weapons.forEach((w) => { w.visible = !which; });
}
// One swing: chop, mine, hit with a weapon, or shoot, in the direction you face.
function swing() {
  if (!player || player.dead || now < player.nextHit) return;
  if (mouseHeld && now - aim.at < 0.1) { player.face(aim.x, aim.z); }
  if (player.task) cancelTask();
  if (now - aim.at < 2.5) { player.face(aim.x, aim.z); aim.at = -99; }
  const t = swingTarget();
  if (t.type === 'npc') { held = false; player.face(t.n.x, t.n.z); openDialog(t.n); return; }
  if (t.type === 'node') { held = false; startTask(t); return; }
  moveTarget = null; pending = null; marker.visible = false;
  flashArc();
  if (t.type === 'gather') {
    const n = t.n, def = n.def;
    player.face(n.x, n.z);
    player.nextHit = now + 0.95;
    showGear(def.skill === 'mining' ? 'pick' : 'axe');
    player.play('1H_Melee_Attack_Chop', { once: true, fade: 0.06, speed: 1.3 });
    player.busyUntil = now + 0.5;
    later(0.36, () => {
      if (player.dead) return;
      // re-check the hitbox at the moment of impact: step away and you miss
      if (n.alive && inArc(n.x, n.z, n.r, TOOL_REACH + 0.4, 1.0) >= 0) hitNode(n);
      else burst(player.pos.clone().setY(1).addScaledVector(fwdOf(player), 1.3), '#e8dcc0', 6, 2);
    });
    const stamp = player.nextHit;
    later(1.3, () => { if (player.nextHit === stamp && !player.task) showGear(null); });
    return;
  }
  const A = CLASSES[S.cls].atk, skill = CLASSES[S.cls].skill;
  showGear(null);
  if (t.e && A.proj) player.face(t.e.pos.x, t.e.pos.z); // gentle aim help for ranged
  player.nextHit = now + A.cd * 0.85;
  const dur = player.play(A.anim, { once: true, fade: 0.08, speed: 1.15 });
  player.busyUntil = now + Math.min(dur * 0.7, A.cd * 0.6);
  later(A.hitAt, () => {
    if (player.dead) return;
    const fwd = fwdOf(player);
    if (A.proj) {
      shoot(player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(fwd, 0.8), fwd, A.proj, A.range, 'player',
        (e) => hurtEnemy(e, rollDamage(skill, (A.bonus || 0) + weaponBonus()), skill));
      return;
    }
    burst(player.pos.clone().setY(1.5).addScaledVector(fwd, 1.4), '#fff2a8', 14, 5);
    let hit = false;
    for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && inArc(e.pos.x, e.pos.z, 0.8, MELEE_REACH + 0.3) >= 0) { hurtEnemy(e, rollDamage(skill, weaponBonus()), skill); hit = true; }
    if (!hit) for (const n of nodes) if (n.alive && n.def.skill !== 'fishing' && inArc(n.x, n.z, n.r, MELEE_REACH) >= 0) { burst(new THREE.Vector3(n.x, 1.4, n.z), '#ffe9a8', 6, 3); break; }
  });
}
function hitNode(n) {
  if (!n.alive) return;
  const def = n.def, l = lvl(def.skill);
  const at = new THREE.Vector3(n.x, 1.6, n.z);
  burst(at, def.skill === 'mining' ? '#ffe2b0' : '#c9f59a', 10, 3.5);
  if (l < def.req) { floatText(at.clone().setY(3), 'Too tough!', 'miss'); toast(`You need ${SKILL_NAME[def.skill]} level ${def.req} for that.`, ICONS[def.skill]); return; }
  n.lastHit = now;
  const miss = THREE.MathUtils.clamp(0.28 - (l - def.req) * 0.03, 0.05, 0.28);
  if (rng() < miss) { floatText(at.clone().setY(3), 'Miss', 'miss'); return; }
  const dmg = 1 + Math.floor(rng() * (2 + l * 0.3));
  n.hp = Math.max(0, n.hp - dmg);
  floatText(at.clone().setY(3), String(dmg));
  giveXp(def.skill, Math.round(def.xp * 0.15 * dmg));
  if (n.hp > 0) { n.full.rotation.z = 0.05; later(0.12, () => { n.full.rotation.z = 0; }); return; }
  // broken: tree falls / rock cracks, hand out the haul
  const count = 2 + (rng() < 0.4 + l * 0.01 ? 1 : 0);
  addItem(def.item, count);
  giveXp(def.skill, def.xp * count, player.pos.clone().setY(3.2));
  toast(`You get ${count} ${ITEMS[def.item].toLowerCase()}.`, ICONS[def.item]);
  n.alive = false; n.respawnAt = now + def.respawn; n.bar.hidden = true;
  n.full.visible = false; if (n.cut) n.cut.visible = true;
  if (n.full.userData.collider) n.full.userData.collider.r = 0.6;
  burst(at, '#ffe9a8', 30, 6);
  refreshUI();
}
// a soft wedge on the ground showing where you are facing
const arcMat = new THREE.MeshBasicMaterial({ color: '#fff6d0', transparent: true, opacity: 0.16, depthWrite: false, fog: false });
const arcMesh = new THREE.Mesh(new THREE.CircleGeometry(MELEE_REACH + 0.6, 24, Math.PI / 2 - 0.95, 1.9), arcMat);
arcMesh.rotation.x = -Math.PI / 2; arcMesh.layers.set(1);
const arcHolder = new THREE.Group(); arcHolder.add(arcMesh); arcMesh.position.y = 0.07; arcMesh.rotation.z = Math.PI; scene.add(arcHolder);
let arcFlash = 0;
function flashArc() { arcFlash = 1; }

// ---------- tasks (fishing) ----------
function cancelTask() {
  if (player && player.task) {
    player.task = null;
    showGear(null);
    if (now > player.busyUntil && !player.dead) player.play('Idle');
  }
  pending = null;
}
function startTask(t) {
  const p = targetPos(t);
  const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
  if (d > reachOf(t) + 0.3) { pending = t; moveTarget = new THREE.Vector2(p.x, p.z); return; }
  pending = null; moveTarget = null; marker.visible = false;
  player.face(p.x, p.z);
  if (t.type === 'npc') { openDialog(t.n); return; }
  const def = t.n.def;
  if (lvl(def.skill) < def.req) { toast(`You need ${SKILL_NAME[def.skill]} level ${def.req} for that.`, ICONS[def.skill]); return; }
  player.task = { ...t, next: now + 1.4 };
  showGear('rod'); player.play('1H_Ranged_Aiming');
}

function gatherTick(task) {
  const n = task.n, def = n.def;
  if (now < task.next) return;
  task.next = now + 1.4 + rng() * 0.6;
  const l = lvl(def.skill);
  const chance = THREE.MathUtils.clamp(0.4 + (l - def.req) * 0.04, 0.25, 0.92);
  burst(new THREE.Vector3(n.x, 1.5, n.z), '#bff4ff', 8, 3);
  if (rng() > chance) return;
  addItem(def.item);
  giveXp(def.skill, def.xp, player.pos.clone().setY(3.2));
  toast(`You get some ${ITEMS[def.item].toLowerCase()}.`, ICONS[def.item]);
  refreshUI();
}

// ---------- combat ----------
const projectiles = [];
const orbGeo = new THREE.IcosahedronGeometry(0.4, 1);
// Projectiles fly in a straight line and hit whatever hitbox they pass through.
function shoot(from, dir, kind, range, owner, onHit) {
  let mesh;
  if (kind === 'bolt') {
    mesh = lib.arrow.clone(true); stylize(mesh); mesh.scale.setScalar(2.2);
  } else {
    mesh = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: kind === 'dark' ? '#c58bff' : '#8ff7ff', fog: false }));
    mesh.layers.set(1);
    mesh.add(new THREE.PointLight(kind === 'dark' ? '#b066ff' : '#6fe9ff', 12, 8, 1.5));
  }
  mesh.position.copy(from);
  mesh.lookAt(from.clone().add(dir));
  scene.add(mesh);
  projectiles.push({ mesh, dir: dir.clone().setY(0).normalize(), kind, owner, onHit, speed: kind === 'bolt' ? 26 : kind === 'dark' ? 11 : 17, left: range + 1 });
}
function rollDamage(skill, bonus = 0) {
  const maxHit = 2 + Math.floor(lvl(skill) * 0.55) + bonus;
  if (rng() < 0.12) return 0;
  return 1 + Math.floor(rng() * maxHit);
}
function hurtEnemy(e, dmg, skill) {
  const head = e.pos.clone().setY(3.4);
  if (e.state === 'idle' || e.state === 'walk') e.state = 'chase';
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  e.hp = Math.max(0, e.hp - dmg);
  floatText(head, String(dmg));
  burst(e.pos.clone().setY(1.6), '#ffffff', 14, 5);
  giveXp(skill, dmg * 4);
  if (e.hp <= 0) {
    e.state = 'dead'; e.bar.hidden = true;
    e.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    giveXp(skill, e.T.xp);
    const coins = 3 + Math.floor(rng() * 9);
    S.coins += coins; addItem('bones');
    floatText(e.pos.clone().setY(2.4), `+${coins} coins`, 'gain');
    for (const k of Object.keys(QUESTS)) if (S.quests[k].state === 'active' && QUESTS[k].need.kills !== undefined) S.quests[k].kills++;
    refreshUI();
    later(16, () => {
      e.hp = e.T.hp; e.state = 'rising';
      e.root.position.set(e.home.x, 0, e.home.y);
      const ok = e.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { e.state = 'idle'; e.play('Idle'); } });
      if (!ok) { e.state = 'idle'; e.play('Idle'); }
      burst(e.pos.clone().setY(0.5), '#b9ff8a', 30, 4);
    });
  } else if (e.name !== '1H_Melee_Attack_Chop' && e.name !== 'Spellcast_Shoot') {
    e.play('Hit_A', { once: true, fade: 0.05, onFinish: () => e.play('Idle_Combat') });
  }
}
let lastHurt = -10;
function hurtPlayer(dmg) {
  if (player.dead) return;
  const head = player.pos.clone().setY(3.6);
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  S.hp -= dmg; lastHurt = now;
  floatText(head, String(dmg), 'hurt');
  burst(player.pos.clone().setY(1.5), '#ff8a7a', 10, 4);
  if (S.hp <= 0) {
    S.hp = 0; player.dead = true; cancelTask(); moveTarget = null;
    player.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    toast('You were knocked out! You wake up by the well.', null, true);
    later(3, () => {
      player.root.position.set(0, 0, 6); player.air = false; camPos.set(0, 30, 40);
      S.hp = maxHp(); player.dead = false; player.play('Idle'); refreshUI(); save();
    });
  } else if (!player.task && now > player.busyUntil) {
    player.play('Hit_A', { once: true, fade: 0.05, onFinish: () => player.play('Idle') });
  }
  refreshUI();
}

const timers = [];
const later = (t, f) => timers.push({ t, f });

function enemyTick(e, dt) {
  const ep = e.pos;
  if (e.state === 'dead' || e.state === 'rising') return;
  const toP = Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z);
  const fromHome = Math.hypot(ep.x - e.home.x, ep.z - e.home.y);
  const reach = e.T.ranged ? 8 : 2.4;
  if (player.dead && (e.state === 'chase')) e.state = 'return';
  if ((e.state === 'idle' || e.state === 'walk') && toP < 7.5 && !player.dead && $('pick').hidden) e.state = 'chase';
  if (e.state === 'chase') {
    if (fromHome > 20) { e.state = 'return'; return; }
    e.face(player.pos.x, player.pos.z);
    if (toP > reach) {
      const dx = player.pos.x - ep.x, dz = player.pos.z - ep.z;
      ep.x += (dx / toP) * 4.2 * dt; ep.z += (dz / toP) * 4.2 * dt;
      if (e.name !== '1H_Melee_Attack_Chop' && e.name !== 'Spellcast_Shoot' && e.name !== 'Hit_A') e.play('Running_A', { fade: 0.15 });
    } else if (now > e.nextHit) {
      e.nextHit = now + 1.9 + rng() * 0.6;
      const dmg = rng() < 0.3 ? 0 : 1 + Math.floor(rng() * e.T.maxHit);
      if (e.T.ranged) {
        e.play('Spellcast_Shoot', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        later(0.35, () => {
          if (e.hp <= 0 || player.dead) return;
          const dir = new THREE.Vector3(player.pos.x - ep.x, 0, player.pos.z - ep.z);
          shoot(ep.clone().setY(1.8).addScaledVector(dir.clone().normalize(), 0.6), dir, 'dark', 12, 'enemy', () => hurtPlayer(dmg));
        });
      } else {
        e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        later(0.4, () => {
          if (e.hp <= 0 || Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z) >= reach + 1) return;
          if (player.pos.y > 0.7) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; }
          hurtPlayer(dmg);
        });
      }
    } else if (e.name === 'Running_A' || e.name === 'Idle' || e.name === 'Walking_A') e.play('Idle_Combat');
  } else if (e.state === 'return') {
    const dx = e.home.x - ep.x, dz = e.home.y - ep.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { e.state = 'idle'; e.hp = e.T.hp; e.play('Idle'); }
    else { ep.x += (dx / d) * 4 * dt; ep.z += (dz / d) * 4 * dt; e.face(e.home.x, e.home.y); e.play('Walking_A'); }
  } else {
    e.timer -= dt;
    if (e.timer < 0) {
      e.timer = 2 + rng() * 4;
      const a = rng() * 6.28, r = rng() * 5;
      e.target.set(e.home.x + Math.cos(a) * r, e.home.y + Math.sin(a) * r);
      e.state = 'walk';
    }
    if (e.state === 'walk') {
      const tx = e.target.x - ep.x, tz = e.target.y - ep.z, d = Math.hypot(tx, tz);
      if (d > 0.3) { ep.x += (tx / d) * 1.6 * dt; ep.z += (tz / d) * 1.6 * dt; e.root.rotation.y = Math.atan2(tx, tz); e.play(e.clips.Walking_D_Skeletons ? 'Walking_D_Skeletons' : 'Walking_A'); }
      else { e.state = 'idle'; e.play('Idle'); }
    }
  }
}

// ---------- minimap ----------
const MAP_R = 70, MAP_PX = 512;
const mapBg = document.createElement('canvas'); mapBg.width = mapBg.height = MAP_PX;
const PLACES = [['King', 4, -45], ['Village', 0, -4], ['Market', 7, 19], ['Skeleton camp', CAMP.x, CAMP.z + 9], ['Mine', MINE.x, MINE.z - 9], ['Lake', LAKE.x, LAKE.z], ['Castle', 4, -54], ['Tavern', -4, -22]];
// Photograph the world from straight above once, and use it as the map picture.
function bakeMap() {
  const cam = new THREE.OrthographicCamera(-MAP_R, MAP_R, MAP_R, -MAP_R, 1, 500);
  cam.position.set(0, 250, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(MAP_PX, MAP_PX);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const fog = scene.fog; scene.fog = null;
  const hidden = [...clouds, ...enemies.map((e) => e.root), ...npcs.map((n) => n.actor.root)];
  hidden.forEach((o) => { o.userData.wasVis = o.visible; o.visible = false; });
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
  hidden.forEach((o) => { o.visible = o.userData.wasVis; });
  scene.fog = fog;
  const px = new Uint8Array(MAP_PX * MAP_PX * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, MAP_PX, MAP_PX, px);
  rt.dispose();
  const img = new ImageData(MAP_PX, MAP_PX), row = MAP_PX * 4;
  for (let y = 0; y < MAP_PX; y++) img.data.set(px.subarray((MAP_PX - 1 - y) * row, (MAP_PX - y) * row), y * row);
  const g = mapBg.getContext('2d');
  g.putImageData(img, 0, 0);
  // warm, storybook paper tint
  g.globalCompositeOperation = 'soft-light'; g.fillStyle = '#ffdca0'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.globalCompositeOperation = 'source-over';
}
const mini = $('minimap'), bigMap = $('bigmap');
let lastMap = 0, mapBaked = 0;
function toggleBigMap(force) {
  const show = force ?? bigMap.hidden;
  bigMap.hidden = !show;
  if (show) drawMap(bigMap.querySelector('canvas'), true);
}
mini.addEventListener('click', () => toggleBigMap(true));
$('jumpbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
$('sprintbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); sprintToggle = !sprintToggle; $('sprintbtn').setAttribute('aria-pressed', String(sprintToggle)); });
bigMap.addEventListener('click', () => toggleBigMap(false));
function drawMap(cv, full) {
  if (!player) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), css = cv.clientWidth || 150;
  if (cv.width !== Math.round(css * dpr)) { cv.width = cv.height = Math.round(css * dpr); }
  const W = cv.width, g = cv.getContext('2d');
  const p = player.pos, half = full ? MAP_R : 30;
  const cx = full ? 0 : p.x, cz = full ? 0 : p.z;
  const k = W / (half * 2);
  const toPx = (x, z) => [(x - cx + half) * k, (z - cz + half) * k];
  const src = (v) => ((v + MAP_R) / (MAP_R * 2)) * MAP_PX;
  g.clearRect(0, 0, W, W);
  g.save();
  if (!full) { g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip(); }
  g.fillStyle = '#3f7a3a'; g.fillRect(0, 0, W, W);
  g.drawImage(mapBg, src(cx - half), src(cz - half), src(cx + half) - src(cx - half), src(cz + half) - src(cz - half), 0, 0, W, W);
  const dot = (x, z, r, fill) => { const [u, v] = toPx(x, z); g.beginPath(); g.arc(u, v, r * dpr, 0, 7); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#3a2010'; g.stroke(); };
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising') dot(e.pos.x, e.pos.z, full ? 3 : 3.5, '#ff5a4a');
  for (const n of npcs) {
    const qid = Object.keys(QUESTS).find((q) => QUESTS[q].giver === n.id);
    const st = qid && S.quests[qid].state;
    const col = n.king ? '#c58bff' : n.shop ? '#ffe9a0' : st === 'todo' ? '#ffd23f' : qid && questReady(qid) ? '#9cff6b' : '#f6efdc';
    dot(n.x, n.z, full ? 4 : 4.5, col);
  }
  if (full) {
    g.font = `700 ${13 * dpr}px Fredoka, Trebuchet MS, sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round';
    for (const [name, x, z] of PLACES) { const [u, v] = toPx(x, z); g.lineWidth = 4 * dpr; g.strokeStyle = '#3a2010'; g.strokeText(name, u, v); g.fillStyle = '#fff6dc'; g.fillText(name, u, v); }
  }
  // you: an arrow pointing the way you face
  const [u, v] = toPx(p.x, p.z), a = player.root.rotation.y, sz = (full ? 7 : 8) * dpr;
  g.translate(u, v); g.rotate(-a);
  g.beginPath(); g.moveTo(0, sz * 1.2); g.lineTo(sz * 0.8, -sz * 0.7); g.lineTo(0, -sz * 0.25); g.lineTo(-sz * 0.8, -sz * 0.7); g.closePath();
  g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = '#3a2010'; g.stroke();
  g.restore();
}

// ---------- main loop ----------
const camPos = new THREE.Vector3(0, 30, 40);
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3();
function collide(p, r = 0.7) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 0.0001) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
  const d = Math.hypot(p.x, p.z);
  if (d > 66) { p.x *= 66 / d; p.z *= 66 / d; }
}
let stamina = 100, staminaAt = 0, sprintToggle = false;
let lastUi = 0, lastSave = 0, regenAt = 0, lastAct = '', stuck = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  now = clock.elapsedTime;
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const f = timers[i].f; timers.splice(i, 1); f(); } }

  if (player && !player.dead && $('pick').hidden) {
    const busy = now < player.busyUntil;
    let mx = 0, mz = 0;
    if (keys.has('u')) mz -= 1; if (keys.has('d')) mz += 1; if (keys.has('l')) mx -= 1; if (keys.has('r')) mx += 1;
    const pp = player.pos;
    if (!mx && !mz && moveTarget) {
      const tx = moveTarget.x - pp.x, tz = moveTarget.y - pp.z, d = Math.hypot(tx, tz);
      const stopAt = pending ? reachOf(pending) : 0.3;
      if (d > stopAt) { mx = tx / d; mz = tz / d; }
      else { moveTarget = null; marker.visible = false; if (pending) { const t = pending; pending = null; startTask(t); } }
    }
    // you can always move, even mid-swing; while a swing plays you keep facing where you aimed
    if (mx || mz) {
      if (talking) closeDialog();
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
      const sprinting = (keys.has('sprint') || sprintToggle) && stamina > 1 && !busy;
      if (sprinting) { stamina = Math.max(0, stamina - dt * 22); staminaAt = now + 1; if (stamina <= 1) sprintToggle = false; }
      const speed = 6.5 * (1 + (lvl('speed') - 1) * 0.006) * (sprinting ? 1.65 : 1);
      const ox = pp.x, oz = pp.z;
      pp.x += mx * speed * dt; pp.z += mz * speed * dt;
      collide(pp);
      const moved = Math.hypot(pp.x - ox, pp.z - oz);
      if (moved > 0.001) giveXp('speed', moved * (sprinting ? 0.9 : 0.5));
      // give up on a tap target we can't reach
      stuck = moved < speed * dt * 0.2 ? stuck + dt : 0;
      if (stuck > 0.6 && moveTarget) { moveTarget = null; marker.visible = false; if (pending) { const t = pending; pending = null; startTask(t); } stuck = 0; }
      if (!busy) {
        const want = Math.atan2(mx, mz);
        let diff = want - player.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        player.root.rotation.y += diff * Math.min(1, dt * 14);
        if (!player.air) player.play('Running_A', { fade: 0.12, speed: sprinting ? 1.35 : 1 });
        if (sprinting && rng() < 0.3) burst(pp.clone().setY(0.15), '#f3e2bd', 1, 1.5);
      }
    } else if (!busy && player.task) {
      gatherTick(player.task);
    } else if (!busy && (player.name === 'Running_A' || player.name === 'Idle_Combat')) {
      player.play('Idle', { fade: 0.15 });
    }
    if (now > staminaAt && stamina < 100) stamina = Math.min(100, stamina + dt * 16);
    $('stamfill').style.width = `${stamina}%`;
    if (player.air) {
      pp.y += player.vy * dt; player.vy -= GRAV * dt;
      if (pp.y <= 0) { pp.y = 0; player.air = false; player.vy = 0; burst(pp.clone().setY(0.15), '#f3e2bd', 10, 2.5); if (now > player.busyUntil) player.play(mx || mz ? 'Running_A' : 'Idle', { fade: 0.1 }); }
    }
    if ((held || mouseHeld) && now >= player.nextHit && !talking) { if (mouseHeld) aim.at = now; swing(); }
    if (now - lastHurt > 6 && now > regenAt && S.hp < maxHp()) { S.hp = Math.min(maxHp(), S.hp + 1); regenAt = now + 2.5; refreshUI(); }
  }
  if (marker.visible) { marker.scale.setScalar(Math.max(1, marker.scale.x - dt * 2)); marker.material.opacity = 0.6 + 0.3 * Math.sin(now * 8); }

  for (const e of enemies) { if (player) enemyTick(e, dt); e.mixer.update(dt); }
  if (player) player.mixer.update(dt);
  for (const n of npcs) { n.actor.mixer.update(dt); n.marker.position.y = 4.6 + Math.sin(now * 3 + n.x) * 0.15; }

  for (const n of nodes) {
    if (!n.alive && now > n.respawnAt) {
      n.alive = true; n.full.visible = true; if (n.cut) n.cut.visible = false; if (n.maxHp) n.hp = n.maxHp;
      if (n.full.userData.collider) n.full.userData.collider.r = 1.2;
    }
    if (n.ring) {
      const ph = (now * 0.8 + n.x) % 1;
      n.ring.scale.setScalar(1 + ph * 0.8); n.ring.material.opacity = 0.9 - ph * 0.8;
      if (rng() < 0.03) burst(new THREE.Vector3(n.x, 0.2, n.z), '#ffffff', 2, 1.5);
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    const step = pr.speed * dt;
    pr.mesh.position.addScaledVector(pr.dir, step); pr.left -= step;
    const pp = pr.mesh.position;
    let hitSomething = false;
    if (pr.owner === 'player') {
      for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) < 0.95) { pr.onHit(e); hitSomething = true; break; }
    } else if (player && !player.dead && Math.abs(player.pos.y + 1.6 - pp.y) < 1.4 && Math.hypot(player.pos.x - pp.x, player.pos.z - pp.z) < 0.8) { pr.onHit(); hitSomething = true; }
    if (!hitSomething) for (const c of colliders) if (c.r > 0.9 && Math.hypot(c.x - pp.x, c.z - pp.z) < c.r * 0.8) { hitSomething = true; break; }
    if (hitSomething || pr.left <= 0) {
      burst(pp, pr.kind === 'dark' ? '#d6a8ff' : pr.kind === 'bolt' ? '#fff2c0' : '#8ff7ff', hitSomething ? 20 : 8, hitSomething ? 5 : 2);
      scene.remove(pr.mesh); projectiles.splice(i, 1); continue;
    }
    if (pr.kind !== 'bolt' && rng() < 0.6) burst(pp, pr.kind === 'dark' ? '#d6a8ff' : '#bffaff', 1, 1);
  }

  for (const n of nodes) {
    if (!n.bar) continue;
    if (n.alive && n.hp < n.maxHp && now - n.lastHit > 10) n.hp = n.maxHp;
    const show = n.alive && n.hp < n.maxHp;
    n.bar.hidden = !show;
    if (show) {
      const v = tmpV.set(n.x, n.cut ? 4.2 : 2.6, n.z).project(camera);
      n.bar.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      n.bar.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      n.bar.firstChild.style.width = `${(n.hp / n.maxHp) * 100}%`;
    }
  }
  if (player) {
    arcHolder.position.set(player.pos.x, 0, player.pos.z); arcHolder.rotation.y = player.root.rotation.y;
    arcHolder.visible = !player.dead && $('pick').hidden;
    arcFlash = Math.max(0, arcFlash - dt * 4);
    arcMat.opacity = 0.12 + arcFlash * 0.3;
  }

  for (const e of enemies) {
    const show = e.hp > 0 && e.hp < e.T.hp && e.state !== 'rising';
    e.bar.hidden = !show;
    if (show) {
      const v = tmpV.copy(e.pos).setY(3.3).project(camera);
      e.bar.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      e.bar.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      e.bar.firstChild.style.width = `${(e.hp / e.T.hp) * 100}%`;
    }
  }

  if (player && now - lastUi > 0.15) {
    lastUi = now;
    const gathering = player.task && player.task.type === 'node';
    const info = gathering
      ? { label: 'Stop', icon: ICONS[player.task.n.def.skill], hint: `${player.task.n.def.doing}…`, ok: true }
      : describe(swingTarget());
    const key = info.label + info.hint + info.ok;
    if (key !== lastAct) {
      lastAct = key;
      $('actionlabel').textContent = info.label; $('actionicon').src = info.icon; $('actionhint').textContent = info.hint;
      $('action').disabled = !info.ok;
    }
  }
  // bake the map picture once textures have had time to arrive, then once more to be safe
  if ((mapBaked === 0 && now > 2) || (mapBaked === 1 && now > 8)) { mapBaked++; bakeMap(); }
  if (player && now - lastMap > 0.1) { lastMap = now; mini.hidden = false; drawMap(mini, false); if (!bigMap.hidden) drawMap(bigMap.querySelector('canvas'), true); }
  if (player && now - lastSave > 6) { lastSave = now; save(); }

  const P = PRESETS[env.preset];
  if (dynamic.waterMat) dynamic.waterMat.uniforms.time.value = now;
  const fl = 0.85 + 0.15 * Math.sin(now * 17) + 0.1 * Math.sin(now * 7.3);
  if (dynamic.fireLight) dynamic.fireLight.intensity = 30 * fl * P.fire;
  dynamic.flames.forEach((f, i) => { f.scale.set(1, fl * (i ? 1.1 : 1), 1); f.rotation.y = now * (i ? -2 : 2); });
  for (const c of clouds) { c.position.x += dt * 0.8; if (c.position.x > 110) c.position.x = -110; }

  const focus = player ? tmpF.copy(player.pos).setY(0) : tmpF.set(0, 0, 4);
  updateParticles(dt, now, focus);
  const off = new THREE.Vector3(0, 23, 27).multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1));
  camPos.lerp(tmpV.copy(focus).add(off), 1 - Math.pow(0.002, dt));
  camera.position.copy(camPos);
  camera.lookAt(focus.x, 1.2, focus.z - 1);
  const sd = P.sunDir;
  sun.position.set(focus.x + sd[0], sd[1], focus.z + sd[2]);
  sun.target.position.set(focus.x, 0, focus.z);
  render();
}
addEventListener('pagehide', () => { if (!resetting) save(); });

window.__jq = { switchClass, equipWeapon, openWeaponShop, openKing, jump, eat, eatBest, openShop, drawMinimap: () => drawMinimap(), swing, swingTarget, hitNode, projectiles, timers, get S() { return S; }, get player() { return player; }, enemies, nodes, npcs, startTask, doAction, giveXp, save, openSheet, openDialog };
window.addEventListener('error', (e) => { const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${e.message}`; });
main().catch((err) => {
  console.error(err);
  const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${err && err.message ? err.message : err}. Try reloading the page.`;
});
