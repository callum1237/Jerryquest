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
};
const NODES = {
  tree: { skill: 'woodcutting', req: 1, xp: 25, item: 'logs', name: 'Tree', verb: 'Chop', doing: 'Chopping', deplete: 0.3, respawn: 14 },
  oak: { skill: 'woodcutting', req: 5, xp: 40, item: 'oak_logs', name: 'Oak tree', verb: 'Chop', doing: 'Chopping', deplete: 0.22, respawn: 20 },
  copper: { skill: 'mining', req: 1, xp: 18, item: 'copper_ore', name: 'Copper rock', verb: 'Mine', doing: 'Mining', deplete: 0.6, respawn: 10 },
  iron: { skill: 'mining', req: 6, xp: 35, item: 'iron_ore', name: 'Iron rock', verb: 'Mine', doing: 'Mining', deplete: 0.7, respawn: 18 },
  shrimp: { skill: 'fishing', req: 1, xp: 12, item: 'shrimp', name: 'Shrimp spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
  trout: { skill: 'fishing', req: 5, xp: 45, item: 'trout', name: 'Trout spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
};
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
});
let S = fresh();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const d = JSON.parse(raw); const f = fresh(); S = { ...f, ...d, xp: { ...f.xp, ...d.xp }, quests: { ...f.quests, ...d.quests } }; return true; }
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
let tool = null, rod = null;

// ---------- boot ----------
const FILES = ['world', 'knight', 'mage', 'archer', 'barbarian', 'skel_warrior', 'skel_minion', 'skel_mage'];
async function main() {
  let n = 0;
  const loaded = await Promise.all(FILES.map((f) => loadModel(f).then((g) => { $('loadmsg').textContent = `${++n} of ${FILES.length} models`; return g; })));
  FILES.forEach((f, i) => { G[f] = loaded[i]; });
  for (const c of G.world.scene.children) lib[c.name] = c;
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
  if (prev) { player.root.position.copy(prev.root.position); player.root.rotation.y = prev.root.rotation.y; scene.remove(prev.root); }
  else player.root.position.set(S.pos[0], 0, S.pos[1]);
  player.weapons = [];
  player.root.traverse((o) => { if (c.weapon.includes(o.name)) player.weapons.push(o); });
  player.play('Idle');
  player.busyUntil = 0; player.task = null; player.nextHit = 0; player.dead = false;
  S.hp = Math.min(S.hp > 0 ? S.hp : maxHp(), maxHp());
  if (tool) { tool.removeFromParent(); player.attach(tool); tool.visible = false; }
  if (rod) { rod.removeFromParent(); player.attach(rod); rod.visible = false; }
  updateTitle();
  buildClassBar();
  refreshUI();
}
function buildClassBar() {
  const bar = $('classes');
  bar.innerHTML = '';
  for (const [k, c] of Object.entries(CLASSES)) {
    const b = document.createElement('button');
    b.id = `cls-${k}`; b.title = `Switch to ${c.name}`;
    b.innerHTML = `<img src="${ICONS[c.skill]}" alt="">${c.name}`;
    b.setAttribute('aria-pressed', String(S.cls === k));
    b.onclick = () => {
      if (S.cls === k || !player || player.dead) return;
      cancelTask(); startAs(k); save();
      burst(player.pos.clone().setY(1.5), '#ffe07a', 40, 5, 1.2);
      toast(`You are now a ${c.name}. Your skills, bag and quests come with you.`, ICONS[c.skill]);
    };
    bar.appendChild(b);
  }
}
function updateTitle() {
  $('pname').textContent = CLASSES[S.cls].name;
  $('pclass').textContent = `Total level ${totalLevel()}`;
}

// ---------- gathering nodes ----------
const crystalGeo = new THREE.OctahedronGeometry(0.5, 0);
function buildNodes() {
  const addTree = (x, z, kind) => {
    if (blocked(x, z) || !isFree(x, z, 2.5) || Math.hypot(x, z) < 12) return;
    const v = kind === 'oak' ? 'B' : 'A';
    const s = kind === 'oak' ? S_NATURE * 1.25 : S_NATURE;
    const full = place(`tree_single_${v}`, x, z, s, rng() * 6, { shrink: 0.35 });
    const cut = place(`tree_single_${v}_cut`, x, z, s, full.rotation.y, { collide: false });
    cut.visible = false;
    nodes.push({ kind, def: NODES[kind], x, z, full, cut, alive: true, respawnAt: 0, reach: 2.6 });
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
    nodes.push({ kind, def: NODES[kind], x, z, full: gems, alive: true, respawnAt: 0, reach: 2.6 });
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
    g.lineWidth = 10; g.strokeStyle = '#4a2a17'; g.strokeText(ch, 32, 52);
    g.fillStyle = ch === '?' ? '#9cff6b' : '#ffd23f'; g.fillText(ch, 32, 52);
    tex.needsUpdate = true;
  };
  return sp;
}
function buildNpcs() {
  const defs = [
    { id: 'bertha', name: 'Bertha the Innkeeper', model: 'barbarian', x: -2, z: -10.5, hide: [] },
    { id: 'rowan', name: 'Captain Rowan', model: 'knight', x: 12, z: -18, hide: [] },
    { id: 'fenwick', name: 'Old Fenwick', model: 'mage', x: 15, z: -4.5, hide: [] },
  ];
  for (const d of defs) {
    const a = new Actor(G[d.model], { hide: d.hide, scale: 1.3 });
    a.root.position.set(d.x, 0, d.z);
    a.face(0, 0);
    a.play(d.id === 'fenwick' ? 'Spellcasting' : 'Idle');
    if (d.id === 'fenwick') a.mixer.timeScale = 0.4;
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
    const qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === n.id);
    const st = S.quests[qid].state;
    n.marker.userData.draw(st === 'todo' ? '!' : questReady(qid) ? '?' : '');
  }
  if (!$('sheet').hidden && sheetMode !== 'opts') renderSheet();
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
      slots.push(it ? `<div class="slot" title="${ITEMS[it[0]]}"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></div>` : '<div class="slot empty"></div>');
    }
    el.innerHTML = `<h3>Bag <small>${S.coins} coins</small></h3><div class="bag">${slots.join('')}</div><p class="hint">Gather logs, ore and fish, and collect bones from skeletons.</p>`;
  } else if (sheetMode === 'quests') {
    el.innerHTML = `<h3>Quests</h3>${Object.entries(QUESTS).map(([k, q]) => {
      const st = S.quests[k].state, ready = questReady(k);
      const tag = st === 'done' ? '<span class="tag done">Done</span>' : ready ? '<span class="tag ready">Hand in</span>' : st === 'active' ? '<span class="tag active">Active</span>' : '<span class="tag todo">New</span>';
      const body = st === 'todo' ? `Talk to ${npcName(q.giver)}.` : st === 'done' ? 'Completed.' : ready ? `Return to ${npcName(q.giver)}.` : `${q.desc} (${questProgress(k)})`;
      return `<div class="quest"><h4>${q.name}${tag}</h4><p>${body}</p></div>`;
    }).join('')}`;
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
  for (const m of ['skills', 'bag', 'quests', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', String(m === mode));
}
function closeSheet() { $('sheet').hidden = true; sheetMode = null; for (const m of ['skills', 'bag', 'quests', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', 'false'); }
for (const m of ['skills', 'bag', 'quests', 'opts']) $(`b-${m}`).addEventListener('click', () => openSheet(m));

// dialogue
let talking = null;
function openDialog(npc) {
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
const KEYMAP = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
addEventListener('keydown', (e) => {
  if (!player || !$('pick').hidden) return;
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); cancelTask(); moveTarget = null; e.preventDefault(); }
  if (e.code === 'Space' || e.code === 'KeyE') { doAction(); e.preventDefault(); }
  if (e.code === 'KeyK') openSheet('skills');
  if (e.code === 'KeyI' || e.code === 'KeyB') openSheet('bag');
  if (e.code === 'KeyQ') openSheet('quests');
  if (e.code === 'Escape') { closeSheet(); closeDialog(); }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
addEventListener('blur', () => keys.clear());

let moveTarget = null, pending = null;
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 32), new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
marker.rotation.x = -Math.PI / 2; marker.layers.set(1); marker.visible = false; scene.add(marker);

function targetAt(x, z) {
  let best = null, bd = 1e9;
  const consider = (t, tx, tz, r) => { const d = Math.hypot(tx - x, tz - z); if (d < r && d < bd) { bd = d; best = t; } };
  for (const e of enemies) if (e.hp > 0) consider({ type: 'enemy', e }, e.pos.x, e.pos.z, 2);
  for (const n of npcs) consider({ type: 'npc', n }, n.x, n.z, 2);
  for (const n of nodes) if (n.alive) consider({ type: 'node', n }, n.x, n.z, n.def.skill === 'fishing' ? 2.2 : 2.4);
  return best;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!player || player.dead) return;
  const v = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(v, camera);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(groundPlane, p)) return;
  cancelTask();
  const t = targetAt(p.x, p.z);
  pending = t;
  moveTarget = new THREE.Vector2(p.x, p.z);
  marker.position.set(p.x, 0.08, p.z); marker.visible = !t; marker.scale.setScalar(1.4);
});
let zoom = 1;
renderer.domElement.addEventListener('wheel', (e) => { zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.001, 0.6, 1.5); e.preventDefault(); }, { passive: false });
$('action').addEventListener('click', () => {
  if (player && player.task && player.task.type === 'node') { cancelTask(); return; }
  doAction();
});

const targetPos = (t) => (t.type === 'enemy' ? t.e.pos : { x: t.n.x, z: t.n.z });
const reachOf = (t) => (t.type === 'enemy' ? CLASSES[S.cls].atk.range : t.n.reach);

function nearest() {
  if (!player) return null;
  const p = player.pos;
  let best = null, bd = 1e9;
  const take = (t, x, z, r) => { const d = Math.hypot(x - p.x, z - p.z); if (d < r && d < bd) { bd = d; best = t; } };
  for (const n of npcs) take({ type: 'npc', n }, n.x, n.z, n.reach + 0.6);
  for (const n of nodes) if (n.alive) take({ type: 'node', n }, n.x, n.z, n.reach + 0.6);
  for (const e of enemies) if (e.hp > 0) take({ type: 'enemy', e }, e.pos.x, e.pos.z, Math.max(5, CLASSES[S.cls].atk.range));
  return best;
}
function describe(t) {
  if (!t) return { label: 'Explore', icon: ICONS.speed, hint: 'WASD or tap to move. Walk up to something to use it.', ok: false };
  if (t.type === 'npc') return { label: 'Talk', icon: ICONS.magic, hint: t.n.name, ok: true };
  if (t.type === 'enemy') return { label: 'Attack', icon: ICONS[CLASSES[S.cls].skill], hint: `${t.e.T.name} (${t.e.hp} health)`, ok: true };
  const d = t.n.def, l = lvl(d.skill);
  return { label: d.verb, icon: ICONS[d.skill], hint: l >= d.req ? `${d.name} · ${SKILL_NAME[d.skill]} ${d.req}+` : `${d.name} needs ${SKILL_NAME[d.skill]} level ${d.req}`, ok: l >= d.req };
}
function doAction() {
  if (!player || player.dead || !$('pick').hidden) return;
  if (talking) { closeDialog(); return; }
  const t = nearest();
  if (t) startTask(t);
}

// ---------- tasks ----------
function cancelTask() {
  if (player && player.task) {
    player.task = null;
    tool.visible = false; rod.visible = false;
    player.weapons.forEach((w) => { w.visible = true; });
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
  if (t.type === 'node') {
    const def = t.n.def;
    if (lvl(def.skill) < def.req) { toast(`You need ${SKILL_NAME[def.skill]} level ${def.req} for that.`, ICONS[def.skill]); return; }
    player.task = { ...t, next: now + 1.4 };
    player.weapons.forEach((w) => { w.visible = false; });
    if (def.skill === 'fishing') { rod.visible = true; player.play('1H_Ranged_Aiming'); }
    else { tool.visible = true; player.play('1H_Melee_Attack_Chop', { speed: 0.9 }); }
    return;
  }
  player.task = { ...t };
}

function gatherTick(task) {
  const n = task.n, def = n.def;
  if (!n.alive) { cancelTask(); return; }
  if (now < task.next) return;
  task.next = now + 1.4 + rng() * 0.6;
  const l = lvl(def.skill);
  const chance = THREE.MathUtils.clamp(0.4 + (l - def.req) * 0.04, 0.25, 0.92);
  const at = new THREE.Vector3(n.x, 1.5, n.z);
  burst(at, def.skill === 'fishing' ? '#bff4ff' : def.skill === 'mining' ? '#ffe2b0' : '#c9f59a', 8, 3);
  if (rng() > chance) return;
  addItem(def.item);
  giveXp(def.skill, def.xp, player.pos.clone().setY(3.2));
  toast(`You get some ${ITEMS[def.item].toLowerCase()}.`, ICONS[def.item]);
  if (def.deplete && rng() < def.deplete) {
    n.alive = false; n.respawnAt = now + def.respawn;
    n.full.visible = false; if (n.cut) n.cut.visible = true;
    if (n.full.userData.collider) n.full.userData.collider.r = 0.6;
    burst(at, '#ffe9a8', 24, 5);
    cancelTask();
  }
  refreshUI();
}

// ---------- combat ----------
const projectiles = [];
const orbGeo = new THREE.IcosahedronGeometry(0.4, 1);
function shoot(from, target, kind, onHit) {
  let mesh;
  if (kind === 'bolt') {
    mesh = lib.arrow.clone(true); stylize(mesh); mesh.scale.setScalar(2.2);
  } else {
    mesh = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: kind === 'dark' ? '#c58bff' : '#8ff7ff', fog: false }));
    mesh.layers.set(1);
    mesh.add(new THREE.PointLight(kind === 'dark' ? '#b066ff' : '#6fe9ff', 12, 8, 1.5));
  }
  mesh.position.copy(from);
  scene.add(mesh);
  projectiles.push({ mesh, target, kind, onHit, speed: kind === 'bolt' ? 30 : 18, life: 2 });
}
function rollDamage(skill, bonus = 0) {
  const maxHit = 2 + Math.floor(lvl(skill) * 0.55) + bonus;
  if (rng() < 0.12) return 0;
  return 1 + Math.floor(rng() * maxHit);
}
function combatTick(task) {
  const e = task.e, A = CLASSES[S.cls].atk;
  if (e.hp <= 0) { cancelTask(); return; }
  const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
  if (d > A.range + 0.5) { player.task = null; pending = task; moveTarget = new THREE.Vector2(e.pos.x, e.pos.z); return; }
  player.face(e.pos.x, e.pos.z);
  if (now < player.nextHit) { if (player.name !== 'Idle_Combat') player.play(player.clips.Idle_Combat ? 'Idle_Combat' : 'Idle'); return; }
  player.nextHit = now + A.cd;
  const dur = player.play(A.anim, { once: true, fade: 0.08, speed: 1.15 });
  player.busyUntil = now + Math.min(dur * 0.8, A.cd * 0.9);
  later(A.hitAt, () => {
    if (e.hp <= 0 || player.dead) return;
    const skill = CLASSES[S.cls].skill;
    const dmg = rollDamage(skill, A.bonus || 0);
    const land = () => { if (e.hp > 0) hurtEnemy(e, dmg, skill); };
    const fwd = new THREE.Vector3(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));
    if (A.proj) shoot(player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(fwd, 0.8), e, A.proj, land);
    else { burst(player.pos.clone().setY(1.5).addScaledVector(fwd, 1.4), '#fff2a8', 14, 5); land(); }
  });
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
    if (player.task && player.task.e === e) cancelTask();
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
      player.root.position.set(0, 0, 6); camPos.set(0, 30, 40);
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
        later(0.35, () => { if (e.hp > 0 && !player.dead) shoot(ep.clone().setY(1.8), player, 'dark', () => hurtPlayer(dmg)); });
      } else {
        e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        later(0.4, () => { if (e.hp > 0 && Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z) < reach + 1) hurtPlayer(dmg); });
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

// ---------- main loop ----------
const camPos = new THREE.Vector3(0, 30, 40);
const tmpV = new THREE.Vector3();
function collide(p, r = 0.7) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 0.0001) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
  const d = Math.hypot(p.x, p.z);
  if (d > 66) { p.x *= 66 / d; p.z *= 66 / d; }
}
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
      if (pending && pending.type === 'enemy') moveTarget.set(pending.e.pos.x, pending.e.pos.z);
      const tx = moveTarget.x - pp.x, tz = moveTarget.y - pp.z, d = Math.hypot(tx, tz);
      const stopAt = pending ? reachOf(pending) : 0.3;
      if (d > stopAt) { mx = tx / d; mz = tz / d; }
      else { moveTarget = null; marker.visible = false; if (pending) { const t = pending; pending = null; startTask(t); } }
    }
    if ((mx || mz) && !busy) {
      if (talking) closeDialog();
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
      const speed = 6.5 * (1 + (lvl('speed') - 1) * 0.006);
      const ox = pp.x, oz = pp.z;
      pp.x += mx * speed * dt; pp.z += mz * speed * dt;
      collide(pp);
      const moved = Math.hypot(pp.x - ox, pp.z - oz);
      if (moved > 0.001) giveXp('speed', moved * 0.5);
      // give up on a tap target we can't reach
      stuck = moved < speed * dt * 0.2 ? stuck + dt : 0;
      if (stuck > 0.6 && moveTarget) { moveTarget = null; marker.visible = false; if (pending) { const t = pending; pending = null; startTask(t); } stuck = 0; }
      const want = Math.atan2(mx, mz);
      let diff = want - player.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      player.root.rotation.y += diff * Math.min(1, dt * 14);
      player.play('Running_A', { fade: 0.12 });
    } else if (!busy && player.task) {
      if (player.task.type === 'node') gatherTick(player.task);
      else if (player.task.type === 'enemy') combatTick(player.task);
    } else if (!busy && (player.name === 'Running_A' || player.name === 'Idle_Combat')) {
      player.play('Idle', { fade: 0.15 });
    }
    if (now - lastHurt > 6 && now > regenAt && S.hp < maxHp()) { S.hp = Math.min(maxHp(), S.hp + 1); regenAt = now + 2.5; refreshUI(); }
  }
  if (marker.visible) { marker.scale.setScalar(Math.max(1, marker.scale.x - dt * 2)); marker.material.opacity = 0.6 + 0.3 * Math.sin(now * 8); }

  for (const e of enemies) { if (player) enemyTick(e, dt); e.mixer.update(dt); }
  if (player) player.mixer.update(dt);
  for (const n of npcs) { n.actor.mixer.update(dt); n.marker.position.y = 4.6 + Math.sin(now * 3 + n.x) * 0.15; }

  for (const n of nodes) {
    if (!n.alive && now > n.respawnAt) {
      n.alive = true; n.full.visible = true; if (n.cut) n.cut.visible = false;
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
    const tp = pr.target.pos.clone().setY(1.6);
    const dir = tp.sub(pr.mesh.position);
    const dist = dir.length();
    pr.life -= dt;
    if (dist < 0.7 || pr.life <= 0) {
      if (pr.life > 0) pr.onHit();
      burst(pr.mesh.position, pr.kind === 'dark' ? '#d6a8ff' : pr.kind === 'bolt' ? '#fff2c0' : '#8ff7ff', 20, 5);
      scene.remove(pr.mesh); projectiles.splice(i, 1); continue;
    }
    dir.normalize();
    pr.mesh.position.addScaledVector(dir, Math.min(dist, pr.speed * dt));
    pr.mesh.lookAt(pr.mesh.position.clone().add(dir));
    if (pr.kind !== 'bolt' && rng() < 0.6) burst(pr.mesh.position, pr.kind === 'dark' ? '#d6a8ff' : '#bffaff', 1, 1);
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
      : describe(player.task || nearest());
    const key = info.label + info.hint + info.ok;
    if (key !== lastAct) {
      lastAct = key;
      $('actionlabel').textContent = info.label; $('actionicon').src = info.icon; $('actionhint').textContent = info.hint;
      $('action').disabled = !info.ok;
    }
  }
  if (player && now - lastSave > 6) { lastSave = now; save(); }

  const P = PRESETS[env.preset];
  if (dynamic.waterMat) dynamic.waterMat.uniforms.time.value = now;
  const fl = 0.85 + 0.15 * Math.sin(now * 17) + 0.1 * Math.sin(now * 7.3);
  if (dynamic.fireLight) dynamic.fireLight.intensity = 30 * fl * P.fire;
  dynamic.flames.forEach((f, i) => { f.scale.set(1, fl * (i ? 1.1 : 1), 1); f.rotation.y = now * (i ? -2 : 2); });
  for (const c of clouds) { c.position.x += dt * 0.8; if (c.position.x > 110) c.position.x = -110; }

  const focus = player ? player.pos : new THREE.Vector3(0, 0, 4);
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

window.__jq = { projectiles, timers, get S() { return S; }, get player() { return player; }, enemies, nodes, npcs, startTask, doAction, giveXp, save, openSheet, openDialog };
window.addEventListener('error', (e) => { const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${e.message}`; });
main().catch((err) => {
  console.error(err);
  const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${err && err.message ? err.message : err}. Try reloading the page.`;
});
