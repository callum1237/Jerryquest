// JerryQuest: playable single-player slice. One hero shaped by gear and stat points, skills that level by use, gathering, combat and quests.
import { THREE, scene, camera, renderer, sun, sky, PRESETS, env, applyPreset, styled, setStyled, stylize, toon, registerMesh,
  loadModel, burst, updateParticles, render, rng } from './engine.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildWorld, buildFlowers, place, colliders, clouds, dynamic, LAKE, CAMP, MINE, S_NATURE, blocked, isFree, ZONES, WORLD_R, VS } from './world.js';
import { ICONS } from './icons.js';
import { buildInteriors, INTERIORS } from './interiors.js';

const $ = (id) => document.getElementById(id);
const clock = new THREE.Clock();
let now = 0;

// ---------- rules ----------
const SKILLS = [
  ['woodcutting', 'Woodcutting'], ['mining', 'Mining'], ['fishing', 'Fishing'], ['speed', 'Speed'],
];
const SKILL_NAME = Object.fromEntries(SKILLS);
const XPT = [0, 0];
{ let pts = 0; for (let l = 1; l < 99; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); XPT[l + 1] = Math.floor(pts / 4); } }
const levelOf = (xp) => { let l = 1; while (l < 99 && xp >= XPT[l + 1]) l++; return l; };

// ---------- the hero: one level, three stats ----------
// Every level gives +1 Attack, +1 Defense and +1 Health for free, plus 2 points to spend anywhere.
const STATS = { atk: ['Attack', 'melee'], def: ['Defense', 'shield'], hp: ['Health', 'heart'] };
const AUTO_PER_LEVEL = 1, FREE_PER_LEVEL = 2;
// Attack multiplies your weapon's base damage. Defense divides the damage you take.
// Health adds max health. A point of Defense and a point of Health are worth about the same,
// so a balanced hero lasts longest.
// Hero XP: bosses and quests give the most; hitting and beating monsters gives some;
// chopping, mining and fishing give a little (this share of the skill XP).
const GATHER_HERO_XP = 0.25, HIT_HERO_XP = 3;
const ATK_MULT = 0.1, DEF_DIV = 0.1, HP_BASE = 50, HP_PER = 6;
// How each kind of weapon attacks. The weapon itself sets damage, reach (or range) and swing time.
const STYLES = {
  melee: { anim: '1H_Melee_Attack_Slice_Diagonal', heavy: '2H_Melee_Attack_Chop', hitAt: 0.32 },
  magic: { anim: 'Spellcast_Shoot', hitAt: 0.35, proj: 'orb' },
  ranged: { anim: '1H_Ranged_Shoot', hitAt: 0.22, proj: 'bolt' },
};
const STYLE_NAME = { melee: 'Melee', magic: 'Magic', ranged: 'Ranged' };
// Every weapon also has a special attack (R, or the Special button): usually an area attack, on a cooldown.
const SPECIALS = {
  whirl: { name: 'Whirlwind', desc: 'Spin and hit everything around you', cd: 6, mult: 1.5 },
  quake: { name: 'Ground Slam', desc: 'Leap and smash the ground in a wide ring', cd: 8, mult: 2.0 },
  nova: { name: 'Starburst', desc: 'A magic circle bursts where you aim', cd: 7, mult: 1.8 },
  volley: { name: 'Volley', desc: 'Fire a fan of five bolts', cd: 6, mult: 1.0 },
};
const specialOf = (w) => (w.type === 'magic' ? 'nova' : w.type === 'ranged' ? 'volley' : w.heavy ? 'quake' : 'whirl');
const ITEMS = {
  logs: 'Logs', oak_logs: 'Oak logs', copper_ore: 'Copper ore', iron_ore: 'Iron ore', shrimp: 'Raw shrimp', trout: 'Raw trout', bones: 'Bones',
  bread: 'Bread', pie: 'Apple pie', stew: 'Hearty stew',
  bone_dust: 'Bone dust', dark_essence: 'Dark essence',
  dragon_scale: "Gagron's fire scale", silver_ring: 'Silver ring', ruby: 'Ruby', golden_crown: 'Tiny golden crown',
  lucky_sock: "Bonecrusher's lucky sock", gloom_hat: "Gloomcaster's droopy hat", rattle_tooth: "Rattlebones' gold tooth",
};
// Food heals; bought from Marta's stall in the market.
const FOOD = { bread: { heal: 8, price: 8 }, pie: { heal: 20, price: 20 }, stew: { heal: 40, price: 40 } };
// Weapons. dmg = base damage (your Attack multiplies it), reach = swing radius for melee or range for
// magic and crossbows, cd = seconds between attacks (lower is faster). Your weapon decides how you fight.
const WEAPONS = {
  k_sword: { type: 'melee', name: 'Knight sword', dmg: 4, reach: 2.6, cd: 0.9, price: 0 },
  k_dagger: { type: 'melee', name: 'Quick dagger', dmg: 4, reach: 2.0, cd: 0.5, price: 40, model: 'dagger' },
  k_steel: { type: 'melee', name: 'Steel sword', dmg: 6, reach: 2.7, cd: 0.85, price: 45, model: 'sword_1handed' },
  k_axe: { type: 'melee', name: 'Great axe', dmg: 9, reach: 3.2, cd: 1.35, price: 140, model: 'axe_2handed', heavy: true },
  k_gold: { type: 'melee', name: 'Golden sword', dmg: 10, reach: 2.8, cd: 0.8, price: 320, model: 'sword_1handed', tint: '#ffd84a' },
  k_royal: { type: 'melee', name: 'Royal blade', dmg: 13, reach: 3.4, cd: 1.1, price: 600, model: 'sword_2handed_color', heavy: true },
  m_wand: { type: 'magic', name: 'Apprentice wand', dmg: 4, reach: 11, cd: 0.8, price: 45, model: 'wand' },
  m_staff: { type: 'magic', name: 'Oak staff', dmg: 6, reach: 12, cd: 1.2, price: 60, model: 'staff' },
  m_crystal: { type: 'magic', name: 'Crystal staff', dmg: 9, reach: 13, cd: 1.1, price: 160, model: 'staff', tint: '#8ff0ff' },
  m_star: { type: 'magic', name: 'Starlight wand', dmg: 9, reach: 12, cd: 0.7, price: 320, model: 'wand', tint: '#ffe27a' },
  m_ember: { type: 'magic', name: 'Ember staff', dmg: 14, reach: 14, cd: 1.2, price: 600, model: 'staff', tint: '#ff8a5a' },
  a_xbow: { type: 'ranged', name: 'Hunter crossbow', dmg: 4, reach: 13, cd: 0.75, price: 45, model: 'crossbow_1handed' },
  a_heavy: { type: 'ranged', name: 'Heavy crossbow', dmg: 8, reach: 15, cd: 1.2, price: 150, model: 'crossbow_2handed' },
  a_gold: { type: 'ranged', name: 'Golden crossbow', dmg: 10, reach: 14, cd: 0.8, price: 320, model: 'crossbow_1handed', tint: '#ffd84a' },
  a_shadow: { type: 'ranged', name: 'Shadow repeater', dmg: 9, reach: 13, cd: 0.5, price: 600, model: 'crossbow_2handed', tint: '#b896ff' },
  // unique boss weapons: only from boss drops, never sold
  k_cleaver: { type: 'melee', name: "Bonecrusher's Cleaver", dmg: 15, reach: 3.4, cd: 1.2, price: 0, unique: true, model: 'axe_2handed', tint: '#ff9a7a', heavy: true },
  m_gloom: { type: 'magic', name: 'Gloomstaff', dmg: 15, reach: 14, cd: 1.0, price: 0, unique: true, model: 'staff', tint: '#b07aff' },
  k_flame: { type: 'melee', name: "Gagron's Flamebrand", dmg: 14, reach: 3.0, cd: 0.9, price: 0, unique: true, model: 'sword_2handed_color', tint: '#ff8a3a', heavy: true },
  a_rattle: { type: 'ranged', name: "Rattlebones' Repeater", dmg: 12, reach: 14, cd: 0.55, price: 0, unique: true, model: 'crossbow_2handed', tint: '#9effa8' },
};
// Shields and armour add Defense on top of your Defense points.
const ARMOUR = {
  sh_badge: { slot: 'shield', name: 'Badge shield', def: 2, price: 0 },
  sh_square: { slot: 'shield', name: 'Square shield', def: 4, price: 80, model: 'shield_square_color' },
  sh_spike: { slot: 'shield', name: 'Spiked shield', def: 6, price: 220, model: 'shield_spikes_color' },
  ar_cloth: { slot: 'armour', name: 'Cloth tunic', def: 0, price: 0 },
  ar_leather: { slot: 'armour', name: 'Leather armour', def: 2, price: 60, tint: '#e0b088' },
  ar_chain: { slot: 'armour', name: 'Chainmail', def: 4, price: 160, tint: '#cfd9e6' },
  ar_gold: { slot: 'armour', name: 'Golden plate', def: 7, price: 450, tint: '#ffe070' },
};
for (const w of Object.values(WEAPONS)) w.slot = 'weapon';
const GEAR = { ...WEAPONS, ...ARMOUR };
// spare gear sells back to the smiths for half price; boss weapons are worth a fortune
const gearValue = (g) => (g.unique ? 250 : Math.floor(g.price / 2));
const gearIcon = (g) => (g.slot === 'weapon' ? ICONS[g.type] : ICONS[g.slot]);
const gearStats = (g) => (g.slot === 'weapon'
  ? `${g.dmg} dmg · ${g.type === 'melee' ? 'reach' : 'range'} ${g.reach} · ${g.cd}s · ${SPECIALS[specialOf(g)].name}`
  : `+${g.def} defense`);

// Who drops what. Regular monsters roll this table; bosses always drop their trophy and may drop their weapon.
const BOSS_WEAPON = { boss_gagron: 'k_flame', boss_crusher: 'k_cleaver', boss_gloom: 'm_gloom', boss_rattle: 'a_rattle' };
const DARK_KING = 'Morgoth the Menacing'; // working name, change it here
// Everything can be sold. Treasures (rings, rubies, crowns) are rare drops worth a lot.
const SELL = { dragon_scale: 90, bread: 4, pie: 10, stew: 20, silver_ring: 40, ruby: 120, golden_crown: 400, bone_dust: 3, dark_essence: 15, lucky_sock: 60, gloom_hat: 60, rattle_tooth: 60, logs: 3, oak_logs: 6, copper_ore: 4, iron_ore: 8, shrimp: 3, trout: 8, bones: 2 };
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
  // minibosses: big, tough, and every third attack is a giant slam you can see coming (jump or run!)
  boss_crusher: { name: 'Bonecrusher', model: 'skel_warrior', hp: 170, maxHit: 8, weapon: 'axe_2handed', xp: 800, boss: true, scale: 2.5, coins: [90, 150], drop: 'lucky_sock', slam: 5.5 },
  boss_gloom: { name: 'Gloomcaster', model: 'skel_mage', hp: 140, maxHit: 7, weapon: 'Skeleton_Staff', xp: 800, boss: true, scale: 2.3, coins: [90, 150], drop: 'gloom_hat', ranged: true, spread: true, slam: 4.5 },
  // the first story boss: a fire dragon in a cave north-east of the castle. Breathes fire and rains fireballs.
  boss_gagron: { name: 'Gagron the Hideous', model: 'dragon', hp: 260, maxHit: 7, xp: 900, boss: true, dragon: true, scale: 2.1, coins: [120, 200], drop: 'dragon_scale', inside: 'cave', noBones: true },
  boss_rattle: { name: 'Captain Rattlebones', model: 'skel_minion', hp: 150, maxHit: 7, weapon: 'Skeleton_Blade', xp: 800, boss: true, scale: 2.3, coins: [90, 150], drop: 'rattle_tooth', slam: 6 },
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
    need: { kills: 4 }, reward: { coins: 80, xp: { hero: 200 } }, desc: 'Defeat 4 skeletons at the camp.',
  },
  supper: {
    name: "The Wizard's Supper", giver: 'fenwick',
    intro: 'Ahem. A wizard cannot live on spells alone. Fetch me 3 raw shrimp from the lake, and 2 copper ore from the mine for my new cauldron.',
    ready: 'Shrimp AND copper! My cauldron and my belly thank you.', done: 'Mmm, shrimp stew. Truly the finest magic.',
    need: { shrimp: 3, copper_ore: 2 }, reward: { coins: 100, xp: { fishing: 150, mining: 150 } }, desc: 'Bring Fenwick 3 raw shrimp and 2 copper ore.',
  },
  crusher: {
    name: 'The Big Bad Bones', giver: 'giles', bossType: 'boss_crusher',
    intro: "A giant skeleton called Bonecrusher stomps about the Grumble Crags, west of the valley. Every stomp sours my milk! Knock him down, and mind his big slam. Jump or run when the ground glows red!",
    ready: 'You beat Bonecrusher? My cows are cheering! Well, mooing.', done: 'Milk is sweet again, thanks to you.',
    need: { boss: 1 }, reward: { coins: 300, xp: { hero: 600 } }, desc: 'Defeat Bonecrusher in the Grumble Crags (west).',
  },
};

// ---------- main story (optional: never locks you in, but it's the main path) ----------
// Chapter 1, "The Seal Breaks". More chapters and, far in the future, the Dark King himself.
Object.assign(QUESTS, {
  st_1: {
    story: true, chapter: 'Chapter 1', name: 'Darkness Stirs', giver: 'king', after: [],
    intro: `For a hundred years the Heartstone kept the dark magic sealed away, and the kingdom knew only peace. Last night the Heartstone cracked. The seal is broken, and ${DARK_KING}'s servants are waking. The skeletons south-west of the village are the first of them. Show me you can stand against them: defeat 3.`,
    ready: 'You stood firm. Good. The kingdom will need that courage, for this is only the beginning.',
    done: 'The Heartstone shattered into shards when the seal broke. Find them, hero.',
    need: { kills: 3 }, reward: { coins: 60, xp: { hero: 200 } }, desc: 'Defeat 3 skeletons, then return to King Jerrold.',
  },
  st_dragon: {
    story: true, chapter: 'Chapter 1', name: "Gagron's Lair", giver: 'king', after: ['st_1'], bossType: 'boss_gagron',
    intro: `When the Heartstone broke, its biggest shard fell into the Ember Cave, north-east of the castle. Something woke up down there: Gagron the Hideous, a fire dragon, and he is guarding it. Watch the ground: when it glows, his fire is coming. Jump, dash or run!`,
    ready: 'You beat Gagron and brought back the shard! It is warm as a hearth. The first piece of the seal is home.', done: 'The Ember shard glows on its stand. Gagron will sulk in his cave for a while.',
    need: { boss: 1 }, reward: { coins: 200, xp: { hero: 700 } }, desc: 'Defeat Gagron the Hideous in the Ember Cave (north-east of the castle).',
  },
  st_crags: {
    story: true, chapter: 'Chapter 1', name: 'The Shard of the Crags', giver: 'king', after: ['st_dragon'], bossType: 'boss_crusher',
    intro: `A shard of the Heartstone fell in the Grumble Crags, to the west. ${DARK_KING}'s brute, Bonecrusher, has claimed it. Defeat him and bring the shard home.`,
    ready: 'The Crags shard! It still glows. One piece of the seal, restored.', done: 'The Crags shard rests in the throne room, humming softly.',
    need: { boss: 1 }, reward: { coins: 150, xp: { hero: 500 } }, desc: 'Defeat Bonecrusher in the Grumble Crags (west).',
  },
  st_glimmer: {
    story: true, chapter: 'Chapter 1', name: 'The Shard of Glimmerwood', giver: 'king', after: ['st_dragon'], bossType: 'boss_gloom',
    intro: `Another shard lies in Glimmerwood, to the east. The Gloomcaster, ${DARK_KING}'s sorcerer, drinks its light. Stop him before the whole forest goes grey.`,
    ready: 'The Glimmerwood shard! Feel how it sparkles. The seal grows stronger.', done: 'The Glimmerwood shard glitters beside its brother.',
    need: { boss: 1 }, reward: { coins: 150, xp: { hero: 500 } }, desc: 'Defeat the Gloomcaster in Glimmerwood (east).',
  },
  st_hollow: {
    story: true, chapter: 'Chapter 1', name: 'The Shard of the Hollow', giver: 'king', after: ['st_dragon'], bossType: 'boss_rattle',
    intro: `The third shard sank into Haunted Hollow, north of the castle. Captain Rattlebones leads ${DARK_KING}'s restless dead there. Put him to rest, if only for a while.`,
    ready: 'The Hollow shard, cold as moonlight. Three of the pieces are home.', done: 'Three shards, safe. But the Heartstone is not whole...',
    need: { boss: 1 }, reward: { coins: 150, xp: { hero: 500 } }, desc: 'Defeat Captain Rattlebones in Haunted Hollow (north).',
  },
});
const storyOpen = (k) => (S.quests[k] && S.quests[k].state !== 'todo') || (QUESTS[k].after || []).every((a) => S.quests[a] && S.quests[a].state === 'done');
const storyStep = () => Object.keys(QUESTS).filter((k) => QUESTS[k].story && storyOpen(k) && S.quests[k].state !== 'done');

// ---------- saved state ----------
const SAVE_KEY = 'jerryquest_save_v1';
const fresh = () => ({
  started: false, name: '', bank: 0, xp: Object.fromEntries(SKILLS.map(([k]) => [k, 0])), inv: {}, coins: 0,
  hero: { xp: 0, alloc: { atk: 0, def: 0, hp: 0 } },
  quests: Object.fromEntries(Object.keys(QUESTS).map((k) => [k, { state: 'todo', kills: 0 }])),
  hp: 56, pos: [0, 6], preset: 'day',
  look: { outfit: 'none', trim: 'none', hat: false, cape: true, hair: 'hero', hairLen: 'short', hairCol: 'chestnut', skin: 'peach', eyes: 'brown', eyeStyle: 'round', head: 'normal', ears: 'human', sex: 'm', mouth: 'smile', mark: 'none' },
  owned: ['k_sword', 'sh_badge', 'ar_cloth'], equip: { weapon: 'k_sword', shield: 'sh_badge', armour: 'ar_cloth' },
});
let S = fresh();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw); const f = fresh();
      // older saves had classes and Melee/Magic/Ranged skills: fold that into the hero
      if (d.cls && !d.hero) {
        const old = d.xp || {};
        d.hero = { xp: (old.melee || 0) + (old.magic || 0) + (old.ranged || 0), alloc: { atk: 0, def: 0, hp: 0 } };
        d.equip = { weapon: (d.equip && d.equip[d.cls]) || 'k_sword', shield: 'sh_badge', armour: 'ar_cloth' };
        d.started = true;
      }
      S = { ...f, ...d, xp: { ...f.xp, ...d.xp }, hero: { ...f.hero, ...d.hero, alloc: { ...f.hero.alloc, ...(d.hero || {}).alloc } }, quests: { ...f.quests, ...d.quests }, look: { ...f.look, ...d.look }, equip: { ...f.equip, ...d.equip }, owned: [...new Set([...f.owned, ...(d.owned || [])])] };
      for (const k of Object.keys(S.xp)) if (!SKILL_NAME[k]) delete S.xp[k];
      S.owned = S.owned.filter((k) => GEAR[k]);
      for (const sl of ['weapon', 'shield', 'armour']) if (!GEAR[S.equip[sl]]) S.equip[sl] = f.equip[sl];
      delete S.cls;
      return true;
    }
  } catch (e) { /* storage unavailable */ }
  return false;
}
function save() {
  if (!S.started || !player) return;
  S.pos = where === 'out' ? [player.root.position.x, player.root.position.z] : [INTERIORS[where].exitTo.x, INTERIORS[where].exitTo.z];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
}
const lvl = (k) => levelOf(S.xp[k]);
const heroLvl = () => levelOf(S.hero.xp);
// a stat = 1 at level 1, +1 every level, plus whatever points you spent on it
const stat = (k) => heroLvl() * AUTO_PER_LEVEL + S.hero.alloc[k];
const freePoints = () => (heroLvl() - 1) * FREE_PER_LEVEL - Object.values(S.hero.alloc).reduce((a, b) => a + b, 0);
const W = () => WEAPONS[S.equip.weapon] || WEAPONS.k_sword;
const gearDef = () => (ARMOUR[S.equip.shield] || { def: 0 }).def + (ARMOUR[S.equip.armour] || { def: 0 }).def;
const totalDef = () => stat('def') + gearDef();
const dmgMult = () => 1 + ATK_MULT * stat('atk');
const defDiv = () => 1 + DEF_DIV * totalDef();
const maxHp = () => HP_BASE + HP_PER * stat('hp');

// ---------- see-through silhouettes ----------
// When a tree or house hides the hero (or a boss), a soft glowing shape shows through it.
// The hero's visible pixels mark the stencil, so the glow only appears where they're actually hidden.
function markStencil(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || o.userData.stencilled) return;
    const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
    m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
    for (const mat of [m.std, m.toon]) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp; }
    o.userData.stencilled = true;
    registerMesh(o, m);
  });
}
function silMat(col) {
  return new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
}
const silMats = {};
function addSilhouette(root, col) {
  markStencil(root);
  const mat = silMats[col] || (silMats[col] = silMat(col)), list = [];
  root.traverse((o) => { if (o.isMesh && o.userData.mats && !o.userData.isSil && !o.userData.hasSil) list.push(o); });
  for (const o of list) {
    o.userData.hasSil = true;
    const sil = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, mat) : new THREE.Mesh(o.geometry, mat);
    sil.userData.isSil = true; sil.frustumCulled = false; sil.renderOrder = 20; sil.layers.set(1);
    // a child with no offset sits exactly on its mesh and hides with it
    o.add(sil); if (o.isSkinnedMesh) sil.bind(o.skeleton, o.bindMatrix);
  }
}

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
    const clip = this.clips[name] || (this.alias && this.clips[this.alias[name]]);
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
const FILES = ['world', 'gear', 'interior', 'dragon', 'knight', 'heroine', 'mage', 'archer', 'barbarian', 'skel_warrior', 'skel_minion', 'skel_mage'];
async function main() {
  let n = 0;
  const loaded = await Promise.all(FILES.map((f) => loadModel(f).then((g) => { $('loadmsg').textContent = `${++n} of ${FILES.length} models`; return g; })));
  FILES.forEach((f, i) => { G[f] = loaded[i]; });
  for (const c of G.world.scene.children) lib[c.name] = c;
  for (const c of G.gear.scene.children) lib[c.name] = c;
  for (const c of G.interior.scene.children) lib[c.name] = c;
  buildWorld(lib);
  // the tavern door sits in front of the tavern, which moved out with the rest of the village
  buildInteriors(lib, { tavern: { outside: { x: -4.0 * VS, z: -17 * VS + 4.7 }, exitTo: { x: -4.0 * VS + 0.6, z: -17 * VS + 7.6 } } });
  buildDoors();
  buildChests();
  buildNodes();
  buildNpcs();
  buildEnemies();
  buildFlowers();
  buildTools();
  $('coinicon').src = ICONS.coins; $('hearticon').src = ICONS.heart; $('booticon').src = ICONS.boot;
  document.querySelectorAll('[data-icon]').forEach((im) => { im.src = ICONS[im.dataset.icon]; });
  const had = loadSave();
  applyPreset(S.preset || 'day');
  $('loading').style.opacity = '0';
  setTimeout(() => $('loading').remove(), 700);
  if (had && S.started) { startHero(); if (!S.name) openCreator('new'); } else showPick();
  renderer.setAnimationLoop(tick);
}

function showPick() {
  const cards = $('cards');
  cards.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'card panel begin'; b.id = 'pick-begin';
  b.innerHTML = `<h3><img src="${ICONS.star}" alt="">Begin your adventure</h3><p>You start with a sword and a shield. Level up to earn stat points, and shape your hero with the weapons, shields and armour you find.</p>
    <p class="perk">${Object.values(STATS).map(([nm, ic]) => `<span class="statpill"><img src="${ICONS[ic]}" alt="">${nm}</span>`).join('')}</p>`;
  b.addEventListener('click', () => {
    $('pick').hidden = true;
    if (!S.started) { S.started = true; S.hp = maxHp(); }
    startHero(); save();
    openCreator('new');
  });
  cards.appendChild(b);
  $('pick').hidden = false;
}

function startHero() {
  player = new Actor(heroModel());
  player.root.position.set(S.pos[0], 0, S.pos[1]);
  player.base = {};
  player.root.traverse((o) => { if (o.name === '1H_Sword') player.base.weapon = o; if (o.name === 'Badge_Shield') player.base.shield = o; });
  borrowKnightGear();
  player.weapons = [];
  addSilhouette(player.root, '#ffe9a0');
  equipGear();
  player.play('Idle');
  player.busyUntil = 0; player.task = null; player.nextHit = 0; player.dead = false;
  S.hp = Math.min(S.hp > 0 ? S.hp : maxHp(), maxHp());
  if (tool) { tool.removeFromParent(); player.attach(tool); tool.visible = false; }
  if (rod) { rod.removeFromParent(); player.attach(rod); rod.visible = false; }
  if (pick) { pick.removeFromParent(); player.attach(pick); pick.visible = false; }
  updateTitle();
  buildGearBar();
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
const HAIR_STYLES = { short: 'Neat', hero: 'Hero spikes', spiky: 'Spiky', swept: 'Swept fringe', bob: 'Bob', hime: 'Straight bangs', long: 'Ponytail', twin: 'Pigtails', bun: 'Top bun', curls: 'Curls', mohawk: 'Mohawk', none: 'Bald' };
const HAIR_LENGTHS = { short: 'Short', shoulder: 'Shoulder', long: 'Long', vlong: 'Very long' };
const SKIN_TONES = {
  porcelain: ['Porcelain', '#ffe9dc'], peach: ['Peach', '#f9cfb0'], honey: ['Honey', '#e7b085'], tan: ['Tan', '#c98d5e'],
  bronze: ['Bronze', '#b37548'], umber: ['Umber', '#93603d'], ebony: ['Ebony', '#74493a'], green: ['Orc green', '#8fc46a'], blue: ['Frost blue', '#9cc8ec'],
};
const EYE_COLOURS = {
  brown: ['Brown', '#8a5228'], hazel: ['Hazel', '#a88a3a'], blue: ['Blue', '#3d8fe0'], sky: ['Sky', '#7fd0ff'], green: ['Green', '#3fae4a'],
  emerald: ['Emerald', '#1fd18a'], violet: ['Violet', '#9a5ff0'], red: ['Red', '#e0393f'], gold: ['Gold', '#f2b51c'], grey: ['Grey', '#8a96a8'],
};
const EYE_STYLES = { round: 'Big and round', sharp: 'Determined', sleepy: 'Sleepy', happy: 'Happy', classic: 'Little dots' };
const HEAD_SIZES = { normal: ['Normal', 1], big: ['Big', 1.15], chibi: ['Chibi', 1.3] };
const hairMats = toon('#8a4f2a');
for (const mat of [hairMats.std, hairMats.toon]) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp; }
const hairCache = new Map();
function hairGroup(style, len = 'short') {
  const key = `${style}|${len}`;
  if (hairCache.has(key)) return hairCache.get(key);
  const g = new THREE.Group();
  const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = true; registerMesh(m, hairMats); g.add(m); return m;
  };
  // A lock of hair: a flattened cone hanging from a point on the head, leaning out to follow the skull.
  // az: 0 is the front of the face, +/- toward the sides, PI the back. el: height on the head in radians.
  const lock = (az, el, h, r = 0.12, lean = 0, twist = 0, flat = 0.5, out = 1.07) => {
    const k = `${r}|${h}`; if (!lockGeos[k]) lockGeos[k] = new THREE.ConeGeometry(r, h, 8).rotateX(Math.PI).translate(0, -h / 2, 0);
    const holder = new THREE.Group();
    holder.position.set(HC.x + Math.sin(az) * Math.cos(el) * HR.x * out, HC.y + Math.sin(el) * HR.y * out, HC.z + Math.cos(az) * Math.cos(el) * HR.z * out);
    holder.rotation.set(-(Math.max(0, el) + 0.1 + lean), az, twist, 'YXZ');
    const m = new THREE.Mesh(lockGeos[k]); m.scale.z = flat; m.castShadow = true; registerMesh(m, hairMats);
    holder.add(m); g.add(holder); return holder;
  };
  // The hair "shell": a sphere a little bigger than the head, cut along a hairline.
  // front is how low it comes over the forehead, side over the ears, back at the nape.
  const shell = (front = 0.42, side = -0.05, back = -0.78) => {
    const k = `${front}|${side}|${back}`;
    if (!shellGeos[k]) {
      const src = new THREE.SphereGeometry(1, 48, 32), p = src.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), hz = Math.hypot(x, z);
        const f = hz > 1e-4 ? z / hz : 0; // +1 front, -1 back
        const hl = f > 0 ? THREE.MathUtils.lerp(side, front, Math.pow(f, 1.6)) : THREE.MathUtils.lerp(side, back, Math.pow(-f, 0.8));
        if (y < hl) { const r = Math.sqrt(Math.max(0, 1 - hl * hl)); p.setXYZ(i, hz > 1e-4 ? (x / hz) * r : 0, hl, hz > 1e-4 ? (z / hz) * r : 0); }
      }
      src.computeVertexNormals(); shellGeos[k] = src;
    }
    return add(shellGeos[k], HC.x, HC.y + 0.01, HC.z - 0.01, 0, 0, 0, HR.x * 1.07, HR.y * 1.08, HR.z * 1.07);
  };
  const bangs = (kind) => {
    if (kind === 'blunt') { for (let i = -3; i <= 3; i++) lock(i * 0.2, 0.78, 0.32, 0.16, 0.02, 0, 0.45); return; }
    if (kind === 'side') { for (let i = -3; i <= 3; i++) lock(i * 0.2, 0.8, 0.3 - Math.abs(i + 1) * 0.02, 0.16, 0.04, -0.35, 0.45); return; }
    if (kind === 'centre') { for (const i of [-3, -2, -1, 1, 2, 3]) lock(i * 0.2, 0.8, 0.3, 0.16, 0.04, Math.sign(i) * 0.3, 0.45); return; }
    if (kind === 'spiky') { for (let i = -3; i <= 3; i++) lock(i * 0.19, 0.82, 0.34 - (i % 2 ? 0.08 : 0), 0.15, 0.08, i * 0.12, 0.5); return; }
    if (kind === 'swept') { for (let i = -3; i <= 3; i++) lock(i * 0.2 - 0.1, 0.84, 0.32 + (i > 0 ? 0.08 : 0), 0.17, 0.05, -0.7, 0.45); return; }
  };
  const sidelocks = (h = 0.6) => { for (const s of [-1, 1]) lock(s * 1.0, 0.2, h, 0.12, 0.0, 0, 0.85, 1.03); };
  const LEN = { short: 0, shoulder: 0.55, long: 0.95, vlong: 1.4 }[len] || 0;
  const backHair = (L) => {
    if (!L) return;
    for (let i = 0; i < 9; i++) { const az = Math.PI * (0.52 + i * 0.12); lock(az, 0.0, 0.55 + L * 0.65, 0.22, 0.0, 0, 0.8, 1.0); }
    // a soft mass under the locks so long hair has body from behind
    add(new THREE.CapsuleGeometry(0.3, 0.2 + L * 0.5, 4, 12), HC.x, HC.y - 0.2 - L * 0.32, HC.z - HR.z * 0.62, 0.1, 0, 0, 1.55, 1, 0.62);
    sidelocks(0.45 + L * 0.35);
  };
  const spikes = (n = 9, big = 1) => {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; lock(a, 0.95, 0.42 * big, 0.15, 1.4, 0, 0.8, 0.95); }
  };
  if (style === 'short') { shell(); bangs('side'); }
  if (style === 'spiky') { shell(); bangs('spiky'); spikes(10); }
  if (style === 'hero') {
    shell(); bangs('spiky');
    const sp = [[0, 1.0, 0.55], [0.5, 0.95, 0.5], [-0.5, 0.95, 0.5], [1.1, 0.75, 0.45], [-1.1, 0.75, 0.45], [2.2, 0.6, 0.5], [-2.2, 0.6, 0.5], [Math.PI, 0.6, 0.55], [1.6, 0.4, 0.38], [-1.6, 0.4, 0.38]];
    for (const [az, el, h] of sp) lock(az, el, h, 0.17, 2.45 - el, 0, 0.7, 0.92);
  }
  if (style === 'swept') { shell(0.38); bangs('swept'); lock(-0.8, 0.4, 0.42, 0.12, 0.05, -0.2, 0.6); }
  if (style === 'bun') { shell(0.48, -0.05, -0.7); bangs('centre'); add(new THREE.SphereGeometry(0.25, 16, 12), HC.x, HC.y + HR.y * 0.95, HC.z - HR.z * 0.55); }
  if (style === 'long') {
    shell(0.45, -0.05, -0.72); bangs('centre');
    add(new THREE.TorusGeometry(0.1, 0.04, 6, 12), HC.x, HC.y + HR.y * 0.62, HC.z - HR.z * 1.0, 0.6);
    const t = lock(Math.PI, 0.55, 0.9 + LEN * 0.55, 0.2, -0.15, 0, 0.75, 1.12);
    t.position.y += 0.05;
  }
  if (style === 'bob') { shell(0.42, -0.62, -0.75); bangs('blunt'); for (const s of [-1, 1]) lock(s * 1.2, 0.05, 0.42, 0.16, -0.12, 0, 0.9, 1.0); }
  if (style === 'hime') { shell(0.42, -0.1, -0.8); bangs('blunt'); sidelocks(0.75); backHair(Math.max(LEN, 0.95)); }
  if (style === 'twin') {
    shell(0.45, -0.05, -0.72); bangs('centre');
    for (const s of [-1, 1]) { add(new THREE.SphereGeometry(0.09, 10, 8), HC.x + s * HR.x * 0.82, HC.y + HR.y * 0.55, HC.z - HR.z * 0.45); const t = lock(s * 2.0, 0.55, 0.7 + LEN * 0.5, 0.18, 0.7, 0, 0.75, 1.15); t.rotation.z = s * 0.25; }
  }
  if (style === 'curls') {
    shell(0.4, 0.0, -0.45);
    for (let i = 0; i < 26; i++) { const az = (i * 2.399) % (Math.PI * 2), el = 0.15 + (i % 5) * 0.2; if (Math.cos(az) > 0.55 && el < 0.7) continue; add(curlGeo, HC.x + Math.sin(az) * Math.cos(el) * HR.x * 1.1, HC.y + Math.sin(el) * HR.y * 1.1, HC.z + Math.cos(az) * Math.cos(el) * HR.z * 1.1); }
    for (let i = -2; i <= 2; i++) add(curlGeo, HC.x + Math.sin(i * 0.3) * HR.x * 0.95, HC.y + HR.y * 0.72, HC.z + Math.cos(i * 0.3) * HR.z * 0.8, 0, 0, 0, 0.8, 0.8, 0.8);
  }
  if (style === 'mohawk') {
    for (let i = 0; i < 6; i++) { const el = 1.15 - Math.abs(i - 2) * 0.08; lock(Math.PI * (i / 5) * 0.9 - 0.15, el, 0.5, 0.13, 2.85 - el, 0, 0.5, 0.92); }
  }
  if (!['none', 'mohawk', 'long', 'bob', 'hime', 'twin'].includes(style)) backHair(LEN);
  hairCache.set(key, g);
  return g;
}
const lockGeos = {}, shellGeos = {}, curlGeo = new THREE.SphereGeometry(0.15, 10, 8);
// centre and radii of the code-built head in head-bone space (matches buildFace)
const HC = new THREE.Vector3(0, 0.546, 0.024), HR = new THREE.Vector3(0.543, 0.516, 0.508);

// ---------- face, skin, head size, ears ----------
// Every hero gets a soft round chibi head built in code, with an anime face painted on a canvas:
// big glossy eyes, brows in the hair colour, a mouth, cheeks and optional face marks.
// The face blinks every few seconds and winces when you are hit.
const MOUTHS = { smile: 'Smile', grin: 'Big grin', calm: 'Calm', cat: 'Cat smile', fang: 'Little fang', pout: 'Pout' };
const MARKS = { none: 'None', freckles: 'Freckles', rosy: 'Rosy cheeks', scar: 'Hero scar', paint: 'War paint', star: 'Star mark' };
const SEXES = { m: 'Male', f: 'Female' };
// Where the original model's head sat, measured once on the knight so both bodies get the same head.
let headRef = null;
function measureHead(root) {
  let head = null, bone = null;
  root.traverse((o) => { if (o.isSkinnedMesh && /_Head(_Hooded)?$/.test(o.name)) head = o; if (o.isBone && o.name === 'head') bone = o; });
  if (!head || !bone) return null;
  root.updateMatrixWorld(true);
  const inv = bone.matrixWorld.clone().invert(), v = new THREE.Vector3(), box = new THREE.Box3();
  const pos = head.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); head.applyBoneTransform(i, v); v.applyMatrix4(head.matrixWorld).applyMatrix4(inv); box.expandByPoint(v); }
  return box;
}
function headParts() {
  if (player.headInfo) return player.headInfo;
  let head = null, bone = null;
  player.root.traverse((o) => { if (o.isSkinnedMesh && /_Head(_Hooded)?$/.test(o.name)) head = o; if (o.isBone && o.name === 'head') bone = o; });
  if (!bone) return null;
  if (!headRef) {
    const tmp = SkeletonUtils.clone(G.knight.scene); tmp.scale.setScalar(1.3);
    headRef = measureHead(tmp) || new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.45), new THREE.Vector3(0.5, 1.1, 0.5));
  }
  player.headInfo = { head, bone, box: headRef };
  return player.headInfo;
}
const headGeo = (() => {
  const g = new THREE.SphereGeometry(1, 56, 40), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // soft jaw: narrower and a little forward toward the chin, flatter at the back
    if (v.y < 0) { const k = -v.y; v.x *= 1 - 0.2 * k * k; v.z *= 1 - 0.06 * k * k; if (v.z > 0) v.z += 0.07 * k * v.z; v.y *= 0.94; }
    if (v.z < 0) v.z *= 0.93;
    // round cheeks just below eye level
    const ch = Math.max(0, 1 - Math.abs(v.y + 0.3) * 3.2) * Math.max(0, v.z) * 0.05; v.x *= 1 + ch;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
})();
const earGeo = new THREE.ConeGeometry(0.13, 0.5, 10);
const humanEarGeo = new THREE.SphereGeometry(1, 12, 10);
const FW = 1024, FH = 512, FX = 256, EY = 268, ESEP = 80;
function shade(hex, k) { return `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`; }
function mixHex(a, b, t) { return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`; }
// One eye, centred at (x, y). side is -1 for the eye on the viewer's left, +1 for the right.
function drawEye(g, x, y, side, L, state) {
  const ink = '#2b160c', female = L.sex === 'f', col = (EYE_COLOURS[L.eyes] || EYE_COLOURS.brown)[1];
  const lidCol = shade((SKIN_TONES[L.skin] || SKIN_TONES.peach)[1], 0.86);
  g.save(); g.translate(x, y); g.scale(side, 1); // draw as the right eye; the outer corner is +x
  g.lineCap = 'round'; g.lineJoin = 'round';
  const lashFlicks = () => {
    if (!female) return;
    g.lineWidth = 5; g.beginPath(); g.moveTo(30, -26); g.quadraticCurveTo(42, -32, 48, -42); g.moveTo(35, -16); g.quadraticCurveTo(48, -18, 54, -26); g.stroke();
  };
  if (state === 'blink' || L.eyeStyle === 'happy') {
    g.strokeStyle = ink; g.lineWidth = 8; g.beginPath();
    if (state === 'blink') { g.moveTo(-32, 2); g.quadraticCurveTo(0, 18, 34, 0); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(34, 0); g.lineTo(42, -6); g.stroke(); }
    else { g.moveTo(-32, 10); g.quadraticCurveTo(0, -30, 34, 8); g.stroke(); }
    if (female) { g.lineWidth = 4.5; g.beginPath(); g.moveTo(30, state === 'blink' ? 2 : 0); g.lineTo(44, -10); g.stroke(); }
    g.restore(); return;
  }
  if (state === 'hurt') {
    g.strokeStyle = ink; g.lineWidth = 8; g.beginPath(); g.moveTo(26, -20); g.lineTo(-18, 0); g.lineTo(26, 18); g.stroke();
    g.restore(); return;
  }
  if (L.eyeStyle === 'classic') {
    g.fillStyle = ink; g.beginPath(); g.ellipse(0, 4, 15, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(-4, -6, 6, 0, Math.PI * 2); g.fill();
    if (female) { g.strokeStyle = ink; g.lineWidth = 4.5; g.beginPath(); g.moveTo(12, -14); g.lineTo(24, -24); g.stroke(); }
    g.restore(); return;
  }
  const rx = 33, ry = L.eyeStyle === 'sleepy' ? 38 : 44;
  // white of the eye
  g.save();
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#ffffff'; g.fillRect(-60, -60, 120, 120);
  // iris: dark at the top, the chosen colour in the middle, a bright glow at the bottom
  const ix = -3, iy = 6, irx = 25, iry = 34;
  const gr = g.createLinearGradient(0, iy - iry, 0, iy + iry);
  gr.addColorStop(0, shade(col, 0.35)); gr.addColorStop(0.45, col); gr.addColorStop(1, mixHex(col, '#ffffff', 0.55));
  g.fillStyle = gr; g.beginPath(); g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = shade(col, 0.3); g.lineWidth = 3; g.stroke();
  // pupil and a soft ring
  g.fillStyle = shade(col, 0.22); g.beginPath(); g.ellipse(ix, iy - 2, 12, 17, 0, 0, Math.PI * 2); g.fill();
  // sparkles
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(ix - 9, iy - 14, 9, 11, -0.3, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(ix + 10, iy + 16, 4.5, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.55; g.beginPath(); g.arc(ix + 12, iy - 6, 3, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  // shadow from the upper lid
  g.fillStyle = 'rgba(60,30,20,0.18)'; g.beginPath(); g.ellipse(0, -ry + 6, rx + 4, 14, 0, 0, Math.PI * 2); g.fill();
  // lids: determined eyes are cut by a slanted lid, sleepy ones are half closed
  g.fillStyle = lidCol;
  if (L.eyeStyle === 'sharp') { g.beginPath(); g.moveTo(-60, -60); g.lineTo(60, -60); g.lineTo(60, -34); g.lineTo(-60, -12); g.closePath(); g.fill(); }
  if (L.eyeStyle === 'sleepy') g.fillRect(-60, -60, 120, 52);
  g.restore();
  // upper lash line: thick, with a flick at the outer corner
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = female ? 9 : 8;
  g.beginPath();
  if (L.eyeStyle === 'sharp') { g.moveTo(-32, -10); g.lineTo(34, -34); g.lineTo(44, -38); }
  else if (L.eyeStyle === 'sleepy') { g.moveTo(-32, -8); g.quadraticCurveTo(0, -12, 34, -8); g.lineTo(42, -12); }
  else { g.ellipse(0, 0, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.93); g.lineTo(43, -26); }
  g.stroke();
  lashFlicks();
  // a short lower lash
  g.lineWidth = 3.5; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 0.22, Math.PI * 0.62); g.stroke();
  g.restore();
}
function drawBrow(g, x, y, side, L) {
  const hc = (HAIR_COLOURS[L.hairCol] || HAIR_COLOURS.chestnut)[1], female = L.sex === 'f';
  g.save(); g.translate(x, y); g.scale(side, 1);
  g.strokeStyle = shade(hc, 0.7); g.lineCap = 'round'; g.lineWidth = female ? 7 : 11;
  g.beginPath();
  if (L.eyeStyle === 'sharp') { g.moveTo(-28, 10); g.lineTo(34, -8); }
  else if (L.eyeStyle === 'sleepy') { g.moveTo(-28, 2); g.quadraticCurveTo(4, -6, 34, 4); }
  else if (female) { g.moveTo(-26, 4); g.quadraticCurveTo(6, -16, 36, 0); }
  else { g.moveTo(-28, 2); g.quadraticCurveTo(4, -10, 34, -2); }
  g.stroke(); g.restore();
}
function drawMouth(g, x, y, L, state) {
  const ink = '#4a1c12', skin = (SKIN_TONES[L.skin] || SKIN_TONES.peach)[1];
  g.save(); g.translate(x, y); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = ink; g.lineWidth = 5;
  const m = state === 'hurt' ? 'hurt' : L.mouth;
  if (m === 'hurt') { g.beginPath(); g.moveTo(-14, 4); g.lineTo(-7, -2); g.lineTo(0, 4); g.lineTo(7, -2); g.lineTo(14, 4); g.stroke(); }
  else if (m === 'grin') {
    g.fillStyle = '#7a2a22'; g.beginPath(); g.moveTo(-16, -4); g.quadraticCurveTo(0, -1, 16, -4); g.quadraticCurveTo(14, 18, 0, 19); g.quadraticCurveTo(-14, 18, -16, -4); g.closePath(); g.fill();
    g.fillStyle = '#ff8f8f'; g.beginPath(); g.ellipse(0, 13, 8, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(-12, -3, 24, 5);
    g.beginPath(); g.moveTo(-16, -4); g.quadraticCurveTo(0, -1, 16, -4); g.quadraticCurveTo(14, 18, 0, 19); g.quadraticCurveTo(-14, 18, -16, -4); g.stroke();
  } else if (m === 'calm') { g.beginPath(); g.moveTo(-9, 2); g.quadraticCurveTo(0, 4, 9, 2); g.stroke(); }
  else if (m === 'cat') { g.beginPath(); g.moveTo(-16, -2); g.quadraticCurveTo(-8, 10, 0, 0); g.quadraticCurveTo(8, 10, 16, -2); g.stroke(); }
  else if (m === 'pout') { g.fillStyle = shade(skin, 0.7); g.beginPath(); g.ellipse(0, 3, 6, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else {
    g.beginPath(); g.moveTo(-14, -2); g.quadraticCurveTo(0, 12, 14, -2); g.stroke();
    if (m === 'fang') { g.fillStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(4, 3.5); g.lineTo(10, 2); g.lineTo(8, 11); g.closePath(); g.fill(); g.stroke(); }
  }
  g.restore();
}
function paintFace(g, L, state) {
  const skin = (SKIN_TONES[L.skin] || SKIN_TONES.peach)[1];
  g.fillStyle = skin; g.fillRect(0, 0, FW, FH);
  // a gentle darker band low on the back of the head so the toon light reads as roundness
  // cheeks
  const blush = L.mark === 'rosy' ? 0.55 : 0.28;
  for (const s of [-1, 1]) {
    const cx = FX + s * 112, cy = EY + 56, rg = g.createRadialGradient(cx, cy, 2, cx, cy, 40);
    rg.addColorStop(0, `rgba(255,110,120,${blush})`); rg.addColorStop(1, 'rgba(255,110,120,0)');
    g.fillStyle = rg; g.fillRect(cx - 44, cy - 44, 88, 88);
    if (L.mark === 'rosy') { g.strokeStyle = 'rgba(220,70,90,0.6)'; g.lineWidth = 3; g.lineCap = 'round'; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(cx + i * 11 - 4, cy + 5); g.lineTo(cx + i * 11 + 4, cy - 5); g.stroke(); } }
  }
  // little nose
  g.fillStyle = shade(skin, 0.78); g.beginPath(); g.ellipse(FX + 2, EY + 46, 5, 3.5, 0, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) { drawEye(g, FX + s * ESEP, EY, s, L, state); drawBrow(g, FX + s * (ESEP - 4), EY - 62, s, L); }
  drawMouth(g, FX, EY + 82, L, state);
  if (L.mark === 'freckles') { g.fillStyle = shade(skin, 0.68); for (const [dx, dy] of [[-120, 44], [-104, 56], [-92, 42], [-112, 66], [92, 42], [104, 56], [120, 44], [112, 66], [-12, 40], [14, 40]]) { g.beginPath(); g.arc(FX + dx, EY + dy, 3.5, 0, Math.PI * 2); g.fill(); } }
  if (L.mark === 'scar') { g.strokeStyle = shade(skin, 0.62); g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(FX - 44, EY + 18); g.lineTo(FX + 36, EY + 58); g.stroke(); g.strokeStyle = '#ffd9cc'; g.lineWidth = 2; g.stroke(); }
  if (L.mark === 'paint') { g.fillStyle = '#d9483b'; for (const s of [-1, 1]) for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(FX + s * 54, EY + 44 + i * 14); g.lineTo(FX + s * 112, EY + 36 + i * 14); g.lineTo(FX + s * 110, EY + 44 + i * 14); g.lineTo(FX + s * 56, EY + 52 + i * 14); g.closePath(); g.fill(); } }
  if (L.mark === 'star') { g.fillStyle = '#ffd34a'; g.strokeStyle = '#b8742a'; g.lineWidth = 2.5; const cx = FX + 118, cy = EY + 40; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }
}
const faceTexCache = new Map();
function faceTexture(L, state) {
  const key = [L.sex, L.skin, L.eyes, L.eyeStyle, L.mouth, L.mark, L.hairCol, state].join('|');
  if (faceTexCache.has(key)) return faceTexCache.get(key);
  if (faceTexCache.size > 24) { for (const t of faceTexCache.values()) t.dispose(); faceTexCache.clear(); }
  const cv = document.createElement('canvas'); cv.width = FW; cv.height = FH;
  paintFace(cv.getContext('2d'), L, state);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  faceTexCache.set(key, t);
  return t;
}
// A small picture of part of a face, for the buttons in the hero creator.
let previewCv = null;
function facePreview(L, part) {
  if (!previewCv) { previewCv = document.createElement('canvas'); previewCv.width = FW; previewCv.height = FH; }
  paintFace(previewCv.getContext('2d'), L, 'open');
  const crop = part === 'mouth' ? [FX - 60, EY + 50, 120, 70] : part === 'mark' ? [FX - 150, EY - 30, 300, 140] : [FX - 130, EY - 90, 260, 150];
  const out = document.createElement('canvas'); out.width = 160; out.height = Math.round(160 * crop[3] / crop[2]);
  out.getContext('2d').drawImage(previewCv, crop[0], crop[1], crop[2], crop[3], 0, 0, out.width, out.height);
  return out.toDataURL();
}
function buildFace() {
  const H = headParts();
  if (!H) return;
  const L = S.look;
  if (H.head) { H.head.visible = false; }
  if (player.faceGroup) { player.faceGroup.removeFromParent(); player.faceGroup.traverse((o) => { if (o.material && o.material.dispose && !o.userData.keepMat) o.material.dispose(); }); }
  const fg = new THREE.Group(); player.faceGroup = fg; H.bone.add(fg);
  const box = H.box, c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const rx = sz.x * 0.5, ry = sz.y * 0.47, rz = sz.z * 0.5;
  const mats = toon('#f6f2f0');
  mats.toon.onBeforeCompile = () => {};
  mats.std.map = faceTexture(L, 'open'); mats.toon.map = mats.std.map;
  for (const mat of [mats.std, mats.toon]) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp; }
  const head = new THREE.Mesh(headGeo); registerMesh(head, mats); head.castShadow = true;
  head.scale.set(rx, ry, rz); head.position.set(c.x, c.y + sz.y * 0.02, c.z);
  // the sphere's u = 0.25 column, where the face is painted, already points forward (+z)
  fg.add(head);
  player.faceMats = mats; player.faceState = 'open';
  const skinMat = toon(SKIN_TONES[L.skin][1]);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(L.ears === 'elf' ? earGeo : humanEarGeo); registerMesh(e, skinMat); e.castShadow = true;
    if (L.ears === 'elf') { e.position.set(sx * (rx + 0.1), c.y - ry * 0.02, c.z - rz * 0.08); e.rotation.set(-0.3, 0, -sx * 1.12); e.scale.set(1, 1, 0.6); }
    else { e.position.set(sx * rx * 0.97, c.y - ry * 0.08, c.z - rz * 0.06); e.scale.set(rx * 0.13, ry * 0.2, rz * 0.15); }
    fg.add(e);
  }
  player.headScale = HEAD_SIZES[L.head] ? HEAD_SIZES[L.head][1] : 1;
}
// Blink every few seconds; wince for a moment when hurt.
function faceTick() {
  if (!player || !player.faceMats) return;
  let st = 'open';
  if (player.dead || now < (player.hurtFace || 0)) st = 'hurt';
  else if (now < (player.blinkUntil || 0)) st = 'blink';
  else if (now > (player.blinkAt || 0)) { player.blinkUntil = now + 0.14; player.blinkAt = now + 2.2 + Math.random() * 3.5; st = 'blink'; }
  if (st !== player.faceState) {
    player.faceState = st;
    const t = faceTexture(S.look, st);
    player.faceMats.std.map = t; player.faceMats.toon.map = t;
  }
}
function applyLook() {
  if (!player) return;
  const L = S.look;
  for (const g of hairCache.values()) g.removeFromParent();
  const hc = HAIR_COLOURS[L.hairCol] || HAIR_COLOURS.chestnut;
  // a touch darker than the swatch so sunlight doesn't bleach the top of the hair
  const hcol = new THREE.Color(hc[1]).multiplyScalar(0.72);
  hairMats.std.color.copy(hcol); hairMats.toon.color.copy(hcol);
  const showHair = L.hair !== 'none' && !L.hat;
  const arm = ARMOUR[S.equip.armour] || ARMOUR.ar_cloth;
  if (showHair) { let head; player.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; }); if (head) head.add(hairGroup(L.hair, L.hairLen)); }
  buildFace();
  player.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats) return;
    const n = o.name;
    const isCape = /_Cape$/.test(n), isBody = /_Body$/.test(n), isHat = /_(Helmet|Hat)$/.test(n), isLimb = /_(ArmLeft|ArmRight|LegLeft|LegRight)$/.test(n);
    if (isHat) o.visible = L.hat;
    if (isCape) o.visible = L.cape;
    if (isCape || isBody || isLimb) {
      if (!o.userData.ownMats) {
        o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
        o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
        o.userData.mats = o.userData.ownMats;
        o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std;
      }
      const key = isCape ? L.trim : L.outfit, col = isLimb ? arm.tint || '#ffffff' : LOOK_COLOURS[key][1];
      const amt = isLimb || key === 'none' ? 0 : isCape ? 1 : 0.75;
      for (const mat of [o.userData.mats.std, o.userData.mats.toon]) { colourise(mat, amt); mat.color.set(amt ? mixHex(col, '#ffffff', 0.12) : col); }
    }
  });
}
function colourise(mat, amt) {
  if (!mat.userData.colourise) {
    mat.userData.colourise = { value: amt };
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.colourise = mat.userData.colourise;
      sh.fragmentShader = 'uniform float colourise;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor *= vec4(mix(texel.rgb, vec3(min(1.0, 0.35 + lum * 1.25)), colourise), texel.a);
        #endif`);
    };
    mat.customProgramCacheKey = () => 'colourise';
    mat.needsUpdate = true;
  }
  mat.userData.colourise.value = amt;
}
function tinted(obj, col) {
  obj.traverse((o) => {
    if (!o.isMesh || !o.userData.mats) return;
    const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
    m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
    m.std.color.set(col); m.toon.color.set(col); registerMesh(o, m);
  });
  return obj;
}
// Put the equipped weapon in the right hand, the shield in the left, and tint the armour.
function handSlot(side) { let s = null; player.root.traverse((o) => { if (!s && new RegExp(`handslot${side}$`, 'i').test(o.name)) s = o; }); return s; }
function equipGear() {
  if (!player) return;
  const w = W(), sh = ARMOUR[S.equip.shield] || ARMOUR.sh_badge;
  for (const m of player.customs || []) m.removeFromParent();
  player.customs = []; player.weapons = [];
  const hold = (item, base, side) => {
    if (base) base.visible = !item.model;
    if (!item.model) { if (base) player.weapons.push(base); return; }
    if (!lib[item.model]) return;
    const m = lib[item.model].clone(true); stylize(m);
    if (item.tint) tinted(m, item.tint);
    addSilhouette(m, '#ffe9a0');
    const slot = handSlot(side);
    if (slot) slot.add(m);
    player.customs.push(m); player.weapons.push(m);
  };
  hold(w, player.base.weapon, 'r');
  hold(sh, player.base.shield, 'l');
  for (const g of player.weapons) g.visible = !player.task;
  // the ground wedge shows how far your weapon reaches
  arcMesh.scale.setScalar(w.type === 'melee' ? (w.reach + 0.6) / (MELEE_REACH + 0.6) : 1);
  applyLook();
}
function buildGearBar() {
  const w = W(), free = freePoints();
  $('classes').innerHTML = `<div class="classchip"><img src="${ICONS[w.type]}" alt="">${w.name}<small>${STYLE_NAME[w.type]}</small></div>`
    + (free > 0 ? `<button id="spendpts" class="spend"><img src="${ICONS.star}" alt="">${free} stat point${free > 1 ? 's' : ''} to spend</button>` : '');
  if (free > 0) $('spendpts').onclick = () => openSheet('skills');
}
function updateTitle() {
  $('pname').textContent = heroName();
  $('pclass').textContent = `Level ${heroLvl()} · ${stat('atk')} atk · ${totalDef()} def`;
  $('badgeicon').src = ICONS[W().type];
  $('badgelvl').textContent = heroLvl();
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
  for (let i = 0; i < 80 && nodes.length < 18; i++) { const a = rng() * Math.PI * 2, r = 18 + rng() * 24; addTree(Math.cos(a) * r, Math.sin(a) * r, 'tree'); }
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
    { id: 'bertha', name: 'Bertha the Innkeeper', model: 'barbarian', x: -7.2 * VS, z: -11 * VS, hide: [] },
    { id: 'rowan', name: 'Captain Rowan', model: 'knight', x: 12 * VS, z: -18 * VS, hide: [] },
    { id: 'fenwick', name: 'Old Fenwick', model: 'mage', x: 15 * VS, z: -4.5 * VS, hide: [] },
    { id: 'marta', name: 'Marta the Baker', model: 'barbarian', x: 7.5 * VS, z: 10.2 * VS, hide: [], shop: 'food', tint: '#bfe3ff' },
    { id: 'brom', name: 'Brom the Blacksmith', model: 'barbarian', x: 5.5 * VS, z: -19.8 * VS, hide: [], shop: 'melee', tint: '#ffb38a' },
    { id: 'wisteria', name: 'Madame Wisteria', model: 'mage', x: 18.4 * VS, z: -21.6 * VS, hide: [], shop: 'magic', tint: '#f0b0ff' },
    { id: 'hazel', name: 'Hazel the Fletcher', model: 'archer', x: -22 * VS, z: 10.5 * VS, hide: [], shop: 'ranged', tint: '#d8f0a0' },
    { id: 'king', name: 'King Jerrold', model: 'knight', x: INTERIORS.castle.king.x, z: INTERIORS.castle.king.z, hide: ['Knight_Helmet'], king: true, tint: '#b98cff', inside: 'castle' },
    ...INTERIORS.castle.guards.map(([x, z], i) => ({ id: `guard${i}`, name: 'Royal Guard', model: 'knight', x, z, hide: [], inside: 'castle', tint: '#8fb8ff',
      lines: ['Long live King Jerrold!', 'The King grants a new calling to any hero who asks.', 'Mind the carpet. The King had it cleaned this morning.'] })),
    { id: 'giles', name: 'Farmer Giles', model: 'barbarian', x: ZONES.meadow.x + 3, z: ZONES.meadow.z + 5, hide: [], tint: '#d8c070' },
    { id: 'pip', name: 'Granny Pip', model: 'mage', x: ZONES.meadow.x - 6, z: ZONES.meadow.z + 1, hide: [], tint: '#ffc0d8',
      lines: ['Back in my day, skeletons said please before they stabbed you.', 'Have you tried my apple pie? Marta in the village sells it. I taught her!', 'The windmill squeaks a little song at night. Listen closely.'] },
    { id: 'crier', name: 'Bertram the Town Crier', model: 'knight', x: -6 * VS, z: 5 * VS, hide: ['Knight_Helmet'], tint: '#ffd08a',
      lines: ['Hear ye! Four lands lie beyond the woods: Glimmerwood to the east, Grumble Crags to the west, Honeymeadow to the south and Haunted Hollow to the north!', 'Hear ye! Each land has a fearsome boss. Watch for the red glow on the ground and get out of the way!', 'Hear ye! Hold Shift to sprint, press Z or C (or tap A or D twice) to dash, R for your special attack, and M for the map. Hear ye!', 'Hear ye! Coins in the bank are safe. Coins in your pocket? Half of them fall out when you get knocked out!'] },
    { id: 'lumi', name: 'Lumi the Wisp-keeper', model: 'mage', x: ZONES.glimmer.x - 14, z: ZONES.glimmer.z + 4, hide: [], tint: '#9ff0ff',
      lines: ['The Gloomcaster stole the colour from half my mushrooms. The rest glow twice as bright out of spite!', 'Glimmerwood hums at night. Can you hear it? No? Try humming back.'] },
    { id: 'dot', name: 'Prospector Dot', model: 'archer', x: ZONES.crags.x + 15, z: ZONES.crags.z + 4, hide: [], tint: '#e8b080',
      lines: ['Bonecrusher sleeps in the middle of the Crags. Well, "sleeps". Mostly he stomps.', 'When the ground glows red, jump! I learned that one the hard way. Twice.'] },
    { id: 'mort', name: 'Gravekeeper Mort', model: 'barbarian', x: ZONES.hollow.x + 12, z: ZONES.hollow.z + 12, hide: [], tint: '#a8a8c0',
      lines: ['Captain Rattlebones keeps getting up. I keep putting him down. It is a living. Well. Sort of.', 'Do not mind the gravestones. Most of them are empty. Most.'] },
    { id: 'penny', name: 'Penny the Banker', model: 'mage', x: -3 * VS, z: 13.5 * VS, hide: [], bank: true, tint: '#ffe08a' },
    { id: 'tom', name: 'Old Tom the Barkeep', model: 'barbarian', x: INTERIORS.tavern.barkeep.x, z: INTERIORS.tavern.barkeep.z, hide: [], shop: 'food', tint: '#e8c89a', inside: 'tavern', face: 'south' },
  ];
  for (const d of defs) {
    const a = new Actor(G[d.model], { hide: d.hide, scale: 1.3 });
    a.root.position.set(d.x, 0, d.z);
    if (d.inside) a.root.rotation.y = 0; else a.face(0, 0);
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
function spawnEnemy(k, x, z) {
  const T = ENEMY_TYPES[k];
  const e = new Actor(G[T.model || k], { scale: T.scale || 1.3 });
  if (T.weapon) { const w = lib[T.weapon].clone(true); stylize(w); e.attach(w); }
  if (T.dragon) e.alias = { Idle: 'Flying_Idle', Idle_Combat: 'Flying_Idle', Running_A: 'Fast_Flying', Walking_A: 'Flying_Idle', Hit_A: 'HitReact', Death_A: 'Death', '1H_Melee_Attack_Chop': 'Headbutt', Spellcast_Shoot: 'Punch', Spellcasting: 'Yes', '2H_Melee_Attack_Chop': 'Punch' };
  e.inside = T.inside || 'out';
  e.type = k; e.T = T; e.home = new THREE.Vector2(x, z);
  e.root.position.set(x, 0, z); e.root.rotation.y = rng() * 6;
  e.hp = T.hp; e.state = 'idle'; e.timer = rng() * 3; e.target = new THREE.Vector2(); e.nextHit = 0; e.swings = 0;
  e.play('Idle');
  if (T.boss) e.root.traverse((o) => { if (o.isMesh && /Body|Head/.test(o.name)) tinted(o, k === 'boss_gloom' ? '#c8a8ff' : k === 'boss_crusher' ? '#ffd0a0' : '#c0ffc8'); });
  if (T.boss) addSilhouette(e.root, '#ff8a9a');
  if (!T.boss) { const bar = document.createElement('div'); bar.className = 'hpbar'; bar.hidden = true; bar.innerHTML = '<i></i>'; document.body.appendChild(bar); e.bar = bar; }
  else e.bar = { hidden: true, style: {}, firstChild: { style: {} } };
  enemies.push(e);
}
function buildEnemies() {
  for (const [k, dx, dz] of [['skel_warrior', -3, -4], ['skel_minion', -6, 3], ['skel_mage', 2, 6], ['skel_minion', 5, -1], ['skel_minion', -1, 9]]) spawnEnemy(k, CAMP.x + dx, CAMP.z + dz);
  const ring = (Z, list, r) => list.forEach((k, i) => { const a = (i / list.length) * Math.PI * 2 + 0.4; spawnEnemy(k, Z.x + Math.cos(a) * r, Z.z + Math.sin(a) * r); });
  ring(ZONES.crags, ['skel_warrior', 'skel_minion', 'skel_warrior', 'skel_minion'], 16);
  ring(ZONES.glimmer, ['skel_mage', 'skel_minion', 'skel_mage', 'skel_mage'], 17);
  ring(ZONES.hollow, ['skel_minion', 'skel_warrior', 'skel_minion', 'skel_mage', 'skel_minion'], 14);
  spawnEnemy('boss_crusher', ZONES.crags.x, ZONES.crags.z);
  spawnEnemy('boss_gloom', ZONES.glimmer.x + 4, ZONES.glimmer.z);
  spawnEnemy('boss_rattle', ZONES.hollow.x, ZONES.hollow.z + 2);
  spawnEnemy('boss_gagron', INTERIORS.cave.lair.x, INTERIORS.cave.lair.z);
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
    if (skill !== 'speed' || after % 5 === 0) { const el = $('banner'); el.textContent = `Level up! ${SKILL_NAME[skill]} ${after}`; el.classList.add('lvl'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); zoneNow = null; setTimeout(() => el.classList.remove('lvl'), 3300); }
    burst(player.pos.clone().setY(1.5), '#ffd23f', 50, 7, 1.4);
    if (!player.task && now > player.busyUntil && !player.dead) { player.play('Cheer', { once: true, onFinish: () => player.play('Idle') }); player.busyUntil = now + 1.2; }
    updateTitle();
    refreshUI();
  }
  // gathering also trains the hero a little (bosses and quests give the most)
  if (skill !== 'speed' && amount > 0) giveHeroXp(Math.max(1, Math.round(amount * GATHER_HERO_XP)));
  else if (!$('sheet').hidden && sheetMode === 'skills' && skill !== 'speed') renderSheet();
}
function giveHeroXp(amount, at) {
  const before = heroLvl();
  S.hero.xp += amount;
  const after = heroLvl();
  if (at) floatText(at, `+${Math.round(amount)} XP`, 'gain');
  if (after > before) {
    const n = after - before;
    S.hp = maxHp();
    toast(`Hero level ${after}! +${n} Attack, Defense and Health, and ${n * FREE_PER_LEVEL} points to spend.`, ICONS.star, true);
    const el = $('banner'); el.textContent = `Level up! Hero ${after}`; el.classList.add('lvl'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); zoneNow = null; setTimeout(() => el.classList.remove('lvl'), 3300);
    burst(player.pos.clone().setY(1.5), '#ffd23f', 60, 7, 1.5);
    if (!player.task && now > player.busyUntil && !player.dead) { player.play('Cheer', { once: true, onFinish: () => player.play('Idle') }); player.busyUntil = now + 1.2; }
    buildGearBar();
  }
  updateTitle(); refreshUI();
  if (!$('sheet').hidden && sheetMode === 'skills') renderSheet();
}
function spendPoint(k) {
  if (freePoints() <= 0) return;
  const before = maxHp();
  S.hero.alloc[k]++;
  if (k === 'hp') S.hp += maxHp() - before;
  burst(player.pos.clone().setY(1.6), k === 'hp' ? '#ff7a8a' : k === 'def' ? '#8fc2ff' : '#ffd84a', 16, 4);
  updateTitle(); buildGearBar(); refreshUI(); save(); renderSheet();
}
function questReady(id) {
  const q = QUESTS[id], st = S.quests[id];
  if (st.state !== 'active') return false;
  return Object.entries(q.need).every(([k, n]) => (k === 'kills' ? st.kills : k === 'boss' ? (st.boss || 0) : (S.inv[k] || 0)) >= n);
}
function questProgress(id) {
  const q = QUESTS[id], st = S.quests[id];
  return Object.entries(q.need).map(([k, n]) => {
    const have = Math.min(n, k === 'kills' ? st.kills : k === 'boss' ? (st.boss || 0) : (S.inv[k] || 0));
    return `${k === 'kills' ? 'Skeletons' : k === 'boss' ? ENEMY_TYPES[q.bossType].name : ITEMS[k]} ${have}/${n}`;
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
function bossUi() {
  if (!player) return;
  const b = $('sheet').hidden ? enemies.find((e) => e.T.boss && e.inside === where && e.hp > 0 && (e.state === 'chase' || e.state === 'slam') && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 32) : null;
  const bar = $('bossbar');
  bar.hidden = !b;
  if (b) { $('bossname').textContent = b.T.name; $('bossfill').style.width = `${(b.hp / b.T.hp) * 100}%`; }
}
let zoneNow = null;
function zoneBanner() {
  if (!player || where !== 'out') return;
  const z = Object.values(ZONES).find((Z) => Math.hypot(player.pos.x - Z.x, player.pos.z - Z.z) < Z.r + 4);
  const name = z ? z.name : Math.hypot(player.pos.x, player.pos.z) < 46 ? 'Jerry Village' : Math.hypot(player.pos.x - 4, player.pos.z + 64) < 28 ? 'Castle grounds' : null;
  if (name && name !== zoneNow) {
    const el = $('banner'); el.textContent = name; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  zoneNow = name;
}
// ---------- bone piles ----------
// A beaten skeleton falls apart into a little heap of bones, and its skull bounces off the top.
// When it comes back, the heap rattles and the bones pull themselves together.
const boneMat = toon('#f1e8d4'), socketMat = toon('#3a2a2a');
const boneGeo = { shaft: new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), knob: new THREE.SphereGeometry(0.11, 8, 6),
  skull: new THREE.SphereGeometry(0.3, 14, 10), jaw: new THREE.BoxGeometry(0.34, 0.14, 0.26), eye: new THREE.SphereGeometry(0.075, 8, 6) };
const boneMesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo); m.position.set(x, y, z); m.castShadow = true; registerMesh(m, mat); return m; };
function makeBone() {
  const g = new THREE.Group();
  g.add(boneMesh(boneGeo.shaft, boneMat, 0, 0, 0));
  for (const y of [-0.35, 0.35]) for (const x of [-0.06, 0.06]) g.add(boneMesh(boneGeo.knob, boneMat, x, y, 0));
  return g;
}
function makeSkull() {
  const g = new THREE.Group();
  g.add(boneMesh(boneGeo.skull, boneMat, 0, 0.3, 0));
  g.add(boneMesh(boneGeo.jaw, boneMat, 0, 0.08, 0.1));
  for (const x of [-0.11, 0.11]) g.add(boneMesh(boneGeo.eye, socketMat, x, 0.34, 0.24));
  return g;
}
const piles = [];
function collapse(e) {
  const g = new THREE.Group(), s = e.T.boss ? 2.2 : 1.3;
  for (let i = 0; i < 6; i++) {
    const b = makeBone(); const a = (i / 6) * Math.PI * 2 + rng();
    b.position.set(Math.cos(a) * 0.35 * rng(), 0.08 + (i % 3) * 0.1, Math.sin(a) * 0.35 * rng());
    b.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 6, (rng() - 0.5) * 0.4);
    b.userData.rest = b.position.clone();
    g.add(b);
  }
  const skull = makeSkull(); skull.position.set(0, 0.3, 0); g.add(skull);
  g.position.set(e.pos.x, 0, e.pos.z); g.scale.setScalar(s); g.rotation.y = rng() * 6;
  scene.add(g);
  e.root.visible = false;
  burst(e.pos.clone().setY(0.8), '#f1e8d4', 18, 4, 1.1);
  e.pile = { g, skull, vy: 6, sx: (rng() - 0.5) * 2.2, sz: (rng() - 0.5) * 2.2, rattle: 0 };
  piles.push(e.pile);
}
function reassemble(e) {
  const P = e.pile;
  if (!P) { e.root.position.set(e.home.x, 0, e.home.y); e.root.visible = true; return; }
  P.rattle = 0.9;
  e.root.position.set(P.g.position.x, 0, P.g.position.z);
  later(0.9, () => {
    scene.remove(P.g); piles.splice(piles.indexOf(P), 1); e.pile = null;
    e.root.visible = true;
  });
}
function pileTick(dt) {
  for (const P of piles) {
    const k = P.skull.position;
    if (P.vy !== null) {
      // the skull hops off the heap, bounces, and settles beside it
      P.vy -= 22 * dt; k.y += P.vy * dt; k.x += P.sx * dt; k.z += P.sz * dt; P.skull.rotation.x += P.sx * dt * 3;
      if (k.y < 0.02) { k.y = 0.02; if (Math.abs(P.vy) < 2) { P.vy = null; P.skull.rotation.x = 0; } else { P.vy = -P.vy * 0.45; P.sx *= 0.6; P.sz *= 0.6; } }
    }
    if (P.rattle > 0) {
      P.rattle -= dt;
      const t = 1 - Math.max(0, P.rattle) / 0.9;
      for (const b of P.g.children) {
        if (b === P.skull) { k.lerp(new THREE.Vector3(0, 0.3 + t * 1.2, 0), t); continue; }
        b.position.copy(b.userData.rest).add(new THREE.Vector3((rng() - 0.5) * 0.12, t * 0.9 + (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12));
      }
    }
  }
}
// ---------- loot ----------
const lootPops = [];
const iconTex = {};
// A little item picture pops out of a beaten monster and floats up, so you can see what dropped.
function popLoot(pos, item, delay = 0) {
  later(delay, () => {
    if (!iconTex[item]) { const t = new THREE.TextureLoader().load(ICONS[item]); t.colorSpace = THREE.SRGBColorSpace; iconTex[item] = t; }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex[item], depthTest: false, fog: false, transparent: true }));
    sp.scale.setScalar(1.3); sp.layers.set(1); sp.renderOrder = 6;
    sp.position.copy(pos).add(new THREE.Vector3((rng() - 0.5) * 1.5, 1.6, (rng() - 0.5) * 1.5));
    scene.add(sp); lootPops.push({ sp, t: 0 });
  });
}
function rollLoot(e) {
  const at = e.pos.clone(), got = [];
  const give = (k, n = 1) => { addItem(k, n); got.push(n > 1 ? `${n} × ${ITEMS[k].toLowerCase()}` : ITEMS[k].toLowerCase()); popLoot(at, k, got.length * 0.15); };
  if (e.T.boss) {
    give('dark_essence', 3);
    if (rng() < 0.4) give('ruby');
    if (rng() < 0.12) { give('golden_crown'); toast('A tiny golden crown! Marta will pay a fortune for that.', ICONS.golden_crown, true); }
    const wk = BOSS_WEAPON[e.type];
    if (wk && !S.owned.includes(wk) && rng() < 0.35) { S.owned.push(wk); popLoot(at, 'chest', 0.6); toast(`RARE DROP: ${WEAPONS[wk].name} (${gearStats(WEAPONS[wk])})! Equip it from your bag.`, ICONS[WEAPONS[wk].type], true); }
  } else {
    if (rng() < 0.5) give('bone_dust');
    if (rng() < (e.type === 'skel_minion' ? 0.08 : 0.15)) give('dark_essence');
    if (rng() < 0.1) give(['bread', 'pie'][rng() < 0.7 ? 0 : 1]);
    // treasures: rare, and worth selling
    if (rng() < (e.type === 'skel_minion' ? 0.03 : 0.06)) give('silver_ring');
    if (rng() < (e.type === 'skel_minion' ? 0.006 : 0.015)) { give('ruby'); toast('A ruby! That will sell for a lot.', ICONS.ruby, true); }
    // very rare: a shop weapon you don't own yet
    if (rng() < 0.025) {
      const pool = Object.keys(GEAR).filter((k) => !GEAR[k].unique && GEAR[k].price > 0 && GEAR[k].price <= 160 && !S.owned.includes(k));
      if (pool.length) { const wk = pool[Math.floor(rng() * pool.length)]; S.owned.push(wk); popLoot(at, 'chest', 0.4); toast(`Rare drop: ${GEAR[wk].name}! Equip it from your bag.`, gearIcon(GEAR[wk]), true); }
    }
  }
  if (got.length) floatText(at.clone().setY(3), got.join(', '), 'gain');
}
// ---------- treasure chests (open one and spin your luck!) ----------
const chests = [];
const CHEST_SPOTS = [[6 * VS, 26 * VS], [-30 * VS, 22 * VS], [36 * VS, -26 * VS], [-12 * VS, -38 * VS], [ZONES.glimmer.x + 10, ZONES.glimmer.z - 12], [ZONES.crags.x - 8, ZONES.crags.z + 14],
  [ZONES.meadow.x - 16, ZONES.meadow.z + 12], [ZONES.hollow.x - 14, ZONES.hollow.z - 6], [70, 60], [-64, 70], [-70, -60], [66, -66]];
function buildChests() {
  for (const [x, z] of CHEST_SPOTS) {
    const m = lib.chest_gold.clone(true); stylize(m); m.position.set(x, 0, z); m.scale.setScalar(1.3); m.rotation.y = rng() * 6; scene.add(m);
    const glow = new THREE.PointLight('#ffd86b', 6, 6, 1.6); glow.position.set(x, 1.6, z); scene.add(glow);
    chests.push({ x, z, m, glow, reach: 2.6, open: false, at: 0 });
    colliders.push({ x, z, r: 0.9 });
  }
}
const LUCK = [
  [40, 'coins', () => { const c = 15 + Math.floor(rng() * 50); S.coins += c; return [`${c} coins!`, ICONS.coins]; }],
  [22, 'food', () => { const k = ['bread', 'pie', 'stew'][Math.floor(rng() * 3)]; addItem(k, 2); return [`2 × ${ITEMS[k].toLowerCase()}!`, ICONS[k]]; }],
  [18, 'xp', () => { if (rng() < 0.5) { giveHeroXp(150); return ['150 hero XP!', ICONS.star]; } const sk = SKILLS[Math.floor(rng() * 3)][0]; giveXp(sk, 150); return [`150 ${SKILL_NAME[sk]} XP!`, ICONS[sk]]; }],
  [8, 'jackpot', () => { S.coins += 150; burst(player.pos.clone().setY(2), '#ffe07a', 90, 9, 1.6); return ['JACKPOT! 150 coins!', ICONS.coins]; }],
  [12, 'prank', () => { player.air = true; player.vy = 18; hurtPlayer(3); burst(player.pos.clone().setY(1), '#ff9af0', 60, 6, 1.2); return ['Boing! A spring-loaded prank!', ICONS.chest]; }],
];
function openChest(c) {
  if (c.open) return;
  c.open = true; c.at = now + 180; c.m.visible = false; c.glow.visible = false;
  burst(new THREE.Vector3(c.x, 1.2, c.z), '#ffe07a', 40, 6, 1.4);
  let r = rng() * LUCK.reduce((a, l) => a + l[0], 0), pick = LUCK[0];
  for (const l of LUCK) { if ((r -= l[0]) <= 0) { pick = l; break; } }
  const [text, icon] = pick[2]();
  toast(`Treasure: ${text}`, icon, true);
  const el = $('banner'); el.textContent = pick[1] === 'prank' ? 'Prank!' : pick[1] === 'jackpot' ? 'Jackpot!' : 'Treasure!';
  el.classList.add('lvl'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); setTimeout(() => el.classList.remove('lvl'), 3300);
  refreshUI(); save();
}
// ---------- doors ----------
let where = 'out', fading = false;
function buildDoors() {
  const geo = new THREE.RingGeometry(0.9, 1.25, 32);
  const ring = (x, z) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.1, z); m.layers.set(1); scene.add(m); doorRings.push(m);
  };
  for (const I of Object.values(INTERIORS)) { ring(I.outside.x, I.outside.z); ring(I.room.door.x, I.room.door.z - 0.6); }
}
const doorRings = [];
function goThrough(to) {
  fading = true; held = false; mouseHeld = false; moveTarget = null; pending = null; marker.visible = false; cancelTask(); closeDialog();
  $('fade').classList.add('on');
  setTimeout(() => {
    const pp = player.pos;
    if (to === 'out') {
      const I = INTERIORS[where];
      pp.set(I.exitTo.x, 0, I.exitTo.z); player.root.rotation.y = 0;
    } else {
      const I = INTERIORS[to];
      pp.set(I.room.door.x, 0, I.room.door.z - 3); player.root.rotation.y = Math.PI;
      toast(I.name, null);
    }
    where = to;
    camPos.copy(pp).setY(0).add(new THREE.Vector3(0, 23, 27).multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1)));
    $('fade').classList.remove('on');
    setTimeout(() => { fading = false; }, 250);
  }, 320);
}
function checkDoors() {
  if (fading || !player || player.dead) return;
  const pp = player.pos;
  if (where === 'out') {
    for (const [id, I] of Object.entries(INTERIORS)) if (Math.hypot(pp.x - I.outside.x, pp.z - I.outside.z) < 1.3) { goThrough(id); return; }
  } else {
    const d = INTERIORS[where].room.door;
    if (pp.z > d.z && Math.abs(pp.x - d.x) < 2.6) goThrough('out');
  }
}
function refreshUI() {
  if (!S.started) return;
  const mh = maxHp();
  $('hpfill').style.width = `${Math.max(0, (S.hp / mh) * 100)}%`;
  $('hptext').textContent = `${Math.max(0, Math.ceil(S.hp))} / ${mh}`;
  $('coinval').textContent = S.coins;
  const active = Object.keys(QUESTS).filter((k) => S.quests[k].state === 'active');
  $('tracker').innerHTML = active.map((k) => `<div><b>${QUESTS[k].name}</b><br>${questReady(k) ? `Return to ${npcName(QUESTS[k].giver)}` : questProgress(k)}</div>`).join('');
  for (const n of npcs) {
    if (n.shop || n.bank) { n.marker.userData.draw('$'); continue; }
    if (n.king) { const st = storyStep(); n.marker.userData.draw(st.some(questReady) ? '?' : st.some((q) => S.quests[q].state === 'todo') ? '!' : '♛'); continue; }
    if (n.lines) { n.marker.userData.draw(''); continue; }
    const qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === n.id && !QUESTS[k].story);
    const st = S.quests[qid].state;
    n.marker.userData.draw(st === 'todo' ? '!' : questReady(qid) ? '?' : '');
  }
  if (!$('sheet').hidden && sheetMode !== 'opts' && sheetMode !== 'look') renderSheet();
}

function renderSheet() {
  const el = $('sheet');
  if (sheetMode === 'skills') {
    const L = heroLvl(), cur = XPT[L], next = XPT[Math.min(99, L + 1)], free = freePoints();
    const pct = L >= 99 ? 100 : ((S.hero.xp - cur) / (next - cur)) * 100;
    const effect = { atk: `Weapon damage × ${dmgMult().toFixed(1)}`, def: `Damage taken ÷ ${defDiv().toFixed(1)}${gearDef() ? ` (gear +${gearDef()})` : ''}`, hp: `${maxHp()} max health` };
    const w = W();
    el.innerHTML = `<h3>Hero <small>Level ${L}</small></h3>
      <div class="herolvl"><div class="xp"><i style="width:${pct}%"></i></div><small>${Math.floor(S.hero.xp - cur)} / ${next - cur} XP to level ${L + 1}</small></div>
      <div class="stats">${Object.entries(STATS).map(([k, [nm, ic]]) => `<div class="stat"><img src="${ICONS[ic]}" alt=""><span class="nm">${nm}</span><span class="lv">${stat(k)}</span><small>${effect[k]}</small>${free > 0 ? `<button class="plus" data-stat="${k}" aria-label="Add a point to ${nm}">+</button>` : ''}</div>`).join('')}</div>
      <p class="hint">${free > 0 ? `<b>${free} point${free > 1 ? 's' : ''} to spend.</b> ` : ''}Each level gives +1 to every stat and ${FREE_PER_LEVEL} points to spend. Defense and Health keep you alive about equally, so mixing them works best.</p>
      <h4 class="sub">Weapon</h4><div class="gearbtn now"><b><img src="${ICONS[w.type]}" alt="">${w.name}</b><span>${gearStats(w)}</span></div>
      <h4 class="sub">Gathering</h4><div class="skills">${SKILLS.map(([k, nm]) => {
      const l = lvl(k), c0 = XPT[l], n0 = XPT[Math.min(99, l + 1)];
      const pc = l >= 99 ? 100 : ((S.xp[k] - c0) / (n0 - c0)) * 100;
      return `<div class="skill" title="${Math.floor(S.xp[k])} XP"><img src="${ICONS[k]}" alt=""><span class="nm">${nm}</span><span class="lv">${l}</span><div class="xp"><i style="width:${pc}%"></i></div></div>`;
    }).join('')}</div><p class="hint">Gathering skills level up as you use them. Speed rises as you travel and makes you run faster.</p>`;
    el.querySelectorAll('[data-stat]').forEach((b) => { b.onclick = () => spendPoint(b.dataset.stat); });
  } else if (sheetMode === 'bag') {
    const items = Object.entries(S.inv);
    const slots = [];
    for (let i = 0; i < Math.max(16, Math.ceil(items.length / 4) * 4); i++) {
      const it = items[i];
      slots.push(!it ? '<div class="slot empty"></div>' : FOOD[it[0]]
        ? `<button class="slot food" data-eat="${it[0]}" title="Eat ${ITEMS[it[0]]} (heals ${FOOD[it[0]].heal})"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></button>`
        : `<div class="slot" title="${ITEMS[it[0]]}"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></div>`);
    }
    const group = (slot, title) => {
      const mine = S.owned.filter((k) => GEAR[k] && GEAR[k].slot === slot);
      return `<h4 class="sub">${title}</h4><div class="gearlist">${mine.map((k) => `<button class="gearbtn" data-gear="${k}" aria-pressed="${S.equip[slot] === k}"><b><img src="${gearIcon(GEAR[k])}" alt="">${GEAR[k].name}</b><span>${gearStats(GEAR[k])}${GEAR[k].unique ? ' · boss drop' : ''}</span></button>`).join('')}</div>`;
    };
    el.innerHTML = `<h3>Bag <small>${S.coins} coins${S.bank ? ` · ${S.bank} banked` : ''}</small></h3><div class="bag">${slots.join('')}</div>
      ${group('weapon', 'Weapons')}${group('shield', 'Shields')}${group('armour', 'Armour')}
      <p class="hint">Your weapon decides how you fight: swords up close, staffs and wands throw magic, crossbows shoot. Tap food to eat it and heal (or press H). Marta at the market buys anything in your bag, and the smiths buy back spare gear.</p>`;
    el.querySelectorAll('[data-eat]').forEach((b) => { b.onclick = () => eat(b.dataset.eat); });
    el.querySelectorAll('[data-gear]').forEach((b) => { b.onclick = () => { const g = GEAR[b.dataset.gear]; S.equip[g.slot] = b.dataset.gear; cancelTask(); equipGear(); buildGearBar(); updateTitle(); save(); renderSheet(); burst(player.pos.clone().setY(1.6), '#ffe07a', 20, 4); }; });
  } else if (sheetMode === 'quests') {
    const order = Object.entries(QUESTS).filter(([k, q]) => !q.story || storyOpen(k) || S.quests[k].state !== 'todo').sort((a, b) => (b[1].story ? 1 : 0) - (a[1].story ? 1 : 0));
    el.innerHTML = `<h3>Quests</h3>${order.map(([k, q]) => {
      const st = S.quests[k].state, ready = questReady(k);
      const tag = st === 'done' ? '<span class="tag done">Done</span>' : ready ? '<span class="tag ready">Hand in</span>' : st === 'active' ? '<span class="tag active">Active</span>' : '<span class="tag todo">New</span>';
      const body = st === 'todo' ? `Talk to ${npcName(q.giver)}.` : st === 'done' ? 'Completed.' : ready ? `Return to ${npcName(q.giver)}.` : `${q.desc} (${questProgress(k)})`;
      return `<div class="quest${q.story ? ' story' : ''}">${q.story ? `<small class="chapter">Main story · ${q.chapter}</small>` : ''}<h4>${q.name}${tag}</h4><p>${body}</p></div>`;
    }).join('')}`;
  } else if (sheetMode === 'look') {
    const sw = (part, set = LOOK_COLOURS) => Object.entries(set).map(([k, [nm, c]]) => `<button class="swatch" data-part="${part}" data-col="${k}" title="${nm}" aria-label="${nm}" aria-pressed="${S.look[part] === k}" style="background:${c}"></button>`).join('');
    const pick = (part, set) => Object.entries(set).map(([k, nm]) => `<button class="hairbtn" data-opt="${part}" data-val="${k}" aria-pressed="${S.look[part] === k}">${nm}</button>`).join('');
    const styles = Object.entries(HAIR_STYLES).map(([k, nm]) => `<button class="hairbtn" data-hair="${k}" aria-pressed="${S.look.hair === k}">${nm}</button>`).join('');
    el.innerHTML = `<h3>Look</h3><div class="look">
      <h4>Outfit colour</h4><div class="swatches">${sw('outfit')}</div>
      <h4>Cape colour</h4><div class="swatches">${sw('trim')}</div>
      <h4>Skin tone</h4><div class="swatches">${sw('skin', SKIN_TONES)}</div>
      <h4>Eyes</h4><div class="toggles">${pick('eyeStyle', EYE_STYLES)}</div>
      <div class="swatches">${sw('eyes', EYE_COLOURS)}</div>
      <h4>Hair style</h4><div class="toggles">${styles}</div>
      <h4>Hair length</h4><div class="toggles">${pick('hairLen', HAIR_LENGTHS)}</div>
      <div class="swatches">${sw('hairCol', HAIR_COLOURS)}</div>
      <h4>Head</h4><div class="toggles">${pick('head', Object.fromEntries(Object.entries(HEAD_SIZES).map(([k, v]) => [k, v[0]])))}${pick('ears', { human: 'Round ears', elf: 'Elf ears' })}</div>
      <p class="hint">${S.look.hat ? 'Take off your helmet to show your face and hair.' : ''}</p>
      <h4>Show</h4><div class="toggles">
        <button id="l-hat" aria-pressed="${S.look.hat}">Helmet</button>
        <button id="l-cape" aria-pressed="${S.look.cape}">Cape</button></div>
      <p class="hint">Armour changes the colour of your arms and legs. Your look belongs to your hero and other players will see it once online play arrives.</p></div>`;
    el.querySelectorAll('.swatch').forEach((b) => { b.onclick = () => { S.look[b.dataset.part] = b.dataset.col; if (['skin', 'eyes', 'hairCol'].includes(b.dataset.part)) S.look.hat = false; applyLook(); save(); renderSheet(); }; });
    el.querySelectorAll('[data-hair]').forEach((b) => { b.onclick = () => { S.look.hair = b.dataset.hair; if (S.look.hair !== 'none') S.look.hat = false; applyLook(); save(); renderSheet(); }; });
    el.querySelectorAll('[data-opt]').forEach((b) => { b.onclick = () => { S.look[b.dataset.opt] = b.dataset.val; S.look.hat = false; applyLook(); save(); renderSheet(); }; });
    $('l-hat').onclick = () => { S.look.hat = !S.look.hat; applyLook(); save(); renderSheet(); };
    $('l-cape').onclick = () => { S.look.cape = !S.look.cape; applyLook(); save(); renderSheet(); };
  } else if (sheetMode === 'opts') {
    el.innerHTML = `<h3>Options</h3><div class="opts">
      <button id="o-style" aria-pressed="${styled.on}">Storybook look: ${styled.on ? 'On' : 'Off'}</button>
      <button id="o-tod" aria-pressed="${env.preset === 'golden'}">${env.preset === 'golden' ? 'Switch to daytime' : 'Switch to golden hour'}</button>
            <button id="o-reset" class="danger">Start over</button>
      <p class="hint">Progress saves in this browser for now. Accounts that save online come in the next step.</p></div>`;
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
  sheetMode = mode; $('sheet').hidden = false; renderSheet(); document.body.classList.add('sheet-open');
  for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', String(m === mode));
}
function closeSheet() { document.body.classList.remove('sheet-open'); $('sheet').hidden = true; sheetMode = null; for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', 'false'); }
for (const m of ['skills', 'bag', 'quests', 'look', 'opts']) $(`b-${m}`).addEventListener('click', () => (m === 'look' ? openCreator('edit') : openSheet(m)));

// dialogue
let talking = null;
function openShop(npc) {
  talking = npc;
  const d = $('dialog');
  // keep whatever an active quest still needs, and never bulk-sell treasures or trophies
  const keep = {};
  for (const [q, st] of Object.entries(S.quests)) if (st.state === 'active') for (const [k, n] of Object.entries(QUESTS[q].need)) if (ITEMS[k]) keep[k] = (keep[k] || 0) + n;
  const spareOf = (k) => Math.max(0, (S.inv[k] || 0) - (keep[k] || 0));
  const goods = Object.entries(S.inv).filter(([k]) => SELL[k] && spareOf(k) > 0).map(([k]) => [k, spareOf(k)]);
  const bulk = goods.filter(([k]) => !FOOD[k] && !['silver_ring', 'ruby', 'golden_crown', 'lucky_sock', 'gloom_hat', 'rattle_tooth'].includes(k));
  const worth = bulk.reduce((a, [k, n]) => a + SELL[k] * n, 0);
  const tavern = npc.id === 'tom';
  d.innerHTML = `<h3>${npc.name}</h3><p>${tavern ? "Welcome to the Sleepy Boar! Pull up a stool. A hot meal mends any bruise. Eat it from your bag, or press H." : 'Fresh from the oven! Food heals you when you eat it from your bag, or press H. And I buy anything you bring me.'}</p>
    <div class="shop">${Object.entries(FOOD).map(([k, f]) => `<button class="buy" data-food="${k}" ${S.coins < f.price ? 'disabled' : ''}><img src="${ICONS[k]}" alt=""><b>${ITEMS[k]}</b><span>Heals ${f.heal}</span><em>${f.price} coins</em></button>`).join('')}</div>
    ${goods.length && !tavern ? `<h4 class="sub">Sell to Marta</h4><div class="shop sell">${goods.map(([k, n]) => `<button class="buy" data-sell="${k}"><img src="${ICONS[k]}" alt=""><b>${ITEMS[k]} × ${n}</b><span>${keep[k] ? `keeping ${keep[k]} for a quest` : `${SELL[k]} each`}</span><em>Sell +${SELL[k] * n}</em></button>`).join('')}</div>` : ''}
    <p class="hint">You have ${S.coins} coins.${tavern ? ' Marta at the market buys goods, if you have any to sell.' : goods.length ? '' : ' Bring me logs, ore, fish, bones or treasures from monsters and I will buy them.'}</p>
    <div class="row">${worth && !tavern ? `<button id="sellall">Sell all materials (+${worth})</button>` : ''}<button id="shopbye">Goodbye</button></div>`;
  d.querySelectorAll('[data-food]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.food, f = FOOD[k];
    if (S.coins < f.price) return;
    S.coins -= f.price; addItem(k);
    toast(`You buy ${ITEMS[k].toLowerCase()}.`, ICONS[k]);
    save(); openShop(npc);
  }; });
  d.querySelectorAll('[data-sell]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.sell, n = spareOf(k), c = SELL[k] * n;
    if (!n) return;
    takeItem(k, n); S.coins += c;
    toast(`Sold ${n} × ${ITEMS[k].toLowerCase()} for ${c} coins.`, ICONS.coins, c >= 100);
    refreshUI(); save(); openShop(npc);
  }; });
  if (worth && !tavern) $('sellall').onclick = () => {
    for (const [k, n] of bulk) takeItem(k, n);
    S.coins += worth; toast(`Sold your materials for ${worth} coins.`, ICONS.coins);
    refreshUI(); save(); openShop(npc);
  };
  $('shopbye').onclick = closeDialog;
  showDialog(d);
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
  const steps = storyStep();
  if (steps.length) {
    // pick: something to hand in first, then something new, then progress on an active one
    const k = steps.find((q) => questReady(q)) || steps.find((q) => S.quests[q].state === 'todo') || steps[0];
    const q = QUESTS[k], st = S.quests[k];
    let text, btn;
    if (questReady(k)) { text = q.ready; btn = ['Hand it over', () => { finishQuest(k, npc); openKing(npc); }]; }
    else if (st.state === 'todo') { text = q.intro; btn = ['I will do it', () => { st.state = 'active'; toast(`${q.chapter}: ${q.name}`, ICONS.scroll, true); refreshUI(); save(); closeDialog(); }]; }
    else { text = `${q.desc} So far: ${questProgress(k)}.`; btn = ['On my way', closeDialog]; }
    d.innerHTML = `<h3>${npc.name}</h3><div class="chapter">${q.chapter} · ${q.name}</div><p></p>${st.state === 'todo' ? `<div class="reward">Reward: ${q.reward.coins} coins and ${Object.values(q.reward.xp)[0]} XP</div>` : ''}
      <div class="row"><button class="primary" id="kq"></button><button id="kingbye">Farewell</button></div>`;
    d.querySelector('p').textContent = text; $('kq').textContent = btn[0]; $('kq').onclick = btn[1];
    $('kingbye').onclick = closeDialog;
    showDialog(d); npc.actor.face(player.pos.x, player.pos.z);
    return;
  }
  d.innerHTML = `<h3>${npc.name}</h3><p>You have done the kingdom proud. ${DARK_KING}'s shadow still lingers, and I will call on you again soon. Until then, grow strong: the smiths in the village sell fine weapons, shields and armour.</p>
    <div class="row"><button id="kingbye">Farewell</button></div>`;
  $('kingbye').onclick = closeDialog;
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
function openWeaponShop(npc) {
  talking = npc;
  const type = npc.shop, d = $('dialog');
  const lines = { melee: 'Finest steel this side of the mountains! Swords, axes, shields and armour. A longer blade swings wider, a lighter one swings faster.', magic: 'Wands and staves, darling, humming with power. Hold one and your blows become bolts of magic you can throw from afar.', ranged: 'Crossbows I made myself. Hold one and you shoot from a safe distance. Lighter ones shoot faster.' };
  const sells = (g) => (g.slot === 'weapon' ? g.type === type : type === 'melee');
  const list = Object.entries(GEAR).filter(([, g]) => !g.unique && g.price > 0 && sells(g));
  const spare = S.owned.map((k) => [k, GEAR[k]]).filter(([k, g]) => g && sells(g) && gearValue(g) > 0 && S.equip[g.slot] !== k);
  d.innerHTML = `<h3>${npc.name}</h3><p>${lines[type]}</p>
    <div class="shop wide">${list.map(([k, g]) => {
      const own = S.owned.includes(k), eq = S.equip[g.slot] === k;
      const label = eq ? 'Equipped' : own ? 'Equip' : `${g.price} coins`;
      return `<button class="buy" data-w="${k}" ${eq || (!own && S.coins < g.price) ? 'disabled' : ''}><img src="${gearIcon(g)}" alt=""><b>${g.name}</b><span>${gearStats(g)}</span><em>${label}</em></button>`;
    }).join('')}</div>
    ${spare.length ? `<h4 class="sub">Sell spare gear</h4><div class="shop sell">${spare.map(([k, g]) => `<button class="buy" data-sellg="${k}"><img src="${gearIcon(g)}" alt=""><b>${g.name}</b><span>${gearStats(g)}</span><em>Sell +${gearValue(g)}</em></button>`).join('')}</div>` : ''}
    <p class="hint">You have ${S.coins} coins. Damage is the weapon's base: your Attack multiplies it.</p><div class="row"><button id="wbye">Goodbye</button></div>`;
  d.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.w, g = GEAR[k];
    if (!S.owned.includes(k)) { if (S.coins < g.price) return; S.coins -= g.price; S.owned.push(k); toast(`You buy the ${g.name}!`, gearIcon(g), true); }
    S.equip[g.slot] = k;
    cancelTask(); equipGear(); burst(player.pos.clone().setY(1.6), '#ffe07a', 24, 4);
    buildGearBar(); updateTitle(); refreshUI(); save(); openWeaponShop(npc);
  }; });
  d.querySelectorAll('[data-sellg]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.sellg, g = GEAR[k];
    if (!S.owned.includes(k) || S.equip[g.slot] === k) return;
    S.owned = S.owned.filter((o) => o !== k); S.coins += gearValue(g);
    toast(`Sold the ${g.name} for ${gearValue(g)} coins.`, ICONS.coins, g.unique);
    refreshUI(); save(); openWeaponShop(npc);
  }; });
  $('wbye').onclick = closeDialog;
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
// The bank keeps coins safe. Coins you carry can be lost when you're knocked out.
function openBank(npc) {
  talking = npc;
  const d = $('dialog');
  const opts = (verb, have) => [10, 100, 1000].filter((n) => n <= have).map((n) => `<button data-${verb}="${n}">${verb === 'dep' ? 'Deposit' : 'Withdraw'} ${n}</button>`).join('') + (have ? `<button data-${verb}="${have}" class="primary">${verb === 'dep' ? 'Deposit' : 'Withdraw'} all (${have})</button>` : '');
  d.innerHTML = `<h3>${npc.name}</h3><p>Coins in my vault are safe as houses. Coins in your pocket? Get knocked out and half of them spill on the ground!</p>
    <div class="bankrow"><div class="bankbox"><img src="${ICONS.coins}" alt=""><b>${S.coins}</b><small>in your pocket</small></div><div class="bankbox vault"><img src="${ICONS.chest}" alt=""><b>${S.bank}</b><small>in the bank</small></div></div>
    <div class="row wrap">${opts('dep', S.coins)}</div><div class="row wrap">${opts('wd', S.bank)}</div>
    <div class="row"><button id="bankbye">Goodbye</button></div>`;
  d.querySelectorAll('[data-dep]').forEach((b) => { b.onclick = () => { const n = Math.min(+b.dataset.dep, S.coins); S.coins -= n; S.bank += n; toast(`Deposited ${n} coins. They're safe now.`, ICONS.coins); refreshUI(); save(); openBank(npc); }; });
  d.querySelectorAll('[data-wd]').forEach((b) => { b.onclick = () => { const n = Math.min(+b.dataset.wd, S.bank); S.bank -= n; S.coins += n; toast(`Withdrew ${n} coins.`, ICONS.coins); refreshUI(); save(); openBank(npc); }; });
  $('bankbye').onclick = closeDialog;
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
// When you're knocked out, half your carried coins spill into a pouch where you fell. Grab it back if you can!
const pouches = [];
function dropPouch(n) {
  if (n <= 0) return;
  const m = lib.coin_stack_large.clone(true); stylize(m); m.scale.setScalar(1.4);
  m.position.set(player.pos.x, 0, player.pos.z); scene.add(m);
  const glow = new THREE.PointLight('#ffd86b', 5, 5, 1.6); glow.position.set(player.pos.x, 1.2, player.pos.z); scene.add(glow);
  pouches.push({ m, glow, n, where, until: now + 240 });
}
function pouchTick() {
  if (!player || player.dead) return;
  for (let i = pouches.length - 1; i >= 0; i--) {
    const P = pouches[i];
    P.m.rotation.y += 0.03;
    const gone = now > P.until, near = P.where === where && Math.hypot(P.m.position.x - player.pos.x, P.m.position.z - player.pos.z) < 1.6;
    if (near) { S.coins += P.n; toast(`You got your ${P.n} coins back!`, ICONS.coins, true); burst(P.m.position.clone().setY(1), '#ffe07a', 30, 5); refreshUI(); save(); }
    if (near || gone) { scene.remove(P.m, P.glow); pouches.splice(i, 1); }
  }
}
function openTalk(npc) {
  talking = npc;
  const d = $('dialog');
  d.innerHTML = '<h3></h3><p></p><div class="row"><button id="talkbye">Goodbye</button></div>';
  d.querySelector('h3').textContent = npc.name;
  d.querySelector('p').textContent = npc.lines[Math.floor(rng() * npc.lines.length)];
  $('talkbye').onclick = closeDialog;
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
function finishQuest(id, npc) {
  const q = QUESTS[id], st = S.quests[id];
  for (const [k, n] of Object.entries(q.need)) if (k !== 'kills' && k !== 'boss') takeItem(k, n);
  st.state = 'done'; S.coins += q.reward.coins;
  for (const [k, v] of Object.entries(q.reward.xp)) { if (k === 'hero') giveHeroXp(v); else giveXp(k, v); }
  toast(`Quest complete: ${q.name}`, ICONS.coins, true);
  burst(npc.actor.pos.clone().setY(2), '#9cff6b', 50, 6, 1.4);
  npc.actor.play('Cheer', { once: true, onFinish: () => npcIdle(npc) });
  refreshUI(); save();
}
function openDialog(npc) {
  if (npc.lines) { openTalk(npc); return; }
  if (npc.king) { openKing(npc); return; }
  if (npc.bank) { openBank(npc); return; }
  if (npc.shop && npc.shop !== 'food') { openWeaponShop(npc); return; }
  if (npc.shop) { openShop(npc); return; }
  talking = npc;
  const qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === npc.id && !QUESTS[k].story);
  const q = QUESTS[qid], st = S.quests[qid];
  const parts = [`${q.reward.coins} coins`];
  for (const [k, v] of Object.entries(q.reward.xp)) parts.push(`${v} ${k === 'hero' ? 'hero' : SKILL_NAME[k]} XP`);
  let text, buttons;
  if (st.state === 'todo') {
    text = q.intro;
    buttons = [['Accept quest', 'primary', () => { st.state = 'active'; toast(`Quest started: ${q.name}`); refreshUI(); save(); closeDialog(); }], ['Not now', '', closeDialog]];
  } else if (questReady(qid)) {
    text = q.ready;
    buttons = [['Hand it over', 'primary', () => { finishQuest(qid, npc); closeDialog(); }]];
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
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
let typing = null;
// Dialog text writes itself out letter by letter, storybook style. Tap to skip.
function showDialog(d) {
  d.hidden = false;
  const p = d.querySelector('p');
  if (!p || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const full = p.textContent; let i = 0;
  clearInterval(typing);
  p.textContent = '';
  typing = setInterval(() => { i += 2; p.textContent = full.slice(0, i); if (i >= full.length) clearInterval(typing); }, 16);
  p.onclick = () => { clearInterval(typing); p.textContent = full; };
}
function closeDialog() { $('dialog').hidden = true; talking = null; }

// ---------- input ----------
const keys = new Set();
const KEYMAP = { ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
addEventListener('keydown', (e) => {
  if (creator.open && e.key === 'Escape' && creator.mode !== 'new') { closeCreator(false); return; }
  if (!player || uiLock()) return;
  if (KEYMAP[e.code]) {
    const k = KEYMAP[e.code];
    // tap left or right twice quickly to dash that way
    if ((k === 'l' || k === 'r') && !e.repeat) { if (now - lastTap[k] < 0.28) dash(k === 'l' ? -1 : 1); lastTap[k] = now; }
    keys.add(k); if (k !== 'sprint') { cancelTask(); moveTarget = null; } e.preventDefault();
  }
  if (e.code === 'KeyZ' && !e.repeat) dash(-1);
  if (e.code === 'KeyC' && !e.repeat) dash(1);
  if (e.code === 'KeyR' && !e.repeat) special();
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
  for (const c of chests) if (!c.open) consider({ type: 'chest', n: c }, c.x, c.z, 1.8);
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
  const p = player.pos, w = W(), A = STYLES[w.type];
  for (const c of chests) if (!c.open && Math.hypot(c.x - p.x, c.z - p.z) < c.reach) return { type: 'chest', n: c };
  if (!mouseHeld) for (const n of npcs) if (Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'npc', n };
  for (const n of nodes) if (n.alive && n.def.skill === 'fishing' && Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'node', n };
  let foe = null, fd = 1e9;
  const reach = w.reach;
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising') { const d = inArc(e.pos.x, e.pos.z, 0.8, reach, A.proj ? 0.3 : 0.95); if (d >= 0 && d < fd) { fd = d; foe = e; } }
  let node = null, nd = 1e9;
  for (const n of nodes) if (n.alive && n.def.skill !== 'fishing') { const d = inArc(n.x, n.z, n.r, TOOL_REACH, 0.8); if (d >= 0 && d < nd) { nd = d; node = n; } }
  if (node && (!foe || fd > 5)) return { type: 'gather', n: node };
  return { type: 'attack', e: foe };
}
function describe(t) {
  const hint = matchMedia('(pointer: coarse)').matches ? 'Tap here to swing at whatever is in front of you.' : 'Click to attack. Space jumps, Shift sprints.';
  if (!t) return { label: 'Attack', icon: ICONS[W().type], hint, ok: true };
  if (t.type === 'npc') return { label: 'Talk', icon: ICONS.magic, hint: t.n.name, ok: true };
  if (t.type === 'chest') return { label: 'Open', icon: ICONS.chest, hint: 'A treasure chest! What could be inside?', ok: true };
  if (t.type === 'attack') return { label: 'Attack', icon: ICONS[W().type], hint: t.e ? `${t.e.T.name} (${t.e.hp} health)` : hint, ok: true };
  const d = t.n.def, l = lvl(d.skill);
  return { label: d.verb, icon: ICONS[d.skill], hint: l >= d.req ? `${d.name} · ${SKILL_NAME[d.skill]} ${d.req}+` : `${d.name} needs ${SKILL_NAME[d.skill]} level ${d.req}`, ok: l >= d.req };
}
function doAction() {
  if (!player || player.dead || uiLock()) return;
  if (talking) { closeDialog(); return; }
  swing();
}
const GRAV = 34;
// Dash: a quick sidestep to the left or right of the screen. Brief dodge window, short cooldown.
let dashUntil = 0, dashReady = 0, dashDir = 0, dashLeft = 0, lastTap = { l: -9, r: -9 };
const dodging = () => player.pos.y > 0.7 || now < dashUntil + 0.08 || dashLeft > 0;
function dash(side) {
  if (!player || player.dead || uiLock() || now < dashReady || stamina < 12) return;
  if (talking) closeDialog();
  if (player.task) cancelTask();
  dashDir = side; dashUntil = now + 0.2; dashReady = now + 0.75; dashLeft = 3.6;
  stamina = Math.max(0, stamina - 12); staminaAt = now + 1;
  burst(player.pos.clone().setY(0.4), '#f3e2bd', 12, 3);
}
function jump() {
  if (!player || player.dead || uiLock() || player.air) return;
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
  if (t.type === 'chest') { held = false; player.face(t.n.x, t.n.z); openChest(t.n); return; }
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
  const w = W(), A = STYLES[w.type];
  // lighter weapons swing faster, so the animation speeds up to match
  const sp = THREE.MathUtils.clamp(1.05 / w.cd, 0.85, 1.9);
  showGear(null);
  if (t.e && A.proj) player.face(t.e.pos.x, t.e.pos.z); // gentle aim help for ranged
  player.nextHit = now + w.cd;
  const dur = player.play(w.heavy && A.heavy ? A.heavy : A.anim, { once: true, fade: 0.08, speed: sp });
  player.busyUntil = now + Math.min(dur * 0.7, w.cd * 0.7);
  later(A.hitAt / sp * 1.15, () => {
    if (player.dead) return;
    const fwd = fwdOf(player);
    if (A.proj) {
      shoot(player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(fwd, 0.8), fwd, A.proj, w.reach, 'player',
        (e) => hurtEnemy(e, heroDamage()));
      return;
    }
    burst(player.pos.clone().setY(1.5).addScaledVector(fwd, w.reach * 0.55), '#fff2a8', 14, 5);
    let hit = false;
    for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && inArc(e.pos.x, e.pos.z, 0.8, w.reach + 0.3) >= 0) { hurtEnemy(e, heroDamage()); hit = true; }
    if (!hit) for (const n of nodes) if (n.alive && n.def.skill !== 'fishing' && inArc(n.x, n.z, n.r, w.reach) >= 0) { burst(new THREE.Vector3(n.x, 1.4, n.z), '#ffe9a8', 6, 3); break; }
  });
}
let specialReady = 0;
function special() {
  if (!player || player.dead || uiLock() || where === 'castle' || where === 'tavern') return;
  if (now < specialReady) { toast(`${SPECIALS[specialOf(W())].name} is recharging...`, ICONS.star); return; }
  if (talking) closeDialog();
  if (player.task) cancelTask();
  if (now - aim.at < 2.5) { player.face(aim.x, aim.z); aim.at = -99; }
  const w = W(), key = specialOf(w), SP = SPECIALS[key];
  specialReady = now + SP.cd; player.nextHit = now + 0.6;
  const big = w.unique ? 1.25 : 1;
  const fwd = fwdOf(player), pp = player.pos;
  const hitIn = (cx, cz, R, mult) => { let n = 0; for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.inside === where && Math.hypot(e.pos.x - cx, e.pos.z - cz) < R + (e.T.boss ? 1.2 : 0.5)) { hurtEnemy(e, Math.round(heroDamage() * mult) || 1); n++; } return n; };
  const ring = (cx, cz, R, col) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.2, cz); m.layers.set(1); scene.add(m);
    fx.push({ m, t: 0, dur: 0.45, R });
  };
  floatText(pp.clone().setY(4.2), SP.name + '!', 'gain');
  if (key === 'whirl') {
    const R = (w.reach + 1.4) * big;
    player.play('1H_Melee_Attack_Slice_Diagonal', { once: true, fade: 0.05, speed: 1.6 }); player.busyUntil = now + 0.45;
    let spin = 0; const spinT = () => { spin += 1; player.root.rotation.y += Math.PI / 3; if (spin < 6) later(0.05, spinT); }; spinT();
    later(0.2, () => { ring(pp.x, pp.z, R, '#fff2a8'); burst(pp.clone().setY(1.2), '#fff2a8', 30, 7); hitIn(pp.x, pp.z, R, SP.mult); });
  } else if (key === 'quake') {
    const R = 4.6 * big;
    player.air = true; player.vy = 12; player.play(player.clips.Jump_Full_Short ? 'Jump_Full_Short' : 'Cheer', { once: true, fade: 0.06, speed: 1.3 });
    later(0.62, () => { player.play('2H_Melee_Attack_Chop', { once: true, fade: 0.05, speed: 1.6 }); });
    later(0.75, () => { ring(pp.x, pp.z, R, '#ffd08a'); burst(pp.clone().setY(0.4), '#ffd08a', 60, 9, 1.4); shake = 0.45; hitIn(pp.x, pp.z, R, SP.mult); });
  } else if (key === 'nova') {
    const dist = Math.min(w.reach * 0.6, 7), cx = pp.x + fwd.x * dist, cz = pp.z + fwd.z * dist, R = 3.6 * big;
    player.play('Spellcasting', { once: true, fade: 0.06, speed: 1.4 }); player.busyUntil = now + 0.5;
    const rune = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 6), new THREE.MeshBasicMaterial({ color: '#9ff0ff', transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    rune.rotation.x = -Math.PI / 2; rune.position.set(cx, 0.2, cz); rune.scale.setScalar(R); rune.layers.set(1); scene.add(rune);
    fx.push({ m: rune, t: 0, dur: 0.55, spin: true });
    later(0.5, () => { ring(cx, cz, R, '#9ff0ff'); burst(new THREE.Vector3(cx, 1, cz), '#bff6ff', 60, 8, 1.4); burst(new THREE.Vector3(cx, 1, cz), '#ffe07a', 24, 6); hitIn(cx, cz, R, SP.mult); });
  } else {
    player.play('1H_Ranged_Shoot', { once: true, fade: 0.06, speed: 1.5 }); player.busyUntil = now + 0.4;
    later(0.2, () => {
      for (const a of [-0.36, -0.18, 0, 0.18, 0.36]) {
        const d = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a * big);
        shoot(pp.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(d, 0.8), d, 'bolt', w.reach, 'player', (e) => hurtEnemy(e, Math.round(heroDamage() * SP.mult)));
      }
    });
  }
}
const fx = [];
function fxTick(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt; const k = f.t / f.dur;
    if (f.R) f.m.scale.setScalar(f.R * (0.3 + 0.7 * k));
    if (f.spin) f.m.rotation.z += dt * 4;
    f.m.material.opacity = 0.85 * (1 - k);
    if (k >= 1) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); fx.splice(i, 1); }
  }
  const el = $('specialbtn');
  if (el && player) {
    const left = Math.max(0, specialReady - now), SP = SPECIALS[specialOf(W())];
    el.style.setProperty('--cd', String(left / SP.cd));
    el.classList.toggle('cooling', left > 0);
    const lbl = left > 0 ? `${Math.ceil(left)}s` : SP.name;
    if (el.dataset.lbl !== lbl) { el.dataset.lbl = lbl; el.querySelector('span').textContent = lbl; }
  }
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
  if (t.type === 'chest') { openChest(t.n); return; }
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
// Your damage: the weapon's base damage, multiplied by your Attack, with a little luck either way.
function heroDamage() {
  if (rng() < 0.1) return 0;
  return Math.max(1, Math.round(W().dmg * dmgMult() * (0.8 + rng() * 0.4)));
}
function hurtEnemy(e, dmg) {
  const head = e.pos.clone().setY(3.4);
  if (e.state === 'idle' || e.state === 'walk') e.state = 'chase';
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  e.hp = Math.max(0, e.hp - dmg);
  floatText(head, String(dmg));
  burst(e.pos.clone().setY(1.6), '#ffffff', 14, 5);
  giveHeroXp(dmg * HIT_HERO_XP);
  if (e.hp <= 0) {
    e.state = 'dead'; e.bar.hidden = true;
    e.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    if (!e.T.noBones) later(0.75, () => { if (e.state === 'dead') collapse(e); });
    giveHeroXp(e.T.xp, e.pos.clone().setY(4));
    const coins = e.T.coins ? e.T.coins[0] + Math.floor(rng() * (e.T.coins[1] - e.T.coins[0])) : 3 + Math.floor(rng() * 9);
    S.coins += coins; addItem('bones');
    rollLoot(e);
    if (e.T.boss) {
      addItem(e.T.drop);
      toast(`You defeated ${e.T.name}! It dropped ${ITEMS[e.T.drop].toLowerCase()}!`, ICONS[e.T.drop], true);
      burst(e.pos.clone().setY(2), '#ffe07a', 80, 8, 1.6);
      for (const k of Object.keys(QUESTS)) if (S.quests[k].state === 'active' && QUESTS[k].bossType === e.type) S.quests[k].boss = 1;
      $('bossbar').hidden = true;
    }
    floatText(e.pos.clone().setY(2.4), `+${coins} coins`, 'gain');
    for (const k of Object.keys(QUESTS)) if (S.quests[k].state === 'active' && QUESTS[k].need.kills !== undefined) S.quests[k].kills++;
    refreshUI();
    later(e.T.boss ? 90 : 16, () => {
      e.hp = e.T.hp; e.state = 'rising';
      reassemble(e);
      const ok = e.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { e.state = 'idle'; e.play('Idle'); } });
      if (!ok) { e.state = 'idle'; e.play('Idle'); }
      burst(e.pos.clone().setY(0.5), '#b9ff8a', 30, 4);
    });
  } else if (e.state !== 'slam' && !['1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', 'Spellcast_Shoot', 'Spellcasting'].includes(e.name)) {
    e.play('Hit_A', { once: true, fade: 0.05, onFinish: () => e.play('Idle_Combat') });
  }
}
let lastHurt = -10;
function hurtPlayer(dmg) {
  if (player.dead || creator.open) return;
  const head = player.pos.clone().setY(3.6);
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  // Defense divides the hit; the leftover fraction rounds up or down by chance
  const d = dmg / defDiv();
  dmg = Math.floor(d) + (rng() < d - Math.floor(d) ? 1 : 0);
  if (dmg === 0) { floatText(head, 'Blocked', 'miss'); burst(player.pos.clone().setY(1.5), '#bfe0ff', 8, 3); return; }
  S.hp -= dmg; lastHurt = now; player.hurtFace = now + 0.45;
  floatText(head, String(dmg), 'hurt');
  burst(player.pos.clone().setY(1.5), '#ff8a7a', 10, 4);
  if (S.hp <= 0) {
    S.hp = 0; player.dead = true; cancelTask(); moveTarget = null;
    player.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    const lost = Math.floor(S.coins / 2);
    if (lost > 0) { S.coins -= lost; dropPouch(lost); }
    toast(lost > 0 ? `You were knocked out and dropped ${lost} coins where you fell! Go back for them, or bank your coins next time.` : 'You were knocked out! You wake up by the well.', null, true);
    later(3, () => {
      player.root.position.set(0, 0, 6); player.air = false; where = 'out'; camPos.set(0, 30, 40);
      S.hp = maxHp(); player.dead = false; player.play('Idle'); refreshUI(); save();
    });
  } else if (!player.task && now > player.busyUntil) {
    player.play('Hit_A', { once: true, fade: 0.05, onFinish: () => player.play('Idle') });
  }
  refreshUI();
}

const timers = [];
const later = (t, f) => timers.push({ t, f });

// ---------- Gagron's fire ----------
// Every fire attack paints a glowing warning on the floor first. Jump, dash or step out before it fills.
const hazards = [];
const hazardMat = () => new THREE.MeshBasicMaterial({ color: '#ff6a1f', transparent: true, opacity: 0.25, depthWrite: false, fog: false, side: THREE.DoubleSide });
function hazard({ x, z, R, dir = 0, half = Math.PI, dur = 1.1, dmg, fire = true }) {
  const geo = half >= Math.PI ? new THREE.CircleGeometry(1, 40) : new THREE.CircleGeometry(1, 30, Math.PI / 2 - half, half * 2);
  const m = new THREE.Mesh(geo, hazardMat()); m.rotation.x = -Math.PI / 2; m.rotation.z = dir; m.position.set(x, 0.14, z); m.layers.set(1); m.scale.setScalar(R * 0.1); scene.add(m);
  const edge = new THREE.Mesh(half >= Math.PI ? new THREE.RingGeometry(0.95, 1, 48) : new THREE.RingGeometry(0.96, 1, 30, 1, Math.PI / 2 - half, half * 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  edge.rotation.x = -Math.PI / 2; edge.rotation.z = dir; edge.position.set(x, 0.15, z); edge.layers.set(1); edge.scale.setScalar(R); scene.add(edge);
  hazards.push({ x, z, R, dir, half, dur, dmg, fire, m, edge, t: 0 });
}
function inHazard(h) {
  const dx = player.pos.x - h.x, dz = player.pos.z - h.z, d = Math.hypot(dx, dz);
  if (d > h.R) return false;
  if (h.half >= Math.PI) return true;
  // angle on the floor, measured the same way as the sector was drawn
  let a = Math.atan2(-dz, dx) - (Math.PI / 2 + h.dir); a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= h.half;
}
function hazardTick(dt) {
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i]; h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    h.m.scale.setScalar(h.R * k); h.m.material.opacity = 0.2 + 0.35 * k;
    if (k >= 1) {
      // whoosh: flames along the area
      for (let j = 0; j < 7; j++) {
        const rr = h.R * Math.sqrt(rng()), aa = h.half >= Math.PI ? rng() * 6.28 : Math.PI / 2 + h.dir + (rng() * 2 - 1) * h.half;
        burst(new THREE.Vector3(h.x + Math.cos(aa) * rr, 0.6, h.z - Math.sin(aa) * rr), j % 2 ? '#ffb347' : '#ff5a1f', 14, 5, 1.2);
      }
      shake = Math.max(shake, 0.3);
      if (!player.dead && inHazard(h)) {
        if (dodging()) floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss');
        else hurtPlayer(h.dmg);
      }
      scene.remove(h.m, h.edge); h.m.material.dispose(); hazards.splice(i, 1);
    }
  }
}
function dragonAttack(e, toP) {
  const ep = e.pos, n = ++e.swings;
  const toward = Math.atan2(player.pos.x - ep.x, player.pos.z - ep.z);
  if (n % 3 === 0) {
    // fireball rain: three warning circles around you, then fireballs fall
    e.play('Spellcasting', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
    for (let i = 0; i < 3; i++) {
      const a = rng() * 6.28, r = i === 0 ? 0 : 2 + rng() * 2.5;
      const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
      later(i * 0.25, () => hazard({ x, z, R: 2.4, dur: 1.2, dmg: Math.round(e.T.maxHit * 1.3) }));
    }
  } else if (toP < 5 && n % 2 === 0) {
    e.face(player.pos.x, player.pos.z);
    e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
    later(0.55, () => {
      if (e.hp <= 0 || Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z) > 5.5) return;
      if (dodging()) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; }
      hurtPlayer(1 + Math.floor(rng() * e.T.maxHit));
    });
  } else {
    // fire breath: a wide cone in front of him
    e.face(player.pos.x, player.pos.z); e.state = 'slam';
    e.play('Spellcast_Shoot', { once: true, fade: 0.1 });
    hazard({ x: ep.x, z: ep.z, R: 12, dir: toward + Math.PI, half: 0.42, dur: 1.15, dmg: Math.round(e.T.maxHit * 1.6) });
    later(1.2, () => { if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); } });
  }
}

// The miniboss's big move: a red circle grows on the ground, then BOOM. Jump or get out!
const slamGeo = new THREE.CircleGeometry(1, 40);
function bossSlam(e) {
  const R = e.T.slam;
  e.state = 'slam';
  const m = new THREE.Mesh(slamGeo, new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(e.pos.x, 0.12, e.pos.z); m.layers.set(1); m.scale.setScalar(0.1); scene.add(m);
  const edge = new THREE.Mesh(new THREE.RingGeometry(R - 0.25, R, 48), new THREE.MeshBasicMaterial({ color: '#ffdf6b', transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
  edge.rotation.x = -Math.PI / 2; edge.position.set(e.pos.x, 0.13, e.pos.z); edge.layers.set(1); scene.add(edge);
  slams.push({ m, edge, t: 0, dur: 1.15, R, e });
  const anim = e.T.ranged ? 'Spellcasting' : e.clips['2H_Melee_Attack_Chop'] ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop';
  e.play(anim, { once: true, fade: 0.1, speed: 0.8 });
}
const slams = [];
function slamTick(dt) {
  for (let i = slams.length - 1; i >= 0; i--) {
    const s2 = slams[i]; s2.t += dt;
    const k = Math.min(1, s2.t / s2.dur);
    s2.m.scale.setScalar(s2.R * k); s2.m.material.opacity = 0.25 + 0.3 * k;
    if (k >= 1) {
      const e = s2.e;
      burst(e.pos.clone().setY(0.5), '#ffd08a', 60, 9, 1.4);
      shake = 0.5;
      if (e.hp > 0 && !player.dead && where === 'out' && Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z) < s2.R) {
        if (dodging()) floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss');
        else hurtPlayer(Math.round(e.T.maxHit * 1.6));
      }
      if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); }
      scene.remove(s2.m, s2.edge); slams.splice(i, 1);
    }
  }
}
let shake = 0;
function enemyTick(e, dt) {
  const ep = e.pos;
  if (e.state === 'dead' || e.state === 'rising') return;
  const toP = Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z);
  const fromHome = Math.hypot(ep.x - e.home.x, ep.z - e.home.y);
  const big = e.T.boss, reach = e.T.ranged ? (big ? 10 : 8) : big ? 3.6 : 2.4;
  if (player.dead && (e.state === 'chase')) e.state = 'return';
  if (where !== e.inside && e.state === 'chase') e.state = 'return';
  if ((e.state === 'idle' || e.state === 'walk') && toP < (big ? 11 : 6.5) && !player.dead && !uiLock() && where === e.inside
    && (big || enemies.filter((o) => o.state === 'chase' && !o.T.boss).length < 3)) e.state = 'chase';
  if (e.state === 'slam') return;
  if (e.state === 'chase') {
    if (fromHome > (big ? 28 : 20)) { e.state = 'return'; return; }
    e.face(player.pos.x, player.pos.z);
    if (toP > reach) {
      const dx = player.pos.x - ep.x, dz = player.pos.z - ep.z;
      ep.x += (dx / toP) * 4.2 * dt; ep.z += (dz / toP) * 4.2 * dt;
      if (e.name !== '1H_Melee_Attack_Chop' && e.name !== 'Spellcast_Shoot' && e.name !== 'Hit_A') e.play('Running_A', { fade: 0.15 });
    } else if (now > e.nextHit) {
      e.nextHit = now + (big ? 2.2 : 1.9) + rng() * 0.6;
      const dmg = rng() < 0.3 ? 0 : 1 + Math.floor(rng() * e.T.maxHit);
      if (e.T.dragon) { dragonAttack(e, toP); return; }
      if (big && ++e.swings % 3 === 0) { bossSlam(e); return; }
      if (e.T.ranged) {
        e.play('Spellcast_Shoot', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        later(0.35, () => {
          if (e.hp <= 0 || player.dead) return;
          const dir = new THREE.Vector3(player.pos.x - ep.x, 0, player.pos.z - ep.z);
          const spreads = e.T.spread ? [-0.3, 0, 0.3] : [0];
          for (const sp of spreads) {
            const d2 = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sp);
            shoot(ep.clone().setY(big ? 3 : 1.8).addScaledVector(d2.clone().normalize(), big ? 1.4 : 0.6), d2, 'dark', big ? 15 : 12, 'enemy', () => hurtPlayer(dmg));
          }
        });
      } else {
        e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        later(0.4, () => {
          if (e.hp <= 0 || Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z) >= reach + 1) return;
          if (dodging()) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; }
          hurtPlayer(dmg);
        });
      }
    } else if (e.name === 'Running_A' || e.name === 'Idle' || e.name === 'Walking_A') e.play('Idle_Combat');
    pushOut(ep, big ? 1.3 : 0.6);
  } else if (e.state === 'return') {
    const dx = e.home.x - ep.x, dz = e.home.y - ep.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { e.state = 'idle'; e.hp = e.T.hp; e.swings = 0; e.play('Idle'); }
    else { ep.x += (dx / d) * 4 * dt; ep.z += (dz / d) * 4 * dt; pushOut(ep, big ? 1.3 : 0.6); e.face(e.home.x, e.home.y); e.play('Walking_A'); }
    if (d >= 0.5 && now - (e.stuckAt || 0) > 6) { e.stuckAt = now; if (Math.hypot(ep.x - (e.lastX || 0), ep.z - (e.lastZ || 0)) < 1) { ep.x = e.home.x; ep.z = e.home.y; } e.lastX = ep.x; e.lastZ = ep.z; }
  } else {
    e.timer -= dt;
    if (e.timer < 0) {
      e.timer = 2 + rng() * 4;
      const a = rng() * 6.28, r = rng() * 5;
      e.target.set(e.home.x + Math.cos(a) * r, e.home.y + Math.sin(a) * r);
      e.state = 'walk'; e.walkAt = now;
    }
    if (e.state === 'walk') {
      const tx = e.target.x - ep.x, tz = e.target.y - ep.z, d = Math.hypot(tx, tz);
      if (d > 0.3) { ep.x += (tx / d) * 1.6 * dt; ep.z += (tz / d) * 1.6 * dt; pushOut(ep, 0.6); if (now - (e.walkAt || 0) > 4) { e.walkAt = now; e.state = 'idle'; } e.root.rotation.y = Math.atan2(tx, tz); e.play(e.clips.Walking_D_Skeletons ? 'Walking_D_Skeletons' : 'Walking_A'); }
      else { e.state = 'idle'; e.play('Idle'); }
    }
  }
}

// ---------- minimap ----------
const MAP_R = 165, MAP_PX = 1024;
const mapBg = document.createElement('canvas'); mapBg.width = mapBg.height = MAP_PX;
const PLACES = [['Village', 0, -4], ['Skeleton camp', CAMP.x, CAMP.z + 9], ['Mine', MINE.x, MINE.z - 9], ['Castle', 4, -54], ...Object.values(ZONES).map((Z) => [Z.name, Z.x, Z.z - Z.r * 0.55])];
// Photograph the world from straight above once, and use it as the map picture.
function bakeMap() {
  const cam = new THREE.OrthographicCamera(-MAP_R, MAP_R, MAP_R, -MAP_R, 1, 500);
  const oldSky = sky.visible; sky.visible = false;
  cam.position.set(0, 250, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(MAP_PX, MAP_PX);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const fog = scene.fog; scene.fog = null;
  const hidden = [...clouds, ...enemies.map((e) => e.root), ...npcs.map((n) => n.actor.root)];
  hidden.forEach((o) => { o.userData.wasVis = o.visible; o.visible = false; });
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
  hidden.forEach((o) => { o.visible = o.userData.wasVis; });
  scene.fog = fog; sky.visible = oldSky;
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
$('dashl').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(-1); });
$('dashr').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(1); });
$('specialbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); special(); });
$('sprintbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); sprintToggle = !sprintToggle; $('sprintbtn').setAttribute('aria-pressed', String(sprintToggle)); });
bigMap.addEventListener('click', () => toggleBigMap(false));
function drawMap(cv, full) {
  if (!player) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), css = cv.clientWidth || 150;
  if (cv.width !== Math.round(css * dpr)) { cv.width = cv.height = Math.round(css * dpr); }
  const W = cv.width, g = cv.getContext('2d');
  const p = player.pos, half = full ? MAP_R : 34;
  const cx = full ? 0 : p.x, cz = full ? 0 : p.z;
  const k = W / (half * 2);
  const toPx = (x, z) => [(x - cx + half) * k, (z - cz + half) * k];
  const src = (v) => ((v + MAP_R) / (MAP_R * 2)) * MAP_PX;
  g.clearRect(0, 0, W, W);
  if (where !== 'out') {
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, W, W);
    g.font = `700 ${(full ? 22 : 13) * dpr}px Fredoka, Trebuchet MS, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ffe9a0';
    const words = INTERIORS[where].name.split(' ');
    words.forEach((w2, i) => g.fillText(w2, W / 2, W / 2 + (i - (words.length - 1) / 2) * (full ? 26 : 15) * dpr));
    return;
  }
  g.save();
  if (!full) { g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip(); }
  g.fillStyle = '#3f7a3a'; g.fillRect(0, 0, W, W);
  g.drawImage(mapBg, src(cx - half), src(cz - half), src(cx + half) - src(cx - half), src(cz + half) - src(cz - half), 0, 0, W, W);
  const dot = (x, z, r, fill) => { const [u, v] = toPx(x, z); g.beginPath(); g.arc(u, v, r * dpr, 0, 7); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#3a2010'; g.stroke(); };
  for (const c of chests) if (!c.open) dot(c.x, c.z, full ? 3 : 3.5, '#ffd23f');
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising') dot(e.pos.x, e.pos.z, e.T.boss ? 6 : full ? 2.5 : 3.5, e.T.boss ? '#ff2a6a' : '#ff5a4a');
  for (const n of npcs) {
    const qid = Object.keys(QUESTS).find((q) => QUESTS[q].giver === n.id && !QUESTS[q].story);
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
function pushOut(p, r) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, m = c.r + r;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const d = Math.hypot(dx, dz);
    if (d < m && d > 0.0001) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
}
function collide(p, r = 0.7) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 0.0001) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
  if (where !== 'out') return;
  const d = Math.hypot(p.x, p.z);
  if (d > WORLD_R) { p.x *= WORLD_R / d; p.z *= WORLD_R / d; }
}
let stamina = 100, staminaAt = 0, sprintToggle = false;
let lastUi = 0, lastSave = 0, regenAt = 0, lastAct = '', stuck = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  now = clock.elapsedTime;
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const f = timers[i].f; timers.splice(i, 1); f(); } }

  if (player && !player.dead && !uiLock()) {
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
    if (dashLeft > 0) { const st = Math.min(dashLeft, 18 * dt); dashLeft -= st; pp.x += dashDir * st; collide(pp); if (dashLeft <= 0) dashUntil = Math.min(dashUntil, now); player.root.rotation.z = -dashDir * 0.25; if (rng() < 0.6) burst(pp.clone().setY(0.9), '#ffffff', 2, 1.5, 0.6); }
    else if (player.root.rotation.z) player.root.rotation.z = 0;
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
    checkDoors();
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

  for (const e of enemies) {
    const near = !player || Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 70;
    if (player && (near || e.state !== 'idle')) enemyTick(e, dt);
    if (near) e.mixer.update(dt);
  }
  slamTick(dt);
  hazardTick(dt);
  fxTick(dt);
  pileTick(dt);
  pouchTick();
  bossUi();
  zoneBanner();
  for (const [i, c] of dynamic.crystals.entries()) { c.position.y = 2.4 + Math.sin(now * 1.6 + i) * 0.4; c.rotation.y = now * 0.8 + i; }
  if (player) { player.mixer.update(dt); if (player.headScale && player.headInfo) player.headInfo.bone.scale.setScalar(player.headScale); faceTick(); }
  for (const n of npcs) { n.actor.mixer.update(dt); n.marker.position.y = 4.6 + Math.sin(now * 3 + n.x) * 0.15; }

  for (let i = lootPops.length - 1; i >= 0; i--) {
    const L = lootPops[i]; L.t += dt;
    L.sp.position.y += dt * (2.2 - L.t * 1.6); L.sp.material.opacity = Math.min(1, 2.4 - L.t * 1.4);
    if (L.t > 1.7) { scene.remove(L.sp); L.sp.material.dispose(); lootPops.splice(i, 1); }
  }
  for (const c of chests) { if (c.open && now > c.at) { c.open = false; c.m.visible = true; c.glow.visible = true; } if (!c.open) c.glow.intensity = 5 + Math.sin(now * 3 + c.x) * 2; }
  for (const r of doorRings) { const ph = (now * 0.7) % 1; r.scale.setScalar(1 + ph * 0.35); r.material.opacity = 0.85 - ph * 0.6; }
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
    arcHolder.visible = !player.dead && !uiLock();
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
  if (player && now - lastMap > 0.1) { lastMap = now; mini.hidden = !$('sheet').hidden; drawMap(mini, false); if (!bigMap.hidden) drawMap(bigMap.querySelector('canvas'), true); }
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
  if (creator.open && player) creatorCam(dt);
  else {
    camPos.lerp(tmpV.copy(focus).add(off), 1 - Math.pow(0.002, dt));
    camera.position.copy(camPos);
    if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (rng() - 0.5) * shake * 1.2; camera.position.y += (rng() - 0.5) * shake; }
    camera.lookAt(focus.x, 1.2, focus.z - 1);
  }
  sky.position.copy(camera.position);
  const sd = P.sunDir;
  sun.position.set(focus.x + sd[0], sd[1], focus.z + sd[2]);
  sun.target.position.set(focus.x, 0, focus.z);
  render();
}
addEventListener('pagehide', () => { if (!resetting) save(); });

// ---------- hero creator ----------
// A full-screen character screen: the hero turns on the left (drag to spin), choices on the right.
const NAME_IDEAS = ['Pip', 'Rowan', 'Elara', 'Bram', 'Juniper', 'Tamsin', 'Fen', 'Wren', 'Corin', 'Maeve', 'Odo', 'Lyra', 'Hollis', 'Briar', 'Cass', 'Nell', 'Alden', 'Isolde', 'Thorne', 'Mira', 'Toby', 'Saffron', 'Gideon', 'Posy'];
const creator = { open: false, mode: 'new', tab: 'body', yaw: 0, drag: null, close: false, before: null, light: null };
const uiLock = () => !$('pick').hidden || creator.open;
const heroName = () => (S.name || '').trim() || 'Hero';
function cleanName(v) { return v.replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').slice(0, 16); }
function randomLook() {
  const pickKey = (o, skip = []) => { const k = Object.keys(o).filter((x) => !skip.includes(x)); return k[Math.floor(Math.random() * k.length)]; };
  const L = S.look;
  L.skin = pickKey(SKIN_TONES, Math.random() < 0.85 ? ['green', 'blue'] : []);
  L.hair = pickKey(HAIR_STYLES, ['none']); L.hairLen = L.sex === 'f' ? pickKey(HAIR_LENGTHS, ['short']) : pickKey(HAIR_LENGTHS);
  L.hairCol = pickKey(HAIR_COLOURS); L.eyes = pickKey(EYE_COLOURS); L.eyeStyle = pickKey(EYE_STYLES, ['classic']);
  L.mouth = pickKey(MOUTHS); L.mark = Math.random() < 0.5 ? 'none' : pickKey(MARKS);
  L.outfit = pickKey(LOOK_COLOURS); L.trim = pickKey(LOOK_COLOURS); L.ears = Math.random() < 0.25 ? 'elf' : 'human';
  L.head = pickKey(HEAD_SIZES); L.hat = false;
}
// Swap the hero's body (male knight or female rogue) without losing where they stand.
function rebuildHero() {
  if (!player) return;
  const pos = player.root.position.clone(), rot = player.root.rotation.y;
  for (const g of hairCache.values()) g.removeFromParent();
  for (const t of [tool, rod, pick]) if (t) t.removeFromParent();
  scene.remove(player.root);
  const hp = S.hp;
  startHero();
  S.hp = hp; player.root.position.copy(pos); player.root.rotation.y = rot;
}
function heroModel() { return S.look.sex === 'f' ? G.heroine : G.knight; }
// The female body has no sword, shield or helmet of its own, so it borrows the knight's.
function borrowKnightGear() {
  if (S.look.sex !== 'f') return;
  const src = {}; G.knight.scene.traverse((o) => { if (['1H_Sword', 'Badge_Shield', 'Knight_Helmet'].includes(o.name)) src[o.name] = o; });
  const bones = {}; player.root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  for (const [nm, o] of Object.entries(src)) {
    const parent = o.parent && bones[o.parent.name];
    if (!parent) continue;
    const m = o.clone(true); stylize(m); parent.add(m);
    if (nm === '1H_Sword') player.base.weapon = m;
    if (nm === 'Badge_Shield') player.base.shield = m;
  }
}
const swatchRow = (part, set) => `<div class="cc-swatches">${Object.entries(set).map(([k, [nm, c]]) => `<button class="cc-sw" data-part="${part}" data-val="${k}" title="${nm}" aria-label="${nm}" aria-pressed="${S.look[part] === k}" style="--c:${c}"></button>`).join('')}</div>`;
const chipRow = (part, set) => `<div class="cc-chips">${Object.entries(set).map(([k, nm]) => `<button class="cc-chip" data-part="${part}" data-val="${k}" aria-pressed="${S.look[part] === k}">${Array.isArray(nm) ? nm[0] : nm}</button>`).join('')}</div>`;
const picRow = (part, set, crop) => `<div class="cc-pics">${Object.entries(set).map(([k, nm]) => `<button class="cc-pic" data-part="${part}" data-val="${k}" aria-pressed="${S.look[part] === k}"><img alt="" src="${facePreview({ ...S.look, [part]: k }, crop)}"><span>${nm}</span></button>`).join('')}</div>`;
const field = (label, body, note = '') => `<section class="cc-field"><h4>${label}${note ? `<small>${note}</small>` : ''}</h4>${body}</section>`;
function renderCreator() {
  const L = S.look, el = $('creator');
  const tabs = { body: 'Body', face: 'Face', hair: 'Hair', outfit: 'Outfit' };
  let body = '';
  if (creator.tab === 'body') {
    body = field('Body', `<div class="cc-sex">${Object.entries(SEXES).map(([k, nm]) => `<button class="cc-sexbtn" data-part="sex" data-val="${k}" aria-pressed="${L.sex === k}"><b>${k === 'm' ? '&#9794;' : '&#9792;'}</b>${nm}</button>`).join('')}</div>`)
      + field('Skin tone', swatchRow('skin', SKIN_TONES))
      + field('Head size', chipRow('head', HEAD_SIZES))
      + field('Ears', chipRow('ears', { human: 'Round', elf: 'Pointy elf' }));
  } else if (creator.tab === 'face') {
    body = field('Eyes', picRow('eyeStyle', EYE_STYLES, 'eyes'))
      + field('Eye colour', swatchRow('eyes', EYE_COLOURS))
      + field('Mouth', picRow('mouth', MOUTHS, 'mouth'))
      + field('Face marks', picRow('mark', MARKS, 'mark'));
  } else if (creator.tab === 'hair') {
    body = field('Hair style', chipRow('hair', HAIR_STYLES))
      + field('Length', chipRow('hairLen', HAIR_LENGTHS), 'how far it falls down your back')
      + field('Hair colour', swatchRow('hairCol', HAIR_COLOURS), 'eyebrows match');
  } else {
    body = field('Outfit colour', swatchRow('outfit', LOOK_COLOURS))
      + field('Cape colour', swatchRow('trim', LOOK_COLOURS))
      + field('Wear', `<div class="cc-chips"><button class="cc-chip" id="cc-cape" aria-pressed="${L.cape}">Cape</button><button class="cc-chip" id="cc-hat" aria-pressed="${L.hat}">Helmet</button></div>`, 'a helmet hides your hair')
      + '<p class="cc-note">Armour you find changes the colour of your arms and legs.</p>';
  }
  const isNew = creator.mode === 'new';
  el.innerHTML = `<div class="cc-stage" id="cc-stage" aria-hidden="true"><div class="cc-zoom"><button id="cc-zface" aria-pressed="${creator.close}">Face</button><button id="cc-zbody" aria-pressed="${!creator.close}">Full body</button></div><p class="cc-spin">Drag to turn your hero</p></div>
    <div class="cc-panel panel">
      <h2 class="cc-title">${isNew ? 'Create your hero' : 'Change your look'}</h2>
      <label class="cc-name"><span>Name</span><input id="cc-name" maxlength="16" autocomplete="off" spellcheck="false" value="${(S.name || '').replace(/"/g, '&quot;')}" placeholder="Name your hero"><button id="cc-rname" title="Pick a name for me" aria-label="Pick a name for me">&#127922;</button></label>
      <p class="cc-namehint" id="cc-namehint">Up to 16 letters, numbers, spaces, ' or -</p>
      <div class="cc-tabs" role="tablist">${Object.entries(tabs).map(([k, nm]) => `<button role="tab" data-tab="${k}" aria-selected="${creator.tab === k}">${nm}</button>`).join('')}</div>
      <div class="cc-body">${body}</div>
      <div class="cc-foot"><button id="cc-random">&#127922; Surprise me</button>${isNew ? '' : '<button id="cc-cancel">Cancel</button>'}<button id="cc-done" class="primary">${isNew ? 'Begin adventure' : 'Done'}</button></div>
    </div>`;
  const scroll = creator.scroll || 0; el.querySelector('.cc-body').scrollTop = scroll;
  el.querySelector('.cc-body').addEventListener('scroll', (e) => { creator.scroll = e.target.scrollTop; });
  el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { creator.tab = b.dataset.tab; creator.scroll = 0; creator.close = creator.tab === 'face' || creator.tab === 'hair'; renderCreator(); }; });
  el.querySelectorAll('[data-part]').forEach((b) => {
    b.onclick = () => {
      const part = b.dataset.part, val = b.dataset.val, was = L[part];
      L[part] = val;
      if (['hair', 'hairLen', 'hairCol', 'eyeStyle', 'eyes', 'mouth', 'mark', 'skin', 'ears'].includes(part)) L.hat = false;
      if (part === 'sex' && was !== val) {
        // swap the starter hair if it is still the other body's starter
        const D = { m: ['hero', 'short'], f: ['hime', 'long'] }, o = D[was], n = D[val];
        if (o && L.hair === o[0] && L.hairLen === o[1]) { L.hair = n[0]; L.hairLen = n[1]; }
        rebuildHero();
      }
      else applyLook();
      player.blinkAt = now + 1.5;
      renderCreator();
    };
  });
  const nm = $('cc-name');
  nm.oninput = () => {
    const v = cleanName(nm.value), hint = $('cc-namehint');
    hint.textContent = v !== nm.value ? "Only letters, numbers, spaces, ' and - work in names" : `${v.length} / 16${v.trim() ? '' : ' · leave it empty and you will be called Hero'}`;
    hint.classList.toggle('warn', v !== nm.value);
    if (v !== nm.value) nm.value = v;
    S.name = v; updateTitle();
  };
  nm.onkeydown = (e) => { if (e.key === 'Enter') { nm.blur(); } e.stopPropagation(); };
  $('cc-rname').onclick = () => { S.name = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]; nm.value = S.name; updateTitle(); };
  $('cc-random').onclick = () => { const sex = S.look.sex; randomLook(); S.look.sex = sex; applyLook(); renderCreator(); };
  $('cc-done').onclick = () => closeCreator(true);
  if ($('cc-cancel')) $('cc-cancel').onclick = () => closeCreator(false);
  if ($('cc-cape')) $('cc-cape').onclick = () => { L.cape = !L.cape; applyLook(); renderCreator(); };
  if ($('cc-hat')) $('cc-hat').onclick = () => { L.hat = !L.hat; applyLook(); renderCreator(); };
  $('cc-zface').onclick = () => { creator.close = true; renderCreator(); };
  $('cc-zbody').onclick = () => { creator.close = false; renderCreator(); };
  const st = $('cc-stage');
  st.onpointerdown = (e) => { creator.drag = { x: e.clientX, yaw: creator.yaw }; st.setPointerCapture(e.pointerId); };
  st.onpointermove = (e) => { if (creator.drag) creator.yaw = creator.drag.yaw + (e.clientX - creator.drag.x) * 0.012; };
  st.onpointerup = st.onpointercancel = () => { creator.drag = null; creator.idleAt = now + 2.5; };
}
function openCreator(mode = 'edit') {
  if (!player) return;
  closeSheet(); if (talking) closeDialog(); cancelTask(); moveTarget = null; keys.clear();
  creator.open = true; creator.mode = mode; creator.yaw = 0.35; creator.idleAt = now + 1; creator.scroll = 0;
  creator.before = { look: { ...S.look }, name: S.name };
  if (mode === 'new' && !S.name) S.name = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
  creator.tab = 'body'; creator.close = false;
  creator.facing = player.root.rotation.y; if (!creator.near0) creator.near0 = camera.near;
  if (!creator.light) { creator.light = new THREE.PointLight('#fff1dc', 9, 12, 1.6); scene.add(creator.light); }
  creator.light.visible = true;
  document.body.classList.add('creating');
  $('creator').hidden = false;
  player.play('Idle');
  renderCreator();
}
function closeCreator(keep) {
  if (!keep && creator.before) {
    const sexWas = S.look.sex;
    S.look = { ...creator.before.look }; S.name = creator.before.name;
    if (S.look.sex !== sexWas) rebuildHero(); else applyLook();
  }
  S.name = cleanName(S.name || '').trim();
  if (!S.name) S.name = 'Hero';
  creator.open = false; $('creator').hidden = true; document.body.classList.remove('creating');
  if (creator.light) creator.light.visible = false;
  camera.clearViewOffset(); camera.near = creator.near0 || 0.1; camera.updateProjectionMatrix();
  player.root.rotation.y = creator.facing;
  updateTitle(); save();
  if (creator.mode === 'new') {
    if (!S.welcomed) { S.welcomed = true; toast(`Welcome to Jerry Village, ${heroName()}! Look for villagers with a ! above their heads.`, null, true); }
    else toast(`Looking good, ${heroName()}!`, ICONS.star);
  }
}
// While the creator is open the camera frames the hero up close, shifted left of the panel.
function creatorCam(dt) {
  const p = player.pos, phone = innerWidth < 760;
  if (!creator.drag && now > creator.idleAt) creator.yaw += (Math.sin(now * 0.5) * 0.45 - creator.yaw) * Math.min(1, dt * 1.2);
  player.root.rotation.y = creator.yaw;
  const headY = 2.5 * (player.headScale || 1) ** 0.3;
  const hs = player.headScale || 1;
  const ty = creator.close ? headY + (hs - 1) * 0.9 : 1.45 + (hs - 1) * 0.6, dist = (creator.close ? 4.2 * hs : 8.2 + (hs - 1) * 3) * (phone ? (creator.close ? 1.9 : 1.5) : 1);
  const want = tmpV.set(p.x, ty + (creator.close ? 0.5 : 1.6), p.z + dist);
  // clip away anything standing between the camera and the hero (bushes, fences)
  const near = Math.max(0.1, dist - 2.2);
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  camPos.lerp(want, 1 - Math.pow(0.0005, dt));
  camera.position.copy(camPos);
  camera.lookAt(p.x, ty, p.z);
  const w = innerWidth, h = innerHeight;
  // shift the picture so the hero sits in the open space: above the panel on phones, left of it on wider screens
  if (phone) camera.setViewOffset(w, h, 0, h * (creator.close ? 0.34 : 0.24), w, h);
  else camera.setViewOffset(w, h, (Math.min(460, w * 0.42) + 24) / 2, 0, w, h);
  creator.light.position.set(p.x + 1.5, ty + 1.2, p.z + 3.5);
}

window.__jq = { openCreator, closeCreator, creator, rebuildHero, setZoom: (z) => { zoom = z; }, hurtEnemy, goThrough, get where() { return where; }, INTERIORS, equipGear, spendPoint, giveHeroXp, heroLvl, stat, maxHp, defDiv, openWeaponShop, openKing, jump, eat, eatBest, openShop, swing, swingTarget, hitNode, projectiles, timers, get S() { return S; }, get player() { return player; }, enemies, nodes, npcs, startTask, doAction, giveXp, save, openSheet, openDialog };
window.addEventListener('error', (e) => { const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${e.message}`; });
main().catch((err) => {
  console.error(err);
  const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${err && err.message ? err.message : err}. Try reloading the page.`;
});
