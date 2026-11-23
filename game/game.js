// JerryQuest: playable single-player slice. One hero shaped by gear and stat points, skills that level by use, gathering, combat and quests.
import { THREE, scene, camera, renderer, sun, sky, PRESETS, env, applyPreset, blendPresets, styled, setStyled, stylize, toon, registerMesh,
  loadModel, burst, updateParticles, render, rng } from './engine.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWorld, buildFlowers, place, tentAt, S_PROP, S_BUILD, colliders, clouds, dynamic, LAKE, CAMP, MINE, S_NATURE, blocked, isFree, ZONES, WORLD_R, VS, TOWNS, ROADS, townFacing } from './world.js';
import { LANDS, VALLEY_DOCK, buildLands, makeSnow, landRoads, SANDS_FX, palmNode, roundNode } from './lands.js';
import { ICONS } from './icons.js';
import { buildInteriors, INTERIORS, lavaPools } from './interiors.js';
import { unlockAudio, playMusic, sfx, setVolumes, fxMute } from './audio.js';
import { net, resume, signIn, signOut, loadCloud, cloudSave, flushSave, refreshBoard, setTown, connect, updateProfile, sendPos, sendChat, cleanChat, sendNet } from './online.js';

const $ = (id) => document.getElementById(id);
let resizeCount = 0; addEventListener('resize', () => { resizeCount++; });
// Labels and bars that follow things on screen: only touch the page when something actually
// changed, and slide them with `translate` (no page re-layout) where the browser supports it.
const CAN_TRANSLATE = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('translate', '1px 1px');
function pin(el, v) { // v is a camera-projected point (-1..1)
  const x = Math.round((v.x * 0.5 + 0.5) * innerWidth * 2) / 2, y = Math.round((-v.y * 0.5 + 0.5) * innerHeight * 2) / 2;
  if (el._px === x && el._py === y) return;
  el._px = x; el._py = y;
  if (CAN_TRANSLATE) { if (!el._pinned) { el._pinned = 1; el.style.left = '0px'; el.style.top = '0px'; } el.style.translate = `${x}px ${y}px`; }
  else { el.style.left = `${x}px`; el.style.top = `${y}px`; }
}
const setShown = (el, on) => { if (el.hidden === on) el.hidden = !on; };
const setW = (el, pct) => { const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`; if (el._w !== w) { el._w = w; el.style.width = w; } };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const clock = new THREE.Clock();
let now = 0;

// ---------- rules ----------
const SKILLS = [
  ['woodcutting', 'Woodcutting'], ['mining', 'Mining'], ['fishing', 'Fishing'], ['crafting', 'Crafting'], ['speed', 'Speed'],
];
const SKILL_NAME = Object.fromEntries(SKILLS);
const XPT = [0, 0];
{ let pts = 0; for (let l = 1; l < 99; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); XPT[l + 1] = Math.floor(pts / 4); } }
const levelOf = (xp) => { let l = 1; while (l < 99 && xp >= XPT[l + 1]) l++; return l; };
// Hero levels: cheap at first, steep later. Going from level L to L+1 costs 60 + 40 × L^1.6 XP,
// so level 1 → 2 is 100 XP, 10 → 11 about 1,650, 50 → 51 about 21,000 and 100 → 101 about 63,500.
const HERO_MAX = 150, HXT = [0, 0];
for (let l = 1; l < HERO_MAX; l++) HXT[l + 1] = HXT[l] + Math.round(60 + 40 * Math.pow(l, 1.6));
const heroLevelOf = (xp) => { let l = 1; while (l < HERO_MAX && xp >= HXT[l + 1]) l++; return l; };

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
  logs: 'Logs', oak_logs: 'Oak logs', copper_ore: 'Copper ore', iron_ore: 'Iron ore', frostsilver_ore: 'Frostsilver ore', shrimp: 'Raw shrimp', trout: 'Raw trout', bones: 'Bones',
  bread: 'Bread', pie: 'Apple pie', stew: 'Hearty stew', grilled_shrimp: 'Grilled shrimp', grilled_trout: 'Grilled trout', fish_pie: 'Fish pie',
  bone_dust: 'Bone dust', dark_essence: 'Dark essence',
  dragon_scale: "Gagron's fire scale", silver_ring: 'Silver ring', ruby: 'Ruby', golden_crown: 'Tiny golden crown', frost_gem: 'Frost gem',
  lucky_sock: "Bonecrusher's lucky sock", frost_crown: "Queen Frostwhisker's ice crown", gloom_hat: "Gloomcaster's droopy hat", rattle_tooth: "Rattlebones' gold tooth",
  dark_omen: 'Dark Omen',
  bogwood_logs: 'Bogwood logs', mireiron_ore: 'Mireiron ore', mire_charm: "Mother Mire's charm", rusty_helm: "Sir Soggington's rusty helm", gobbler_tooth: "The Gobbler's tooth",
  palm_logs: 'Palm logs', sunstone_ore: 'Sunstone', sphinx_coin: 'Sphinx coin', pomp_monocle: "Pompington's golden monocle", colossus_core: 'Colossus core',
};
// Food heals; bought from Marta's stall in the market.
const FOOD = { bread: { heal: 8, price: 8 }, pie: { heal: 20, price: 20 }, stew: { heal: 40, price: 40 }, grilled_shrimp: { heal: 6 }, grilled_trout: { heal: 14 }, fish_pie: { heal: 32 } };
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
  // Chapter 2: Frostsilver, sold by Frida in Snowdrop
  f_blade: { type: 'melee', tier: 2, name: 'Frostsilver blade', dmg: 17, reach: 2.9, cd: 0.85, price: 1400, model: 'sword_1handed', tint: '#9fe6ff' },
  f_maul: { type: 'melee', tier: 2, name: 'Glacier maul', dmg: 24, reach: 3.3, cd: 1.3, price: 2200, model: 'axe_2handed', tint: '#bfefff', heavy: true },
  f_rime: { type: 'magic', tier: 2, name: 'Rime staff', dmg: 17, reach: 14, cd: 1.1, price: 1500, model: 'staff', tint: '#9fe6ff' },
  f_bow: { type: 'ranged', tier: 2, name: 'Icicle crossbow', dmg: 16, reach: 15, cd: 0.75, price: 1500, model: 'crossbow_1handed', tint: '#9fe6ff' },
  a_twin: { type: 'ranged', name: 'Avalanche Twinbow', dmg: 20, reach: 15, cd: 0.6, price: 0, unique: true, model: 'crossbow_2handed', tint: '#e0f4ff' },
  // Chapter 3: Bogwood and Mireiron, sold by Bramblewick in Lilypad Landing. Their poison hurts over time.
  b_sword: { type: 'melee', tier: 3, name: 'Mireiron sword', dmg: 27, reach: 3.0, cd: 0.85, price: 3600, model: 'sword_1handed', tint: '#8adf6a', poison: true },
  b_axe: { type: 'melee', tier: 3, name: 'Mire axe', dmg: 38, reach: 3.4, cd: 1.3, price: 4200, model: 'axe_2handed', tint: '#6aaf4a', heavy: true, poison: true },
  b_staff: { type: 'magic', tier: 3, name: 'Bog staff', dmg: 27, reach: 15, cd: 1.1, price: 3800, model: 'staff', tint: '#8adf6a', poison: true },
  b_bow: { type: 'ranged', tier: 3, name: 'Reed crossbow', dmg: 26, reach: 16, cd: 0.75, price: 3800, model: 'crossbow_1handed', tint: '#b8d87a', poison: true },
  // path weapons: anyone can use them, but only your own path's smith will sell you one
  p_fang: { type: 'melee', tier: 3, path: 'vampire', name: 'Fangblade', dmg: 31, reach: 2.9, cd: 0.7, price: 6000, model: 'dagger', tint: '#e0243a', drain: 0.06 },
  p_radiant: { type: 'magic', tier: 3, path: 'angel', name: 'Radiant staff', dmg: 32, reach: 16, cd: 1.0, price: 6000, model: 'staff', tint: '#fff2a0' },
  p_great: { type: 'melee', tier: 3, path: 'human', name: 'Steel greatsword', dmg: 44, reach: 3.6, cd: 1.25, price: 6000, model: 'sword_2handed_color', tint: '#e8eef6', heavy: true },
  k_tongue: { type: 'melee', name: "Gobbler's Tongue", dmg: 36, reach: 4.4, cd: 0.95, price: 0, unique: true, model: 'sword_1handed', tint: '#ff7aa8', poison: true },
  // Chapter 4: Sunsteel, forged by Professor Tinkerwell at Oasis Rest from Sunstone. It burns brighter by day (+15% damage).
  s_sword: { type: 'melee', tier: 4, name: 'Sunsteel sword', dmg: 40, reach: 3.1, cd: 0.8, price: 9000, model: 'sword_1handed', tint: '#ffcf5a', sun: true },
  s_hammer: { type: 'melee', tier: 4, name: 'Sunsteel warhammer', dmg: 58, reach: 3.5, cd: 1.3, price: 11000, model: 'axe_2handed', tint: '#ffb347', heavy: true, sun: true },
  s_staff: { type: 'magic', tier: 4, name: 'Sunburst staff', dmg: 40, reach: 16, cd: 1.05, price: 9500, model: 'staff', tint: '#ffe27a', sun: true },
  s_bow: { type: 'ranged', tier: 4, name: 'Brassbolt crossbow', dmg: 38, reach: 17, cd: 0.7, price: 9500, model: 'crossbow_1handed', tint: '#d8a850', sun: true },
  p_night: { type: 'melee', tier: 4, path: 'vampire', name: 'Nightfang', dmg: 46, reach: 3.0, cd: 0.65, price: 15000, model: 'dagger', tint: '#8a0a2a', drain: 0.08 },
  p_dawn: { type: 'magic', tier: 4, path: 'angel', name: 'Dawnbringer', dmg: 48, reach: 17, cd: 0.95, price: 15000, model: 'staff', tint: '#ffffff' },
  p_cog: { type: 'melee', tier: 4, path: 'human', name: 'Clockwork greatsword', dmg: 66, reach: 3.8, cd: 1.2, price: 15000, model: 'sword_2handed_color', tint: '#d8a850', heavy: true },
  k_colossus: { type: 'melee', name: 'Colossus Fist', dmg: 72, reach: 3.9, cd: 1.35, price: 0, unique: true, model: 'axe_2handed', tint: '#ffd23f', heavy: true },
  a_pomp: { type: 'ranged', name: "Pompington's Popgun", dmg: 30, reach: 16, cd: 0.42, price: 0, unique: true, model: 'crossbow_2handed', tint: '#ffe28a' },
  // MYTHIC: the rarest things in the game. A tiny chance from Chapter 4 bosses and the world boss.
  my_star: { type: 'melee', name: 'Starfall Blade', dmg: 92, reach: 3.7, cd: 0.95, price: 0, unique: true, mythic: true, model: 'sword_2handed_color', tint: '#ff6ab0', heavy: true },
  my_root: { type: 'magic', name: 'Worldroot Staff', dmg: 80, reach: 19, cd: 0.95, price: 0, unique: true, mythic: true, model: 'staff', tint: '#7affc8' },
  my_dawn: { type: 'ranged', name: 'Dawnbreaker', dmg: 46, reach: 20, cd: 0.55, price: 0, unique: true, mythic: true, model: 'crossbow_2handed', tint: '#fff6d0' },
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
  sh_frost: { slot: 'shield', tier: 2, name: 'Frostsilver shield', def: 10, price: 1200, model: 'shield_square_color' },
  ar_frost: { slot: 'armour', tier: 2, name: 'Frostsilver plate', def: 11, price: 1600, tint: '#bfefff' },
  sh_mire: { slot: 'shield', tier: 3, name: 'Mireiron shield', def: 16, price: 3400, model: 'shield_spikes_color' },
  ar_mire: { slot: 'armour', tier: 3, name: 'Mireiron plate', def: 18, price: 4600, tint: '#9adf7a' },
  sh_sun: { slot: 'shield', tier: 4, name: 'Sunsteel shield', def: 24, price: 8000, model: 'shield_square_color' },
  ar_sun: { slot: 'armour', tier: 4, name: 'Sunsteel plate', def: 27, price: 10500, tint: '#ffd27a' },
  // gadgets: Professor Tinkerwell's clockwork trinkets. One gadget slot, a small bonus each.
  g_spring: { slot: 'gadget', tier: 4, name: 'Springheel boots', def: 0, price: 6000, bonus: { speed: 0.1 }, desc: '+10% speed' },
  g_lens: { slot: 'gadget', tier: 4, name: 'Brass aiming lens', def: 0, price: 7000, bonus: { dmg: 0.1 }, desc: '+10% damage' },
  g_cog: { slot: 'gadget', tier: 4, name: 'Cog ward', def: 0, price: 7000, bonus: { def: 0.12 }, desc: '+12% defense' },
  g_heart: { slot: 'gadget', name: 'Clockwork heart', def: 0, price: 0, unique: true, bonus: { dmg: 0.06, def: 0.06, hp: 0.06, speed: 0.04 }, desc: '+6% damage, defense and health, +4% speed' },
};
for (const w of Object.values(WEAPONS)) w.slot = 'weapon';
const GEAR = { ...WEAPONS, ...ARMOUR };
// spare gear sells back to the smiths for half price; boss weapons are worth a fortune
// ---------- rarity: Common, Uncommon, Rare, Epic, Legendary, Mythic ----------
// The top three barely show up before the late game. Mythics are a handful of things in the whole world.
const RARITY = [
  { id: 'common', name: 'Common', col: '#a89c88', sell: 1 }, { id: 'fine', name: 'Uncommon', col: '#4cb35a', sell: 1.3 },
  { id: 'rare', name: 'Rare', col: '#3a86e0', sell: 1.8 }, { id: 'epic', name: 'Epic', col: '#a04ae0', sell: 2.6 },
  { id: 'legendary', name: 'Legendary', col: '#ff9a1a', sell: 4 }, { id: 'mythic', name: 'Mythic', col: '#ff3a7a', sell: 8 },
];
const RAR_IX = Object.fromEntries(RARITY.map((r, i) => [r.id, i]));
function gearRarIx(g) {
  if (!g) return 0;
  if (g.mythic) return 5;
  if (g.unique) return g.dmg >= 60 || g.def >= 30 ? 4 : g.dmg >= 28 || g.def >= 15 ? 3 : 2;
  if (g.tier === 4) return g.path ? 4 : 3;
  if (g.tier === 3) return 2;
  if (g.tier === 2) return 1;
  return g.price >= 150 ? 1 : 0;
}
// shop gear always sells for less than it costs (half, up to three quarters for the rarest), so buying to sell never pays
const gearValue = (g) => Math.floor(g.unique ? [100, 200, 400, 1500, 6000, 40000][gearRarIx(g)] : g.price * [0.5, 0.55, 0.6, 0.65, 0.7, 0.75][gearRarIx(g)]);
const gearIcon = (g) => (g.slot === 'weapon' ? ICONS[g.type] : ICONS[g.slot]);
const gearStats = (g) => (g.slot === 'weapon'
  ? `${g.dmg} dmg · ${g.type === 'melee' ? 'reach' : 'range'} ${g.reach} · ${g.cd}s · ${SPECIALS[specialOf(g)].name}${g.sun ? ' · +15% by day' : ''}`
  : g.slot === 'gadget' ? g.desc : `+${g.def} defense`);
// the equipped gadget's bonus for one stat (dmg, def, hp or speed), as a multiplier
const gadgetMult = (k) => 1 + (((ARMOUR[S.equip.gadget] || {}).bonus || {})[k] || 0);

// Who drops what. Regular monsters roll this table; bosses always drop their trophy and may drop their weapon.
const BOSS_WEAPON = { boss_gagron: 'k_flame', boss_crusher: 'k_cleaver', boss_gloom: 'm_gloom', boss_rattle: 'a_rattle', boss_twin_a: 'a_twin', boss_gobbler: 'k_tongue', boss_colossus: 'k_colossus', boss_pomp: 'a_pomp' };
const DARK_KING = 'Morgoth the Menacing'; // working name, change it here
// Everything can be sold. Treasures (rings, rubies, crowns) are rare drops worth a lot.
const SELL = { palm_logs: 22, sunstone_ore: 70, sphinx_coin: 600, pomp_monocle: 900, colossus_core: 1500, bogwood_logs: 14, mireiron_ore: 40, mire_charm: 500, rusty_helm: 500, gobbler_tooth: 800, grilled_shrimp: 5, grilled_trout: 12, fish_pie: 26, dragon_scale: 90, bread: 4, pie: 10, stew: 20, silver_ring: 40, ruby: 120, golden_crown: 400, frost_gem: 260, bone_dust: 3, dark_essence: 15, lucky_sock: 60, frost_crown: 300, gloom_hat: 60, rattle_tooth: 60, dark_omen: 500, logs: 3, oak_logs: 6, copper_ore: 4, iron_ore: 8, frostsilver_ore: 22, shrimp: 3, trout: 8, bones: 2 };
const NODES = {
  tree: { skill: 'woodcutting', req: 1, xp: 25, item: 'logs', name: 'Tree', verb: 'Chop', doing: 'Chopping', deplete: 0.3, respawn: 14 },
  oak: { skill: 'woodcutting', req: 5, xp: 40, item: 'oak_logs', name: 'Oak tree', verb: 'Chop', doing: 'Chopping', deplete: 0.22, respawn: 20 },
  copper: { skill: 'mining', req: 1, xp: 18, item: 'copper_ore', name: 'Copper rock', verb: 'Mine', doing: 'Mining', deplete: 0.6, respawn: 10 },
  bogwood: { skill: 'woodcutting', req: 30, xp: 110, item: 'bogwood_logs', name: 'Bogwood tree', verb: 'Chop', doing: 'Chopping', deplete: 0.3, respawn: 26 },
  palm: { skill: 'woodcutting', req: 40, xp: 160, item: 'palm_logs', name: 'Desert palm', verb: 'Chop', doing: 'Chopping', deplete: 0.3, respawn: 28 },
  sunstone: { skill: 'mining', req: 40, xp: 180, item: 'sunstone_ore', name: 'Sunstone rock', verb: 'Mine', doing: 'Mining', deplete: 0.75, respawn: 30, sun: true },
  mireiron: { skill: 'fishing', req: 30, xp: 120, item: 'mireiron_ore', name: 'Mireiron in the deep pool', verb: 'Fish', doing: 'Fishing up', deplete: 0, respawn: 0 },
  frostsilver: { skill: 'mining', req: 15, xp: 70, item: 'frostsilver_ore', name: 'Frostsilver rock', verb: 'Mine', doing: 'Mining', deplete: 0.75, respawn: 24 },
  iron: { skill: 'mining', req: 6, xp: 35, item: 'iron_ore', name: 'Iron rock', verb: 'Mine', doing: 'Mining', deplete: 0.7, respawn: 18 },
  shrimp: { skill: 'fishing', req: 1, xp: 12, item: 'shrimp', name: 'Shrimp spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
  trout: { skill: 'fishing', req: 5, xp: 45, item: 'trout', name: 'Trout spot', verb: 'Fish', doing: 'Fishing', deplete: 0, respawn: 0 },
};
// How many hits of health each tree/rock has, and the size of its hitbox.
const NODE_HP = { tree: 5, oak: 9, copper: 5, iron: 8, frostsilver: 11, bogwood: 14, palm: 16, sunstone: 16 };
const ENEMY_TYPES = {
  skel_minion: { name: 'Skeleton', hp: 12, maxHit: 3, weapon: 'Skeleton_Blade', xp: 15 },
  skel_warrior: { name: 'Skeleton Warrior', hp: 28, maxHit: 5, weapon: 'Skeleton_Blade', xp: 30 },
  skel_mage: { name: 'Skeleton Mage', hp: 22, maxHit: 4, weapon: 'Skeleton_Staff', xp: 25, ranged: true },
  // minibosses: big, tough, and every third attack is a giant slam you can see coming (jump or run!)
  boss_crusher: { name: 'Bonecrusher', model: 'skel_warrior', stuck: 2.2, stuckLine: 'Axe stuck! Mum!', hp: 280, maxHit: 8, weapon: 'axe_2handed', xp: 800, boss: true, scale: 2.5, coins: [90, 150], drop: 'lucky_sock', slam: 5.5 },
  boss_gloom: { name: 'Gloomcaster', model: 'skel_mage', hp: 230, maxHit: 7, weapon: 'Skeleton_Staff', xp: 800, boss: true, scale: 2.3, coins: [90, 150], drop: 'gloom_hat', ranged: true, spread: true, slam: 4.5 },
  // the first story boss: a fire dragon in a cave north-east of the castle. Breathes fire and rains fireballs.
  boss_gagron: { name: 'Gagron the Hideous', model: 'dragon', hp: 400, maxHit: 7, xp: 900, boss: true, dragon: true, scale: 2.1, coins: [120, 200], drop: 'dragon_scale', inside: 'cave', noBones: true },
  boss_rattle: { name: 'Captain Rattlebones', model: 'skel_minion', hp: 250, maxHit: 7, weapon: 'Skeleton_Blade', xp: 800, boss: true, scale: 2.3, coins: [90, 150], drop: 'rattle_tooth', slam: 6 },
  gloom_shadow: { name: 'Shadow copy', model: 'skel_mage', hp: 14, maxHit: 5, weapon: 'Skeleton_Staff', xp: 20, ranged: true, scale: 2.1, tint: '#4a2a6a', coins: [0, 2] },
  // Chapter 2, Frostwhisker Peaks: icy skeletons that hit harder and give much more XP
  frost_minion: { name: 'Frost Skeleton', model: 'skel_minion', hp: 48, maxHit: 7, weapon: 'Skeleton_Blade', xp: 70, tint: '#bfe6ff', inside: 'frost', coins: [10, 22] },
  frost_warrior: { name: 'Icebone Warrior', model: 'skel_warrior', hp: 80, maxHit: 9, weapon: 'Skeleton_Blade', xp: 120, tint: '#9fd0ff', inside: 'frost', coins: [16, 30] },
  frost_mage: { name: 'Frost Caster', model: 'skel_mage', hp: 56, maxHit: 8, weapon: 'Skeleton_Staff', xp: 100, ranged: true, tint: '#d8c8ff', inside: 'frost', coins: [14, 26] },
  boss_grumble: { name: 'Grumblefrost', title: 'Ogre of the Pass', model: 'barbarian', hp: 1000, maxHit: 13, weapon: 'axe_2handed', xp: 4000, boss: true, scale: 2.7, coins: [250, 380], drop: 'frost_gem', slam: 6, stuck: 2.2, stuckLine: 'Axe... frozen... in ice!', inside: 'frost', tint: '#e8f4ff',
    look: { skin: 'porcelain', eyes: 'sky', eyeStyle: 'sleepy', mouth: 'fang', hair: 'none', beard: 'full', hairCol: 'snow', head: 'chibi' } },
  boss_twin_a: { name: 'Avalanche Twin: Hail', title: 'The Avalanche Twins', model: 'archer', hp: 1200, maxHit: 12, weapon: 'crossbow_1handed', xp: 3000, boss: true, scale: 2.2, coins: [200, 300], drop: 'frost_gem', ranged: true, inside: 'frost', tint: '#cfe8ff', twin: 'boss_twin_b',
    look: { skin: 'peach', eyes: 'blue', eyeStyle: 'sharp', mouth: 'grin', hair: 'spiky', hairCol: 'snow' } },
  boss_twin_b: { name: 'Avalanche Twin: Sleet', title: 'The Avalanche Twins', model: 'mage', hp: 1200, maxHit: 12, weapon: 'Skeleton_Staff', xp: 3000, boss: true, scale: 2.2, coins: [200, 300], drop: 'frost_gem', ranged: true, spread: true, slam: 5, inside: 'frost', tint: '#e0d8ff', twin: 'boss_twin_a',
    look: { sex: 'f', skin: 'peach', eyes: 'blue', eyeStyle: 'sharp', mouth: 'cat', hair: 'pony', hairLen: 'long', hairCol: 'snow' } },
  thaw_shadow: { name: 'Shadow Wolf', model: 'skel_minion', hp: 70, maxHit: 9, weapon: 'Skeleton_Blade', xp: 90, tint: '#5a3a8a', inside: 'frost', coins: [8, 16] },
  // Chapter 3: Gobbler Marsh. Slimes and bats are Quaternius' low-poly monsters (CC0).
  bog_slime: { name: 'Bog Slime', model: 'slime', hp: 150, maxHit: 15, xp: 260, inside: 'marsh', coins: [22, 40], scale: 0.9, noBones: true, poof: true, mass: 1.4,
    alias: { Idle: 'Slime_Idle', Idle_Combat: 'Slime_Idle', Running_A: 'Slime_Walk', Walking_A: 'Slime_Walk', Hit_A: 'Slime_Idle', Death_A: 'Slime_Death', '1H_Melee_Attack_Chop': 'Slime_Attack', '2H_Melee_Attack_Chop': 'Slime_Attack', Spellcast_Shoot: 'Slime_Attack', Spellcasting: 'Slime_Attack' } },
  mud_gloop: { name: 'Mud Gloop', model: 'slime', hp: 130, maxHit: 14, xp: 200, inside: 'marsh', coins: [14, 26], scale: 0.8, noBones: true, poof: true, tintAll: '#9a7a52', mass: 1.2 },
  mire_bat: { name: 'Mire Bat', model: 'bat', hp: 110, maxHit: 14, xp: 240, inside: 'marsh', coins: [18, 34], scale: 0.8, noBones: true, poof: true, fly: 1.6, mass: 0.7,
    alias: { Idle: 'Bat_Flying', Idle_Combat: 'Bat_Flying', Running_A: 'Bat_Flying', Walking_A: 'Bat_Flying', Hit_A: 'Bat_Hit', Death_A: 'Bat_Death', '1H_Melee_Attack_Chop': 'Bat_Attack', '2H_Melee_Attack_Chop': 'Bat_Attack2', Spellcast_Shoot: 'Bat_Attack', Spellcasting: 'Bat_Attack2' } },
  bog_knight: { name: 'Bog Knight', model: 'skel_warrior', hp: 190, maxHit: 17, weapon: 'Skeleton_Blade', xp: 320, tint: '#9ac08a', inside: 'marsh', coins: [26, 46] },
  bog_witchling: { name: 'Marsh Witchling', model: 'skel_mage', hp: 150, maxHit: 16, weapon: 'Skeleton_Staff', xp: 300, ranged: true, tint: '#b8e09a', inside: 'marsh', coins: [24, 42] },
  boss_mire: { name: 'Mother Mire', title: 'Bog Witch of Mire Hollow', model: 'mage', hp: 1700, maxHit: 18, weapon: 'Skeleton_Staff', xp: 9000, boss: true, scale: 2.3, coins: [400, 600], drop: 'mire_charm', ranged: true, spread: true, slam: 5, inside: 'marsh', tint: '#a8d890',
    look: { sex: 'f', skin: 'green', eyes: 'gold', eyeStyle: 'sharp', mouth: 'fang', hair: 'long', hairLen: 'long', hairCol: 'snow', mark: 'paint', ears: 'elf' } },
  boss_sogg: { name: 'Sir Soggington', title: 'The Sunken Knight', model: 'knight', hp: 1900, maxHit: 19, weapon: 'sword_2handed_color', xp: 10000, boss: true, scale: 2.4, coins: [450, 650], drop: 'rusty_helm', slam: 5.5, stuck: 2.4, stuckLine: 'Glub! Water in me boots!', inside: 'marsh', tint: '#9ab0a0',
    look: { skin: 'blue', eyes: 'grey', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', beard: 'full', hairCol: 'green', hat: true } },
  // Chapter 4: Brassbolt Sands
  sand_gloop: { name: 'Sand Gloop', model: 'slime', hp: 230, maxHit: 21, xp: 420, inside: 'sands', coins: [34, 60], scale: 0.95, noBones: true, poof: true, tintAll: '#e8c070', mass: 1.4 },
  dust_bat: { name: 'Dust Bat', model: 'bat', hp: 170, maxHit: 20, xp: 380, inside: 'sands', coins: [28, 52], scale: 0.85, noBones: true, poof: true, fly: 1.7, mass: 0.7, tintAll: '#a8784a' },
  clock_soldier: { name: 'Clockwork Soldier', model: 'skel_warrior', hp: 290, maxHit: 24, weapon: 'Skeleton_Blade', xp: 520, tint: '#e0b058', inside: 'sands', coins: [40, 70], noBones: true },
  clock_conjurer: { name: 'Copper Conjurer', model: 'skel_mage', hp: 230, maxHit: 23, weapon: 'Skeleton_Staff', xp: 480, ranged: true, tint: '#d8885a', inside: 'sands', coins: [38, 66], noBones: true },
  boss_pomp: { name: 'Sir Percival Pompington', title: 'In a Stolen Battle-Suit', model: 'knight', hp: 3400, maxHit: 24, weapon: 'sword_2handed_color', xp: 20000, boss: true, scale: 2.2, coins: [800, 1100], drop: 'pomp_monocle', slam: 5.5, inside: 'sands', suit: '#ffcf5a' },
  boss_colossus: { name: 'The Brassbolt Colossus', title: 'Guardian of the Old Kingdom', model: 'skel_warrior', hp: 5200, maxHit: 28, weapon: 'axe_2handed', xp: 32000, boss: true, scale: 5.2, coins: [1200, 1600], drop: 'colossus_core', slam: 7, inside: 'sands', tintAll: '#d8a850', noBones: true, mass: 30 },
  boss_gobbler: { name: 'The Gobbler', title: 'Terror of Gobbler Marsh', model: 'slime', hp: 2600, maxHit: 21, xp: 15000, boss: true, scale: 3.4, coins: [600, 900], drop: 'gobbler_tooth', slam: 7, inside: 'marsh', noBones: true, tintAll: '#7ab05a', mass: 20 },
  boss_frost: { name: 'Queen Frostwhisker', model: 'mage', hp: 1400, maxHit: 13, weapon: 'Skeleton_Staff', xp: 3000, boss: true, scale: 2.4, coins: [300, 450], drop: 'frost_crown', ranged: true, spread: true, slam: 5.5, inside: 'frost', tint: '#cfeaff',
    look: { sex: 'f', skin: 'porcelain', eyes: 'sky', eyeStyle: 'sharp', mouth: 'cat', hair: 'hime', hairLen: 'long', hairCol: 'snow', mark: 'star', ears: 'elf' } },
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
    story: true, chapter: 'Prologue', name: 'Darkness Stirs', giver: 'king', after: [],
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
    ready: 'The Hollow shard, cold as moonlight. All four pieces are home... and yet the Heartstone will not mend. Come back and speak with me.', done: 'The shards are home, but something is still wrong with the Heartstone.',
    need: { boss: 1 }, reward: { coins: 150, xp: { hero: 500 } }, desc: 'Defeat Captain Rattlebones in Haunted Hollow (north).',
  },
  st_socket: {
    story: true, chapter: 'Chapter 1', name: 'The Empty Socket', giver: 'king', after: ['st_crags', 'st_glimmer', 'st_hollow'],
    intro: `All four shards sit in the Heartstone, but look: there is a hole right in its heart, where the core should be. Old Fenwick says a powder of ground bones can show whose hands last touched it. Bring me 6 bones from the skeletons and we shall see.`,
    ready: 'Fenwick sprinkles the powder... and the throne room glows! Scratch marks, all around the socket, from the INSIDE. Someone in this very room pried the core loose on purpose. And look: a footprint from a very shiny boot.',
    done: 'Someone close to the throne cracked the Heartstone. Until we know who, the core is lost. A cold wind blows from the north. Take the ship at the lake pier to Frostwhisker Peaks.',
    need: { bones: 6 }, reward: { coins: 250, xp: { hero: 1200 } }, desc: 'Bring King Jerrold 6 bones for Fenwick\'s revealing powder.',
  },
  // Chapter 2: a new land. Sail from the pier on the village lake to Frostwhisker Peaks.
  st_frost1: {
    story: true, chapter: 'Chapter 2', name: 'The Frozen North', giver: 'elder', after: ['st_socket'], land: 'frost',
    intro: 'Brr! You came all the way from Jerry Valley? Then you felt it too: the cold that crept south the night your Heartstone cracked. Queen Frostwhisker has woken up in her Ice Palace, and her frost skeletons are everywhere. Clear a few of them out of our woods and hills, and then we can talk about the Queen.',
    ready: 'You fought them off! Snowdrop has not been this brave in years. Come, warm your hands, and I will tell you about the Queen.', done: 'Snowdrop is safer thanks to you. The Queen still sits in her Ice Palace to the north.',
    need: { kills: 6 }, reward: { coins: 300, xp: { hero: 2500 } }, desc: 'Defeat 6 frost monsters in Frostwhisker Peaks.',
  },
  st_grumble: {
    story: true, chapter: 'Chapter 2', name: 'The Ogre of the Pass', giver: 'elder', after: ['st_frost1'], bossType: 'boss_grumble', land: 'frost',
    intro: 'The path to the Ice Palace is blocked by Grumblefrost, a snow ogre the size of a house. He rolls snowballs bigger than my cottage. When you see the long line on the ground, get out of its way! And when his axe sticks in the ice, hit him hard.',
    ready: 'Grumblefrost is snoring in a snowdrift! The pass is open.', done: 'The pass to the palace is clear, thanks to you.',
    need: { boss: 1 }, reward: { coins: 600, xp: { hero: 6000 } }, desc: 'Defeat Grumblefrost on the path to the Ice Palace (north of Snowdrop).',
  },
  st_twins: {
    story: true, chapter: 'Chapter 2', name: 'The Avalanche Twins', giver: 'elder', after: ['st_grumble'], bossType: 'boss_twin_a', land: 'frost',
    intro: 'Hail and Sleet, the Avalanche Twins, guard Snowman Hills for the Queen. They share one strength between them: hurt one and the other gets furious. Bring a friend if you can, one for each twin!',
    ready: 'Both twins beaten at once! The snowmen are cheering. Well, they would be, if they could move.', done: 'Snowman Hills is quiet again.',
    need: { boss: 1 }, reward: { coins: 700, xp: { hero: 7000 } }, desc: 'Defeat the Avalanche Twins in Snowman Hills (east).',
  },
  st_frost_boss: {
    story: true, chapter: 'Chapter 2', name: 'The Ice Queen', giver: 'elder', after: ['st_twins'], bossType: 'boss_frost', land: 'frost',
    intro: 'Queen Frostwhisker wants every land frozen solid, yours included. She thinks the cracked Heartstone means nobody can stop her. Her Ice Palace is straight north up the snowy path. Watch for her icy blasts, and when the ground glows, move!',
    ready: 'The Queen is beaten and the snow is just snow again! You are a hero of the north as well as the valley.', done: 'Frostwhisker Peaks is free. The Queen sulks in her palace, much less frosty.',
    need: { boss: 1 }, reward: { coins: 800, xp: { hero: 8000 } }, desc: 'Defeat Queen Frostwhisker in the Ice Palace (north).',
  },
  st_thaw: {
    story: true, chapter: 'Chapter 2', name: 'Thaw', giver: 'elder', after: ['st_frost_boss'], land: 'frost', onStart: () => startThaw(),
    intro: 'Oh dear, oh dear. The Queen was right: her cold was holding the darkness back. The Wardstone of the North is cracking, and shadow wolves are coming for it. She will re-freeze it, but she needs time. Go to the palace and hold them off!',
    ready: 'The Wardstone is frozen solid again! The Queen sends her thanks... and a warning. A man in VERY shiny armour came to her palace last month, asking all about Wardstones.',
    done: 'The north is safe. But who was the shiny man? Captain Barnaby can sail you south to Gobbler Marsh for Chapter 3.',
    need: { kills: 12 }, reward: { coins: 1200, xp: { hero: 12000 } }, desc: 'Defend the Wardstone at the Ice Palace: defeat 12 shadow wolves or frost monsters.',
  },
  // Chapter 3: Gobbler Marsh. Captain Barnaby sails there once the north is safe.
  st_marsh1: {
    story: true, chapter: 'Chapter 3', name: 'Welcome to the Murk', giver: 'croakley', after: ['st_thaw'], land: 'marsh',
    intro: 'Ribbit! Oh! Sorry, a visitor. I am Mayor Croakley of Lilypad Landing. Things keep VANISHING here: boots, boats, a whole bridge last Tuesday. Something is eating the marsh. And now slimes and bats are everywhere. Thin them out for us, would you?',
    ready: 'The bog is a bit less bitey already! Now, about those vanishing bridges...', done: 'Lilypad Landing breathes easier, thanks to you.',
    need: { kills: 8 }, reward: { coins: 1500, xp: { hero: 20000 } }, desc: 'Defeat 8 monsters in Gobbler Marsh.',
  },
  st_mire: {
    story: true, chapter: 'Chapter 3', name: 'Mother Mire', giver: 'croakley', after: ['st_marsh1'], bossType: 'boss_mire', land: 'marsh',
    intro: 'Mother Mire, the bog witch of Mire Hollow, says she is guarding the Marsh Wardstone from "the Gobbler". But her cauldron bubbles all night, and things vanish whenever it does. Go and ask her some questions. Politely! With your sword out.',
    ready: 'So she was FEEDING the Gobbler? For a promise of being young again? Oh, that is dreadful. And very on-brand for a witch.', done: 'Mire Hollow is quiet. The cauldron has gone cold.',
    need: { boss: 1 }, reward: { coins: 2500, xp: { hero: 30000 } }, desc: 'Defeat Mother Mire in Mire Hollow (west).',
  },
  st_sogg: {
    story: true, chapter: 'Chapter 3', name: 'The Sunken Knight', giver: 'croakley', after: ['st_mire'], bossType: 'boss_sogg', land: 'marsh',
    intro: 'A knight has risen out of the Sunken Ruins! Rusty, soggy and VERY cross. Mother Mire must have woken him. He has been underwater for a hundred years, so he might know where the Wardstone went. Beat some sense into him!',
    ready: 'Sir Soggington says the Wardstone is in the Gobbler\'s BELLY? Well, that explains the burping.', done: 'Sir Soggington dries out by the well now, teaching sword drills to the tadpoles.',
    need: { boss: 1 }, reward: { coins: 2800, xp: { hero: 34000 } }, desc: 'Defeat Sir Soggington in the Sunken Ruins (east).',
  },
  st_lantern: {
    story: true, chapter: 'Chapter 3', name: 'Lantern Night', giver: 'croakley', after: ['st_sogg'], land: 'marsh', onStart: () => startLanternNight(),
    intro: 'The Gobbler only comes up for light. Tonight the whole village floats lanterns! Light the five lantern posts around the marsh. Mud gloops will try to snuff you out, so be quick, and bring friends!',
    ready: 'All five lanterns are glowing! Look... out in Gobbler\'s Pool. Two big yellow eyes. It is coming up.', done: 'The lanterns still float on the pool. They look lovely, actually.',
    need: { lanterns: 5 }, reward: { coins: 2000, xp: { hero: 26000 } }, desc: 'Light the 5 lantern posts around Gobbler Marsh.',
  },
  st_gobbler: {
    story: true, chapter: 'Chapter 3', name: 'The Gobbler', giver: 'croakley', after: ['st_lantern'], bossType: 'boss_gobbler', land: 'marsh',
    intro: 'The Gobbler is awake in its pool, north of the village. It lashes with its tongue, hides under the lily pads, and if it catches you... it SWALLOWS you. If that happens, wriggle! Mash attack and it will spit you out.',
    ready: 'You beat the Gobbler! And it coughed up the Wardstone... but look. It has split in two.', done: 'The Gobbler sulks at the bottom of its pool. It has gone vegetarian.',
    need: { boss: 1 }, reward: { coins: 4000, xp: { hero: 50000 } }, desc: "Defeat the Gobbler in Gobbler's Pool (north).",
  },
  st_choice: {
    story: true, chapter: 'Chapter 3', name: 'Light or Dark', giver: 'croakley', after: ['st_gobbler'], land: 'marsh', onStart: () => openPathChoice(),
    intro: 'The Marsh Wardstone has split into a black half and a white half. They hum when you come near. Mother Mire says whoever touches them first takes in their power. Dark, light... or neither. Choose carefully, hero. (The King\'s wizard can undo it later, for a price.)',
    ready: 'It is done. The halves have gone quiet. You feel... different.', done: 'You made your choice at the Marsh Wardstone.',
    need: { choice: 1 }, reward: { coins: 3000, xp: { hero: 30000 } }, desc: 'Touch the Wardstone halves and choose: Vampire, Angel or Human. (Talk to Mayor Croakley.)',
  },
  // Chapter 4: Brassbolt Sands. Captain Barnaby sails there once you have chosen your path.
  st_sand1: {
    story: true, chapter: 'Chapter 4', name: 'Sand in Everything', giver: 'tinkerwell', after: ['st_choice'], land: 'sands',
    intro: 'Ah! A visitor! Mind the gears. I am Professor Tinkerwell, last engineer of old Brassbolt. Under this sand sleeps a whole clockwork kingdom, and something is WINDING IT BACK UP. Clockwork soldiers marching about, sand gloops in my socks... Clear some out so I can think!',
    ready: 'Splendid! Those soldiers had fresh oil in their joints. Someone is maintaining them. Someone with very shiny taste.', done: 'Oasis Rest can hear itself think again.',
    need: { kills: 10 }, reward: { coins: 5000, xp: { hero: 45000 } }, desc: 'Defeat 10 monsters in Brassbolt Sands.',
  },
  st_sphinx: {
    story: true, chapter: 'Chapter 4', name: 'The Sphinx Engine', giver: 'tinkerwell', after: ['st_sand1'], land: 'sands',
    intro: 'The Sphinx Engine guards the old kingdom\'s memory. It knows where the Desert Wardstone went, but it only talks to people who answer its riddles. Three right answers. Wrong answers make it... cross. Its voicebox, Cogsworth, stands between its paws.',
    ready: 'Three riddles! You clever thing. And it said the Wardstone was taken to power "the Colossus"? Oh no. Oh no no no.', done: 'The Sphinx Engine purrs when you walk past now.',
    need: { riddles: 3 }, reward: { coins: 4000, xp: { hero: 40000 } }, desc: 'Answer 3 riddles at the Sphinx Engine (west). Talk to Cogsworth.',
  },
  st_storm: {
    story: true, chapter: 'Chapter 4', name: 'Sandstorm', giver: 'tinkerwell', after: ['st_sphinx'], land: 'sands', onStart: () => startSandstorm(),
    intro: 'A SANDSTORM! And my supply caravan was out in it! Four crates of parts are scattered across the dunes. I need them to build something that can stop the Colossus. Find them before the dust bats do. Stick together out there!',
    ready: 'All four crates! Gears, springs, a lens, and... a very fancy invitation with a gold seal? "To Sir Percival Pompington, from His Darkness." Uh oh.', done: 'The storm has passed. The dunes are all different shapes now.',
    need: { crates: 4 }, reward: { coins: 4500, xp: { hero: 42000 } }, desc: 'Find the 4 lost caravan crates in the sandstorm.',
  },
  st_pomp: {
    story: true, chapter: 'Chapter 4', name: 'The Shiny Traitor', giver: 'tinkerwell', after: ['st_storm'], bossType: 'boss_pomp', land: 'sands',
    intro: 'Pompington is working for the Dark King! He has stolen my battle-suit from Rustwind Yard: rockets, a big sword, the lot. He was promised "glory beyond measure". Go and get my suit back. Try not to dent it. Actually, dent it as much as you like.',
    ready: 'He cried? In the suit? Oh dear. Well, he says the Dark King promised to make him famous, then sent him a letter calling him "the shiny one" and never wrote again. Poor silly man.', done: 'Pompington is polishing pots at Oasis Rest to say sorry. Slowly.',
    need: { boss: 1 }, reward: { coins: 7000, xp: { hero: 60000 } }, desc: 'Defeat Sir Percival Pompington in Rustwind Yard (east).',
  },
  st_colossus: {
    story: true, chapter: 'Chapter 4', name: 'The Brassbolt Colossus', giver: 'tinkerwell', after: ['st_pomp'], bossType: 'boss_colossus', land: 'sands',
    intro: 'The Colossus is awake in its plaza, north of here, with the Wardstone ticking in its chest. Watch its fists: when one gets stuck in the ground, a gear pops loose. Hit it there! When its knees glow, JUMP its laser, or stand on a glowing pressure plate to short it out. At the end its core opens. That is your moment!',
    ready: 'You did it! The Colossus is down and the Wardstone is safe. But... why is the sky going dark over the dunes?', done: 'The Colossus sits quietly in its plaza. Children climb on it now.',
    need: { boss: 1 }, reward: { coins: 10000, xp: { hero: 90000 } }, desc: 'Defeat the Brassbolt Colossus in Colossus Plaza (north).',
  },
  st_castle: {
    story: true, chapter: 'Chapter 4', name: 'The Floating Castle', giver: 'tinkerwell', after: ['st_colossus'], land: 'sands',
    intro: 'Something huge is rising behind the plaza. Go to the lookout on the north road and see what it is. Take your friends. Take biscuits.',
    ready: 'A castle. Floating. With purple windows. That is HIS castle, hero. The Dark King\'s. And it is flying towards the valley.', done: 'The Floating Castle hangs in the sky. Chapter 5 is coming soon!',
    need: { castle: 1 }, reward: { coins: 6000, xp: { hero: 50000 } }, desc: 'Go to the lookout north of Oasis Rest and see what is rising.',
  },
});
// The story is split into chapters, and each new chapter takes you to a new land.
// The Prologue and Chapters 1 to 4 are playable; Chapter 5 is the plan.
const CHAPTERS = [
  { id: 'pro', tag: 'Prologue', name: 'The Crack', land: 'Jerry Valley', quests: ['st_1'] },
  { id: 'c1', tag: 'Chapter 1', name: 'The Shards', land: 'Jerry Valley', quests: ['st_dragon', 'st_crags', 'st_glimmer', 'st_hollow', 'st_socket'] },
  { id: 'c2', tag: 'Chapter 2', name: 'The Frozen North', land: 'Frostwhisker Peaks', quests: ['st_frost1', 'st_grumble', 'st_twins', 'st_frost_boss', 'st_thaw'] },
  { id: 'c3', tag: 'Chapter 3', name: 'The Hungry Swamp', land: 'Gobbler Marsh', quests: ['st_marsh1', 'st_mire', 'st_sogg', 'st_lantern', 'st_gobbler', 'st_choice'] },
  { id: 'c4', tag: 'Chapter 4', name: 'The Clockwork Ruins', land: 'Brassbolt Sands', quests: ['st_sand1', 'st_sphinx', 'st_storm', 'st_pomp', 'st_colossus', 'st_castle'] },
  { id: 'c5', tag: 'Chapter 5', name: 'The Dark King', land: 'The Floating Castle', quests: [], soon: true },
];
function chapterNow() {
  for (const c of CHAPTERS) if (c.soon || c.quests.some((k) => !S.quests[k] || S.quests[k].state !== 'done')) return c;
  return CHAPTERS[CHAPTERS.length - 1];
}
let shownChapter = null;
function renderChapter() {
  const c = chapterNow(), el = $('pchapter'); if (!el) return;
  el.textContent = c.tag === 'Prologue' ? 'Prologue' : c.tag.replace('Chapter ', 'Ch ');
  el.title = `${c.tag}: ${c.name} (${c.land})${c.soon ? '. Coming soon!' : ''}`;
  if (shownChapter && shownChapter !== c.id) toast(c.soon ? `${c.tag}: ${c.name} is coming soon! You've finished every chapter so far.` : `${c.tag}: ${c.name} begins!`, ICONS.quests || null, true);
  shownChapter = c.id;
}
const storyOpen = (k) => (S.quests[k] && S.quests[k].state !== 'todo') || (QUESTS[k].after || []).every((a) => S.quests[a] && S.quests[a].state === 'done');
const storyStep = () => Object.keys(QUESTS).filter((k) => QUESTS[k].story && storyOpen(k) && S.quests[k].state !== 'done');

// ---------- saved state ----------
const SAVE_KEY = 'jerryquest_save_v1';
const fresh = () => ({
  started: false, name: '', bank: 0, xp: Object.fromEntries(SKILLS.map(([k]) => [k, 0])), inv: {}, coins: 0,
  hero: { xp: 0, alloc: { atk: 0, def: 0, hp: 0 } },
  quests: Object.fromEntries(Object.keys(QUESTS).map((k) => [k, { state: 'todo', kills: 0 }])),
  hp: 56, pos: [0, 6], preset: 'day',
  look: { outfit: 'none', trim: 'none', hat: false, cape: true, hair: 'hero', hairLen: 'short', hairCol: 'chestnut', skin: 'peach', eyes: 'brown', eyeStyle: 'round', head: 'big', ears: 'human', sex: 'm', mouth: 'smile', mark: 'none', beard: 'none' },
  owned: ['k_sword', 'sh_badge', 'ar_cloth'], equip: { weapon: 'k_sword', shield: 'sh_badge', armour: 'ar_cloth' },
});
let S = fresh();
// ---------- character slots ----------
// An account keeps up to three heroes. The cloud save holds { v: 2, cur, slots: [...] };
// an older single save simply becomes slot 1, so nobody loses progress.
const SLOTS = 3;
let slotBox = { v: 2, cur: 0, slots: Array(SLOTS).fill(null) };
function setSlotBox(d) {
  if (d && d.v === 2 && Array.isArray(d.slots)) slotBox = { v: 2, cur: Math.min(SLOTS - 1, d.cur || 0), slots: [...d.slots, ...Array(SLOTS).fill(null)].slice(0, SLOTS) };
  else slotBox = { v: 2, cur: 0, slots: [d && d.started ? d : null, null, null] };
}
// a quick look at a slot without switching to it
function slotInfo(d) {
  if (!d || !d.started) return null;
  const keep = S; parseSave(JSON.parse(JSON.stringify(d)));
  const info = { lvl: heroLvl(), ch: chapterNow(), coins: (S.coins || 0) + (S.bank || 0), look: S.look };
  S = keep; return info;
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return parseSave(JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  return false;
}
// turns saved data (from this browser or the cloud) into the game state
function parseSave(d) {
  {
    if (d) {
      const f = fresh();
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
  }
  return false;
}
function save() {
  if (!S.started || !player) return;
  S.pos = where === 'out' || LANDS[where] ? [player.root.position.x, player.root.position.z] : [INTERIORS[where].exitTo.x, INTERIORS[where].exitTo.z];
  S.land = LANDS[where] ? where : 'out';
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  if (net.on) { slotBox.slots[slotBox.cur] = S; cloudSave(slotBox, { name: heroName(), level: heroLvl(), worth: netWorth().total }); }
}
const lvl = (k) => levelOf(S.xp[k]);
const heroLvl = () => heroLevelOf(S.hero.xp);
// a stat = 1 at level 1, +1 every level, plus whatever points you spent on it
const stat = (k) => heroLvl() * AUTO_PER_LEVEL + S.hero.alloc[k];
const freePoints = () => (heroLvl() - 1) * FREE_PER_LEVEL - Object.values(S.hero.alloc).reduce((a, b) => a + b, 0);
// the equipped weapon, with any smith upgrades applied
const wCache = { k: '', p: -1, w: null };
const W = () => {
  const k = WEAPONS[S.equip.weapon] ? S.equip.weapon : 'k_sword', p = plusOf(k);
  if (!p) return WEAPONS[k];
  if (wCache.k !== k || wCache.p !== p) { const w = WEAPONS[k]; wCache.k = k; wCache.p = p; wCache.w = { ...w, dmg: Math.round(w.dmg * plusMult(k) * 10) / 10, name: plusName(k) }; }
  return wCache.w;
};
const gearDef = () => ['shield', 'armour'].reduce((a, sl) => a + (ARMOUR[S.equip[sl]] ? Math.round(ARMOUR[S.equip[sl]].def * plusMult(S.equip[sl]) * 10) / 10 : 0), 0);
const totalDef = () => stat('def') + gearDef();
const dmgMult = () => (1 + ATK_MULT * stat('atk')) * renown();
const defDiv = () => (1 + DEF_DIV * totalDef()) * pathDef();
const maxHp = () => Math.round((HP_BASE + HP_PER * stat('hp')) * pathHp() * renown());

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
  play(name, { once = false, fade = 0.18, speed = 1, clamp = false, onFinish = null, from = 0 } = {}) {
    const clip = this.clips[name] || (this.alias && this.clips[this.alias[name]]);
    if (!clip) return 0;
    const a = this.mixer.clipAction(clip);
    if (this.current === a && !once) return clip.duration;
    a.reset(); a.setEffectiveTimeScale(speed); a.setEffectiveWeight(1);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = clamp;
    a.play(); if (from) a.time = Math.min(from, clip.duration * 0.9);
    if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
    this.current = a; this.name = name; this.onFinish = onFinish;
    return (clip.duration - Math.min(from, clip.duration * 0.9)) / speed;
  }
  slot() { let s = null; this.root.traverse((o) => { if (!s && /handslotr$/i.test(o.name)) s = o; }); return s; }
  attach(obj) { const s = this.slot(); if (s) s.add(obj); return obj; }
  face(x, z) { this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z); }
  get pos() { return this.root.position; }
}

const G = {}, lib = {};
let player = null, snowFx = null;
const npcs = [];
const enemies = [];
const nodes = [];
let tool = null, rod = null, pick = null;

// ---------- boot ----------
const FILES = ['world', 'gear', 'interior', 'dragon', 'slime', 'bat', 'knight', 'heroine', 'mage', 'archer', 'barbarian', 'skel_warrior', 'skel_minion', 'skel_mage'];
async function main() {
  let n = 0;
  const loaded = await Promise.all(FILES.map((f) => loadModel(f).then((g) => { $('loadmsg').textContent = `${++n} of ${FILES.length} models`; return g; })));
  FILES.forEach((f, i) => { G[f] = loaded[i]; });
  for (const c of G.world.scene.children) lib[c.name] = c;
  for (const c of G.gear.scene.children) lib[c.name] = c;
  for (const c of G.interior.scene.children) lib[c.name] = c;
  const before = new Set(scene.children);
  buildWorld(lib);
  buildLands();
  // the tavern door sits in front of the tavern, which moved out with the rest of the village
  buildInteriors(lib, { tavern: { outside: { x: -4.0 * VS, z: -17 * VS + 4.7 }, exitTo: { x: -4.0 * VS + 0.6, z: -17 * VS + 7.6 } } });
  groupRegions(scene.children.filter((o) => !before.has(o)));
  snowFx = makeSnow();
  buildDoors();
  buildOccluders();
  buildChests();
  buildNodes();
  buildNpcs();
  buildEnemies();
  buildCrew();
  buildFlowers();
  buildTools();
  mergeStatic();
  buildSpots();
  poolLights();
  $('coinicon').src = ICONS.coins; $('hearticon').src = ICONS.heart; $('booticon').src = ICONS.boot;
  document.querySelectorAll('[data-icon]').forEach((im) => { im.src = ICONS[im.dataset.icon]; });
  const had = loadSave(); rebuildBinds();
  // entering the world, once the title screen is done
  const begin = () => {
    $('pick').hidden = true; document.body.classList.remove('titling');
    rebuildBinds(); applyTowns(); dayTick(0, true); makeGagronFriend(); makeSoggFriend(); makePompFriend();
    if (S.started) { startHero(); if (!S.name && !net.on) openCreator('new'); } else newHero();
    if (net.on) goOnline();
  };
  if (net.enabled && await resume()) {
    try { const d = await loadCloud(); setSlotBox(d); S = fresh(); net.on = true; } catch (e) { console.warn(e); }
  }
  $('loading').style.opacity = '0';
  setTimeout(() => $('loading').remove(), 700);
  showTitle(had, begin);
  renderer.setAnimationLoop(tick);
}

// ---------- the title screen ----------
// The first thing anyone sees: the logo over the living village, with the camera drifting slowly
// around it. Sign in or make an account when online play is on, or just press Play.
const LOGO = `<svg class="crest" viewBox="0 0 120 132" aria-hidden="true">
  <defs><linearGradient id="lgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset="1" stop-color="#e8a93a"/></linearGradient>
  <linearGradient id="lgP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f62d8"/><stop offset="1" stop-color="#55308f"/></linearGradient></defs>
  <path d="M60 6 L108 22 L104 70 C100 98 82 116 60 126 C38 116 20 98 16 70 L12 22 Z" fill="url(#lgG)" stroke="#4a2a17" stroke-width="5" stroke-linejoin="round"/>
  <path d="M60 17 L97 29 L94 69 C91 91 77 106 60 114 C43 106 29 91 26 69 L23 29 Z" fill="url(#lgP)" stroke="#4a2a17" stroke-width="2.5" stroke-linejoin="round"/>
  <g stroke="#4a2a17" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M40 92 L76 40 L82 36 L80 43 L44 95 Z" fill="#e9eef7"/><path d="M38 86 L48 96" fill="none"/><path d="M36 99 L41 94" fill="none"/>
    <path d="M80 92 L44 40 L38 36 L40 43 L76 95 Z" fill="#e9eef7"/><path d="M82 86 L72 96" fill="none"/><path d="M84 99 L79 94" fill="none"/>
    <path d="M60 46 L64.5 56 L75 56.5 L67 63 L70 73.5 L60 67.5 L50 73.5 L53 63 L45 56.5 L55.5 56 Z" fill="#ffd84a"/>
  </g>
</svg>`;
function titleShell(inner) {
  const pick = $('pick');
  pick.innerHTML = `<div class="title">
    <div class="logo">${LOGO}<h1 aria-label="JerryQuest"><span>Jerry</span><span>Quest</span></h1><p class="ribbon"><span>A storybook adventure with friends</span></p></div>
    <div class="tcard panel">${inner}</div>
    <p class="tfoot"><span class="srv ${net.enabled ? 'on' : ''}">${net.enabled ? 'Server online' : 'Server offline'}</span><span>Free art by KayKit and Quaternius</span><button id="t-music" class="linky" type="button">Music: tap anywhere</button></p>
  </div>`;
  pick.hidden = false; document.body.classList.add('titling');
  $('t-music').onclick = () => { unlockAudio(); $('t-music').textContent = 'Music on'; };
}
// Everyone plays on the one shared server. (Add ?dev to the address to test without it.)
const DEV = /[?&]dev\b/.test(location.search);
function showTitle(had, begin) {
  if (net.configured && !net.enabled && !DEV) return showNoServer();
  if (net.enabled && !net.on) return showAccount(had, begin);
  if (net.on) return showSlots(begin);
  if (!S.started) return showPick(begin);
  const l = heroLvl();
  titleShell(`<h2>Welcome back, ${heroName()}!</h2>
    <p class="tsub">Level ${l} · ${chapterNow().tag}: ${chapterNow().name}</p>
    <button id="t-play" class="primary big" type="button">Play</button>
    ${net.on ? '<button id="t-switch" class="linky" type="button">Not you? Log out</button>' : '<button id="t-new" class="linky" type="button">Start a new hero</button>'}`);
  $('t-play').onclick = () => { unlockAudio(); begin(); };
  if ($('t-switch')) $('t-switch').onclick = async () => { resetting = true; await signOut(); location.reload(); };
  if ($('t-new')) $('t-new').onclick = () => {
    const b = $('t-new');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to erase this hero and start fresh'; return; }
    S = fresh(); showPick(begin);
  };
}
function showAccount(had, begin) {
  titleShell(`<div class="ttabs" role="tablist"><button id="tab-in" role="tab" aria-selected="true" type="button">Log in</button><button id="tab-new" role="tab" aria-selected="false" type="button">New account</button></div>
    <form id="acct" class="acct" autocomplete="on">
      <label>Username<input id="a-name" name="username" autocomplete="username" maxlength="16" required spellcheck="false" placeholder="3 to 16 letters or numbers"></label>
      <label>Password<input id="a-pass" name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="At least 6 characters"></label>
      <p class="acct-msg" id="a-msg" role="status"></p>
      <button class="primary big" id="a-go" type="submit">Log in</button>
    </form>
`);
  let create = false;
  const setTab = (c) => {
    create = c; $('tab-in').setAttribute('aria-selected', String(!c)); $('tab-new').setAttribute('aria-selected', String(c));
    $('a-go').textContent = c ? 'Make my account' : 'Log in';
    $('a-pass').autocomplete = c ? 'new-password' : 'current-password';
    $('a-msg').textContent = c ? 'Your username is your hero name. Pick a good one!' : ''; $('a-msg').classList.remove('bad');
  };
  $('tab-in').onclick = () => setTab(false); $('tab-new').onclick = () => setTab(true);
  const busy = (on) => { for (const b of $('pick').querySelectorAll('button, input')) b.disabled = on; };
  $('acct').addEventListener('submit', async (ev) => {
    ev.preventDefault(); unlockAudio();
    const msg = $('a-msg'); msg.textContent = create ? 'Making your account...' : 'Logging in...'; msg.classList.remove('bad');
    busy(true);
    const r = await signIn($('a-name').value, $('a-pass').value, create);
    if (r.error) { msg.textContent = r.error; msg.classList.add('bad'); busy(false); return; }
    let d = null;
    try { d = await loadCloud(); } catch (e) { msg.textContent = `Logged in, but your save could not load. (${(e && (e.message || e.code)) || 'unknown error'})`; msg.classList.add('bad'); busy(false); return; }
    if (d) setSlotBox(d);
    else setSlotBox(create && had ? S : null); // a hero already saved in this browser moves into a brand new account
    S = fresh();
    net.on = true;
    showSlots(begin);
  });
}
// pick which of your heroes to play, or start a fresh one in an empty slot
function showSlots(begin) {
  const card = (d, i) => {
    const inf = slotInfo(d);
    if (!inf) return `<div class="slotcard empty"><b>Slot ${i + 1}</b><span>Empty</span><button class="primary" data-slot="${i}" type="button">New hero</button></div>`;
    return `<div class="slotcard"><img src="${portrait(inf.look)}" alt=""><b>Slot ${i + 1} · Level ${inf.lvl}</b><span>${inf.ch.tag}: ${inf.ch.name}</span><small>${fmt(inf.coins)} coins</small>
      <button class="primary" data-slot="${i}" type="button">Play</button><button class="linky" data-erase="${i}" type="button">Erase</button></div>`;
  };
  titleShell(`<h2>Choose your hero</h2><p class="tsub">Logged in as ${esc(net.user ? net.user.name : '')}. Each slot is its own adventure.</p>
    <div class="slots">${slotBox.slots.map(card).join('')}</div>
    <button id="t-switch" class="linky" type="button">Not you? Log out</button>`);
  $('pick').querySelectorAll('[data-slot]').forEach((b) => { b.onclick = () => {
    unlockAudio(); const i = +b.dataset.slot; slotBox.cur = i;
    if (slotBox.slots[i] && slotBox.slots[i].started) parseSave(JSON.parse(JSON.stringify(slotBox.slots[i]))); else { S = fresh(); S.started = false; }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    begin();
  }; });
  $('pick').querySelectorAll('[data-erase]').forEach((b) => { b.onclick = () => {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to erase this hero for good'; return; }
    const i = +b.dataset.erase; slotBox.slots[i] = null;
    const other = slotBox.slots.find((x) => x && x.started);
    cloudSave(slotBox, { name: net.user.name, level: other ? heroLevelOf(other.hero.xp) : 1, worth: 0 }, true);
    showSlots(begin);
  }; });
  $('t-switch').onclick = async () => { resetting = true; await signOut(); try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } location.reload(); };
}
function showNoServer() {
  titleShell(`<h2>Can't reach the game server</h2>
    <p class="tsub">JerryQuest is played online with everyone together. Check your internet connection, then try again.</p>
    <button id="t-retry" class="primary big" type="button">Try again</button>`);
  $('t-retry').onclick = () => location.reload();
}
// a brand new hero goes straight to the character creator
function newHero() {
  S.started = true; S.hp = maxHp();
  startHero(); save();
  openCreator('new');
}
function showPick(begin) {
  titleShell(`<h2>Begin your adventure</h2>
    <p class="tsub">Make your hero, then fight, chop, mine, fish and free the kingdom's towns. Level up to earn stat points and build your hero your way.</p>
    <p class="perk">${Object.values(STATS).map(([nm, ic]) => `<span class="statpill"><img src="${ICONS[ic]}" alt="">${nm}</span>`).join('')}</p>
    <button id="pick-begin" class="primary big" type="button">Play</button>`);
  $('pick-begin').onclick = () => { unlockAudio(); S.started = false; begin(); };
}
// the camera drifts slowly around the village behind the title
function titleCam() {
  const t = now * 0.045, r = camera.aspect < 1 ? 62 : 48;
  camPos.set(Math.sin(t) * r, 26, Math.cos(t) * r + 2);
  camera.position.copy(camPos);
  camera.lookAt(0, 3, -4);
}
let profileKey = '';
function profile() { const C = cosState(), t = heroTitle(); return { name: heroName(), lvl: heroLvl(), look: { ...S.look, path: S.path || '', cos: { ...C.eq }, ti: t ? t.name : '', tc: t ? t.col : '' }, w: where, x: player ? player.pos.x : 0, z: player ? player.pos.z : 0 }; }
function goOnline() {
  net.onTowns = syncTowns;
  net.onPeerGone = (id) => { dropPeer(id); partyPeerGone(id); if (trade && trade.with === id) tradeClose('Your trade partner left.'); };
  net.onNet = onNet;
  connect(profile()).then(() => { toast(`Online as ${net.user.name}. Friends who are playing show up in the world.`, ICONS.star); sys('Press Enter to chat with everyone. Type /p and a name to invite a friend to your party.'); });
  save();
}

// ---------- other players ----------
const peerActors = new Map();
const PEER_HATS = ['Barbarian_Hat', 'Mage_Hat', 'Knight_Helmet'];
function makePeer(id, p) {
  const look = { ...fresh().look, ...(p.look || {}) };
  const cos = look.cos || {}, skel = isSkel(cos);
  const a = skel ? new Actor(G.skel_minion, { hide: SKEL_HIDE }) : new Actor(look.sex === 'f' ? G.heroine : G.knight, { hide: look.hat ? [] : PEER_HATS });
  if (skel) skelPaint(a); else { dressNpc(a, pathLook(look, look.path)); pathDecor(a, look.path); }
  setFlair(a, { rank: rankOf(p.lvl || 1), aura: cos.aura, trail: cos.trail, hat: cos.hat, helmet: look.hat });
  if (!skel && cos.outfit && COS.outfit[cos.outfit]) { paintOutfit(a, COS.outfit[cos.outfit]); dressOutfit(a, COS.outfit[cos.outfit], look.sex === 'f' ? G.heroine : G.knight); }
  setHeroScale(a, heroScale(look));
  if (cos.cape && COS.cape[cos.cape]) capeColour(a, COS.cape[cos.cape].col, COS.cape[cos.cape].glow);
  a.root.position.set(p.x || 0, 0, p.z || 0);
  a.play('Idle');
  const tag = document.createElement('div'); tag.className = 'herotag peer'; tag.innerHTML = '<b></b>'; document.body.appendChild(tag);
  const pa = { a, tag, key: JSON.stringify(look), anim: 'Idle' };
  peerActors.set(id, pa);
  return pa;
}
function dropPeer(id) {
  const pa = peerActors.get(id);
  if (!pa) return;
  if (pa.a.flair) auraKit(pa.a, null);
  scene.remove(pa.a.root); pa.tag.remove(); peerActors.delete(id);
}
const ONE_SHOT = /Attack|Hit_|Death|Jump|Dodge|Use_Item|Interact|Cheer|Spellcast|Block/;
function peersTick(dt) {
  if (!net.on || !player) return;
  sendPos(player.pos.x, player.pos.z, player.root.rotation.y, player.name || 'Idle', where, `${Math.max(0, Math.round(S.hp))}/${maxHp()}`);
  const key = `${heroName()}|${heroLvl()}|${JSON.stringify(S.look)}|${S.path || ''}|${JSON.stringify(cosState().eq)}|${S.title || ''}`;
  if (key !== profileKey) { profileKey = key; updateProfile(profile()); }
  for (const [id, p] of net.peers) {
    let pa = peerActors.get(id);
    if (pa && pa.key !== JSON.stringify({ ...fresh().look, ...(p.look || {}) })) { dropPeer(id); pa = null; }
    if (!pa) pa = makePeer(id, p);
    const here = p.where === where && !creator.open;
    pa.a.root.visible = here;
    if (!here) { setShown(pa.tag, false); continue; }
    // glide towards the last position they sent
    const k = Math.min(1, dt * 10);
    p.x += (p.gx - p.x) * k; p.z += (p.gz - p.z) * k;
    if (Math.hypot(p.gx - p.x, p.gz - p.z) > 12) { p.x = p.gx; p.z = p.gz; }
    pa.a.root.position.set(p.x, 0, p.z);
    let dr = (p.ry || 0) - pa.a.root.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    pa.a.root.rotation.y += dr * k;
    if (p.a && p.a !== pa.anim) { pa.anim = p.a; pa.a.play(p.a, { once: ONE_SHOT.test(p.a), clamp: /Death/.test(p.a) }); }
    pa.a.mixer.update(dt); headPose(pa.a);
    flairTick(pa.a, dt, /Running|Walking/.test(pa.anim));
    if (pa.shimAt === undefined || now > pa.shimAt) { pa.shimAt = now + 0.1; shimmerTick(pa.a, p.look && p.look.cos); }
    const v = tmpV.set(p.x, 4.4, p.z).project(camera);
    if (v.z > 1 || bossIntro) { setShown(pa.tag, false); continue; }
    setShown(pa.tag, true);
    pin(pa.tag, v);
    const txt = `${p.name || 'Friend'} · Lv ${p.lvl || 1}`, col = tagColour(p.lvl || 1), tt = (p.look && p.look.ti) || '';
    if (pa.tag.dataset.t !== txt + col + tt) { pa.tag.dataset.t = txt + col + tt; pa.tag.querySelector('b').textContent = txt; pa.tag.style.setProperty('--tc', col); setTagTitle(pa.tag, tt, p.look && p.look.tc); }
  }
}


// ---------- parties and duels ----------
// Type in chat: /p name (or /party name) to invite, /p list, /p leave. The leader also has
// /p kick name, /p damage on|off and /p disband. A party of one disbands by itself.
// Party members show on each other's map with their health, share some monster XP,
// and can't hurt each other unless the leader turns party damage on.
// Outside the villages and indoors, players level 10 and up can fight each other.
// The whole Chapter 1 starting area around Jerry Village is always safe.
const PARTY_MAX = 6, PVP_LVL = 10;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let party = null; // { leader, members: [{ id, name }], dmg }
const invites = new Map(); // id we invited -> time
const joinAsked = new Map(); // leaders whose invite we accepted -> time
const myId = () => (net.user ? net.user.id : 'me');
const sys = (t) => chatLine('', t, 'sys');
const inParty = (id) => !!party && party.members.some((m) => m.id === id);
const peerByName = (n) => { n = String(n || '').trim().toLowerCase(); for (const [id, p] of net.peers) if ((p.name || '').toLowerCase() === n) return [id, p]; return null; };
function partyPush() { if (party && party.leader === myId()) sendNet('ps', { party }); renderParty(); }
function partySet(p, why) {
  const was = party; party = p;
  if (!p && was && why) { sys(why); toast(why, ICONS.star); }
  renderParty();
}
function chatCommand(line) {
  const [cmd, ...rest] = line.slice(1).split(/\s+/), arg = rest.join(' ');
  if (/^(t|trade)$/i.test(cmd)) { if (!arg) sys('Trade: /trade name, standing near them.'); else tradeInvite(arg); return; }
  if (!/^(p|party)$/i.test(cmd)) { sys('Commands: /p name to invite, /p list, /p leave, /p kick name, /p damage on|off, /p disband, /trade name'); return; }
  if (!net.on) { sys('Parties need the game server.'); return; }
  const sub = (rest[0] || '').toLowerCase(), me = myId(), lead = party && party.leader === me;
  if (!sub || sub === 'help') { sys('Party: /p name invites someone. /p list shows your party. /p leave. Leader only: /p kick name, /p damage on or off, /p disband.'); return; }
  if (sub === 'list') {
    if (!party) { sys('You are not in a party. Invite someone with /p name'); return; }
    sys(`Party (${party.members.length}/${PARTY_MAX}), damage between members ${party.dmg ? 'ON' : 'off'}: ${party.members.map((m) => `${m.id === party.leader ? '★ ' : ''}${m.id === me ? heroName() : m.name}${m.id !== me ? ` (${(net.peers.get(m.id) || {}).h || '?'} HP)` : ''}`).join(', ')}`);
    return;
  }
  if (sub === 'leave') { if (!party) { sys('You are not in a party.'); return; } partyLeave(); return; }
  if (sub === 'disband') {
    if (!party) { sys('You are not in a party.'); return; }
    if (!lead) { sys('Only the party leader can disband. Use /p leave to leave.'); return; }
    sendNet('ps', { party: { ...party, gone: true } }); partySet(null, 'You disbanded the party.'); return;
  }
  if (sub === 'kick') {
    if (!lead) { sys(party ? 'Only the party leader can kick.' : 'You are not in a party.'); return; }
    const nm = rest.slice(1).join(' ').toLowerCase(), m = party.members.find((x) => x.id !== me && (x.name || '').toLowerCase() === nm);
    if (!m) { sys(`Nobody called "${rest.slice(1).join(' ')}" is in your party.`); return; }
    party.members = party.members.filter((x) => x !== m);
    sys(`${m.name} was removed from the party.`);
    partyPush(); partyCheckSize(); return;
  }
  if (sub === 'damage') {
    if (!lead) { sys(party ? 'Only the party leader can change that.' : 'You are not in a party.'); return; }
    const on = /^on$/i.test(rest[1] || '') ? true : /^off$/i.test(rest[1] || '') ? false : !party.dmg;
    party.dmg = on; sys(`Party members ${on ? 'CAN now' : 'can no longer'} hurt each other.`); partyPush(); return;
  }
  // otherwise it's an invite
  if (party && !lead) { sys('Only the party leader can invite people.'); return; }
  const found = peerByName(arg);
  if (!found) { sys(`Nobody called "${arg}" is online right now.`); return; }
  const [id, p] = found;
  if (inParty(id)) { sys(`${p.name} is already in your party.`); return; }
  if (party && party.members.length >= PARTY_MAX) { sys(`A party can have ${PARTY_MAX} heroes at most.`); return; }
  invites.set(id, now);
  sendNet('pi', { to: id, name: heroName() });
  sys(`Party invite sent to ${p.name}.`);
}
function partyLeave() {
  const me = myId();
  if (!party) return;
  if (party.leader === me) {
    // hand the crown to the next hero in line, then step out
    const rest = party.members.filter((m) => m.id !== me);
    if (rest.length >= 2) sendNet('ps', { party: { ...party, leader: rest[0].id, members: rest } });
    else sendNet('ps', { party: { ...party, gone: true } });
  } else sendNet('pl', { to: party.leader });
  partySet(null, 'You left the party.');
}
function partyCheckSize() {
  if (party && party.members.length < 2) { sendNet('ps', { party: { ...party, gone: true } }); partySet(null, 'Your party disbanded because nobody else is left.'); }
}
function partyPeerGone(id) {
  if (!party || !inParty(id)) return;
  const me = myId();
  const m = party.members.find((x) => x.id === id);
  party.members = party.members.filter((x) => x.id !== id);
  sys(`${m ? m.name : 'Someone'} left the game and the party.`);
  // if the leader went, the next hero in the list takes over
  if (party.leader === id) party.leader = party.members[0] ? party.members[0].id : me;
  if (party.leader === me) { partyPush(); partyCheckSize(); } else renderParty();
}
function invitePrompt(from, name) {
  const el = document.createElement('div'); el.className = 'pinvite panel';
  el.innerHTML = `<p><b></b> invites you to a party!</p><div class="row"><button class="primary" type="button">Join</button><button type="button">No thanks</button></div>`;
  el.querySelector('b').textContent = name;
  const [yes, no] = el.querySelectorAll('button');
  const close = () => el.remove();
  yes.onclick = () => {
    close();
    if (party) partyLeave();
    joinAsked.set(from, now); sendNet('pa', { to: from, name: heroName() });
    sys(`Joining ${name}'s party...`);
  };
  no.onclick = close;
  setTimeout(close, 30000);
  document.body.appendChild(el);
  sfx('coin');
}
function onNet(ev, m) {
  const me = myId(), from = m.id, peer = net.peers.get(from);
  if (['ti', 'ta', 'to', 'tx'].includes(ev)) { tradeNet(ev, from, m); return; }
  if (ev === 'wb') { wbNet(m); return; }
  if (ev === 'bh' || ev === 'bs') { bossNet(ev, m); return; }
  if (ev === 'pi') { if (peer) invitePrompt(from, (peer && peer.name) || m.name || 'Someone'); return; }
  if (ev === 'pa') {
    if (!invites.has(from) || now - invites.get(from) > 60) return;
    invites.delete(from);
    if (!party) party = { leader: me, members: [{ id: me, name: heroName() }], dmg: false };
    if (party.leader !== me || party.members.length >= PARTY_MAX || inParty(from)) return;
    party.members.push({ id: from, name: (peer && peer.name) || m.name || 'Friend' });
    sys(`${(peer && peer.name) || m.name} joined your party!`); toast(`${(peer && peer.name) || m.name} joined your party!`, ICONS.star);
    partyPush(); return;
  }
  if (ev === 'pl') {
    if (!party || party.leader !== me || !inParty(from)) return;
    const who = party.members.find((x) => x.id === from);
    party.members = party.members.filter((x) => x.id !== from);
    sys(`${who.name} left the party.`); partyPush(); partyCheckSize(); return;
  }
  if (ev === 'ps') {
    const p = m.party; if (!p || !Array.isArray(p.members)) return;
    const mine = p.members.some((x) => x.id === me);
    if (p.gone) { if (party && (party.leader === from || inParty(from)) && mine) partySet(null, 'The party was disbanded.'); return; }
    if (mine) {
      const fresh = !party || party.leader !== p.leader && !inParty(from);
      if (fresh && !(joinAsked.has(from) && now - joinAsked.get(from) < 60)) return;
      if (fresh) joinAsked.delete(from);
      if (party && party.dmg !== p.dmg) sys(`Party damage is now ${p.dmg ? 'ON' : 'off'}.`);
      party = { leader: p.leader, members: p.members.slice(0, PARTY_MAX).map((x) => ({ id: String(x.id), name: String(x.name || 'Friend').slice(0, 16) })), dmg: !!p.dmg };
      if (fresh) { sys(`You joined ${(peer && peer.name) || 'the'} party! Type /p list to see who is in it.`); toast('You joined a party!', ICONS.star); }
      renderParty();
    } else if (party && party.leader === from && party.leader !== me) partySet(null, 'You were removed from the party.');
    return;
  }
  if (ev === 'hit') { if (canFight(from, true)) hurtPlayer(Math.max(1, Math.min(9999, +m.dmg || 0)), from); return; }
  if (ev === 'ko') { if (peer && m.offer) duelPrize(from, peer.name || 'a hero', m.offer); return; }
  if (ev === 'loot') { takeDuelLoss(from, m.pick); return; }
  if (ev === 'px') {
    if (!inParty(from) || m.w !== where || !player || player.dead) return;
    if (Math.hypot(player.pos.x - m.x, player.pos.z - m.z) > 40) return;
    giveHeroXp(Math.max(1, Math.round((+m.xp || 0) * 0.4)), player.pos.clone().setY(4.4));
  }
}
// a monster your party helped with: nearby members get a share of its XP
function partyShareXp(xp, pos) { if (party && party.members.length > 1) sendNet('px', { xp, x: pos.x, z: pos.z, w: where }); }
// Villages, town squares, indoors and the starting area are safe. Out in the wild, heroes level 10+ can duel.
function safeSpot(x, z, w) {
  if (w !== 'out' && !LANDS[w]) return true;
  if (w === 'out' && Math.hypot(x, z) < 70) return true; // the Chapter 1 spawn area
  for (const L of Object.values(LANDS)) if (L.village && Math.hypot(x - L.village.x, z - L.village.z) < 24) return true;
  for (const T of TOWNS) if (Math.hypot(x - T.x, z - T.z) < 12) return true;
  return false;
}
function canFight(id, incoming = false) {
  const p = net.peers.get(id);
  if (!p || !player || player.dead || p.where !== where) return false;
  if (inParty(id) && !party.dmg) return false;
  if (heroLvl() < PVP_LVL || (p.lvl || 1) < PVP_LVL) return false;
  if (safeSpot(player.pos.x, player.pos.z, where) || safeSpot(p.x, p.z, p.where)) return false;
  if (incoming && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 30) return false;
  return true;
}
// called from the attack code: strike any other hero inside the hit shape
function hitPeers(test, dmg) {
  let n = 0;
  for (const [id, p] of net.peers) {
    if (p.where !== where || !test(p.x, p.z)) continue;
    if (!canFight(id)) continue;
    sendNet('hit', { to: id, dmg: Math.round(dmg) });
    burst(new THREE.Vector3(p.x, 1.5, p.z), '#ff8a7a', 10, 4); floatText(new THREE.Vector3(p.x, 3.8, p.z), String(Math.round(dmg)), 'big');
    n++;
  }
  return n;
}
// party frame under the hero card: names and health bars
function renderParty() {
  let el = $('partyframe');
  if (!party || party.members.length < 2) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'partyframe'; el.className = 'panel'; document.body.appendChild(el); }
  el.hidden = false;
  const me = myId();
  const rows = party.members.filter((m) => m.id !== me).map((m) => {
    const p = net.peers.get(m.id) || {}, [h, mx] = String(p.h || '0/1').split('/').map(Number), k = mx ? Math.max(0, Math.min(1, h / mx)) : 0;
    const far = p.where !== where ? ' far' : '';
    return `<div class="pm${far}"><span>${m.id === party.leader ? '★ ' : ''}${esc(m.name)}${far ? ' · elsewhere' : ''}</span><i><b style="width:${(k * 100).toFixed(0)}%"></b></i><small>${p.h ? `${h} / ${mx}` : '...'}</small></div>`;
  }).join('');
  const html = `<h4>${party.leader === me ? '★ Your party' : 'Party'}${party.dmg ? ' · damage on' : ''}</h4>${rows}`;
  if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
}
let partyUiAt = 0;
function partyTick() { if (party && now > partyUiAt) { partyUiAt = now + 0.5; renderParty(); } }

// ---------- duel prizes ----------
// The winner picks ONE: 80% of the coins the loser carried, their weapon, their armour, or 2 bag items.
// Starter gear can't be taken. Banked coins are always safe.
const STARTER = { weapon: 'k_sword', armour: 'ar_cloth' };
let duelLoss = null;
function duelOffer() {
  const o = { coins: Math.floor(S.coins * 0.8) };
  for (const sl of ['weapon', 'armour']) { const k = S.equip[sl]; if (k && GEAR[k] && k !== STARTER[sl]) o[sl] = [k, plusOf(k)]; }
  // the two most valuable things in the bag
  const best = Object.entries(S.inv).filter(([k, n]) => n > 0 && SELL[k]).sort((a, b) => SELL[b[0]] - SELL[a[0]]);
  const items = []; let left = 2;
  for (const [k, n] of best) { if (!left) break; const t = Math.min(n, left); items.push([k, t]); left -= t; }
  if (items.length) o.items = items;
  return o;
}
function duelPrize(from, name, offer) {
  const el = document.createElement('div'); el.className = 'pinvite duelprize panel';
  const opts = [];
  const c = Math.max(0, Math.floor(+offer.coins || 0));
  if (c > 0) opts.push(['coins', `<img src="${ICONS.coins}" alt="">${fmt(c)} coins`]);
  for (const sl of ['weapon', 'armour']) { const g = offer[sl] && GEAR[offer[sl][0]]; if (g) opts.push([sl, `<img src="${gearIcon(g)}" alt="">${esc(g.name)}${offer[sl][1] ? ` +${offer[sl][1]}` : ''}`]); }
  const items = (Array.isArray(offer.items) ? offer.items : []).filter(([k]) => ITEMS[k]);
  if (items.length) opts.push(['items', items.map(([k, n]) => `<img src="${ICONS[k]}" alt="">${n} × ${esc(ITEMS[k])}`).join(' ')]);
  sfx('win');
  if (!opts.length) { toast(`You won the duel against ${name}! They had nothing worth taking.`, ICONS.star, true); return; }
  el.innerHTML = `<p>You beat <b></b>! Pick one prize:</p><div class="prizes">${opts.map(([k, h]) => `<button type="button" data-pz="${k}">${h}</button>`).join('')}</div>`;
  el.querySelector('b').textContent = name;
  el.querySelectorAll('[data-pz]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.pz; el.remove();
    if (k === 'coins') S.coins += c;
    else if (k === 'items') for (const [id, n] of items) addItem(id, Math.max(1, Math.min(2, n | 0)));
    else {
      const [gk, plus] = offer[k];
      if (!S.owned.includes(gk)) S.owned.push(gk);
      if (plus > plusOf(gk)) S.plus = { ...(S.plus || {}), [gk]: Math.min(PLUS_MAX, plus | 0) };
    }
    sendNet('loot', { to: from, pick: k });
    toast(`Prize taken from ${name}!`, ICONS.coins, true); sfx('coin'); giveHeroXp(60 + heroLvl() * 10); refreshUI(); save();
  }; });
  setTimeout(() => el.remove(), 45000);
  document.body.appendChild(el);
}
function takeDuelLoss(from, pick) {
  if (!duelLoss || duelLoss.from !== from || now > duelLoss.until) return;
  const o = duelLoss.offer; duelLoss = null;
  const who = (net.peers.get(from) || {}).name || 'The winner';
  if (pick === 'coins') { const c = Math.min(S.coins, o.coins || 0); S.coins -= c; toast(`${who} took ${fmt(c)} of your coins.`, ICONS.coins, true); }
  else if (pick === 'items' && o.items) { for (const [k, n] of o.items) if (S.inv[k]) takeItem(k, Math.min(S.inv[k], n)); toast(`${who} took ${o.items.map(([k, n]) => `${n} ${ITEMS[k]}`).join(' and ')} from your bag.`, ICONS.bag, true); }
  else if ((pick === 'weapon' || pick === 'armour') && o[pick]) {
    const k = o[pick][0];
    S.owned = S.owned.filter((x) => x !== k);
    if (S.plus) delete S.plus[k];
    if (S.equip[pick] === k) S.equip[pick] = STARTER[pick];
    if (!S.owned.includes(STARTER[pick])) S.owned.push(STARTER[pick]);
    equipGear(); if (typeof buildGearBar === 'function') buildGearBar();
    toast(`${who} took your ${GEAR[k].name}!`, gearIcon(GEAR[k]), true);
  }
  refreshUI(); save();
}

// ---------- world bosses ----------
// Every 20 minutes (by the real clock, so every player sees the same one at the same time) King Wobblegut,
// a giant golden jelly, flops down in one of the lands for 7 minutes. Everyone hits the same health bar:
// each hit is shared as a fraction of its health, so a level 5 and a level 80 hero both matter.
// Anyone who helped gets the reward, and it's tougher the more heroes are close by.
const WB_EVERY = 20 * 60 * 1000, WB_LIVE = 7 * 60 * 1000;
const WB_SPOTS = [['out', 50, 6, 'the Glimmerwood road'], ['frost', 1000, -4, 'the Frostwhisker road'], ['marsh', 2000, -4, 'the Gobbler Marsh road'], ['sands', 3000, 2, 'the Brassbolt dunes']];
ENEMY_TYPES.wb_wobble = { name: 'King Wobblegut', title: 'World Boss · everyone can help', model: 'slime', hp: 3000, maxHit: 10, xp: 0, boss: true, world: true, scale: 4, coins: [0, 1], drop: 'royal_jelly', slam: 8, noBones: true, poof: true, tintAll: '#ffcf3a', mass: 40 };
ITEMS.royal_jelly = 'Royal jelly'; SELL.royal_jelly = 400;
ITEMS.golden_acorn = 'Golden acorn'; SELL.golden_acorn = 250;
let wb = null, wbSlot = -1, wbWarned = -1, wbDmg = 0, wbAt = 0, wbRemote = false;
const wbInfo = (t = Date.now()) => { const slot = Math.floor(t / WB_EVERY), into = t - slot * WB_EVERY; return { slot, spot: WB_SPOTS[slot % WB_SPOTS.length], live: into < WB_LIVE, left: WB_LIVE - into, next: (slot + 1) * WB_EVERY - t }; };
const landName = (w) => (w === 'out' ? 'the Valley' : w === 'frost' ? 'Frostwhisker Peaks' : w === 'marsh' ? 'Gobbler Marsh' : 'Brassbolt Sands');
const landOpen = (w) => w === 'out' || where === w || Object.keys(QUESTS).some((k) => QUESTS[k].land === w && S.quests[k] && S.quests[k].state !== 'todo');
const WB_ON = false; // Callum asked to take the golden jelly world boss out
function wbTick() {
  if (!WB_ON || !player || now < wbAt) return;
  wbAt = now + 1;
  const I = wbInfo();
  if (I.next < 60000 && wbWarned !== I.slot + 1 && !creator.open && heroLvl() >= 3) {
    wbWarned = I.slot + 1; const sp = WB_SPOTS[(I.slot + 1) % WB_SPOTS.length];
    if (!landOpen(sp[0])) return;
    const t = `World boss! King Wobblegut lands on ${sp[3]} in ${landName(sp[0])} in one minute. Bring friends!`;
    sys(t); toast(t, ICONS.star, true);
  }
  // reward once it falls
  if (wb && wb.state === 'dead' && !wb.paid) {
    wb.paid = true;
    if (wbDmg > 0) {
      S.wbKills = (S.wbKills || 0) + 1; S.wbDone = { [wbSlot]: 1 };
      const c = 200 + heroLvl() * 60; S.coins += c;
      giveHeroXp(Math.round((HXT[Math.min(HERO_MAX, heroLvl() + 1)] - HXT[heroLvl()]) * 0.35), player.pos.clone().setY(4.4));
      toast(`King Wobblegut is beaten! You helped and earned ${fmt(c)} coins.`, ICONS.coins, true);
    } else toast('King Wobblegut was beaten by other heroes. Hit it next time to share the reward!', ICONS.star);
    refreshUI(); save();
  }
  const here = I.live && where === I.spot[0] && !(S.wbDone || {})[I.slot];
  if (wb && (!here || wbSlot !== I.slot) && wb.state !== 'dead') { removeEnemy(wb); wb = null; $('bossbar').hidden = true; }
  if (wb && wb.state === 'dead' && wbSlot !== I.slot) wb = null;
  if (here && !wb) {
    // scale to this hero: about 70 of your hits alone, more with friends nearby; it hits for about a tenth of your health
    let near = 0; for (const [, p] of net.peers) if (p.where === where && Math.hypot(p.x - I.spot[1], p.z - I.spot[2]) < 60) near++;
    const T = ENEMY_TYPES.wb_wobble, hit = W().dmg * dmgMult() * pathDmg();
    T.hp = Math.max(400, Math.round(hit * 70 * (1 + 0.7 * near))); T.maxHit = Math.max(4, Math.round(maxHp() * 0.1));
    wbSlot = I.slot; wbDmg = 0;
    wb = spawnEnemy('wb_wobble', I.spot[1], I.spot[2]); wb.temp = true; wb.inside = where;
    burst(wb.pos.clone().setY(3), '#ffe07a', 80, 10, 1.8);
  }
}
// Story bosses are shared too: everyone fighting the same boss nearby hits one health bar.
// Each hit goes out as a share of its health; every couple of seconds fighters also send where the bar is,
// so a friend who joins late sees the same health.
let bossRemote = false, bossSyncAt = 0;
function bossShare(e, dmg) {
  if (!e.T.boss || e.T.world || bossRemote || dmg <= 0 || !net.on) return;
  sendNet('bh', { t: e.type, f: dmg / e.T.hp, w: where, x: e.pos.x, z: e.pos.z });
}
function sharedBoss(m) {
  if (!player || m.w !== where || !ENEMY_TYPES[m.t]) return null;
  return enemies.find((e) => e.type === m.t && e.hp > 0 && e.state !== 'dead' && e.inside === where && Math.hypot(e.pos.x - m.x, e.pos.z - m.z) < 50 && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 60) || null;
}
function bossNet(ev, m) {
  const e = sharedBoss(m); if (!e) return;
  if (ev === 'bh') {
    const d = Math.max(0, Math.min(0.25, +m.f || 0)) * e.T.hp; if (d <= 0) return;
    // someone else's fight only moves the health bar: it never pulls the boss onto you
    const mine = !!e.myDmg || !['idle', 'walk', 'return'].includes(e.state);
    if (e.hp - d > 0) { e.hp -= d; if (mine) phaseCheck(e); return; }
    bossRemote = true; fxMute.on = !mine; try { hurtEnemy(e, Math.ceil(e.hp)); } finally { bossRemote = false; fxMute.on = false; }
  } else if (ev === 'bs') {
    // only ever bring the bar down, and only once this boss is in a fight here
    const f = Math.max(0.01, Math.min(1, +m.f || 1));
    if (e.state !== 'idle' && f * e.T.hp < e.hp - 1) { e.hp = f * e.T.hp; phaseCheck(e); }
  }
}
function bossSyncTick() {
  if (!net.on || !player || now < bossSyncAt) return;
  bossSyncAt = now + 2;
  for (const e of enemies) if (e.T.boss && !e.T.world && e.hp > 0 && e.state !== 'idle' && e.state !== 'dead' && e.inside === where && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 40) sendNet('bs', { t: e.type, f: e.hp / e.T.hp, w: where, x: e.pos.x, z: e.pos.z });
}
// called from hurtEnemy for our own hits
function wbShare(e, dmg) { if (e.T.world && !wbRemote && dmg > 0) { wbDmg += dmg; sendNet('wb', { slot: wbSlot, f: dmg / e.T.hp }); } }
function wbNet(m) {
  if (!wb || wb.state === 'dead' || m.slot !== wbSlot) return;
  const d = Math.max(0, Math.min(0.2, +m.f || 0)) * wb.T.hp;
  if (d <= 0) return;
  if (wb.hp - d > 0) { wb.hp -= d; return; }
  const mine = !!wb.myDmg || !['idle', 'walk', 'return'].includes(wb.state);
  wbRemote = true; fxMute.on = !mine; try { hurtEnemy(wb, Math.ceil(wb.hp)); } finally { wbRemote = false; fxMute.on = false; }
}

// ---------- trading ----------
// /trade name opens a trade window with another hero. Both sides put in coins, bag items or spare gear,
// press Ready, and the swap happens only when both are ready with the exact same deal on screen.
// Changing anything un-readies both sides, so nobody can sneak a swap.
let trade = null; // { with, name, mine: {coins, items:{}, gear:[]}, theirs, ready, theirReady, el }
const tradeAsked = new Map();
const emptyOffer = () => ({ coins: 0, items: {}, gear: [] });
const offerKey = (o) => JSON.stringify([o.coins | 0, Object.entries(o.items || {}).filter(([, n]) => n > 0).sort(), [...(o.gear || [])].sort()]);
const spareGear = () => S.owned.filter((k) => GEAR[k] && !Object.values(S.equip).includes(k) && k !== STARTER.weapon && k !== STARTER.armour);
function tradeInvite(arg) {
  if (!net.on) { sys('Trading needs the game server.'); return; }
  const found = peerByName(arg);
  if (!found) { sys(`Nobody called "${arg}" is online right now.`); return; }
  const [id, p] = found;
  if (trade) { sys('Finish your current trade first.'); return; }
  if (p.where !== where || Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 20) { sys(`Walk closer to ${p.name} to trade.`); return; }
  tradeAsked.set(id, now); sendNet('ti', { to: id, name: heroName() });
  sys(`Trade request sent to ${p.name}.`);
}
function tradePrompt(from, name) {
  if (trade) return;
  const el = document.createElement('div'); el.className = 'pinvite panel';
  el.innerHTML = `<p><b></b> wants to trade with you!</p><div class="row"><button class="primary" type="button">Trade</button><button type="button">No thanks</button></div>`;
  el.querySelector('b').textContent = name;
  const [yes, no] = el.querySelectorAll('button');
  yes.onclick = () => { el.remove(); if (trade) return; sendNet('ta', { to: from }); tradeOpen(from, name); };
  no.onclick = () => el.remove();
  setTimeout(() => el.remove(), 30000);
  document.body.appendChild(el); sfx('coin');
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && trade) { sendNet('tx', { to: trade.with }); tradeClose('Trade cancelled.'); } });
function tradeOpen(id, name) {
  trade = { with: id, name, mine: emptyOffer(), theirs: emptyOffer(), ready: false, theirReady: false, el: document.createElement('div') };
  trade.el.className = 'tradewin panel'; document.body.appendChild(trade.el);
  sys(`Trading with ${name}. Add things, then press Ready.`);
  tradeRender();
}
function tradeClose(msg) {
  if (!trade) return;
  trade.el.remove(); trade = null;
  if (msg) { sys(msg); toast(msg, ICONS.coins); }
}
function tradeSend() { if (trade) sendNet('to', { to: trade.with, offer: trade.mine, ready: trade.ready, sees: offerKey(trade.theirs) }); }
function tradeChanged() { trade.ready = false; trade.theirReady = false; tradeSend(); tradeRender(); }
function offerHtml(o, mine) {
  const rows = [];
  if (o.coins > 0) rows.push(`<button type="button" data-tc="1" ${mine ? '' : 'disabled'}><img src="${ICONS.coins}" alt="">${fmt(o.coins)} coins</button>`);
  for (const [k, n] of Object.entries(o.items || {})) if (n > 0 && ITEMS[k]) rows.push(`<button type="button" data-ti="${k}" ${mine ? '' : 'disabled'}><img src="${ICONS[k]}" alt="">${n} × ${esc(ITEMS[k])}</button>`);
  for (const k of o.gear || []) if (GEAR[k]) rows.push(`<button type="button" data-tg="${k}" ${mine ? '' : 'disabled'}><img src="${gearIcon(GEAR[k])}" alt="">${esc(GEAR[k].name)}</button>`);
  return rows.join('') || '<em>Nothing yet</em>';
}
function tradeRender() {
  if (!trade) return;
  const T = trade, el = T.el;
  const bag = Object.entries(S.inv).filter(([k, n]) => ITEMS[k] && n - (T.mine.items[k] || 0) > 0);
  const gear = spareGear().filter((k) => !T.mine.gear.includes(k));
  el.innerHTML = `<h3>Trade with <span></span></h3>
    <div class="tcols"><div><h4>You give${T.ready ? ' <b class="rdy">Ready</b>' : ''}</h4><div class="toffer">${offerHtml(T.mine, true)}</div></div>
    <div><h4>They give${T.theirReady ? ' <b class="rdy">Ready</b>' : ''}</h4><div class="toffer">${offerHtml(T.theirs, false)}</div></div></div>
    <div class="tadd"><label>Coins <input type="number" min="0" step="10" value="${T.mine.coins || ''}" placeholder="0" max="${S.coins}"></label>
    <div class="tbag">${bag.map(([k, n]) => `<button type="button" data-add="${k}" title="${esc(ITEMS[k])}"><img src="${ICONS[k]}" alt=""><small>${n - (T.mine.items[k] || 0)}</small></button>`).join('')}${gear.map((k) => `<button type="button" data-addg="${k}" title="${esc(GEAR[k].name)}" class="g"><img src="${gearIcon(GEAR[k])}" alt=""></button>`).join('')}</div>
    <p class="hint">Tap things in your bag to add them. Tap them in "You give" to take them back. Worn gear can't be traded.</p></div>
    <div class="row"><button type="button" class="primary" id="tready">${T.ready ? 'Waiting for them...' : 'Ready'}</button><button type="button" id="tcancel">Cancel</button></div>`;
  el.querySelector('h3 span').textContent = T.name;
  const inp = el.querySelector('input');
  inp.onchange = () => { T.mine.coins = Math.max(0, Math.min(S.coins, Math.floor(+inp.value || 0))); tradeChanged(); };
  inp.onkeydown = (e) => e.stopPropagation(); inp.onkeyup = (e) => e.stopPropagation();
  el.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { const k = b.dataset.add; T.mine.items[k] = (T.mine.items[k] || 0) + 1; tradeChanged(); }; });
  el.querySelectorAll('[data-addg]').forEach((b) => { b.onclick = () => { T.mine.gear.push(b.dataset.addg); tradeChanged(); }; });
  el.querySelectorAll('.toffer [data-ti]:not([disabled])').forEach((b) => { b.onclick = () => { const k = b.dataset.ti; T.mine.items[k]--; if (T.mine.items[k] <= 0) delete T.mine.items[k]; tradeChanged(); }; });
  el.querySelectorAll('.toffer [data-tg]:not([disabled])').forEach((b) => { b.onclick = () => { T.mine.gear = T.mine.gear.filter((k) => k !== b.dataset.tg); tradeChanged(); }; });
  el.querySelectorAll('.toffer [data-tc]:not([disabled])').forEach((b) => { b.onclick = () => { T.mine.coins = 0; tradeChanged(); }; });
  el.querySelector('#tready').onclick = () => { if (T.ready) return; T.ready = true; tradeSend(); tradeRender(); tradeTry(); };
  el.querySelector('#tcancel').onclick = () => { sendNet('tx', { to: T.with }); tradeClose('Trade cancelled.'); };
}
// both ready and both see the same deal: swap
function tradeTry() {
  const T = trade;
  if (!T || !T.ready || !T.theirReady || T.theySee !== offerKey(T.mine)) return;
  const o = T.mine;
  if ((T.theirs.gear || []).some((k) => S.owned.includes(k))) { sendNet('tx', { to: T.with }); tradeClose('Trade cancelled: you already own some of that gear.'); return; }
  // check we still have everything we offered
  if (S.coins < o.coins || Object.entries(o.items).some(([k, n]) => (S.inv[k] || 0) < n) || o.gear.some((k) => !spareGear().includes(k))) { sendNet('tx', { to: T.with }); tradeClose('Trade cancelled: something in your offer is gone.'); return; }
  S.coins -= o.coins;
  for (const [k, n] of Object.entries(o.items)) takeItem(k, n);
  S.owned = S.owned.filter((k) => !o.gear.includes(k));
  if (S.plus) for (const k of o.gear) delete S.plus[k];
  const t = T.theirs;
  S.coins += Math.max(0, t.coins | 0);
  for (const [k, n] of Object.entries(t.items || {})) if (ITEMS[k] && n > 0) addItem(k, Math.min(9999, n | 0));
  for (const k of t.gear || []) if (GEAR[k] && !S.owned.includes(k)) S.owned.push(k);
  sfx('win'); burst(player.pos.clone().setY(2), '#ffe07a', 40, 6, 1.2);
  const got = [t.coins > 0 ? `${fmt(t.coins)} coins` : '', ...Object.entries(t.items || {}).map(([k, n]) => `${n} ${ITEMS[k]}`), ...(t.gear || []).map((k) => GEAR[k].name)].filter(Boolean);
  const name = T.name; tradeClose(`Trade with ${name} done! You got ${got.length ? got.join(', ') : 'nothing'}.`);
  S.trades = (S.trades || 0) + 1;
  refreshUI(); save();
}
function tradeNet(ev, from, m) {
  const peer = net.peers.get(from);
  if (ev === 'ti') { if (peer) tradePrompt(from, peer.name || m.name || 'Someone'); return; }
  if (ev === 'ta') { if (!tradeAsked.has(from) || now - tradeAsked.get(from) > 60 || trade) return; tradeAsked.delete(from); tradeOpen(from, (peer && peer.name) || 'Friend'); return; }
  if (!trade || trade.with !== from) return;
  if (ev === 'tx') { tradeClose(`${trade.name} cancelled the trade.`); return; }
  if (ev === 'to') {
    const o = m.offer || {}, clean = { coins: Math.max(0, Math.floor(+o.coins || 0)), items: {}, gear: (Array.isArray(o.gear) ? o.gear : []).filter((k) => GEAR[k]).slice(0, 8) };
    for (const [k, n] of Object.entries(o.items || {}).slice(0, 20)) if (ITEMS[k] && n > 0) clean.items[k] = Math.floor(n);
    const changed = offerKey(clean) !== offerKey(trade.theirs);
    trade.theirs = clean; trade.theirReady = !!m.ready; trade.theySee = m.sees;
    if (changed) trade.ready = false;
    tradeRender(); tradeTry();
  }
}

// ---------- chat ----------
// Enter opens the chat box; Enter again sends to everyone on the server. Messages fade from the corner
// after a while and pop up in a speech bubble over the speaker's head.
const chatEl = { box: $('chat'), log: $('chatlog'), form: $('chatform'), inp: $('chatin'), btn: $('chatbtn') };
let chatUnread = 0;
const chatSpam = new Map(); // id -> recent message times, so one noisy player can't flood everyone
function chatLine(name, text, cls = '') {
  const p = document.createElement('p'); if (cls) p.className = cls;
  if (name) { const b = document.createElement('b'); b.textContent = `${name}: `; p.appendChild(b); }
  p.appendChild(document.createTextNode(text));
  chatEl.log.appendChild(p);
  while (chatEl.log.children.length > 50) chatEl.log.firstChild.remove();
  chatEl.log.scrollTop = chatEl.log.scrollHeight;
  setTimeout(() => p.classList.add('old'), 14000);
  if (!chatEl.box.classList.contains('open') && !cls) { chatUnread++; chatBadge(); }
}
function chatBadge() {
  let n = chatEl.btn.querySelector('small');
  if (!chatUnread) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement('small'); chatEl.btn.appendChild(n); }
  n.textContent = chatUnread > 9 ? '9+' : chatUnread;
}
function sayBubble(tag, text) {
  if (!tag) return;
  let i = tag.querySelector('i');
  if (!i) { i = document.createElement('i'); tag.appendChild(i); }
  i.textContent = text.length > 80 ? `${text.slice(0, 78)}...` : text;
  clearTimeout(i.timer); i.timer = setTimeout(() => i.remove(), 4000 + text.length * 60);
}
function openChat() {
  chatEl.box.classList.add('open'); chatUnread = 0; chatBadge();
  keys.clear();
  chatEl.inp.focus();
  chatEl.log.scrollTop = chatEl.log.scrollHeight;
}
function closeChat() { chatEl.box.classList.remove('open'); chatEl.inp.blur(); chatEl.inp.value = ''; }
chatEl.btn.onclick = openChat;
chatEl.inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeChat(); } e.stopPropagation(); });
chatEl.inp.addEventListener('keyup', (e) => e.stopPropagation());
chatEl.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = chatEl.inp.value;
  if (!cleanChat(raw)) { closeChat(); return; }
  if (/^\//.test(raw.trim())) { chatCommand(raw.trim()); chatEl.inp.value = ''; if (matchMedia('(pointer: coarse)').matches) closeChat(); return; }
  if (!net.on && !DEV) { chatLine('', 'Chat needs the game server. Try again in a moment.', 'sys'); return; }
  const r = sendChat(raw);
  if (r.error) { chatLine('', r.error, 'sys'); return; }
  chatLine(heroName(), r.text, 'me');
  heroTag(); sayBubble(heroTagEl, r.text);
  chatEl.inp.value = '';
  if (matchMedia('(pointer: coarse)').matches) closeChat();
  else chatEl.inp.focus();
});
net.onChat = (m) => {
  const t = performance.now(), list = (chatSpam.get(m.id) || []).filter((x) => t - x < 8000);
  if (list.length >= 4 || !m.text) return;
  list.push(t); chatSpam.set(m.id, list);
  chatLine(m.name, m.text);
  const pa = peerActors.get(m.id);
  if (pa) sayBubble(pa.tag, m.text);
};

function startHero() {
  player = new Actor(heroModel(), { hide: heroSkel() ? SKEL_HIDE : [] });
  player.root.position.set(S.pos[0], 0, S.pos[1]);
  if (S.land && LANDS[S.land]) where = S.land;
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
  ember: ['Ember', '#ffa86a'], forest: ['Forest', '#6ab87a'], navy: ['Navy', '#6a7ad8'], snowy: ['Snowy', '#f4f8ff'],
};
const HAIR_COLOURS = {
  chestnut: ['Chestnut', '#8a4f2a'], black: ['Black', '#2e2630'], blonde: ['Blonde', '#f2c75c'], ginger: ['Ginger', '#e0742f'],
  snow: ['Snow', '#f1ece4'], pink: ['Pink', '#ff8fc8'], blue: ['Blue', '#5f9ef0'], green: ['Green', '#66c46a'],
  auburn: ['Auburn', '#a8322a'], silver: ['Silver', '#b8bcc8'], purple: ['Purple', '#9a5fd8'], teal: ['Teal', '#2fb0a8'], honey: ['Honey', '#d8a04a'], mint: ['Mint', '#9fe8c8'],
};
const HAIR_STYLES = { short: 'Neat', hero: 'Hero spikes', spiky: 'Spiky', swept: 'Swept fringe', shag: 'Messy layers', wavy: 'Soft waves', bob: 'Bob', hime: 'Straight bangs', long: 'Ponytail', sidepony: 'Side ponytail', braid: 'Braid', twin: 'Pigtails', bun: 'Top bun', curls: 'Curls', mohawk: 'Mohawk', none: 'Bald' };
const HAIR_LENGTHS = { short: 'Short', chin: 'Chin', shoulder: 'Shoulder', long: 'Long', vlong: 'Very long' };
const SKIN_TONES = {
  porcelain: ['Porcelain', '#ffe9dc'], peach: ['Peach', '#f9cfb0'], honey: ['Honey', '#e7b085'], tan: ['Tan', '#c98d5e'],
  bronze: ['Bronze', '#b37548'], umber: ['Umber', '#93603d'], ebony: ['Ebony', '#74493a'], green: ['Orc green', '#8fc46a'], blue: ['Frost blue', '#9cc8ec'],
};
const EYE_COLOURS = {
  brown: ['Brown', '#8a5228'], hazel: ['Hazel', '#a88a3a'], blue: ['Blue', '#3d8fe0'], sky: ['Sky', '#7fd0ff'], green: ['Green', '#3fae4a'],
  emerald: ['Emerald', '#1fd18a'], violet: ['Violet', '#9a5ff0'], red: ['Red', '#e0393f'], gold: ['Gold', '#f2b51c'], grey: ['Grey', '#8a96a8'],
  pink: ['Pink', '#ff6fb0'], teal: ['Teal', '#1fb8b0'], amber: ['Amber', '#e08a1a'],
};
const EYE_STYLES = { round: 'Big and round', sharp: 'Determined', sleepy: 'Sleepy', happy: 'Happy', classic: 'Little dots' };
const HEAD_SIZES = { normal: ['Normal', 1.02], big: ['Big', 1.17], chibi: ['Chibi', 1.34] };
// height slider: -1 (short) to 1 (tall); everyone is a touch bigger than before so outfits read clearly
const heroScale = (L) => 1.3 * 1.05 * (1 + Math.max(-1, Math.min(1, +(L && L.height) || 0)) * 0.1);
// heroes stand a little taller than the chunky models: still chibi, a bit closer to regular people.
// The head is scaled back so it stays round.
const TALL = 1.1;
function setHeroScale(a, s) { a.tall = TALL; a.root.scale.set(s, s * TALL, s); }
// a lower, closer camera than a straight top-down view, so you can see everyone's faces
const CAM_OFF = new THREE.Vector3(0, 15, 26);
const BEARDS = { none: 'None', stache: 'Moustache', curly: 'Curly moustache', goatee: 'Goatee', full: 'Big beard', wizard: 'Wizard beard' };
let hairMatId = 0;
function hairMatsFor(col) {
  const m = toon(col); m.uid = ++hairMatId;
  for (const mat of [m.std, m.toon]) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp; }
  return m;
}
const HERO_HAIR = hairMatsFor('#8a4f2a'), hairMats = HERO_HAIR;
const hairCache = new Map();
function hairGroup(style, len = 'short', hairMats = HERO_HAIR) {
  const key = `${style}|${len}|${hairMats.uid || 0}`;
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
  const LEN = { short: 0, chin: 0.28, shoulder: 0.55, long: 0.95, vlong: 1.4 }[len] || 0;
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
    const sp = [[0.25, 1.05, 0.42], [-0.3, 1.05, 0.4], [1.0, 0.8, 0.38], [-1.0, 0.8, 0.38], [2.2, 0.6, 0.45], [-2.2, 0.6, 0.45], [Math.PI, 0.6, 0.5], [1.6, 0.45, 0.32], [-1.6, 0.45, 0.32]];
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
  if (style === 'wavy') {
    // soft layered waves that frame the face and fall to the chosen length
    shell(0.44, -0.12, -0.76); bangs('side');
    for (let i = 0; i < 13; i++) { const az = 0.95 + (i / 12) * (Math.PI * 2 - 1.9), w = i % 2 ? 0.12 : -0.12; lock(az, 0.2, 0.42 + LEN * 0.75, 0.22, -0.3, w, 0.55, 1.0); }
    for (let i = 0; i < 9; i++) { const az = 1.2 + (i / 8) * (Math.PI * 2 - 2.4); lock(az, 0.5, 0.36 + LEN * 0.35, 0.21, -0.25, i % 2 ? -0.1 : 0.1, 0.55, 0.98); }
    for (const s of [-1, 1]) { lock(s * 0.8, 0.36, 0.48 + LEN * 0.45, 0.15, -0.36, s * 0.15, 0.65, 1.0); }
    if (LEN > 0.3) add(new THREE.CapsuleGeometry(0.3, 0.1 + LEN * 0.45, 4, 12), HC.x, HC.y - 0.15 - LEN * 0.3, HC.z - HR.z * 0.6, 0.1, 0, 0, 1.55, 1, 0.62);
  }
  if (style === 'shag') {
    // a messy, choppy cut: lots of little layers flicking out
    shell(0.45, -0.12, -0.7); bangs('spiky');
    for (let i = 0; i < 14; i++) { const az = (i / 14) * Math.PI * 2 + 0.2; if (Math.cos(az) > 0.7) continue; lock(az, 0.58, 0.3, 0.15, 0.6, i % 2 ? 0.35 : -0.35, 0.6, 1.0); }
    for (let i = 0; i < 10; i++) { const az = 1.0 + (i / 9) * (Math.PI * 2 - 2.0); lock(az, 0.18, 0.34 + LEN * 0.5, 0.16, -0.25, i % 2 ? 0.3 : -0.3, 0.65, 1.02); }
  }
  if (style === 'sidepony') {
    shell(0.45, -0.05, -0.72); bangs('swept');
    add(new THREE.SphereGeometry(0.1, 10, 8), HC.x - HR.x * 0.78, HC.y + HR.y * 0.25, HC.z - HR.z * 0.5);
    const t = lock(-2.0, 0.28, 0.85 + LEN * 0.6, 0.21, -0.35, 0.2, 0.75, 1.16); t.position.y += 0.02;
  }
  if (style === 'braid') {
    shell(0.46, -0.05, -0.76); bangs('centre'); sidelocks(0.4);
    const n = 4 + Math.round(LEN * 4), seg = new THREE.SphereGeometry(0.12, 10, 8);
    for (let i = 0; i < n; i++) add(seg, HC.x + (i % 2 ? 0.03 : -0.03), HC.y - 0.05 - i * 0.17, HC.z - HR.z * 1.02 - Math.min(i, 2) * 0.04, 0, 0, (i % 2 ? 0.4 : -0.4), 1, 0.85, 0.8);
    add(new THREE.TorusGeometry(0.07, 0.03, 6, 12), HC.x, HC.y - 0.05 - n * 0.17 + 0.05, HC.z - HR.z * 1.1, Math.PI / 2);
    lock(Math.PI, -0.2 - n * 0.12, 0.2, 0.1, 0, 0, 0.8, 1.0).position.set(HC.x, HC.y - 0.1 - n * 0.17, HC.z - HR.z * 1.1);
  }
  if (!['none', 'mohawk', 'long', 'bob', 'hime', 'twin', 'wavy', 'sidepony', 'braid'].includes(style)) backHair(LEN);
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
function headParts(a = player) {
  if (a.headInfo) return a.headInfo;
  let head = null, bone = null;
  a.root.traverse((o) => { if (o.isSkinnedMesh && /_Head(_Hooded)?$/.test(o.name)) head = o; if (o.isBone && o.name === 'head') bone = o; });
  if (!bone) return null;
  if (!headRef) {
    const tmp = SkeletonUtils.clone(G.knight.scene); tmp.scale.setScalar(1.3);
    headRef = measureHead(tmp) || new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.45), new THREE.Vector3(0.5, 1.1, 0.5));
  }
  a.headInfo = { head, bone, box: headRef };
  return a.headInfo;
}
// The big chibi head sits low on the shoulders, so there is no long bare neck.
// Animations may or may not move the head bone, so only lower it when the mixer has just set it.
const NECK_DROP = 0.2;
function headPose(a) {
  if (!a || !a.headInfo || !a.headScale) return;
  const b = a.headInfo.bone; b.scale.setScalar(a.headScale); if (a.tall) b.scale.y /= a.tall;
  if (b.position.y !== a.headY) a.headBase = b.position.y;
  b.position.y = a.headBase - NECK_DROP * a.headScale; a.headY = b.position.y;
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
const FW = 1024, FH = 512, FX = 256, EY = 268, ESEP = 92, EYE_K = 1.32;
function shade(hex, k) { return `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`; }
// Lighter/darker sliders: -1 is much darker, +1 much lighter, 0 is the swatch colour.
const _tc = new THREE.Color(), _tw = new THREE.Color('#ffffff'), _tk = new THREE.Color('#1c1216');
function tone(hex, s = 0) { if (!s) return hex; _tc.set(hex).lerp(s > 0 ? _tw : _tk, Math.abs(s) * (s > 0 ? 0.6 : 0.65)); return `#${_tc.getHexString()}`; }
const skinOf = (L) => tone((SKIN_TONES[L.skin] || SKIN_TONES.peach)[1], L.skinShade);
const hairOf = (L) => tone((HAIR_COLOURS[L.hairCol] || HAIR_COLOURS.chestnut)[1], L.hairShade);
const eyeOf = (L) => tone((EYE_COLOURS[L.eyes] || EYE_COLOURS.brown)[1], L.eyeShade);
const shadeKey = (L) => [L.skinShade || 0, L.hairShade || 0, L.eyeShade || 0].map((v) => Math.round(v * 20)).join(',');
function mixHex(a, b, t) { return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`; }
// One eye, centred at (x, y). side is -1 for the eye on the viewer's left, +1 for the right.
function drawEye(g, x, y, side, L, state) {
  const ink = '#2b160c', female = L.sex === 'f', col = eyeOf(L);
  const lidCol = shade(skinOf(L), 0.86);
  g.save(); g.translate(x, y); g.scale(side * EYE_K, EYE_K); // draw as the right eye; the outer corner is +x
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
  g.beginPath(); for (let k = 0; k < 8; k++) { const r = k % 2 ? 2.2 : 7, a = k * Math.PI / 4; g.lineTo(ix + 9 + Math.cos(a) * r, iy - 20 + Math.sin(a) * r); } g.closePath(); g.fill();
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
  const hc = hairOf(L), female = L.sex === 'f';
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
  const ink = '#4a1c12', skin = skinOf(L);
  g.save(); g.translate(x, y); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = ink; g.lineWidth = 5;
  const m = state === 'hurt' ? 'hurt' : state === 'talk' ? 'talk' : L.mouth;
  if (m === 'talk') { g.fillStyle = '#7a2a22'; g.beginPath(); g.ellipse(0, 5, 12, 11, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ff8f8f'; g.beginPath(); g.ellipse(0, 10, 7, 4.5, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(0, 5, 12, 11, 0, 0, Math.PI * 2); g.stroke(); }
  else if (m === 'hurt') { g.beginPath(); g.moveTo(-14, 4); g.lineTo(-7, -2); g.lineTo(0, 4); g.lineTo(7, -2); g.lineTo(14, 4); g.stroke(); }
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
  const skin = skinOf(L);
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
  for (const s of [-1, 1]) { drawEye(g, FX + s * ESEP, EY, s, L, state); drawBrow(g, FX + s * (ESEP - 4), EY - 78, s, L); }
  drawMouth(g, FX, EY + 82, L, state);
  if (L.mark === 'freckles') { g.fillStyle = shade(skin, 0.68); for (const [dx, dy] of [[-120, 44], [-104, 56], [-92, 42], [-112, 66], [92, 42], [104, 56], [120, 44], [112, 66], [-12, 40], [14, 40]]) { g.beginPath(); g.arc(FX + dx, EY + dy, 3.5, 0, Math.PI * 2); g.fill(); } }
  if (L.mark === 'scar') { g.strokeStyle = shade(skin, 0.62); g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(FX - 44, EY + 18); g.lineTo(FX + 36, EY + 58); g.stroke(); g.strokeStyle = '#ffd9cc'; g.lineWidth = 2; g.stroke(); }
  if (L.mark === 'paint') { g.fillStyle = '#d9483b'; for (const s of [-1, 1]) for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(FX + s * 54, EY + 44 + i * 14); g.lineTo(FX + s * 112, EY + 36 + i * 14); g.lineTo(FX + s * 110, EY + 44 + i * 14); g.lineTo(FX + s * 56, EY + 52 + i * 14); g.closePath(); g.fill(); } }
  if (L.mark === 'star') { g.fillStyle = '#ffd34a'; g.strokeStyle = '#b8742a'; g.lineWidth = 2.5; const cx = FX + 118, cy = EY + 40; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }
}
const faceTexCache = new Map();
function faceTexture(L, state) {
  const key = [L.sex, L.skin, L.eyes, L.eyeStyle, L.mouth, L.mark, L.hairCol, shadeKey(L), state].join('|');
  if (faceTexCache.has(key)) return faceTexCache.get(key);
  if (faceTexCache.size > 90) { for (const t of faceTexCache.values()) t.dispose(); faceTexCache.clear(); }
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

// A storybook portrait of anyone's face (hero, villagers, crew), painted from the same face art as their 3D head,
// with their hair drawn on top. Used in conversations and on your hero badge.
const portraitCache = new Map();
let portraitFaceCv = null;
function portrait(L) {
  const key = [L.sex, L.skin, L.eyes, L.eyeStyle, L.mouth, L.mark, L.hair, L.hairLen, L.hairCol, L.beard, L.ears, L.hat, shadeKey(L)].join('|');
  if (portraitCache.has(key)) return portraitCache.get(key);
  if (!portraitFaceCv) { portraitFaceCv = document.createElement('canvas'); portraitFaceCv.width = FW; portraitFaceCv.height = FH; }
  paintFace(portraitFaceCv.getContext('2d'), L, 'open');
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'), ink = '#2b160c';
  const skin = skinOf(L), hair = hairOf(L), hairDk = shade(hair, 0.72);
  const cx = 128, cy = 150, rx = 98, ry = 92, H = L.hair, long = ['long', 'twin', 'hime', 'bob', 'curls'].includes(H) || ['long', 'vlong'].includes(L.hairLen) && H !== 'none' && H !== 'mohawk';
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 7; g.strokeStyle = ink;
  // hair that hangs behind the face
  if (long) { g.fillStyle = hairDk; g.beginPath(); g.ellipse(cx, cy + 14, rx + 22, ry + 30, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // ears
  g.fillStyle = skin;
  for (const sx of [-1, 1]) {
    g.beginPath();
    if (L.ears === 'elf') { g.moveTo(cx + sx * (rx - 8), cy - 4); g.lineTo(cx + sx * (rx + 40), cy - 40); g.lineTo(cx + sx * (rx - 4), cy + 26); }
    else g.ellipse(cx + sx * (rx - 2), cy + 8, 16, 21, 0, 0, Math.PI * 2);
    g.closePath(); g.fill(); g.stroke();
  }
  // the face itself, cut from the face texture
  g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = skin; g.fillRect(0, 0, 256, 256);
  g.drawImage(portraitFaceCv, FX - 175, EY - 128, 350, 330, cx - rx - 4, cy - ry + 4, (rx + 4) * 2, (rx + 4) * 2 * 330 / 350);
  g.restore();
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  // beard
  if (L.beard === 'full' || L.beard === 'wizard') {
    g.fillStyle = hairDk; g.beginPath(); g.moveTo(cx - rx + 4, cy + 4);
    g.quadraticCurveTo(cx - rx + 10, cy + ry + (L.beard === 'wizard' ? 70 : 30), cx, cy + ry + (L.beard === 'wizard' ? 80 : 34));
    g.quadraticCurveTo(cx + rx - 10, cy + ry + (L.beard === 'wizard' ? 70 : 30), cx + rx - 4, cy + 4);
    g.quadraticCurveTo(cx + 30, cy + 70, cx, cy + 58); g.quadraticCurveTo(cx - 30, cy + 70, cx - rx + 4, cy + 4); g.fill(); g.stroke();
  }
  if (['stache', 'curly', 'full', 'wizard'].includes(L.beard)) {
    g.fillStyle = hairDk;
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 20, cy + 50, 24, 9, sx * -0.25, 0, Math.PI * 2); g.fill(); g.stroke(); }
  }
  if (L.beard === 'goatee') { g.fillStyle = hairDk; g.beginPath(); g.moveTo(cx - 16, cy + 76); g.lineTo(cx + 16, cy + 76); g.lineTo(cx, cy + 110); g.closePath(); g.fill(); g.stroke(); }
  // hair on top, with a zig-zag fringe
  if (H !== 'none') {
    g.fillStyle = hair; g.beginPath();
    const top = cy - ry - (H === 'curls' || H === 'bun' ? 18 : 10);
    if (H === 'mohawk') { g.moveTo(cx - 22, cy - ry + 18); g.lineTo(cx - 16, top - 30); g.lineTo(cx, top - 44); g.lineTo(cx + 16, top - 30); g.lineTo(cx + 22, cy - ry + 18); g.closePath(); }
    else {
      g.moveTo(cx - rx - 8, cy + (long ? 30 : 0));
      g.bezierCurveTo(cx - rx - 14, top - 10, cx + rx + 14, top - 10, cx + rx + 8, cy + (long ? 30 : 0));
      const n = H === 'spiky' || H === 'hero' ? 6 : 5;
      for (let i = 0; i <= n; i++) { const x = cx + rx + 4 - (i / n) * (rx * 2 + 8), dip = i % 2 ? 22 : 44; g.lineTo(x, cy - 46 + (i === 0 || i === n ? 40 : dip - 22)); }
      g.closePath();
    }
    g.fill(); g.stroke();
    if (H === 'spiky' || H === 'hero') { for (const [x, h] of [[-50, 40], [-10, 54], [34, 46], [70, 30]]) { g.beginPath(); g.moveTo(cx + x - 22, top + 18); g.lineTo(cx + x + 4, top - h + 10); g.lineTo(cx + x + 22, top + 20); g.fill(); g.stroke(); } }
    if (H === 'bun') { g.beginPath(); g.arc(cx, top - 14, 30, 0, Math.PI * 2); g.fill(); g.stroke(); }
    if (H === 'twin') for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * (rx + 18), cy - 30, 22, 34, sx * 0.4, 0, Math.PI * 2); g.fill(); g.stroke(); }
    // shine
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 6; g.beginPath(); g.arc(cx - 20, cy - 20, ry - 14, -2.3, -1.7); g.stroke();
  }
  const url = cv.toDataURL();
  portraitCache.set(key, url);
  return url;
}
// Facial hair, built in head space from the same head measurements as the face.
const neckGeo = new THREE.CylinderGeometry(1, 1.1, 1, 16), beardGeo = new THREE.SphereGeometry(1, 20, 14), stacheGeo = new THREE.CapsuleGeometry(0.5, 1.2, 4, 10), goateeGeo = new THREE.ConeGeometry(0.5, 1, 12).rotateX(Math.PI);
function addBeard(fg, kind, c, rx, ry, rz, mats) {
  if (!kind || kind === 'none') return;
  const put = (geo, x, y, z, sx, sy, sz, rxx = 0, ryy = 0, rzz = 0) => { const m = new THREE.Mesh(geo); registerMesh(m, mats); m.castShadow = true; m.position.set(c.x + x * rx, c.y + y * ry, c.z + z * rz); m.scale.set(sx * rx, sy * ry, sz * rz); m.rotation.set(rxx, ryy, rzz); fg.add(m); return m; };
  if (kind === 'full' || kind === 'wizard') {
    // a big round beard that wraps the jaw from ear to ear
    put(beardGeo, 0, -0.78, 0.3, 0.84, 0.46, 0.62);
    for (const sx of [-1, 1]) put(beardGeo, sx * 0.62, -0.45, 0.12, 0.3, 0.42, 0.42);
    if (kind === 'wizard') { put(goateeGeo, 0, -1.25, 0.62, 0.95, 0.9, 0.7, -0.35); put(goateeGeo, 0, -1.75, 0.82, 0.55, 0.6, 0.45, -0.5); }
  }
  if (kind === 'goatee') put(goateeGeo, 0, -0.98, 0.78, 0.36, 0.42, 0.3, -0.5);
  if (kind === 'stache' || kind === 'curly' || kind === 'full' || kind === 'wizard') {
    for (const sx of [-1, 1]) {
      put(stacheGeo, sx * 0.19, -0.37, 0.94, 0.2, 0.12, 0.11, 0, 0, sx * (kind === 'curly' ? 1.95 : 1.4));
      if (kind === 'curly') put(beardGeo, sx * 0.47, -0.3, 0.84, 0.1, 0.1, 0.08);
    }
  }
}
// The code-built chibi head: a round head with a painted face, ears and facial hair.
// Works for the hero and for every villager (a is any Actor, L a look).
function buildFace(a = player, L = S.look) {
  const H = headParts(a);
  if (!H) return;
  if (H.head) { H.head.visible = false; }
  if (a.faceGroup) { a.faceGroup.removeFromParent(); a.faceGroup.traverse((o) => { if (o.material && o.material.dispose && !o.userData.keepMat && !o.userData.isInk) o.material.dispose(); }); }
  const fg = new THREE.Group(); a.faceGroup = fg; H.bone.add(fg);
  const box = H.box, c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const rx = sz.x * 0.5, ry = sz.y * 0.47, rz = sz.z * 0.5;
  const mats = toon('#f6f2f0');
  mats.toon.onBeforeCompile = () => {};
  mats.std.map = faceTexture(L, 'open'); mats.toon.map = mats.std.map;
  for (const mat of [mats.std, mats.toon]) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp; }
  const head = new THREE.Mesh(headGeo); registerMesh(head, mats); head.castShadow = true;
  head.userData.stencilled = true;
  head.scale.set(rx, ry, rz); head.position.set(c.x, c.y + sz.y * 0.02, c.z);
  // the sphere's u = 0.25 column, where the face is painted, already points forward (+z)
  fg.add(head);
  a.faceMats = mats; a.faceState = 'open'; a.faceLook = L;
  const skinMat = toon(skinOf(L));
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(L.ears === 'elf' ? earGeo : humanEarGeo); registerMesh(e, skinMat); e.castShadow = true;
    if (L.ears === 'elf') { e.position.set(sx * (rx + 0.1), c.y - ry * 0.02, c.z - rz * 0.08); e.rotation.set(-0.3, 0, -sx * 1.12); e.scale.set(1, 1, 0.6); }
    else { e.position.set(sx * rx * 0.97, c.y - ry * 0.08, c.z - rz * 0.06); e.scale.set(rx * 0.13, ry * 0.2, rz * 0.15); }
    e.visible = !L.hat; // a helmet covers the ears; otherwise they poke through its sides
    fg.add(e);
  }
  // the face group grows with the head bone, so shrink the neck by the head size or it pokes out of the collar
  const hsz = HEAD_SIZES[L.head] ? HEAD_SIZES[L.head][1] : 1.17, nk = 1.4 / hsz;
  const neck = new THREE.Mesh(neckGeo); registerMesh(neck, skinMat); neck.position.set(c.x, c.y - ry * (0.78 + 0.12 * nk), c.z - rz * 0.05); neck.scale.set(rx * 0.42 * Math.min(1, nk * 1.1), ry * 0.45 * nk, rz * 0.42 * Math.min(1, nk * 1.1)); fg.add(neck);
  // lift the knight helmet so its visor clears the big eyes and the chin guard stops hanging over the chest
  a.root.traverse((o) => {
    if (o.name !== 'Knight_Helmet') return;
    if (!o.userData.base) o.userData.base = { y: o.position.y, s: o.scale.x };
    const hk = (HEAD_SIZES[L.head] ? HEAD_SIZES[L.head][1] : 1.17) / 1.4; o.position.y = o.userData.base.y + 0.17 * hk; o.scale.setScalar(o.userData.base.s * 1.13 * Math.max(0.8, hk));
  });
  const hc = new THREE.Color(hairOf(L)).multiplyScalar(0.78);
  addBeard(fg, L.beard, c, rx, ry, rz, toon(`#${hc.getHexString()}`));
  a.headScale = HEAD_SIZES[L.head] ? HEAD_SIZES[L.head][1] : 1.17;
  markStencil(fg);
  addInk(fg);
}
// Blink every few seconds; wince for a moment when hurt; chatter while talking.
function faceTick(a = player) {
  if (!a || !a.faceMats) return;
  let st = 'open';
  if (a.dead || now < (a.hurtFace || 0)) st = 'hurt';
  else if (now < (a.emoteUntil || 0)) st = a.emoteFace;
  else if (now < (a.talkUntil || 0) && Math.sin(now * 26) > -0.2) st = 'talk';
  else if (now < (a.blinkUntil || 0)) st = 'blink';
  else if (now > (a.blinkAt || 0)) { a.blinkUntil = now + 0.14; a.blinkAt = now + 2.2 + Math.random() * 3.5; st = 'blink'; }
  if (st !== a.faceState) {
    a.faceState = st;
    const t = faceTexture(a.faceLook || S.look, st);
    a.faceMats.std.map = t; a.faceMats.toon.map = t;
  }
}
// Bold storybook ink lines around characters: an inverted shell pushed out a fixed number of pixels.
const inkW = { value: 0.0015 };
const inkMat = new THREE.MeshBasicMaterial({ color: '#4a2a1c', side: THREE.BackSide, fog: false });
inkMat.onBeforeCompile = (sh) => {
  sh.uniforms.inkW = inkW;
  sh.vertexShader = 'uniform float inkW;\n' + sh.vertexShader.replace('#include <project_vertex>', `
    #ifdef USE_SKINNING
      vec3 inkN = objectNormal;
    #else
      vec3 inkN = normal;
    #endif
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    mvPosition.xyz += normalize(normalMatrix * inkN) * inkW * -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;`);
};
function addInk(root) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && o.visible && o.userData.mats && !o.userData.isSil && !o.userData.isInk && !o.userData.hasInk) list.push(o); });
  for (const o of list) {
    o.userData.hasInk = true;
    const h = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, inkMat) : new THREE.Mesh(o.geometry, inkMat);
    h.userData.isInk = true; h.frustumCulled = false; h.layers.set(1); h.castShadow = false;
    o.add(h); if (o.isSkinnedMesh) h.bind(o.skeleton, o.bindMatrix);
  }
}
function applyLook() {
  if (!player) return;
  const L = S.look;
  if ($('badgeicon')) $('badgeicon').src = portrait(L);
  for (const [k, g] of hairCache) if (k.endsWith(`|${HERO_HAIR.uid}`)) g.removeFromParent();
  // a touch darker than the swatch so sunlight doesn't bleach the top of the hair
  const hcol = new THREE.Color(hairOf(L)).multiplyScalar(0.72);
  hairMats.std.color.copy(hcol); hairMats.toon.color.copy(hcol);
  const ofc0 = COS.outfit[cosState().eq.outfit || ''], helmOn = !!(ofc0 && ofc0.helm && !L.helmOff);
  const showHair = L.hair !== 'none' && !L.hat && !helmOn;
  const arm = ARMOUR[S.equip.armour] || ARMOUR.ar_cloth;
  const skel = heroSkel();
  if (showHair && !skel) { let head; player.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; }); if (head) head.add(hairGroup(L.hair, L.hairLen)); }
  if (!skel) buildFace(player, pathLook(L, S.path));
  pathDecor(player, S.path);
  player.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats) return;
    const n = o.name;
    const isCape = /_Cape$/.test(n), isBody = /_Body$/.test(n), isHat = /_(Helmet|Hat)$/.test(n), isLimb = /_(ArmLeft|ArmRight|LegLeft|LegRight)$/.test(n);
    if (isHat) o.visible = L.hat || (helmOn && /Knight_Helmet$/.test(n));
    if (isCape) o.visible = L.cape;
    if (isCape || isBody || isLimb) {
      if (!o.userData.ownMats) {
        o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
        o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
        o.userData.mats = o.userData.ownMats;
        o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std;
      }
      const key = isCape ? L.trim : L.outfit, col = isLimb ? arm.tint || '#ffffff' : tone(LOOK_COLOURS[key][1], key === 'none' ? 0 : isCape ? L.trimShade : L.outfitShade);
      const amt = isLimb || key === 'none' ? 0 : isCape ? 1 : 0.75;
      for (const mat of [o.userData.mats.std, o.userData.mats.toon]) { colourise(mat, amt); mat.color.set(amt ? mixHex(col, '#ffffff', 0.12) : col); }
    }
  });
  dressArmour();
  if (helmOn) player.root.traverse((o) => { if (o.isMesh && /Knight_Helmet$/.test(o.name) && o.userData.mats && !Array.isArray(o.userData.mats.toon)) { if (!o.userData.ownMats) { o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() }; o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile; o.userData.mats = o.userData.ownMats; o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std; } for (const m of [o.userData.mats.std, o.userData.mats.toon]) { colourise(m, 0.7); m.color.set(ofc0.helm); if (m.emissive) m.emissive.set('#000000'); } } });
  const ofC = cosState().eq.outfit; if (skel) skelPaint(player); else if (ofC && COS.outfit[ofC]) paintOutfit(player, COS.outfit[ofC]);
  player.baseScale = heroScale(L); if (!tinyUntil) setHeroScale(player, player.baseScale);
  const capeC = cosState().eq.cape; if (capeC && COS.cape[capeC]) capeColour(player, COS.cape[capeC].col, COS.cape[capeC].glow);
  addInk(player.root);
  heroFlair();
}
// paint a hero's cape (cosmetic capes)
function capeColour(a, col, glow = 0) {
  a.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || !/_Cape$/.test(o.name) || Array.isArray(o.userData.mats.toon)) return;
    if (!o.userData.ownMats) { o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() }; o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile; o.userData.mats = o.userData.ownMats; o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std; }
    for (const m of [o.userData.mats.std, o.userData.mats.toon]) { colourise(m, 1); m.color.set(col); if (m.emissive) m.emissive.set(col).multiplyScalar(0.12 + glow); }
  });
}
// outfits: recolour the hero's tunic and trim (cosmetic only)
function paintOutfit(a, c) {
  a.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || Array.isArray(o.userData.mats.toon)) return;
    const body = /_Body$/.test(o.name), cape = /_Cape$/.test(o.name), arm = /_Arm(Left|Right)$/.test(o.name), leg = /_Leg(Left|Right)$/.test(o.name);
    if (!body && !cape && !arm && !leg) return;
    if (!o.userData.ownMats) { o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() }; o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile; o.userData.mats = o.userData.ownMats; o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std; }
    // the whole hero wears the outfit: tunic and sleeves in the main colour, legs a blend toward the trim
    const col = body ? c.body : arm ? mixHex(c.body, '#000000', 0.08) : leg ? mixHex(c.trim, c.body, 0.4) : c.trim;
    for (const m of [o.userData.mats.std, o.userData.mats.toon]) { colourise(m, cape ? 1 : 0.85); m.color.set(col); if (m.emissive) m.emissive.set(col).multiplyScalar((c.glow || 0) * (body || cape ? 1 : 0.5)); }
  });
}
// Outfits get a few clean trim pieces in their second colour: a collar, a belt with a buckle,
// a sash on some, and a glowing chest charm on the rarer ones. Simple shapes, bold colours.
const OUTFIT_TRIM = { ranger: 'sash', pirate: 'sash', nomad: 'sash', shadow: 'sash', bog: 'sash' };
const sashGeo = new THREE.TorusGeometry(1, 0.1, 6, 32), collarGeo = new THREE.TorusGeometry(1, 0.22, 8, 28), charmGeo = new THREE.OctahedronGeometry(1, 0);
function dressOutfit(a, c, model, armour = null) {
  if (a.outfitParts) for (const m of a.outfitParts) m.removeFromParent();
  a.outfitParts = [];
  if (!c || !model || c.skin) return;
  if (!restRigs.has(model)) { const r = SkeletonUtils.clone(model.scene); r.scale.setScalar(1.3); r.updateMatrixWorld(true); const b = {}; r.traverse((o) => { if (o.isBone) b[o.name.replace(/[^a-z]/gi, '').toLowerCase()] = o; }); restRigs.set(model, b); }
  const rest = restRigs.get(model), live = {};
  a.root.traverse((o) => { if (o.isBone) live[o.name.replace(/[^a-z]/gi, '').toLowerCase()] = o; });
  if (!rest.chest || !live.chest) return;
  const r = c.r || 0, glow = c.glow || 0;
  const trim = toon(c.trim, glow ? { emissive: new THREE.Color(c.trim).multiplyScalar(glow * 0.8) } : {});
  const W2L = new THREE.Matrix4(), M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const put = (bn, geo, mats, pos, rot, size) => {
    const bone = rest[bn], key = bn; if (!bone || !live[key]) return;
    const m = new THREE.Mesh(geo); registerMesh(m, mats); m.castShadow = true;
    q.setFromEuler(rot); M.compose(pos, q, sc.copy(size));
    W2L.copy(bone.matrixWorld).invert().multiply(M); W2L.decompose(m.position, m.quaternion, m.scale);
    live[key].add(m); a.outfitParts.push(m); return m;
  };
  const wp = (b) => new THREE.Vector3().setFromMatrixPosition(rest[b].matrixWorld);
  const S1 = 1.3, ch = wp('chest');
  if (!(armour && armour.gorget)) put('chest', collarGeo, trim, ch.clone().add(new THREE.Vector3(0, 0.34 * S1, 0.01 * S1)), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.22 * S1, 0.2 * S1, 0.22 * S1));
  if (OUTFIT_TRIM[c.id || ''] === 'sash' || c.sash) put('chest', sashGeo, trim, ch.clone().add(new THREE.Vector3(0, 0.06 * S1, 0.02 * S1)), new THREE.Euler(Math.PI / 2, 0, 0.62, 'ZYX'), new THREE.Vector3(0.43 * S1, 0.36 * S1, 0.9 * S1));
  if (rest.hips && !(armour && armour.belt)) {
    const hp = wp('hips');
    put('hips', sashGeo, trim, hp.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.01 * S1)), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.41 * S1, 0.35 * S1, 1.1 * S1));
    put('hips', charmGeo, toon(r >= 3 ? c.trim : '#ffd34a', { emissive: r >= 3 ? new THREE.Color(c.trim).multiplyScalar(0.4) : '#3a2400' }), hp.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.36 * S1)), new THREE.Euler(0, 0, Math.PI / 4), new THREE.Vector3(0.07 * S1, 0.07 * S1, 0.035 * S1));
  }
  // themed pieces
  const st = c.style, dark = toon(c.helm ? mixHex(c.helm, '#ffffff', 0.18) : c.body), side2 = THREE.DoubleSide;
  if (st === 'knight') for (const sd of ['l', 'r']) {
    const arm = rest[`upperarm${sd}`]; if (!arm) continue;
    const sp = wp(`upperarm${sd}`), out = Math.sign(sp.x) || (sd === 'l' ? 1 : -1), R0 = 0.36 * S1;
    put(`upperarm${sd}`, padGeo, dark, sp.clone().add(new THREE.Vector3(out * 0.07 * S1, 0.1 * S1, 0)), new THREE.Euler(0, 0, -out * 0.5), new THREE.Vector3(R0, R0 * 0.8, R0 * 1.05));
    put(`upperarm${sd}`, padGeo, trim, sp.clone().add(new THREE.Vector3(out * 0.15 * S1, -0.02 * S1, 0)), new THREE.Euler(0, 0, -out * 0.75), new THREE.Vector3(R0 * 0.75, R0 * 0.6, R0 * 0.85));
    put(`upperarm${sd}`, spikeGeo, trim, sp.clone().add(new THREE.Vector3(out * 0.22 * S1, 0.4 * S1, 0)), new THREE.Euler(0, 0, -out * 0.55), new THREE.Vector3(0.055 * S1, 0.08 * S1, 0.055 * S1));
  }
  if ((st === 'vamp' || st === 'holy') && live.chest) {
    // folded wings on the back: leathery bat wings for vampires, small feathered ones for holy looks
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      if (st === 'vamp') {
        const o = new THREE.Mesh(batWingGeo); registerMesh(o, (() => { const m = toon(c.trim); m.std.side = m.toon.side = side2; return m; })()); o.scale.set(sx * 0.6, 0.6, 1);
        const i2 = new THREE.Mesh(batWingGeo); registerMesh(i2, (() => { const m = toon(c.body); m.std.side = m.toon.side = side2; return m; })()); i2.scale.set(sx * 0.48, 0.48, 1); i2.position.set(sx * 0.04, 0.03, -0.01);
        w.add(o, i2); w.position.set(sx * 0.14, 0.3, -0.34); w.rotation.set(0.15, sx * 0.55, sx * 0.1);
      } else {
        const fm = toon('#ffffff', { emissive: new THREE.Color(c.trim).multiplyScalar(0.15 + glow) });
        for (const [k, len] of [[0, 0.5], [1, 0.4], [2, 0.3]]) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, len, 4, 8)); registerMesh(f, fm); f.position.set(sx * (0.14 + k * 0.06), 0.12 - k * 0.1, 0); f.rotation.z = sx * (1.0 + k * 0.25); w.add(f); }
        w.position.set(sx * 0.18, 0.25, -0.32); w.rotation.y = -sx * 0.5;
      }
      live.chest.add(w); a.outfitParts.push(w);
    }
  }
  if (st === 'holy' && live.head && a.headInfo) {
    const H = a.headInfo, ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 32)); registerMesh(ring, toon(c.trim, { emissive: new THREE.Color(c.trim).multiplyScalar(0.6) }));
    ring.rotation.x = Math.PI / 2 + 0.12; ring.position.y = H.box.max.y - 0.12; live.head.add(ring); a.outfitParts.push(ring);
  }
  if (r >= 3 && !(armour && armour.gem)) put('chest', charmGeo, toon(c.trim, { emissive: new THREE.Color(c.trim).multiplyScalar(0.5 + glow) }), ch.clone().add(new THREE.Vector3(0, 0.14 * S1, 0.35 * S1)), new THREE.Euler(0, 0, 0), new THREE.Vector3(0.075 * S1, 0.1 * S1, 0.04 * S1));
  for (const m of a.outfitParts) { markStencil(m); addInk(m); }
}
// shimmering looks (mythic outfits, prism cape) slowly cycle through the colours
const _shim = new THREE.Color();
let shimAt = 0;
function shimmerTick(a, cos) {
  if (!a || !cos) return;
  const of = cos.outfit && COS.outfit[cos.outfit], cp = cos.cape && COS.cape[cos.cape];
  if (!(of && of.shimmer) && !(cp && cp.shimmer)) return;
  a.root.traverse((o) => {
    if (!o.isMesh || !o.userData.ownMats) return;
    const body = /_Body$/.test(o.name), cape = /_Cape$/.test(o.name);
    if (cape && cp && cp.shimmer) { _shim.setHSL((now * 0.12) % 1, 0.75, 0.6); for (const m of [o.userData.mats.std, o.userData.mats.toon]) { m.color.copy(_shim); if (m.emissive) m.emissive.copy(_shim).multiplyScalar(0.35); } }
    else if (body && of && of.shimmer) { const k = 0.5 + 0.5 * Math.sin(now * 2.2); for (const m of [o.userData.mats.std, o.userData.mats.toon]) if (m.emissive) m.emissive.set(of.body).lerp(_shim.set(of.trim), 0.25 * k).multiplyScalar(0.35 + 0.15 * k); }
  });
}
// Armour you wear shows on your hero: chunky shoulder pads, a belt, a chest badge. Bigger armour, bigger pads.
const ARMOUR_LOOK = {
  ar_leather: { col: '#a8683a', trim: '#6e3f1e', pad: 0.26, belt: true },
  ar_chain: { col: '#c3cedc', trim: '#7d8796', pad: 0.3, belt: true, layers: 2, gorget: true },
  ar_gold: { col: '#ffcc33', trim: '#c9821c', pad: 0.36, belt: true, layers: 2, gorget: true, gem: '#e0444f', spike: true },
  ar_frost: { col: '#cfefff', trim: '#5aa8d8', pad: 0.38, belt: true, layers: 2, gorget: true, gem: '#7fe8ff', spike: true },
  ar_mire: { col: '#9adf7a', trim: '#3a6a2a', pad: 0.41, belt: true, layers: 3, gorget: true, gem: '#c8ff9a', spike: true, glow: '#1a4a10' },
  ar_sun: { col: '#ffd27a', trim: '#c87a1a', pad: 0.45, belt: true, layers: 3, gorget: true, gem: '#ff6a2a', spike: true, glow: '#6a3a00' },
};
const restRigs = new Map();
const padGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), ringGeo = new THREE.TorusGeometry(1, 0.16, 8, 28), gemGeo = new THREE.OctahedronGeometry(1, 0), spikeGeo = new THREE.ConeGeometry(1, 2.4, 8);
// an outfit is a full look of its own: armour pieces and the shield stay hidden under it (their stats still count)
const outfitOn = () => { const oc = cosState().eq.outfit; return !!(oc && COS.outfit[oc]); };
function dressArmour() {
  { const oc = cosState().eq.outfit; dressOutfit(player, oc && COS.outfit[oc], heroModel(), null); }
  if (player.armourParts) for (const m of player.armourParts) m.removeFromParent();
  player.armourParts = [];
  const A = outfitOn() ? null : ARMOUR_LOOK[S.equip.armour];
  if (!A) return;
  // measure on an untouched copy of the body in its rest pose, then hang each piece on the
  // matching bone of the hero, so it sits the same way whatever animation is playing
  const model = heroModel();
  if (!restRigs.has(model)) { const r = SkeletonUtils.clone(model.scene); r.scale.setScalar(1.3); r.updateMatrixWorld(true); const b = {}; r.traverse((o) => { if (o.isBone) b[o.name.replace(/[^a-z]/gi, '').toLowerCase()] = o; }); restRigs.set(model, b); }
  const rest = restRigs.get(model), live = {};
  player.root.traverse((o) => { if (o.isBone) live[o.name.replace(/[^a-z]/gi, '').toLowerCase()] = o; });
  const bones = rest;
  if (!bones.chest || !live.chest) return;
  const main = toon(A.col, A.glow ? { emissive: A.glow } : A.gem ? { emissive: '#3a2400' } : {}), trim = toon(A.trim);
  const W2L = new THREE.Matrix4(), M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const place = (bone, geo, mats, pos, rot, size) => {
    const m = new THREE.Mesh(geo); registerMesh(m, mats); m.castShadow = true;
    q.setFromEuler(rot); M.compose(pos, q, sc.copy(size));
    W2L.copy(bone.matrixWorld).invert().multiply(M);
    W2L.decompose(m.position, m.quaternion, m.scale);
    const key = Object.keys(rest).find((k) => rest[k] === bone);
    live[key].add(m); player.armourParts.push(m); return m;
  };
  const wp = (b) => new THREE.Vector3().setFromMatrixPosition(bones[b].matrixWorld);
  const S1 = 1.3;
  for (const side of ['l', 'r']) {
    const arm = bones[`upperarm${side}`]; if (!arm) continue;
    const sp = wp(`upperarm${side}`), out = Math.sign(sp.x) || (side === 'l' ? 1 : -1);
    const r = A.pad * S1;
    for (let i = 0; i < (A.layers || 1); i++) {
      const k = 1 - i * 0.22;
      place(arm, padGeo, i ? trim : main, sp.clone().add(new THREE.Vector3(out * (0.06 + i * 0.07) * S1, (0.1 - i * 0.12) * S1, 0)), new THREE.Euler(0, 0, -out * (0.45 + i * 0.25)), new THREE.Vector3(r * k, r * 0.78 * k, r * 1.05 * k));
    }
    place(arm, ringGeo, trim, sp.clone().add(new THREE.Vector3(out * 0.06 * S1, 0.1 * S1, 0)), new THREE.Euler(Math.PI / 2, 0, -out * 0.45), new THREE.Vector3(r * 0.98, r * 1.03, r * 0.9));
    if (A.spike) place(arm, spikeGeo, trim, sp.clone().add(new THREE.Vector3(out * 0.2 * S1, 0.36 * S1, 0)), new THREE.Euler(0, 0, -out * 0.6), new THREE.Vector3(0.06 * S1, 0.07 * S1, 0.06 * S1));
  }
  const ch = wp('chest');
  if (A.gorget) place(bones.chest, ringGeo, main, ch.clone().add(new THREE.Vector3(0, 0.36 * S1, 0.02 * S1)), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.26 * S1, 0.24 * S1, 0.4 * S1));
  if (A.gem) {
    place(bones.chest, gemGeo, toon(A.gem, { emissive: '#400' }), ch.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.36 * S1)), new THREE.Euler(0, 0, 0), new THREE.Vector3(0.09 * S1, 0.12 * S1, 0.05 * S1));
    place(bones.chest, ringGeo, main, ch.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.33 * S1)), new THREE.Euler(0, 0, 0), new THREE.Vector3(0.12 * S1, 0.14 * S1, 0.12 * S1));
  }
  if (A.belt && bones.hips) {
    const hp = wp('hips');
    place(bones.hips, ringGeo, trim, hp.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.01 * S1)), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.4 * S1, 0.34 * S1, 0.55 * S1));
    place(bones.hips, gemGeo, main, hp.clone().add(new THREE.Vector3(0, 0.12 * S1, 0.36 * S1)), new THREE.Euler(0, 0, Math.PI / 4), new THREE.Vector3(0.08 * S1, 0.08 * S1, 0.04 * S1));
  }
  for (const m of player.armourParts) { markStencil(m); addInk(m); }
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
          diffuseColor *= vec4(mix(texel.rgb, vec3(min(1.0, 0.62 + lum * 0.55)), colourise), texel.a);
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
// weapons in hand are drawn a bit longer than the models come, so blades and staffs read as heroic
function stretchBlade(m) {
  const box = new THREE.Box3(), sz = new THREE.Vector3();
  m.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
  m.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); box.union(b); } });
  box.getSize(sz);
  const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
  for (const k of ['x', 'y', 'z']) m.scale[k] *= k === ax ? 1.28 : 1.08;
}
function equipGear() {
  if (!player) return;
  const w = W(), sh = ARMOUR[S.equip.shield] || ARMOUR.sh_badge;
  for (const m of player.customs || []) m.removeFromParent();
  player.customs = []; player.weapons = [];
  const hold = (item, base, side) => {
    if (side === 'l' && outfitOn()) { if (base) base.visible = false; return; }
    if (base) base.visible = !item.model;
    // shields are held a bit smaller so they don't hide the hero's outfit
    if (base && side === 'r' && !item.model && !base.userData.stretched) { base.userData.stretched = true; stretchBlade(base); }
    if (base && side === 'l') { if (base.userData.s0 == null) base.userData.s0 = base.scale.x; base.scale.setScalar(base.userData.s0 * 0.64); }
    if (!item.model) { if (base) player.weapons.push(base); return; }
    if (!lib[item.model]) return;
    const m = lib[item.model].clone(true); stylize(m);
    if (item.tint) tinted(m, item.tint);
    addSilhouette(m, '#ffe9a0');
    const slot = handSlot(side);
    if (side === 'l') m.scale.multiplyScalar(0.64);
    else if (item.type !== 'ranged') stretchBlade(m);
    if (slot) slot.add(m);
    player.customs.push(m); player.weapons.push(m);
  };
  hold(w, player.base.weapon, 'r');
  hold(sh, player.base.shield, 'l');
  // higher tier weapons glow
  const wm = player.customs.find((m) => player.weapons.includes(m)); if (wm && w.model) glowMesh(wm, w.tint || '#ffe9a0', gearGlow(w, S.equip.weapon));
  heroFlair();
  for (const g of player.weapons) g.visible = !player.task;
  // the ground wedge shows how far your weapon reaches
  arcMesh.scale.setScalar(w.type === 'melee' ? (w.reach + 0.6) / (MELEE_REACH + 0.6) : 1);
  applyLook();
}
// ---------- hotbar ----------
// Eight slots along the bottom. Put food or gear on it from the Bag, then press 1-8 (or tap) to eat or equip.
const HOT_N = 8;
function hotbar() { if (!Array.isArray(S.hotbar) || S.hotbar.length !== HOT_N) S.hotbar = [...(S.hotbar || []), ...Array(HOT_N).fill(null)].slice(0, HOT_N); return S.hotbar; }
let hotPick = -1; // a slot the player tapped to fill next
function pinToHotbar(k) {
  const hb = hotbar(), at = hb.indexOf(k);
  if (at >= 0 && hotPick < 0) { hb[at] = null; toast(`Took ${ITEMS[k] || GEAR[k].name} off the hotbar.`); }
  else {
    if (at >= 0) hb[at] = null;
    let i = hotPick >= 0 ? hotPick : hb.indexOf(null);
    if (i < 0) i = HOT_N - 1;
    hb[i] = k; hotPick = -1;
    toast(`${ITEMS[k] || GEAR[k].name} is on hotbar slot ${i + 1}.`, ICONS[k] || gearIcon(GEAR[k]));
  }
  save(); renderHotbar();
}
function useHotbar(i) {
  const k = hotbar()[i];
  const slotEl = $('hotbar').children[i];
  if (slotEl) { slotEl.classList.remove('used'); void slotEl.offsetWidth; slotEl.classList.add('used'); }
  if (!k) { hotPick = i; bagTab = 'items'; if (sheetMode !== 'bag') openSheet('bag'); else renderSheet(); toast(`Pick something in your bag for slot ${i + 1} (press +).`); renderHotbar(); return; }
  if (FOOD[k]) { if (!S.inv[k]) { toast(`You're out of ${ITEMS[k]}.`, ICONS[k]); return; } eat(k); renderHotbar(); return; }
  const g = GEAR[k];
  if (!g && ITEMS[k]) { toast(`${ITEMS[k]}: ${S.inv[k] || 0} in your bag.`, ICONS[k]); return; }
  if (g && S.owned.includes(k)) {
    if (S.equip[g.slot] === k) { toast(`${g.name} is already equipped.`, gearIcon(g)); return; }
    S.equip[g.slot] = k; cancelTask(); equipGear(); buildGearBar(); updateTitle(); save();
    burst(player.pos.clone().setY(1.6), '#ffe07a', 20, 4); toast(`Equipped ${g.name}.`, gearIcon(g));
    if (sheetMode) renderSheet(); renderHotbar();
  }
}
function renderHotbar() {
  const el = $('hotbar'); if (!el || !S.started) return;
  const hb = hotbar(), kb = binds();
  // gear you sold, traded or lost in a duel leaves the hotbar
  for (let i = 0; i < HOT_N; i++) if (GEAR[hb[i]] && !S.owned.includes(hb[i])) hb[i] = null;
  // first time: fill it with your weapons, then your food, so switching weapons is one key away
  if (!S.hotAuto) {
    S.hotAuto = 1;
    const mine = [S.equip.weapon, ...S.owned.filter((k) => GEAR[k] && GEAR[k].slot === 'weapon' && k !== S.equip.weapon)].filter(Boolean);
    const foods = Object.keys(FOOD).filter((k) => S.inv[k]);
    for (const k of [...mine.slice(0, 5), ...foods]) { const at = hb.indexOf(null); if (at < 0 || hb.includes(k)) continue; hb[at] = k; }
  }
  // a new weapon you get goes straight into a free slot
  S.hotSeen = S.hotSeen || [...S.owned];
  for (const k of S.owned) if (!S.hotSeen.includes(k)) { S.hotSeen.push(k); if (GEAR[k] && GEAR[k].slot === 'weapon' && !hb.includes(k)) { const at = hb.indexOf(null); if (at >= 0) hb[at] = k; } }
  el.innerHTML = hb.map((k, i) => {
    const key = keyLabel(kb[`hot${i + 1}`][0] || kb[`hot${i + 1}`][1]);
    if (!k) return `<button class="hot empty${hotPick === i ? ' picking' : ''}" data-hot="${i}" title="Empty: tap, then press + on something in your bag"><kbd>${key}</kbd></button>`;
    const food = FOOD[k], g = GEAR[k], item = !g && ITEMS[k], n = !g ? (S.inv[k] || 0) : null;
    if (!g && !item) return `<button class="hot empty" data-hot="${i}"><kbd>${key}</kbd></button>`;
    const on = g && S.equip[g.slot] === k;
    const tip = food ? `Eat ${ITEMS[k]} (heals ${food.heal})` : g ? `Equip ${g.name}` : `${ITEMS[k]} (${n} in your bag)`;
    return `<button class="hot${on ? ' on' : ''}${!g && !n ? ' out' : ''}" data-hot="${i}" data-drag="${k}" title="${tip}. Drag to move, right-click to clear."><img src="${g ? gearIcon(g) : ICONS[k]}" alt=""><kbd>${key}</kbd>${!g ? `<span>${n}</span>` : ''}</button>`;
  }).join('');
  el.querySelectorAll('[data-hot]').forEach((b) => {
    const i = +b.dataset.hot;
    b.onclick = () => useHotbar(i);
    b.oncontextmenu = (e) => { e.preventDefault(); hotbar()[i] = null; save(); renderHotbar(); };
  });
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
  $('badgeicon').src = portrait(S.look); $('badgeicon').classList.add('face');
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
    const { full, cut } = roundNode(x, z, kind === 'oak', kind === 'oak' ? 2.5 : 2.1); addInk(full); addInk(cut);
    cut.visible = false;
    nodes.push(hpNode({ kind, def: NODES[kind], x, z, full, cut, alive: true, respawnAt: 0, reach: 2.6, r: 1.1 }));
  };
  for (let i = 0; i < 80 && nodes.length < 18; i++) { const a = rng() * Math.PI * 2, r = 18 + rng() * 24; addTree(Math.cos(a) * r, Math.sin(a) * r, 'tree'); }
  for (let i = 0; i < 60 && nodes.filter((n) => n.kind === 'oak').length < 8; i++) addTree(6 + rng() * 26, 30 + rng() * 14, 'oak');

  const addRock = (x, z, kind) => {
    place(rng() > 0.5 ? 'rock_single_D' : 'rock_single_E', x, z, S_NATURE * 2.6, rng() * 6, { shrink: 0.5 });
    const gems = new THREE.Group();
    const mats = toon(kind === 'copper' ? '#ff9b3d' : kind === 'frostsilver' ? '#7fe8ff' : kind === 'sunstone' ? '#ffc84a' : '#a8c8f0', { emissive: kind === 'copper' ? '#5a2600' : kind === 'frostsilver' ? '#1a5a70' : kind === 'sunstone' ? '#8a4a00' : '#1b2f52' });
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
  // Frostsilver only grows in the north, around Snowman Hills
  for (const [dx, dz] of [[-20, -14], [-24, -8], [-18, -4], [-12, 18], [-20, 14]]) addRock(LANDS.frost.zones.hills.x + dx, LANDS.frost.zones.hills.z + dz, 'frostsilver');
  // Bogwood: dark, mossy trees around Lilypad Landing (Woodcutting 30)
  const ML = LANDS.marsh;
  for (const [dx, dz] of [[-16, 14], [-20, 2], [16, 16], [22, 0], [-8, -14], [10, -16], [-28, 24], [30, 20]]) {
    const x = ML.village.x + dx, z = ML.village.z + dz;
    if (!isFree(x, z, 2)) continue;
    const full = place('tree_single_A', x, z, S_NATURE * 1.35, rng() * 6, { shrink: 0.35 });
    const cut = place('tree_single_A_cut', x, z, S_NATURE * 1.35, full.rotation.y, { collide: false });
    for (const o of [full, cut]) o.traverse((m) => { if (m.isMesh && m.userData.mats) { for (const k of ['std', 'toon']) { m.userData.mats[k] = m.userData.mats[k].clone(); m.userData.mats[k].color.multiply(new THREE.Color('#6a8a4a')); } m.material = styled.on ? m.userData.mats.toon : m.userData.mats.std; } });
    cut.visible = false;
    nodes.push(hpNode({ kind: 'bogwood', def: NODES.bogwood, x, z, full, cut, alive: true, respawnAt: 0, reach: 2.6, r: 1.1 }));
  }
  // Mireiron glints at the bottom of the Deep Pool (Fishing 30)
  for (const a of [0.4, 2.4, 4.4]) {
    const P = ML.pond, x = P.x + Math.cos(a) * (P.r - 1.2), z = P.z + Math.sin(a) * (P.r - 1.2);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 24), new THREE.MeshBasicMaterial({ color: '#c8ff9a', transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.09, z); ring.layers.set(1); scene.add(ring);
    nodes.push({ kind: 'mireiron', def: NODES.mireiron, x, z, full: ring, alive: true, reach: 3.6, ring });
  }
  // Brassbolt Sands: Sunstone rocks round the Sphinx (Mining 40, daylight only) and desert palms by the oasis road (Woodcutting 40)
  const SL = LANDS.sands;
  for (const [dx, dz] of [[14, 8], [18, -2], [10, 16], [-4, 18], [20, 12]]) { const x = SL.zones.sphinx.x + dx, z = SL.zones.sphinx.z + dz; if (isFree(x, z, 2)) addRock(x, z, 'sunstone'); }
  for (const [dx, dz] of [[-18, 6], [-22, -6], [18, 4], [24, -8], [-14, -16], [12, -18]]) {
    const x = SL.village.x + dx, z = SL.village.z + dz;
    if (!isFree(x, z, 2)) continue;
    const { full, cut } = palmNode(x, z); addInk(full); addInk(cut);
    cut.visible = false;
    nodes.push(hpNode({ kind: 'palm', def: NODES.palm, x, z, full, cut, alive: true, respawnAt: 0, reach: 2.6, r: 1.1 }));
  }

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
    { id: 'pip', name: 'Pip of the Request Board', model: 'archer', x: -10.5, z: 12, hide: [], board: true, tint: '#ffd8a0' },
    { id: 'brom', name: 'Brom the Blacksmith', model: 'barbarian', x: 5.5 * VS, z: -19.8 * VS, hide: [], shop: 'melee', tint: '#ffb38a' },
    { id: 'wisteria', name: 'Madame Wisteria', model: 'mage', x: 18.4 * VS, z: -21.6 * VS, hide: [], shop: 'magic', tint: '#f0b0ff' },
    { id: 'hazel', name: 'Hazel the Fletcher', model: 'heroine', x: -22 * VS, z: 10.5 * VS, hide: [], shop: 'ranged', tint: '#d8f0a0' },
    { id: 'king', name: 'King Jerrold', model: 'knight', x: INTERIORS.castle.king.x, z: INTERIORS.castle.king.z, hide: ['Knight_Helmet'], king: true, tint: '#b98cff', inside: 'castle' },
    ...INTERIORS.castle.guards.map(([x, z], i) => ({ id: `guard${i}`, name: 'Royal Guard', model: 'knight', x, z, hide: [], inside: 'castle', tint: '#8fb8ff',
      lines: ['Long live King Jerrold!', 'The King grants a new calling to any hero who asks.', 'Mind the carpet. The King had it cleaned this morning.'] })),
    { id: 'giles', name: 'Farmer Giles', model: 'barbarian', x: ZONES.meadow.x + 3, z: ZONES.meadow.z + 5, hide: [], tint: '#d8c070' },
    { id: 'pip', name: 'Granny Pip', model: 'mage', x: ZONES.meadow.x - 6, z: ZONES.meadow.z + 1, hide: [], tint: '#ffc0d8',
      lines: ['Back in my day, skeletons said please before they stabbed you.', 'Have you tried my apple pie? Marta in the village sells it. I taught her!', 'The windmill squeaks a little song at night. Listen closely.'] },
    { id: 'crier', name: 'Bertram the Town Crier', model: 'knight', x: -6 * VS, z: 5 * VS, hide: ['Knight_Helmet'], tint: '#ffd08a',
      lines: ['Hear ye! Four lands lie beyond the woods: Glimmerwood to the east, Grumble Crags to the west, Honeymeadow to the south and Haunted Hollow to the north!', 'Hear ye! Each land has a fearsome boss. Watch for the red glow on the ground and get out of the way!', 'Hear ye! Hold Shift to sprint, press C (or tap any direction twice) to dash in any direction, J or click to attack, R for your special attack, and M for the map. Hear ye!', 'Hear ye! Coins in the bank are safe. Coins in your pocket? Half of them fall out when you get knocked out!', 'Hear ye! Adventurers wander the valley. Talk to them or open the Crew menu to make them allies, leave them be, or make them your rivals!', 'Hear ye! Monsters have taken Thornbury, Mossbrook and Cinderholt! Defeat each town\'s tyrant to free it, and the townsfolk will send you coins.'] },
    { id: 'lumi', name: 'Lumi the Wisp-keeper', model: 'mage', x: ZONES.glimmer.x - 14, z: ZONES.glimmer.z + 4, hide: [], tint: '#9ff0ff',
      lines: ['The Gloomcaster stole the colour from half my mushrooms. The rest glow twice as bright out of spite!', 'Glimmerwood hums at night. Can you hear it? No? Try humming back.'] },
    { id: 'dot', name: 'Prospector Dot', model: 'heroine', x: ZONES.crags.x + 15, z: ZONES.crags.z + 4, hide: [], tint: '#e8b080',
      lines: ['Bonecrusher sleeps in the middle of the Crags. Well, "sleeps". Mostly he stomps.', 'When the ground glows red, jump! I learned that one the hard way. Twice.'] },
    { id: 'mort', name: 'Gravekeeper Mort', model: 'barbarian', x: ZONES.hollow.x + 12, z: ZONES.hollow.z + 12, hide: [], tint: '#a8a8c0',
      lines: ['Captain Rattlebones keeps getting up. I keep putting him down. It is a living. Well. Sort of.', 'Do not mind the gravestones. Most of them are empty. Most.'] },
    { id: 'penny', name: 'Penny the Banker', model: 'mage', x: -3 * VS, z: 13.5 * VS, hide: [], bank: true, tint: '#ffe08a' },
    { id: 'tom', name: 'Old Tom the Barkeep', model: 'barbarian', x: INTERIORS.tavern.barkeep.x, z: INTERIORS.tavern.barkeep.z, hide: [], shop: 'food', tint: '#e8c89a', inside: 'tavern', face: 'south' },
    { id: 'captain', name: 'Captain Barnaby Gale', model: 'barbarian', x: VALLEY_DOCK.x, z: VALLEY_DOCK.z, hide: [], tint: '#5a8ad8', sail: 'frost',
      look: { skin: 'tan', eyes: 'blue', eyeStyle: 'happy', mouth: 'grin', hair: 'short', beard: 'full', hairCol: 'ginger' } },
    { id: 'captain2', name: 'Captain Barnaby Gale', model: 'barbarian', x: LANDS.frost.captain.x, z: LANDS.frost.captain.z, hide: [], tint: '#5a8ad8', sail: 'out', inside: 'frost',
      look: { skin: 'tan', eyes: 'blue', eyeStyle: 'happy', mouth: 'grin', hair: 'short', beard: 'full', hairCol: 'ginger' } },
    { id: 'elder', name: 'Elder Mittens', model: 'mage', x: LANDS.frost.elder.x, z: LANDS.frost.elder.z, hide: [], tint: '#9fd0ff', inside: 'frost',
      look: { sex: 'f', skin: 'porcelain', eyes: 'sky', eyeStyle: 'happy', mouth: 'smile', hair: 'bun', hairCol: 'snow', mark: 'rosy', hat: true } },
    // travelling merchants: one in every land village. They sell food and buy anything, gear included.
    { id: 'trader_frost', name: 'Pip the Peddler', model: 'heroine', x: LANDS.frost.village.x + 5, z: LANDS.frost.village.z - 7, hide: [], shop: 'food', tint: '#ffd0a0', inside: 'frost' },
    { id: 'trader_marsh', name: 'Moss the Merchant', model: 'barbarian', x: LANDS.marsh.village.x + 5, z: LANDS.marsh.village.z - 7, hide: [], shop: 'food', tint: '#b8e0a0', inside: 'marsh' },
    { id: 'trader_sands', name: 'Saffi the Trader', model: 'mage', x: LANDS.sands.village.x + 5, z: LANDS.sands.village.z - 7, hide: [], shop: 'food', tint: '#ffcf8a', inside: 'sands' },
    { id: 'trader_out', name: 'Wandering Wim', model: 'barbarian', x: CAMP.x + 9, z: CAMP.z - 6, hide: [], shop: 'food', tint: '#d8c0ff' },
    { id: 'frida', name: 'Frida the Frostsmith', model: 'barbarian', x: LANDS.frost.village.x - 7, z: LANDS.frost.village.z + 6, hide: [], shop: 'frost', tint: '#9fd8ff', inside: 'frost',
      look: { sex: 'f', skin: 'tan', eyes: 'sky', eyeStyle: 'sharp', mouth: 'grin', hair: 'braid', hairLen: 'long', hairCol: 'snow' } },
    { id: 'snowkid', name: 'Pip Snowdrift', model: 'heroine', x: LANDS.frost.village.x + 6, z: LANDS.frost.village.z + 5, hide: [], tint: '#ff9ab8', inside: 'frost',
      look: { sex: 'f', skin: 'peach', eyes: 'green', eyeStyle: 'round', mouth: 'grin', hair: 'twin', hairLen: 'shoulder', hairCol: 'ginger', mark: 'freckles' },
      lines: ['I built every snowman on Snowman Hills! Well, most of them. Some of them built themselves...', 'Queen Frostwhisker used to be nice, Granny says. Then she got bored of everyone being warm.', 'Watch out on the frozen pond. It is very slippy. I know from experience!'] },
    // Chapter 3: Lilypad Landing in Gobbler Marsh
    { id: 'captain3', name: 'Captain Barnaby Gale', model: 'barbarian', x: LANDS.marsh.captain.x, z: LANDS.marsh.captain.z, hide: [], tint: '#5a8ad8', sail: 'out', inside: 'marsh',
      look: { skin: 'tan', eyes: 'blue', eyeStyle: 'happy', mouth: 'grin', hair: 'short', beard: 'full', hairCol: 'ginger' } },
    { id: 'croakley', name: 'Mayor Croakley', model: 'barbarian', x: LANDS.marsh.elder.x, z: LANDS.marsh.elder.z, hide: [], tint: '#7ac05a', inside: 'marsh',
      look: { skin: 'green', eyes: 'gold', eyeStyle: 'round', mouth: 'cat', hair: 'none', hairCol: 'green', mark: 'freckles', head: 'chibi' } },
    { id: 'bramble', name: 'Bramblewick the Bogsmith', model: 'mage', x: LANDS.marsh.village.x - 7, z: LANDS.marsh.village.z + 6, hide: [], shop: 'marsh', tint: '#8ac06a', inside: 'marsh',
      look: { sex: 'f', skin: 'tan', eyes: 'green', eyeStyle: 'sharp', mouth: 'grin', hair: 'curls', hairLen: 'shoulder', hairCol: 'green', mark: 'freckles' } },
    { id: 'tadpole', name: 'Tadpole Tim', model: 'knight', x: LANDS.marsh.village.x + 6, z: LANDS.marsh.village.z + 5, hide: [], tint: '#9ad87a', inside: 'marsh',
      look: { skin: 'green', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'mohawk', hairCol: 'green', head: 'chibi' },
      lines: ['The Gobbler ate my wellies! Both of them! I only had them for a week!', 'If you stand really still by the Deep Pool you can hear Mireiron clinking at the bottom. Fishing it up takes ages though.', 'Bogwood trees only let strong woodcutters chop them. My grandpa says level 30. I am level 2.'] },
    // Brassbolt Sands
    { id: 'captain4', name: 'Captain Barnaby Gale', model: 'barbarian', x: LANDS.sands.captain.x, z: LANDS.sands.captain.z, hide: [], tint: '#5a8ad8', sail: 'out', inside: 'sands',
      look: { skin: 'tan', eyes: 'blue', eyeStyle: 'happy', mouth: 'grin', hair: 'short', beard: 'full', hairCol: 'ginger' } },
    { id: 'tinkerwell', name: 'Professor Tinkerwell', model: 'mage', x: LANDS.sands.elder.x, z: LANDS.sands.elder.z, hide: [], tint: '#d8a850', inside: 'sands',
      look: { skin: 'bronze', eyes: 'sky', eyeStyle: 'round', mouth: 'grin', hair: 'none', beard: 'long', hairCol: 'snow', head: 'chibi' } },
    { id: 'gizmo', name: 'Gizmo the Gearsmith', model: 'heroine', x: LANDS.sands.village.x - 7, z: LANDS.sands.village.z + 6, hide: [], shop: 'sands', tint: '#e0a050', inside: 'sands',
      look: { sex: 'f', skin: 'ebony', eyes: 'gold', eyeStyle: 'sharp', mouth: 'grin', hair: 'pony', hairLen: 'long', hairCol: 'ginger', mark: 'paint' } },
    { id: 'cogsworth', name: 'Cogsworth, Voice of the Sphinx', model: 'skel_mage', x: LANDS.sands.zones.sphinx.x, z: LANDS.sands.zones.sphinx.z + 2, hide: [], tint: '#e0b058', inside: 'sands' },
    { id: 'dunstan', name: 'Dusty Dunstan', model: 'barbarian', x: LANDS.sands.village.x + 6, z: LANDS.sands.village.z + 5, hide: [], tint: '#e8c890', inside: 'sands',
      look: { skin: 'honey', eyes: 'brown', eyeStyle: 'sleepy', mouth: 'smile', hair: 'shag', hairCol: 'blonde', beard: 'stache', head: 'chibi' },
      lines: ['Sunstone only goes soft in daylight. Mine it at night and you will just bonk your pickaxe. Mining 40, mind.', 'Desert palms are as tough as old boots. You need Woodcutting 40 to chop one.', 'I once sold the Colossus a hat. It did not say thank you. It did not say anything. It is a statue.'] },
  ];
  for (const d of defs) makeNpc(d);
}
function makeNpc(d) {
  {
    const look = d.look ? { ...NPC_BASE, ...d.look } : NPC_LOOKS[d.id] || NPC_LOOKS[d.id.replace(/\d+$/, '')];
    const hide = [...d.hide];
    if (look && !look.hat) hide.push('Barbarian_Hat', 'Mage_Hat', 'Knight_Helmet');
    const a = new Actor(G[d.model], { hide, scale: 1.3 });
    if (look) dressNpc(a, look);
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
    const n = { ...d, look, actor: a, marker: m, reach: 3.2, accent: d.king ? '#e0a21c' : d.shop ? '#e8743a' : d.bank ? '#d9a21c' : d.lines ? '#3a9ad9' : '#8f62d8' };
    npcs.push(n);
    return n;
  }
}
// Each villager gets a hand-made look in the same chibi style as the hero: big head, painted face, hair.
const NPC_LOOKS = (() => {
  const base = { skin: 'peach', eyes: 'brown', eyeStyle: 'round', mouth: 'smile', mark: 'none', hair: 'short', hairLen: 'short', hairCol: 'chestnut', ears: 'human', head: 'big', beard: 'none', hat: false, sex: 'm' };
  const L = (o) => ({ ...base, ...o });
  return {
    bertha: L({ sex: 'f', skin: 'honey', eyes: 'green', eyeStyle: 'happy', mouth: 'grin', hair: 'bun', hairCol: 'ginger', mark: 'rosy' }),
    rowan: L({ skin: 'tan', eyes: 'blue', eyeStyle: 'sharp', mouth: 'calm', hair: 'swept', hairCol: 'black', mark: 'scar', beard: 'stache' }),
    fenwick: L({ skin: 'porcelain', eyes: 'grey', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', hairCol: 'snow', beard: 'wizard', hat: true }),
    marta: L({ sex: 'f', skin: 'porcelain', eyes: 'sky', eyeStyle: 'happy', mouth: 'grin', hair: 'twin', hairLen: 'shoulder', hairCol: 'blonde', mark: 'freckles' }),
    brom: L({ skin: 'bronze', eyes: 'gold', eyeStyle: 'sharp', mouth: 'grin', hair: 'none', hairCol: 'ginger', beard: 'full', hat: true }),
    wisteria: L({ sex: 'f', skin: 'peach', eyes: 'violet', eyeStyle: 'sleepy', mouth: 'cat', hair: 'hime', hairLen: 'long', hairCol: 'pink', mark: 'star', hat: true }),
    hazel: L({ sex: 'f', skin: 'tan', eyes: 'hazel', eyeStyle: 'round', mouth: 'smile', hair: 'long', hairLen: 'long', hairCol: 'green', mark: 'freckles', ears: 'elf' }),
    king: L({ skin: 'peach', eyes: 'blue', eyeStyle: 'happy', mouth: 'grin', hair: 'curls', hairCol: 'snow', beard: 'full', head: 'chibi' }),
    guard: L({ skin: 'honey', eyes: 'brown', eyeStyle: 'sharp', mouth: 'calm', hair: 'none', beard: 'stache', hairCol: 'chestnut', hat: true }),
    giles: L({ skin: 'tan', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'spiky', hairCol: 'chestnut', mark: 'freckles', beard: 'goatee' }),
    pip: L({ sex: 'f', skin: 'porcelain', eyes: 'blue', eyeStyle: 'sleepy', mouth: 'smile', hair: 'bun', hairCol: 'snow', mark: 'rosy', head: 'chibi' }),
    crier: L({ skin: 'peach', eyes: 'green', eyeStyle: 'round', mouth: 'grin', hair: 'curls', hairCol: 'ginger', beard: 'curly' }),
    lumi: L({ sex: 'f', skin: 'blue', eyes: 'sky', eyeStyle: 'round', mouth: 'cat', hair: 'bob', hairCol: 'snow', mark: 'star', ears: 'elf', hat: true }),
    dot: L({ sex: 'f', skin: 'bronze', eyes: 'gold', eyeStyle: 'sharp', mouth: 'fang', hair: 'short', hairCol: 'black', mark: 'paint' }),
    mort: L({ skin: 'green', eyes: 'red', eyeStyle: 'sleepy', mouth: 'calm', hair: 'mohawk', hairCol: 'black', beard: 'goatee' }),
    penny: L({ sex: 'f', skin: 'ebony', eyes: 'gold', eyeStyle: 'round', mouth: 'smile', hair: 'hime', hairLen: 'shoulder', hairCol: 'black' }),
    tom: L({ skin: 'peach', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'none', hairCol: 'snow', beard: 'curly', head: 'chibi' }),
  };
})();
function npcLife(n, dt) {
  const a = n.actor;
  if (player && Math.hypot(a.root.position.x - player.pos.x, a.root.position.z - player.pos.z) > 55) return;
  a.mixer.update(dt);
  n.marker.position.y = 4.6 + Math.sin(now * 3 + n.x) * 0.15;
  if (!a.root.visible) return;
  headPose(a);
  faceTick(a);
  // a gentle squash-and-stretch breath, bouncier while chatting
  const chat = talking === n, hop = Math.max(0, (a.hopUntil || 0) - now);
  const k = Math.sin(now * (chat ? 7 : 2.4) + (a.breathPh || 0)) * (chat ? 0.045 : 0.022);
  a.root.scale.set(1.3 * (1 - k * 0.5), 1.3 * (1 + k), 1.3 * (1 - k * 0.5));
  a.root.position.y = hop > 0 ? Math.sin((1 - hop / 0.35) * Math.PI) * 0.45 : 0;
  // turn to look at the hero when they come close
  if (player && (n.inside || 'out') === where) {
    const dx = player.pos.x - n.x, dz = player.pos.z - n.z, d = Math.hypot(dx, dz);
    if (d < 7 || chat) {
      const want = Math.atan2(dx, dz); let diff = want - a.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      a.root.rotation.y += diff * Math.min(1, dt * 5);
      if (!n.greeted && d < 5) { n.greeted = true; a.hopUntil = now + 0.35; if (!n.shop && !chat) a.play('Cheer', { once: true, fade: 0.15, speed: 1.3, onFinish: () => npcIdle(n) }); }
    } else if (d > 10) n.greeted = false;
  }
}
function dressNpc(a, L) {
  buildFace(a, L);
  if (L.hair !== 'none') {
    const col = new THREE.Color(hairOf(L)).multiplyScalar(0.72);
    const mats = hairMatsFor(`#${col.getHexString()}`);
    const g = hairGroup(L.hair, L.hairLen, mats);
    a.headInfo.bone.add(g); addInk(g);
  }
  addInk(a.root);
  a.blinkAt = Math.random() * 4; a.breathPh = Math.random() * 6;
}
const npcIdle = (n) => n.actor.play(n.id === 'fenwick' ? 'Spellcasting' : 'Idle');

// ---------- enemies ----------
for (const k of ['mud_gloop', 'boss_gobbler', 'sand_gloop']) ENEMY_TYPES[k].alias = ENEMY_TYPES.bog_slime.alias;
ENEMY_TYPES.dust_bat.alias = ENEMY_TYPES.mire_bat.alias;
// Toughness pass (Callum, Nov 23): every monster hits harder and takes longer to beat; bosses much more so.
const MOB_HP = 2.2, MOB_HIT = 1.9, BOSS_HP = 4.5, BOSS_HIT = 3;
// each chapter's land is a big step up from the last
const CHAPTER_MULT = { out: 1, frost: 1.35, marsh: 1.75, sands: 2.3 };
function farMult(w, x, z) {
  const c = w === 'out' || !LANDS[w] ? { x: 0, z: 0 } : LANDS[w].village;
  if (!c || (w !== 'out' && !LANDS[w])) return 1;
  const d = Math.hypot(x - c.x, z - c.z);
  return 1 + Math.min(0.8, Math.max(0, (d - 35) / 110));
}
// Boss hits always matter: at least a share of your max health (after your defence), however strong you are.
function bossDmg(e, k = 1) {
  if (!e.T.boss) return Math.max(1, Math.round(e.T.maxHit * k));
  return Math.max(Math.round(e.T.maxHit * k), Math.round(maxHp() * 0.075 * k * defDiv()));
}
function toughen(T) { if (T.world || T.toughened) return; T.toughened = true; const ch = CHAPTER_MULT[T.inside || 'out'] || 1; T.hp = Math.round(T.hp * (T.boss ? BOSS_HP : MOB_HP) * ch); T.maxHit = Math.max(1, Math.round(T.maxHit * (T.boss ? BOSS_HIT : MOB_HIT) * ch)); }
// Valley critters: round, goofy monsters alongside the skeletons (Quaternius CC0 slime and bat)
Object.assign(ENEMY_TYPES, {
  jelly_slime: { name: 'Jelly Slime', model: 'slime', hp: 14, maxHit: 3, xp: 18, scale: 0.6, noBones: true, poof: true, tintAll: '#ff8ac8', mass: 0.9, coins: [3, 10], alias: ENEMY_TYPES.bog_slime.alias },
  honey_slime: { name: 'Honey Slime', model: 'slime', hp: 20, maxHit: 4, xp: 24, scale: 0.7, noBones: true, poof: true, tintAll: '#ffc83a', mass: 1, coins: [4, 12], alias: ENEMY_TYPES.bog_slime.alias },
  mint_slime: { name: 'Mint Slime', model: 'slime', hp: 22, maxHit: 4, xp: 26, scale: 0.7, noBones: true, poof: true, tintAll: '#7fe8c8', mass: 1, coins: [4, 12], alias: ENEMY_TYPES.bog_slime.alias },
  hollow_bat: { name: 'Hollow Bat', model: 'bat', hp: 16, maxHit: 4, xp: 24, scale: 0.6, noBones: true, poof: true, fly: 1.5, mass: 0.6, tintAll: '#8a6ac8', coins: [4, 12], alias: ENEMY_TYPES.mire_bat.alias },
});
for (const T of Object.values(ENEMY_TYPES)) toughen(T);
function spawnEnemy(k, x, z) {
  const T = ENEMY_TYPES[k];
  const e = new Actor(G[T.model || k], { scale: T.scale || 1.3 });
  if (T.weapon) { const w = lib[T.weapon].clone(true); stylize(w); e.attach(w); }
  if (T.alias) e.alias = T.alias;
  if (T.tintAll) e.root.traverse((o) => { if (o.isMesh && !/Eye/i.test((o.userData.mats && o.userData.mats.std.name) || (o.material && o.material.name) || '')) tinted(o, T.tintAll); });
  if (T.dragon) e.alias = { Idle: 'Flying_Idle', Idle_Combat: 'Flying_Idle', Running_A: 'Fast_Flying', Walking_A: 'Flying_Idle', Hit_A: 'HitReact', Death_A: 'Death', '1H_Melee_Attack_Chop': 'Headbutt', Spellcast_Shoot: 'Punch', Spellcasting: 'Yes', '2H_Melee_Attack_Chop': 'Punch' };
  e.inside = T.inside || 'out';
  e.type = k; e.T = T; e.home = new THREE.Vector2(x, z);
  // monsters far from the land's village are naturally fiercer (up to +80% health and damage, and better rewards)
  const far = farMult(e.inside, x, z);
  if (!T.boss && !T.town && !T.world && far > 1.05) {
    e.T = { ...T, hp: Math.round(T.hp * far), maxHit: Math.max(1, Math.round(T.maxHit * far)), xp: Math.round(T.xp * far), coins: T.coins ? T.coins.map((c) => Math.round(c * far)) : T.coins, name: far >= 1.4 ? `Fierce ${T.name}` : T.name };
  }
  e.root.position.set(x, 0, z); e.root.rotation.y = rng() * 6;
  e.hp = T.hp; e.state = 'idle'; e.timer = rng() * 3; e.target = new THREE.Vector2(); e.nextHit = 0; e.swings = 0;
  e.play('Idle');
  if ((T.boss || T.tint) && !T.tintAll) e.root.traverse((o) => { if (o.isMesh && (T.town && !T.boss ? /Body/ : /Body|Head/).test(o.name)) tinted(o, T.tint || (k === 'boss_gloom' ? '#c8a8ff' : k === 'boss_crusher' ? '#ffd0a0' : '#c0ffc8')); });
  if (T.boss) addSilhouette(e.root, '#ff8a9a');
  if ((T.model || k).startsWith('skel')) skeletonize(e, T);
  if (T.look) { const hat = e.root.getObjectByName('Mage_Hat'); if (hat) hat.visible = false; const helm = !T.look.hat && e.root.getObjectByName('Knight_Helmet'); if (helm) helm.visible = false; dressNpc(e, { ...NPC_BASE, ...T.look }); if (k === 'boss_frost') e.root.traverse((o) => { if (o.isBone && o.name === 'head') { const c = makeCrown(); c.traverse((m) => { if (m.isMesh) registerMesh(m, toon('#bfefff')); }); o.add(c); } }); }
  if (!T.boss) { const bar = document.createElement('div'); bar.className = 'hpbar'; bar.hidden = true; bar.innerHTML = '<i></i>'; document.body.appendChild(bar); e.bar = bar; }
  else e.bar = { hidden: true, style: {}, firstChild: { style: {} } };
  e.flashMats = [];
  e.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || o.userData.isSil || Array.isArray(o.userData.mats.toon)) return;
    const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
    m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
    registerMesh(o, m); e.flashMats.push(m.std, m.toon);
    // a painted suit of armour (Pompington's stolen battle-suit): recolour the body and limbs like the hero's outfit
    if (T.suit && /_(Body|ArmLeft|ArmRight|LegLeft|LegRight)$/.test(o.name)) for (const x of [m.std, m.toon]) { colourise(x, 0.9); x.color.set(T.suit); x.needsUpdate = true; }
  });
  // heavier enemies barely budge: minions fly, warriors stagger, bosses rock on their heels
  e.mass = T.mass || (T.dragon ? 16 : T.boss ? 7 : k === 'skel_minion' ? 0.8 : k === 'skel_warrior' ? 1.3 : 1);
  e.kb = new THREE.Vector2(); e.vy = 0; e.lift = 0; e.staggerUntil = 0; e.flashT = 0;
  enemies.push(e);
  return e;
}

// Skeletons get cool bone-white skulls and glowing eyes, so they never read as bald villagers.
const skullBoxes = {}, eyeGeo = new THREE.SphereGeometry(1, 10, 8);
function skeletonize(e, T) {
  const model = T.model || e.type;
  if (!T.boss && !T.tint) e.root.traverse((o) => { if (o.isMesh && /Head|Body/.test(o.name)) tinted(o, '#d4e0ff'); });
  else if (!T.boss) e.root.traverse((o) => { if (o.isMesh && /Head/.test(o.name)) tinted(o, '#d4e0ff'); });
  if (!(model in skullBoxes)) { const tmp = SkeletonUtils.clone(G[model].scene); skullBoxes[model] = measureHead(tmp); }
  const box = skullBoxes[model];
  let bone = null; e.root.traverse((o) => { if (!bone && o.isBone && o.name === 'head') bone = o; });
  if (!box || !bone) return;
  const sz = box.getSize(new THREE.Vector3()), col = T.boss || T.town ? '#ff5a3a' : '#7ff6ff';
  const mat = new THREE.MeshBasicMaterial({ color: col, fog: false });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(eyeGeo, mat); m.layers.set(1);
    m.position.set((box.min.x + box.max.x) / 2 + sx * sz.x * 0.19, box.min.y + sz.y * 0.42, box.max.z - sz.z * 0.1);
    m.scale.setScalar(sz.x * 0.075); bone.add(m);
  }
}
function buildEnemies() {
  for (const [k, dx, dz] of [['skel_warrior', -3, -4], ['skel_minion', -6, 3], ['skel_mage', 2, 6], ['skel_minion', 5, -1], ['skel_minion', -1, 9]]) spawnEnemy(k, CAMP.x + dx, CAMP.z + dz);
  const ring = (Z, list, r) => list.forEach((k, i) => { const a = (i / list.length) * Math.PI * 2 + 0.4; spawnEnemy(k, Z.x + Math.cos(a) * r, Z.z + Math.sin(a) * r); });
  ring(ZONES.crags, ['skel_warrior', 'skel_minion', 'skel_warrior', 'skel_minion'], 16);
  ring(ZONES.glimmer, ['skel_mage', 'mint_slime', 'skel_mage', 'mint_slime', 'jelly_slime'], 17);
  ring(ZONES.hollow, ['skel_minion', 'hollow_bat', 'skel_warrior', 'hollow_bat', 'skel_mage', 'hollow_bat'], 14);
  ring(ZONES.meadow, ['honey_slime', 'jelly_slime', 'honey_slime', 'jelly_slime', 'honey_slime'], 14);
  // a few soft starter critters on the roads near the village
  for (const [x, z] of [[30, 34], [-34, 40], [44, -30]]) spawnEnemy('jelly_slime', x, z);
  spawnEnemy('boss_crusher', ZONES.crags.x, ZONES.crags.z);
  spawnEnemy('boss_gloom', ZONES.glimmer.x + 4, ZONES.glimmer.z);
  spawnEnemy('boss_rattle', ZONES.hollow.x, ZONES.hollow.z + 2);
  spawnEnemy('boss_gagron', INTERIORS.cave.lair.x, INTERIORS.cave.lair.z);
  buildTownMonsters();
  const FZs = LANDS.frost.zones;
  const fring = (Z, list, r) => list.forEach((k, i) => { const a = (i / list.length) * Math.PI * 2 + 0.7; spawnEnemy(k, Z.x + Math.cos(a) * r, Z.z + Math.sin(a) * r); });
  fring(FZs.woods, ['frost_minion', 'frost_warrior', 'frost_minion', 'frost_mage', 'frost_minion'], 11);
  fring({ x: FZs.hills.x - 10, z: FZs.hills.z - 4 }, ['frost_mage', 'frost_minion', 'frost_warrior', 'frost_minion'], 8);
  fring({ x: FZs.palace.x, z: FZs.palace.z + 18 }, ['frost_warrior', 'frost_mage', 'frost_warrior'], 6);
  spawnEnemy('boss_frost', FZs.palace.x, FZs.palace.z - 1);
  const FA = LANDS.frost.arenas;
  spawnEnemy('boss_grumble', FA.grumble.x, FA.grumble.z);
  spawnEnemy('boss_twin_a', FA.twins.x - 3, FA.twins.z + 2);
  spawnEnemy('boss_twin_b', FA.twins.x + 3, FA.twins.z - 2);
  // Gobbler Marsh
  const MZs = LANDS.marsh.zones, MV = LANDS.marsh.village;
  fring(MZs.mire, ['bog_slime', 'bog_witchling', 'mire_bat', 'bog_slime', 'bog_witchling'], 11);
  fring(MZs.ruins, ['bog_knight', 'mire_bat', 'bog_knight', 'bog_slime'], 10);
  fring({ x: MZs.gobbler.x, z: MZs.gobbler.z + 20 }, ['bog_knight', 'mire_bat', 'bog_slime'], 6);
  fring({ x: MV.x, z: MV.z - 18 }, ['bog_slime', 'mire_bat', 'bog_slime'], 7);
  spawnEnemy('boss_mire', MZs.mire.x + 1, MZs.mire.z + 1);
  spawnEnemy('boss_sogg', MZs.ruins.x, MZs.ruins.z);
  spawnEnemy('boss_gobbler', MZs.gobbler.x, MZs.gobbler.z);
  // Brassbolt Sands
  const DZs = LANDS.sands.zones, DV = LANDS.sands.village;
  fring({ x: DZs.sphinx.x + 4, z: DZs.sphinx.z + 18 }, ['sand_gloop', 'clock_conjurer', 'dust_bat', 'sand_gloop'], 8);
  fring(DZs.workshop, ['clock_soldier', 'dust_bat', 'clock_soldier', 'clock_conjurer'], 12);
  fring({ x: DZs.colossus.x, z: DZs.colossus.z + 22 }, ['clock_soldier', 'dust_bat', 'sand_gloop'], 6);
  fring({ x: DV.x, z: DV.z - 18 }, ['sand_gloop', 'dust_bat', 'sand_gloop'], 7);
  spawnEnemy('boss_pomp', DZs.workshop.x, DZs.workshop.z);
  spawnEnemy('boss_colossus', DZs.colossus.x, DZs.colossus.z - 2);
}

// ---------- inventory, xp, quests ----------
function addItem(id, n = 1) { S.inv[id] = (S.inv[id] || 0) + n; refreshUI(); if (!$('sheet').hidden && sheetMode === 'craft') renderSheet(); }
function takeItem(id, n) { S.inv[id] -= n; if (S.inv[id] <= 0) delete S.inv[id]; }
function giveXp(skill, amount, at) {
  const before = lvl(skill);
  S.xp[skill] += amount;
  const after = lvl(skill);
  if (at) floatText(at, `+${Math.round(amount)} ${SKILL_NAME[skill]}`, 'gain');
  if (after > before) {
    toast(`${SKILL_NAME[skill]} level ${after}!`, ICONS[skill], true);
    if (skill !== 'speed' || after % 5 === 0) { levelFanfare('#9cf0ff'); const el = $('banner'); el.textContent = `Level up! ${SKILL_NAME[skill]} ${after}`; el.classList.add('lvl'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); zoneNow = null; setTimeout(() => el.classList.remove('lvl'), 3300); }
    burst(player.pos.clone().setY(1.5), '#ffd23f', 50, 7, 1.4);
    if (!player.task && now > player.busyUntil && !player.dead) { player.play('Cheer', { once: true, onFinish: () => player.play('Idle') }); player.busyUntil = now + 1.2; }
    updateTitle();
    refreshUI();
  }
  // gathering also trains the hero a little (bosses and quests give the most)
  if (skill !== 'speed' && amount > 0) giveHeroXp(Math.max(1, Math.round(amount * GATHER_HERO_XP)));
  else if (!$('sheet').hidden && sheetMode === 'card' && skill !== 'speed') renderSheet();
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
    levelFanfare('#ffd84a');
    const el = $('banner'); el.textContent = `Level up! Hero ${after}`; el.classList.add('lvl'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); zoneNow = null; setTimeout(() => el.classList.remove('lvl'), 3300);
    burst(player.pos.clone().setY(1.5), '#ffd23f', 60, 7, 1.5);
    if (!player.task && now > player.busyUntil && !player.dead) { player.play('Cheer', { once: true, onFinish: () => player.play('Idle') }); player.busyUntil = now + 1.2; }
    buildGearBar();
  }
  updateTitle(); refreshUI();
  if (!$('sheet').hidden && sheetMode === 'card') renderSheet();
}
function spendPoint(k) {
  if (freePoints() <= 0) return;
  const before = maxHp();
  S.hero.alloc[k]++;
  if (k === 'hp') S.hp += maxHp() - before;
  burst(player.pos.clone().setY(1.6), k === 'hp' ? '#ff7a8a' : k === 'def' ? '#8fc2ff' : '#ffd84a', 16, 4);
  updateTitle(); buildGearBar(); refreshUI(); save(); renderSheet();
}
function levelFanfare(col) {
  if (!player) return;
  sfx('levelup');
  const c = player.pos;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; burst(new THREE.Vector3(c.x + Math.cos(a) * 1.6, 0.4, c.z + Math.sin(a) * 1.6), i % 2 ? col : '#ffffff', 5, 2.5, 1.2); }
  burst(c.clone().setY(2.8), col, 40, 6, 1.5);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.2, c.z); ring.layers.set(1); scene.add(ring);
  fx.push({ m: ring, t: 0, dur: 0.7, R: 3.2 });
  if (!player.air) { player.air = true; player.vy = 9; }
  player.play('Cheer', { once: true, fade: 0.1, speed: 1.2 });
}
const QUEST_COUNTERS = ['kills', 'boss', 'lanterns', 'choice', 'riddles', 'crates', 'castle'];
const needHave = (k, st) => (QUEST_COUNTERS.includes(k) ? st[k] || 0 : S.inv[k] || 0);
function questReady(id) {
  const q = QUESTS[id], st = S.quests[id];
  if (st.state !== 'active') return false;
  return Object.entries(q.need).every(([k, n]) => needHave(k, st) >= n);
}
// ---------- quest guide arrow ----------
// The followed quest: the one you picked, or else the first one you're on.
function trackedQuest() {
  const ok = (k) => k && QUESTS[k] && S.quests[k] && S.quests[k].state !== 'done' && (!QUESTS[k].story || storyOpen(k));
  if (ok(S.track)) return S.track;
  const act = Object.keys(QUESTS).filter((k) => S.quests[k].state === 'active');
  return act.find((k) => QUESTS[k].story) || act[0] || storyStep().find((k) => S.quests[k].state === 'todo') || null;
}
// Where the arrow points for a quest, as { x, z, inside } (inside: which building it is in, or 'out').
function questTarget(id) {
  const q = QUESTS[id], st = S.quests[id];
  const npcAt = (nid) => { const n = npcs.find((m) => m.id === nid); return n && { x: n.x, z: n.z, inside: n.inside || 'out' }; };
  if (st.state !== 'active' || questReady(id)) return npcAt(q.giver);
  const P = player.pos;
  if (q.bossType) {
    const b = enemies.find((e) => e.type === q.bossType);
    if (b) return { x: b.home.x, z: b.home.y, inside: b.inside };
  }
  if (q.need.kills) {
    let best = null, bd = 1e9;
    const zone = q.land || 'out';
    for (const e of enemies) if (!e.T.boss && e.hp > 0 && e.inside === zone && !e.T.town) { const d = Math.hypot(e.pos.x - P.x, e.pos.z - P.z); if (d < bd) { bd = d; best = e; } }
    return best ? { x: best.pos.x, z: best.pos.z, inside: zone } : zone === 'out' ? { x: CAMP.x, z: CAMP.z, inside: 'out' } : { x: LANDS[zone].x, z: LANDS[zone].z, inside: zone };
  }
  if (q.need.riddles) { const c = npcAt('cogsworth'); if (c) return c; }
  if (q.need.crates) {
    const c = crates.filter((x) => !x.got).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
    if (c) return { x: c.x, z: c.z, inside: 'sands' };
  }
  if (q.need.castle) return { x: LANDS.sands.lookout.x, z: LANDS.sands.lookout.z, inside: 'sands' };
  if (q.need.lanterns) {
    const l = lanterns.filter((x) => !x.lit).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
    if (l) return { x: l.x, z: l.z, inside: 'marsh' };
  }
  const missing = Object.keys(q.need).find((k) => (S.inv[k] || 0) < q.need[k]);
  let best = null, bd = 1e9;
  // nodes in the land you're standing in come first; ones in other lands mean a trip on the ship
  const landOf = (x) => (x > 2500 ? 'sands' : x > 1500 ? 'marsh' : x > 500 ? 'frost' : 'out');
  for (const n of nodes) if (n.def.item === missing) { const d = Math.hypot(n.x - P.x, n.z - P.z) + (landOf(n.x) === where ? 0 : 5000) + (n.alive === false ? 60 : 0); if (d < bd) { bd = d; best = n; } }
  return best ? { x: best.x, z: best.z, inside: landOf(best.x) } : npcAt(q.giver);
}
let guide = null;
function buildGuide() {
  // a chunky golden arrow that circles the hero's feet, and a bouncing star over the spot
  const g = new THREE.Group(), gold = toon('#ffc93a', { emissive: '#5a3500' });
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.75); shape.lineTo(0.55, 0.05); shape.lineTo(0.22, 0.05); shape.lineTo(0.22, -0.55); shape.lineTo(-0.22, -0.55); shape.lineTo(-0.22, 0.05); shape.lineTo(-0.55, 0.05); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }).rotateX(-Math.PI / 2);
  const arrow = new THREE.Mesh(geo); registerMesh(arrow, toon('#ffc93a', { emissive: '#7a4a00' })); arrow.castShadow = false;
  // drawn on top of everything so trees, houses or the hero never hide it
  for (const m of Object.values(arrow.userData.mats || {})) if (m && m.isMaterial) { m.depthTest = false; m.transparent = true; }
  if (arrow.material) { arrow.material.depthTest = false; arrow.material.transparent = true; }
  arrow.renderOrder = 999; arrow.scale.setScalar(1.9);
  // a dark border drawn just underneath, so the arrow reads clearly on grass, snow and sand
  const rim = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#4a2a17', depthTest: false, transparent: true, fog: false }));
  rim.scale.set(1.22, 0.6, 1.22); rim.position.set(0, -0.05, 0.02); rim.renderOrder = 998; arrow.add(rim);
  const pivot = new THREE.Group(); arrow.position.z = -4.6; pivot.add(arrow); g.add(pivot); // tip faces outward, away from the hero
  // ...but never over the hero (or a boss) themselves: they mark the stencil, and the arrow skips those pixels
  for (const m of [...Object.values(arrow.userData.mats || {}), arrow.material, rim.material]) if (m && m.isMaterial) Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.28 : 0.62, a = Math.PI / 2 + i * Math.PI / 5; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 })); registerMesh(star, gold);
  addInk(star); scene.add(star);
  scene.add(g);
  // a little sign by the arrow says where it's taking you, so it's clear what it's for
  const label = document.createElement('div'); label.className = 'guidelabel'; label.hidden = true; document.body.appendChild(label);
  guide = { g, pivot, arrow, star, label };
}
function guideTick() {
  if (!player) return;
  if (!guide) buildGuide();
  // the load-time scene tidy-up can re-home loose objects into map regions; keep the arrow on the hero
  if (guide.pivot.parent !== guide.g) guide.g.add(guide.pivot);
  if (guide.g.parent !== scene) scene.add(guide.g);
  if (guide.star.parent !== scene) scene.add(guide.star);
  // it steps aside during a boss fight, so the floor warnings are the only things on the ground
  const id = trackedQuest(), show = S.guideOn !== false && id && !uiLock() && !talking && $('bossbar').hidden;
  let t = show && questTarget(id), via = '';
  if (t && t.inside !== where) {
    // the goal is in another place: lead to the door first
    if (LANDS[where]) { const C = LANDS[where].captain; t = { x: C.x, z: C.z, inside: where }; via = 'the ship'; }
    else if (LANDS[t.inside] && where === 'out') { t = { x: VALLEY_DOCK.x, z: VALLEY_DOCK.z, inside: 'out' }; via = 'the ship'; }
    else if (where !== 'out') { const d = INTERIORS[where].room.door; t = { x: d.x, z: d.z, inside: where }; via = 'the door'; }
    else { const I = INTERIORS[t.inside]; t = I && I.outside ? { x: I.outside.x, z: I.outside.z, inside: 'out' } : null; }
  }
  const P = player.pos;
  const d = t ? Math.hypot(t.x - P.x, t.z - P.z) : 0;
  guide.g.visible = !!t && d > 4.5;
  guide.star.visible = !!t && d < 45;
  const L = guide.label;
  if (!t || d <= 4.5 || creator.open) setShown(L, false);
  if (!t) { guide.g.visible = false; guide.star.visible = false; }
  if (!t) return;
  guide.g.position.set(P.x, 0.25 + P.y, P.z);
  const want = Math.atan2(t.x - P.x, t.z - P.z) + Math.PI;
  let diff = want - guide.pivot.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  guide.pivot.rotation.y += diff * 0.2;
  guide.arrow.position.z = -4.6 - Math.sin(now * 5) * 0.35;
  guide.star.position.set(t.x, 5.2 + Math.sin(now * 3) * 0.3, t.z);
  guide.star.rotation.y = now * 2;
  if (d > 4.5 && !creator.open) {
    const q = QUESTS[id], st = S.quests[id];
    const goal = st.state !== 'active' || questReady(id) ? `Talk to ${npcName(q.giver)}` : q.name;
    const txt = `➤ ${via ? `To ${via} · ` : ''}${goal} · ${Math.round(d)}m`;
    if (L.textContent !== txt) L.textContent = txt;
    const v = tmpV.copy(player.pos).setY(0).project(camera);
    setShown(L, v.z <= 1);
    pin(L, v);
  }
}
function questProgress(id) {
  const q = QUESTS[id], st = S.quests[id];
  return Object.entries(q.need).map(([k, n]) => {
    const have = Math.min(n, needHave(k, st));
    return `${k === 'kills' ? 'Monsters' : k === 'boss' ? ENEMY_TYPES[q.bossType].name : k === 'lanterns' ? 'Lanterns lit' : k === 'choice' ? 'Choice made' : k === 'riddles' ? 'Riddles answered' : k === 'crates' ? 'Crates found' : k === 'castle' ? 'Lookout reached' : ITEMS[k]} ${have}/${n}`;
  }).join(', ');
}

// ---------- UI ----------
let sheetMode = null;
// Little messages at the top. The same message again just bumps a "×2" on the one already showing,
// and no more than three stack up at once, so the screen never fills with notes.
function toast(text, icon, big = false) {
  const box = $('toasts'), life = Math.max(big ? 3000 : 1800, Math.min(4500, 1400 + text.length * 50));
  for (const t of box.children) {
    if (t.dataset.text !== text || t.classList.contains('big') !== big) continue;
    const n = (+t.dataset.n || 1) + 1; t.dataset.n = n;
    let c = t.querySelector('em'); if (!c) { c = document.createElement('em'); t.appendChild(c); }
    c.textContent = `×${n}`;
    clearTimeout(t._gone); t._gone = setTimeout(() => t.remove(), life);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast${big ? ' big' : ''}`; el.dataset.text = text;
  el.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}<span></span>`;
  el.querySelector('span').textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  el._gone = setTimeout(() => el.remove(), life);
}
// Pop-up numbers and words. Ones that land on top of each other stack neatly instead of
// overlapping, and only a handful are on screen at once, so a busy fight stays readable.
const floats = [], _ftV = new THREE.Vector3();
function floatText(p, text, cls = '') {
  const v = _ftV.copy(p).project(camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * innerWidth, ms = performance.now();
  let y = (-v.y * 0.5 + 0.5) * innerHeight;
  for (const f of floats) if (ms - f.ms < 450 && Math.abs(f.x - x) < 70 && Math.abs(f.y - y) < 26) y = f.y - 28;
  const el = document.createElement('div');
  el.className = `float ${cls}`; el.textContent = text;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  document.body.appendChild(el);
  const f = { el, x, y, ms }; floats.push(f);
  while (floats.length > 7) floats.shift().el.remove();
  setTimeout(() => { el.remove(); const i = floats.indexOf(f); if (i >= 0) floats.splice(i, 1); }, 1000);
}
const npcName = (id) => npcs.find((n) => n.id === id).name;
function bossUi() {
  if (!player) return;
  const b = $('sheet').hidden ? enemies.find((e) => e.T.boss && e.inside === where && e.hp > 0 && (e.state === 'chase' || e.state === 'slam') && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 32) : null;
  const bar = $('bossbar');
  setShown(bar, !!b);
  if (b) {
    const phased = !!PHASE_LINES[b.type];
    setText($('bossname'), phased ? `${b.T.name} · phase ${b.phase || 1} of 3` : b.T.name);
    if (bar.classList.contains('phased') !== phased) bar.classList.toggle('phased', phased);
    setW($('bossfill'), (b.hp / b.T.hp) * 100);
  }
}
let zoneNow = null;
function zoneBanner() {
  if (!player || where !== 'out') return;
  const z = Object.values(ZONES).find((Z) => Math.hypot(player.pos.x - Z.x, player.pos.z - Z.z) < Z.r + 4);
  const tw = TOWNS.find((T) => Math.hypot(player.pos.x - T.x, player.pos.z - T.z) < T.r + 4);
  const name = tw ? `${tw.name} ${stars(tw.stars)}${townFree(tw.id) ? '' : ' · held by monsters'}` : z ? z.name : Math.hypot(player.pos.x, player.pos.z) < 46 ? 'Jerry Village' : Math.hypot(player.pos.x - 4, player.pos.z + 64) < 28 ? 'Castle grounds' : null;
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
    if (rng() < 0.06) { give('dark_omen'); toast('A DARK OMEN! Take it to a freed town to call the monsters back.', ICONS.dark_omen, true); }
    if (rng() < 0.12) { give('golden_crown'); toast('A tiny golden crown! Marta will pay a fortune for that.', ICONS.golden_crown, true); }
    // mythic: about one in a hundred Chapter 4 boss kills, one in two hundred world bosses
    const myth = Object.keys(WEAPONS).filter((k) => WEAPONS[k].mythic && !S.owned.includes(k));
    const mChance = e.T.world ? 0.005 : e.inside === 'sands' ? 0.01 : 0;
    if (myth.length && rng() < mChance) { const mk = myth[Math.floor(rng() * myth.length)]; S.owned.push(mk); popLoot(at, 'chest', 0.8); toast(`MYTHIC DROP!!! ${WEAPONS[mk].name}! Almost nobody has one of these.`, gearIcon(WEAPONS[mk]), true); burst(at.clone().setY(2), '#ff3a7a', 80, 9, 1.8); if (net.on) sendChat(`I just found a MYTHIC ${WEAPONS[mk].name}!`); }
    cosDrop(e, at, true);
    const wk = BOSS_WEAPON[e.type];
    if (wk && !S.owned.includes(wk) && rng() < 0.35) { S.owned.push(wk); popLoot(at, 'chest', 0.6); toast(`${gearRarity(WEAPONS[wk])[1].toUpperCase()} DROP: ${WEAPONS[wk].name} (${gearStats(WEAPONS[wk])})! Equip it from your bag.`, ICONS[WEAPONS[wk].type], true); }
  } else {
    if (rng() < 0.5) give('bone_dust');
    if (rng() < (e.type === 'skel_minion' ? 0.08 : 0.15)) give('dark_essence');
    if (rng() < 0.1) give(['bread', 'pie'][rng() < 0.7 ? 0 : 1]);
    // treasures: rare, and worth selling
    if (rng() < (e.type === 'skel_minion' ? 0.03 : 0.06)) give('silver_ring');
    if (rng() < (e.type === 'skel_minion' ? 0.006 : 0.015)) { give('ruby'); toast('A ruby! That will sell for a lot.', ICONS.ruby, true); }
    cosDrop(e, at, false);
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
// Opening a chest spins the treasure roulette: lights race round eight prize panels, you hit STOP,
// and it slows down onto your prize. The panels are the odds: 3 coins, 2 food, 1 XP, 1 jackpot, 1 prank.
const WHEEL = ['coins', 'food', 'xp', 'coins', 'jackpot', 'food', 'coins', 'prank'];
const WHEEL_LOOK = { coins: ['Coins', 'coins', '#ffd84a'], food: ['Snacks', 'pie', '#ff9f6b'], xp: ['XP', 'star', '#8fd0ff'], jackpot: ['JACKPOT', 'chest', '#ff6bd0'], prank: ['Prank!', 'chest', '#b48cff'] };
let roulette = null;
function openChest(c) {
  if (c.open || roulette) return;
  c.open = true; c.at = now + 180; c.m.visible = false; c.glow.visible = false;
  burst(new THREE.Vector3(c.x, 1.2, c.z), '#ffe07a', 40, 6, 1.4);
  spinWheel('Treasure Roulette!');
}
function spinWheel(title) {
  if (roulette) return;
  sfx('win');
  const el = $('roulette');
  el.innerHTML = `<div class="rl-wrap"><div class="rl-title">${title}</div><div class="rl-ring">${WHEEL.map((k, i) => {
    const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2, [nm, ic, col] = WHEEL_LOOK[k];
    return `<div class="rl-p" style="--x:${Math.cos(a) * 40}%;--y:${Math.sin(a) * 40}%;--c:${col}"><img src="${ICONS[ic]}" alt=""><b>${nm}</b></div>`;
  }).join('')}<button class="rl-stop" id="rl-stop">STOP!</button></div><div class="rl-hint">Press ${keyOf('interact')}, Space or tap STOP</div></div>`;
  el.hidden = false; document.body.classList.add('rouletting');
  const panels = [...el.querySelectorAll('.rl-p')];
  roulette = { el, panels, pos: 0, speed: 16, stopping: false, done: false, t0: performance.now(), last: performance.now(), lit: -1 };
  $('rl-stop').onclick = stopRoulette;
  requestAnimationFrame(rouletteFrame);
}
function stopRoulette() {
  const R = roulette;
  if (!R || R.stopping) { if (R && R.done) closeRoulette(); return; }
  R.stopping = true;
  // pick where it lands now, then ease the lights onto that panel
  const landOn = Math.floor(rng() * WHEEL.length);
  const cur = R.pos, base = Math.ceil(cur) + WHEEL.length * 2;
  R.target = base + ((landOn - (base % WHEEL.length)) + WHEEL.length) % WHEEL.length;
  R.from = cur; R.st = performance.now(); R.dur = 1700 + (R.target - cur) * 20;
  $('rl-stop').textContent = '...';
}
function rouletteFrame(t) {
  const R = roulette; if (!R) return;
  const dt = Math.min(0.1, (t - R.last) / 1000); R.last = t;
  if (!R.stopping) R.pos += R.speed * dt;
  else if (!R.done) {
    const k = Math.min(1, (t - R.st) / R.dur), e = 1 - Math.pow(1 - k, 3);
    R.pos = R.from + (R.target - R.from) * e;
    if (k >= 1) { R.done = true; R.pos = R.target; }
  }
  const lit = Math.floor(R.pos + 0.0001) % WHEEL.length;
  if (lit !== R.lit) { if (R.lit >= 0) R.panels[R.lit].classList.remove('lit'); R.panels[lit].classList.add('lit'); R.lit = lit; sfx('tick'); }
  if (R.done && !R.paid) { R.paid = true; landRoulette(); }
  if (!R.done || R.el.querySelector('.rl-result')) requestAnimationFrame(rouletteFrame);
}
function landRoulette() {
  const R = roulette, k = WHEEL[R.lit], pick = LUCK.find((l) => l[1] === k);
  R.panels[R.lit].classList.add('win');
  const [text, icon] = pick[2]();
  sfx(k === 'jackpot' ? 'jackpot' : k === 'prank' ? 'boing' : 'win');
  if (k !== 'prank') burst(player.pos.clone().setY(2), k === 'jackpot' ? '#ff9af0' : '#ffe07a', k === 'jackpot' ? 90 : 40, 7, 1.5);
  const res = document.createElement('div'); res.className = `rl-result ${k}`;
  res.innerHTML = `<img src="${icon}" alt=""><span>${text}</span><button class="primary" id="rl-ok">Yay!</button>`;
  R.el.querySelector('.rl-wrap').appendChild(res);
  $('rl-ok').onclick = closeRoulette;
  $('rl-stop').textContent = k === 'prank' ? 'Oops!' : 'WIN!';
  refreshUI(); save();
}
function closeRoulette() {
  if (!roulette) return;
  roulette.el.hidden = true; roulette.el.innerHTML = ''; roulette = null; document.body.classList.remove('rouletting');
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
  $('fade').classList.add('on'); sfx('door');
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
    camPos.copy(pp).setY(0).add(CAM_OFF.clone().multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1)));
    $('fade').classList.remove('on');
    setTimeout(() => { fading = false; }, 250);
  }, 320);
}
// ---------- ships between lands ----------
const chapter1Done = () => ['st_dragon', 'st_crags', 'st_glimmer', 'st_hollow'].every((k) => S.quests[k] && S.quests[k].state === 'done') && (S.quests.st_socket.state === 'done' || S.quests.st_frost1.state !== 'todo');
function openSail(npc) {
  talking = npc;
  const dests = ['out', ...Object.keys(LANDS)].filter((k) => k !== where);
 const marshOpen = S.quests.st_thaw && S.quests.st_thaw.state === 'done', sandsOpen = S.quests.st_choice && S.quests.st_choice.state === 'done';
  const text = where === 'out'
    ? (sandsOpen ? 'Ahoy! The whole map is yours now: the snowy north, the soggy marsh, and the hot, clanky Brassbolt Sands in the east. Bring a hat for the desert!' : marshOpen ? 'Ahoy! Where to, hero? North to the snow, or south to the soggy, froggy marsh? Both are far tougher than the valley.'
      : chapter1Done() ? 'Ahoy! The King says you are bound for Frostwhisker Peaks. Wrap up warm, it is snowing up there! I sail to Gobbler Marsh too, though it is VERY dangerous for now.'
        : "Ahoy! I sail to Frostwhisker Peaks in the north and Gobbler Marsh in the south. The monsters there are much tougher than the valley's. The King will send you in later chapters, but I can take you for a look now if you are brave.")
    : `Where to next? The sea is calm and the biscuits are fresh.`;
  const d = $('dialog');
  d.innerHTML = '<h3></h3><p></p><div class="row"></div>';
  d.querySelector('h3').textContent = npc.name; d.querySelector('p').textContent = text;
  const row = d.querySelector('.row');
  for (const to of dests) { const go = document.createElement('button'); go.className = 'primary'; go.textContent = to === 'out' ? 'Sail home' : `Sail to ${LANDS[to].name}`; go.onclick = () => { closeDialog(); sailTo(to); }; row.appendChild(go); }
  const no = document.createElement('button'); no.textContent = 'Not yet'; no.onclick = closeDialog; row.appendChild(no);
  showDialog(d, { talky: true });
  npc.actor.face(player.pos.x, player.pos.z);
}
function sailTo(to, at = null, label = null) {
  if (fading) return;
  fading = true; held = false; mouseHeld = false; moveTarget = null; pending = null; marker.visible = false; cancelTask();
  const name = to === 'out' ? 'Jerry Valley' : LANDS[to].name;
  $('fade').dataset.label = label || `Sailing to ${name}...`; $('fade').classList.add('on', 'sail'); sfx('door');
  setTimeout(() => {
    const pp = player.pos, A = at || (to === 'out' ? VALLEY_DOCK.arrive : LANDS[to].arrive);
    pp.set(A.x, 0, A.z); player.root.rotation.y = to === 'out' ? Math.PI / 2 : Math.PI;
    where = to;
    camPos.copy(pp).setY(0).add(CAM_OFF.clone().multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1)));
    setTimeout(() => {
      $('fade').classList.remove('on', 'sail');
      toast(to === 'out' ? 'Home sweet Jerry Valley!' : `Welcome to ${name}!`, null, true);
      pathArrive();
      setTimeout(() => { fading = false; }, 250);
      save(); refreshUI();
    }, 1100);
  }, 400);
}
// ---------- fast travel ----------
// From the big map you can jump straight to the village of any land you have unlocked, as long as
// nothing is fighting you. It saves a long walk back to the quest giver or the ship.
const inCombat = () => enemies.some((e) => e.hp > 0 && e.state !== 'idle' && e.state !== 'walk' && e.state !== 'return' && e.state !== 'dead' && e.inside === where && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 26);
function travelSpots() {
  const out = [{ w: 'out', name: 'Jerry Valley (village well)', at: { x: 0, z: 6 } }];
  if (INTERIORS.castle && INTERIORS.castle.exitTo) out.push({ w: 'out', name: 'Castle gate (Jerry Valley)', at: INTERIORS.castle.exitTo });
  out.push({ w: 'out', name: 'Harbour (Jerry Valley)', at: VALLEY_DOCK.arrive });
  for (const [id, L] of Object.entries(LANDS)) if (landOpen(id)) out.push({ w: id, name: `${L.villageName || L.name} (${L.name})`, at: { x: L.village.x, z: L.village.z + 4 } });
  return out;
}
function fastTravel(i) {
  const T = travelSpots()[i]; if (!T || !player) return;
  if (player.dead || bossIntro || roulette) return;
  if (inCombat()) { toast('You can\'t fast travel in the middle of a fight!', ICONS.boot); return; }
  if (!LANDS[where] && where !== 'out') { toast('Step outside first, then fast travel.', ICONS.boot); return; }
  toggleBigMap(false); closeDialog(); closeSheet();
  sailTo(T.w, T.at, T.w === where ? `Travelling to ${T.name.split(' (')[0]}...` : `Sailing to ${T.name.split(' (')[0]}...`);
}
function checkDoors() {
  if (fading || !player || player.dead) return;
  const pp = player.pos;
  if (where === 'out') {
    for (const [id, I] of Object.entries(INTERIORS)) if (Math.hypot(pp.x - I.outside.x, pp.z - I.outside.z) < 1.3) { goThrough(id); return; }
  } else {
    if (!INTERIORS[where]) return;
    const d = INTERIORS[where].room.door;
    if (pp.z > d.z && Math.abs(pp.x - d.x) < 2.6) goThrough('out');
  }
}
function refreshUI() {
  if (!S.started) return;
  $('status').classList.toggle('compact', !S.hudOpen); $('status').classList.toggle('pts', freePoints() > 0);
  $('hudmore').setAttribute('aria-expanded', String(!!S.hudOpen)); $('hudmore').textContent = S.hudOpen ? '▴' : '▾';
  const mh = maxHp();
  $('hpfill').style.width = `${Math.max(0, (S.hp / mh) * 100)}%`;
  $('hptext').textContent = `${Math.max(0, Math.ceil(S.hp))} / ${mh}`;
  { const L = heroLvl(), lo = HXT[L] || 0, hi = HXT[L + 1], max = L >= HERO_MAX || hi == null;
    const k = max ? 1 : Math.max(0, Math.min(1, (S.hero.xp - lo) / (hi - lo)));
    $('xpfill').style.width = `${(k * 100).toFixed(1)}%`;
    $('xptext').textContent = max ? `Level ${L} · max level` : `Level ${L} · ${Math.floor(S.hero.xp - lo).toLocaleString()} / ${(hi - lo).toLocaleString()} XP`; }
  $('coinval').textContent = S.coins;
  renderChapter();
  const active = Object.keys(QUESTS).filter((k) => S.quests[k].state === 'active');
  renderHotbar();
  const tracked = trackedQuest();
  $('tracker').innerHTML = active.map((k) => `<button class="trk${k === tracked ? ' on' : ''}" data-track="${k}" title="Follow this quest"><b>${k === tracked ? '&#10148; ' : ''}${QUESTS[k].name}</b><br>${questReady(k) ? `Return to ${npcName(QUESTS[k].giver)}` : questProgress(k)}</button>`).join('');
  // nothing on yet: point at the next story quest to pick up
  if (!active.length) { const nx = Object.keys(QUESTS).find((k) => QUESTS[k].story && storyOpen(k) && S.quests[k].state === 'todo'); if (nx) $('tracker').innerHTML = `<button class="trk on" data-track="${nx}" title="Follow this quest"><b>&#10148; Next: ${QUESTS[nx].name}</b><br>Talk to ${npcName(QUESTS[nx].giver)}</button>`; }
  $('tracker').querySelectorAll('[data-track]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); S.track = b.dataset.track; refreshUI(); save(); }; });
  for (const n of npcs) {
    if (n.shop || n.bank) { n.marker.userData.draw('$'); continue; }
    if (n.king) { const st = storyStep(); n.marker.userData.draw(st.some(questReady) ? '?' : st.some((q) => S.quests[q].state === 'todo') ? '!' : '♛'); continue; }
    if (n.lines) { n.marker.userData.draw(''); continue; }
    if (n.sail) { n.marker.userData.draw('⚓'); continue; }
    let qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === n.id && !QUESTS[k].story);
    if (!qid) qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === n.id && storyOpen(k) && S.quests[k].state !== 'done');
    if (!qid) { n.marker.userData.draw(''); continue; }
    const st = S.quests[qid].state;
    n.marker.userData.draw(st === 'todo' ? '!' : questReady(qid) ? '?' : '');
  }
  if (!$('sheet').hidden && sheetMode !== 'opts' && sheetMode !== 'look') renderSheet();
}

function renderSheet() {
  const el = $('sheet');
  if (sheetMode === 'craft') { renderCraft(el); return; }
  if (sheetMode === 'crew') { renderCrew(el); return; }
  if (sheetMode === 'card') { renderCard(el); return; }
  if (sheetMode === 'skills') {
    const L = heroLvl(), cur = HXT[L], next = HXT[Math.min(HERO_MAX, L + 1)], free = freePoints();
    const pct = L >= 99 ? 100 : ((S.hero.xp - cur) / (next - cur)) * 100;
    const effect = { atk: `Weapon damage × ${dmgMult().toFixed(1)}`, def: `Damage taken ÷ ${defDiv().toFixed(1)}${gearDef() ? ` (gear +${gearDef()})` : ''}`, hp: `${maxHp()} max health` };
    const w = W();
    el.innerHTML = `<h3>Hero <small>Level ${L}</small></h3>
      <div class="herolvl"><div class="xp"><i style="width:${pct}%"></i></div><small>${Math.floor(S.hero.xp - cur)} / ${next - cur} XP to level ${L + 1}</small></div>
      <div class="stats">${Object.entries(STATS).map(([k, [nm, ic]]) => `<div class="stat"><img src="${ICONS[ic]}" alt=""><span class="nm">${nm}</span><span class="lv">${stat(k)}</span><small>${effect[k]}</small>${free > 0 ? `<button class="plus" data-stat="${k}" aria-label="Add a point to ${nm}">+</button>` : ''}</div>`).join('')}</div>
      <p class="hint">${free > 0 ? `<b>${free} point${free > 1 ? 's' : ''} to spend.</b> ` : ''}Each level gives +1 to every stat and ${FREE_PER_LEVEL} points to spend. Defense and Health keep you alive about equally, so mixing them works best.</p>
      <h4 class="sub">Weapon</h4><div class="gearbtn now"><b><img src="${ICONS[w.type]}" alt="">${w.name}</b><span>${gearStats(w)}</span></div>
      <h4 class="sub">Gathering</h4><div class="skills">${SKILLS.filter(([k]) => k !== 'crafting').map(([k, nm]) => {
      const l = lvl(k), c0 = XPT[l], n0 = XPT[Math.min(99, l + 1)];
      const pc = l >= 99 ? 100 : ((S.xp[k] - c0) / (n0 - c0)) * 100;
      return `<div class="skill" title="${Math.floor(S.xp[k])} XP"><img src="${ICONS[k]}" alt=""><span class="nm">${nm}</span><span class="lv">${l}</span><div class="xp"><i style="width:${pc}%"></i></div></div>`;
    }).join('')}</div><p class="hint">Gathering skills level up as you use them. Speed rises as you travel and makes you run faster.</p>${worthHtml()}`;
    el.querySelectorAll('[data-stat]').forEach((b) => { b.onclick = () => spendPoint(b.dataset.stat); });
  } else if (sheetMode === 'bag') { renderBag(el); return;
  } else if (sheetMode === 'bagOld') {
    const items = Object.entries(S.inv);
    const slots = [];
    for (let i = 0; i < Math.max(16, Math.ceil(items.length / 4) * 4); i++) {
      const it = items[i];
      slots.push(!it ? '<div class="slot empty"></div>' : FOOD[it[0]]
        ? `<div class="slotwrap"><button class="slot food" data-eat="${it[0]}" title="Eat ${ITEMS[it[0]]} (heals ${FOOD[it[0]].heal})"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></button><button class="pin" data-pin="${it[0]}" title="Put on hotbar" aria-label="Put ${ITEMS[it[0]]} on the hotbar" aria-pressed="${(S.hotbar || []).includes(it[0])}">+</button></div>`
        : `<div class="slot" title="${ITEMS[it[0]]}"><img src="${ICONS[it[0]]}" alt="${ITEMS[it[0]]}"><span>${it[1]}</span></div>`);
    }
    const group = (slot, title) => {
      const mine = S.owned.filter((k) => GEAR[k] && GEAR[k].slot === slot);
      return `<h4 class="sub">${title}</h4><div class="gearlist">${mine.map((k) => `<div class="gearwrap"><button class="gearbtn" data-gear="${k}" aria-pressed="${S.equip[slot] === k}"><b><img src="${gearIcon(GEAR[k])}" alt="">${GEAR[k].name}</b><span>${gearStats(GEAR[k])}${GEAR[k].unique ? ' · boss drop' : ''}</span></button><button class="pin" data-pin="${k}" title="Put on hotbar" aria-label="Put ${GEAR[k].name} on the hotbar" aria-pressed="${(S.hotbar || []).includes(k)}">+</button></div>`).join('')}</div>`;
    };
    el.innerHTML = `<h3>Bag <small>${S.coins} coins${S.bank ? ` · ${S.bank} banked` : ''}</small></h3><div class="bag">${slots.join('')}</div>
      ${group('weapon', 'Weapons')}${group('shield', 'Shields')}${group('armour', 'Armour')}${S.owned.some((k) => GEAR[k] && GEAR[k].slot === 'gadget') ? group('gadget', 'Gadgets') : ''}
      <p class="hint">Press + on food or gear to put it on your hotbar, then press its number key to use it. Your weapon decides how you fight: swords up close, staffs and wands throw magic, crossbows shoot. Tap food to eat it and heal (or press H). Marta at the market buys anything in your bag, and the smiths buy back spare gear.</p>`;
    el.querySelectorAll('[data-eat]').forEach((b) => { b.onclick = () => eat(b.dataset.eat); });
    el.querySelectorAll('[data-pin]').forEach((b) => { b.onclick = () => { pinToHotbar(b.dataset.pin); renderSheet(); }; });
    el.querySelectorAll('[data-gear]').forEach((b) => { b.onclick = () => { const g = GEAR[b.dataset.gear]; S.equip[g.slot] = g.slot === 'gadget' && S.equip.gadget === b.dataset.gear ? null : b.dataset.gear; cancelTask(); equipGear(); buildGearBar(); updateTitle(); save(); renderSheet(); burst(player.pos.clone().setY(1.6), '#ffe07a', 20, 4); }; });
  } else if (sheetMode === 'quests') {
    // a cleaner quest log: the main story up top, then what you're doing, what's on offer, and what's done
    const all = Object.entries(QUESTS).filter(([k, q]) => !q.story || storyOpen(k) || S.quests[k].state !== 'todo');
    const st = (k) => S.quests[k].state, tracked = trackedQuest();
    const story = all.filter(([k, q]) => q.story && st(k) !== 'done');
    const doing = all.filter(([k, q]) => !q.story && st(k) === 'active');
    const offered = all.filter(([k, q]) => !q.story && st(k) === 'todo');
    const done = all.filter(([k]) => st(k) === 'done');
    const reward = (q) => { const r = q.reward || {}, bits = []; if (r.coins) bits.push(`<span><img src="${ICONS.coins}" alt="">${fmt(r.coins)}</span>`); if (r.hxp || r.heroXp) bits.push(`<span><img src="${ICONS.star}" alt="">${fmt(r.hxp || r.heroXp)} XP</span>`); return bits.length ? `<div class="qrew">${bits.join('')}</div>` : '<div></div>'; };
    const card = ([k, q]) => {
      const s0 = st(k), ready = questReady(k), on = tracked === k;
      const tag = ready ? '<span class="tag ready">Hand in</span>' : s0 === 'active' ? '<span class="tag active">Active</span>' : '<span class="tag todo">New</span>';
      const body = s0 === 'todo' ? `Talk to ${npcName(q.giver)}.` : ready ? `Return to ${npcName(q.giver)}.` : `${q.desc} <b>${questProgress(k)}</b>`;
      return `<div class="quest${q.story ? ' story' : ''}${on ? ' on' : ''}">${q.story ? `<small class="chapter">Main story · ${q.chapter}</small>` : ''}<h4>${q.name}${tag}</h4><p>${body}</p>
        <div class="qfoot">${reward(q)}<button class="trackbtn" data-track="${k}" aria-pressed="${on}">${on ? '&#10148; Following' : 'Follow'}</button></div></div>`;
    };
    el.innerHTML = `<h3>Quests <small>${done.length} done</small></h3>
      ${story.map(card).join('')}
      ${doing.length ? `<h4 class="sub">In progress</h4>${doing.map(card).join('')}` : ''}
      ${offered.length ? `<h4 class="sub">On offer <small>talk to them to start</small></h4>${offered.map(card).join('')}` : ''}
      ${!story.length && !doing.length && !offered.length ? '<p class="hint">No quests right now. Explore and talk to people!</p>' : ''}
      ${done.length ? `<details class="qdone"><summary>Completed (${done.length})</summary><ul>${done.map(([, q]) => `<li>${q.story ? '&#9733; ' : ''}${q.name}</li>`).join('')}</ul></details>` : ''}`;
    el.querySelectorAll('[data-track]').forEach((b) => { b.onclick = () => { S.track = b.dataset.track; refreshUI(); save(); renderSheet(); }; });
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
      <button id="o-guide" aria-pressed="${S.guideOn !== false}">Quest arrow: ${S.guideOn !== false ? 'On' : 'Off'}</button>
      <h4>Time of day</h4>
      <div class="seg" id="o-tod">${[['cycle', 'Day and night'], ['day', 'Day'], ['golden', 'Golden hour'], ['night', 'Night']].map(([k, nm]) => `<button data-tod="${k}" aria-pressed="${(S.tod || 'cycle') === k}">${nm}</button>`).join('')}</div>
      <h4>Sound</h4>
      <label class="volrow">Music <input type="range" id="o-music" min="0" max="1" step="0.05" value="${(S.vol || {}).music ?? 0.55}"></label>
      <label class="volrow">Effects <input type="range" id="o-sfx" min="0" max="1" step="0.05" value="${(S.vol || {}).sfx ?? 0.8}"></label>
      <h4>Controls</h4>
      <p class="hint">Click a key box, then press the key you want. Backspace clears it, Esc cancels.</p>
      <div class="binds">${BIND_ACTIONS.map(([a, label]) => `<div class="bind"><span>${label}</span>${[0, 1].map((i) => `<button data-bind="${a}" data-slot="${i}" class="${bindCapture && bindCapture.act === a && bindCapture.slot === i ? 'waiting' : ''}">${bindCapture && bindCapture.act === a && bindCapture.slot === i ? 'Press a key…' : keyLabel(binds()[a][i])}</button>`).join('')}</div>`).join('')}</div>
      <button id="o-binds">Reset controls to default</button>
      <button id="o-reset" class="danger">Start over</button>
      ${net.on ? `<button id="o-slot">Switch hero</button><button id="o-out" class="primary">Log out (${net.user.name})</button>` : ''}
      <p class="hint">${net.on ? 'Your progress saves online, so it follows you to any computer.' : 'Progress saves in this browser.'}</p></div>`;
    $('o-style').onclick = () => { setStyled(!styled.on); renderSheet(); };
    $('o-guide').onclick = () => { S.guideOn = S.guideOn === false; save(); renderSheet(); };
    el.querySelectorAll('[data-bind]').forEach((b) => { b.onclick = () => { bindCapture = { act: b.dataset.bind, slot: +b.dataset.slot }; renderSheet(); }; });
    const vols = () => { S.vol = { music: +$('o-music').value, sfx: +$('o-sfx').value }; setVolumes(S.vol.music, S.vol.sfx); save(); };
    $('o-music').oninput = vols; $('o-sfx').oninput = () => { vols(); sfx('coin'); };
    if ($('o-slot')) $('o-slot').onclick = async () => { save(); resetting = true; await flushSave(); location.reload(); };
    if ($('o-out')) $('o-out').onclick = async () => { save(); resetting = true; await flushSave(); await signOut(); try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } location.reload(); };
    $('o-binds').onclick = () => { delete S.binds; rebuildBinds(); save(); renderSheet(); };
    $('o-tod').querySelectorAll('button').forEach((b) => { b.onclick = () => { S.tod = b.dataset.tod; dayTick(0, true); save(); renderSheet(); }; });
    $('o-reset').onclick = () => {
      const b = $('o-reset');
      if (b.dataset.armed) { resetting = true; try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } if (net.on) { slotBox.slots[slotBox.cur] = null; cloudSave(slotBox, { name: net.user.name, level: 1, worth: 0 }, true); setTimeout(() => location.reload(), 1500); } else location.reload(); }
      else { b.dataset.armed = '1'; b.textContent = 'Tap again to erase your progress'; }
    };
  }
}
let resetting = false;
function openSheet(mode) {
  if (mode === 'skills') mode = 'card'; // the hero sheet now lives on the hero card
  if (mode === 'craft') return; // crafting is switched off for now
  if (sheetMode === mode && !$('sheet').hidden) { closeSheet(); return; }
  sheetMode = mode; $('sheet').hidden = false; renderSheet(); document.body.classList.add('sheet-open'); document.body.classList.toggle('sheet-bag', mode === 'bag');
  for (const m of ['skills', 'bag', 'quests', 'craft', 'crew', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', String(m === mode || (m === 'skills' && mode === 'card')));
}
function closeSheet() { document.body.classList.remove('sheet-open', 'sheet-bag'); $('sheet').hidden = true; sheetMode = null; for (const m of ['skills', 'bag', 'quests', 'craft', 'crew', 'look', 'opts']) $(`b-${m}`).setAttribute('aria-pressed', 'false'); }
for (const m of ['skills', 'bag', 'quests', 'craft', 'crew', 'look', 'opts']) $(`b-${m}`).addEventListener('click', () => { document.body.classList.remove('menu-open'); $('menutoggle').setAttribute('aria-expanded', 'false'); if (m === 'look') openCreator('edit'); else openSheet(m); });
$('menutoggle').addEventListener('click', () => { const open = document.body.classList.toggle('menu-open'); $('menutoggle').setAttribute('aria-expanded', String(open)); if (!open) closeSheet(); });

// dialogue
let talking = null;
// Pick how many to sell: a slider, - and + buttons, and quick picks.
function sellPicker(box, k, max, each, done, name = ITEMS[k], icon = ICONS[k]) {
  let n = Math.min(max, Math.max(1, Math.ceil(max / 2)));
  const draw = () => {
    box.innerHTML = `<div class="qtyhead"><img src="${icon}" alt=""><b>${name}</b><small>you have ${max} to sell · ${each} each</small></div>
      <div class="qtyrow"><button data-d="-1" aria-label="One less">−</button><input type="range" min="1" max="${max}" value="${n}" aria-label="How many"><button data-d="1" aria-label="One more">+</button><output>${n}</output></div>
      <div class="qtyrow quick">${[1, 5, 10].filter((q) => q < max).map((q) => `<button data-q="${q}">${q}</button>`).join('')}<button data-q="${Math.ceil(max / 2)}">Half</button><button data-q="${max}">All ${max}</button></div>
      <div class="row"><button class="primary" id="qtygo">Sell ${n} for ${n * each} coins</button><button id="qtyno">Cancel</button></div>`;
    const set = (v) => { n = Math.max(1, Math.min(max, v)); box.querySelector('input').value = n; box.querySelector('output').textContent = n; $('qtygo').textContent = `Sell ${n} for ${n * each} coins`; };
    box.querySelector('input').oninput = (e) => set(+e.target.value);
    box.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => set(n + +b.dataset.d); });
    box.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => set(+b.dataset.q); });
    $('qtygo').onclick = () => done(n);
    $('qtyno').onclick = () => { box.hidden = true; };
  };
  box.hidden = false; draw(); box.scrollIntoView({ block: 'nearest' });
}
// The status panel stays small (name, level, health) until you tap it.
$('status').addEventListener('click', (e) => { if (e.target.closest('#classes button, #tracker button')) return; S.hudOpen = !S.hudOpen; refreshUI(); save(); });
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
  const tavern = npc.id === 'tom', who = npc.name.split(' ')[0], trader = npc.id.startsWith('trader');
  // gear you own but aren't using: merchants buy it, and rarer gear is worth far more
  const spareGear = S.owned.filter((k) => GEAR[k] && !Object.values(S.equip).includes(k) && gearValue(GEAR[k]) > 0 && k !== 'k_sword');
  d.innerHTML = `<h3>${npc.name}</h3><p>${tavern ? "Welcome to the Sleepy Boar! Pull up a stool. A hot meal mends any bruise. Eat it from your bag, or press H." : trader ? 'Travelling goods! Snacks for the road, and I buy anything: treasures, materials, spare weapons and armour. The rarer it is, the more I pay.' : 'Fresh from the oven! Food heals you when you eat it from your bag, or press H. And I buy anything you bring me, gear too.'}</p>
    <div class="shop">${Object.entries(FOOD).filter(([, f]) => f.price).map(([k, f]) => `<button class="buy" data-food="${k}" ${S.coins < f.price ? 'disabled' : ''}><img src="${ICONS[k]}" alt=""><b>${ITEMS[k]}</b><span>Heals ${f.heal}</span><em>${f.price} coins</em></button>`).join('')}</div>
    ${goods.length && !tavern ? `<h4 class="sub">Sell to ${who}</h4><div class="shop sell">${goods.map(([k, n]) => `<button class="buy" data-sell="${k}"><img src="${ICONS[k]}" alt=""><b>${ITEMS[k]} × ${n}</b><span>${keep[k] ? `keeping ${keep[k]} for a quest` : `${SELL[k]} each`}</span><em>Sell…</em></button>`).join('')}</div><div class="sellpick" hidden></div>` : ''}
    ${spareGear.length && !tavern ? `<h4 class="sub">Sell spare gear</h4><div class="shop sell">${spareGear.map((k) => { const g = GEAR[k], [rc, rn] = gearRarity(g); return `<button class="buy ${rc}" data-sellgear="${k}"><img src="${gearIcon(g)}" alt=""><b>${g.name}</b><span><i class="rar">${rn}</i></span><em>${fmt(gearValue(g))} coins</em></button>`; }).join('')}</div>` : ''}
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
    const k = b.dataset.sell, max = spareOf(k);
    if (!max) return;
    sellPicker(d.querySelector('.sellpick'), k, max, SELL[k], (n) => {
      takeItem(k, n); const c = SELL[k] * n; S.coins += c;
      toast(`Sold ${n} × ${ITEMS[k].toLowerCase()} for ${c} coins.`, ICONS.coins, c >= 100);
      refreshUI(); save(); openShop(npc);
    });
  }; });
  d.querySelectorAll('[data-sellgear]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.sellgear, g = GEAR[k], v = gearValue(g);
    // rare things ask twice, so nobody sells a treasure by accident
    if (gearRarIx(g) >= 2 && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.querySelector('em').textContent = `Sure? ${fmt(v)}`; return; }
    if (!S.owned.includes(k) || Object.values(S.equip).includes(k)) return;
    S.owned = S.owned.filter((x) => x !== k); S.hotbar = (S.hotbar || []).map((x) => (x === k ? null : x)); if (S.plus) delete S.plus[k];
    S.coins += v; renderHotbar(); toast(`Sold ${g.name} for ${fmt(v)} coins.`, ICONS.coins, v >= 1000);
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
  eatAt = now + 1.2; sfx('eat');
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
    else if (st.state === 'todo') { text = q.intro; btn = ['I will do it', () => { st.state = 'active'; S.track = k; toast(`${q.chapter}: ${q.name}`, ICONS.scroll, true); refreshUI(); save(); closeDialog(); }]; }
    else { text = `${q.desc} So far: ${questProgress(k)}.`; btn = ['On my way', closeDialog]; }
    d.innerHTML = `<h3>${npc.name}</h3><div class="chapter">${q.chapter} · ${q.name}</div><p></p>${st.state === 'todo' ? `<div class="reward">Reward: ${q.reward.coins} coins and ${Object.values(q.reward.xp)[0]} XP</div>` : ''}
      <div class="row"><button class="primary" id="kq" data-e="1"></button><button id="kingbye">Farewell</button></div>`;
    d.querySelector('p').textContent = text; $('kq').textContent = btn[0]; $('kq').onclick = btn[1];
    $('kingbye').onclick = closeDialog;
    showDialog(d, { talky: true }); npc.actor.face(player.pos.x, player.pos.z);
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
  const lines = { melee: 'Finest steel this side of the mountains! Swords, axes, shields and armour. A longer blade swings wider, a lighter one swings faster.', magic: 'Wands and staves, darling, humming with power. Hold one and your blows become bolts of magic you can throw from afar.', ranged: 'Crossbows I made myself. Hold one and you shoot from a safe distance. Lighter ones shoot faster.', frost: 'Frostsilver, forged cold and sharp! It shrugs off the north\'s worst. Bring me frostsilver ore and I\'ll make it even better.', marsh: 'Bogwood and Mireiron! Everything I make drips with marsh poison, so your foes keep hurting after you hit them. Chosen your path yet? I forge path weapons too.', sands: 'Sunsteel, hot from the forge! It burns brighter in daylight. And gadgets! Springs, lenses, cogs. One gadget at a time, mind, or you will start ticking.' };
   const sells = (g) => (type === 'frost' ? g.tier === 2 : type === 'marsh' ? g.tier === 3 && (!g.path || g.path === S.path) : type === 'sands' ? g.tier === 4 && (!g.path || g.path === S.path) : !g.tier && (g.slot === 'weapon' ? g.type === type : type === 'melee'));
  const list = Object.entries(GEAR).filter(([, g]) => !g.unique && g.price > 0 && sells(g));
  const spare = S.owned.map((k) => [k, GEAR[k]]).filter(([k, g]) => g && sells(g) && gearValue(g) > 0 && S.equip[g.slot] !== k);
  d.innerHTML = `<h3>${npc.name}</h3><p>${lines[type]}</p>
    <div class="shop wide">${list.map(([k, g]) => {
      const own = S.owned.includes(k), eq = S.equip[g.slot] === k;
      const label = eq ? 'Equipped' : own ? 'Equip' : `${g.price} coins`;
      return `<button class="buy" data-w="${k}" ${eq || (!own && S.coins < g.price) ? 'disabled' : ''}><img src="${gearIcon(g)}" alt=""><b>${g.name}</b><span>${gearStats(g)}</span><em>${label}</em></button>`;
    }).join('')}</div>
    ${spare.length ? `<h4 class="sub">Sell spare gear</h4><div class="shop sell">${spare.map(([k, g]) => `<button class="buy" data-sellg="${k}"><img src="${gearIcon(g)}" alt=""><b>${g.name}</b><span>${gearStats(g)}</span><em>Sell +${gearValue(g)}</em></button>`).join('')}</div>` : ''}
    <p class="hint">You have ${S.coins} coins. Damage is the weapon's base: your Attack multiplies it.</p><div class="row">${type === 'frost' || type === 'marsh' || type === 'sands' ? `<button id="wup" class="primary"><img src="${ICONS.hammer}" alt="">Upgrade gear</button>` : ''}${type === 'melee' ? `<button id="wup" class="primary"><img src="${ICONS.hammer}" alt="">Upgrade gear</button>` : ''}<button id="wbye">Goodbye</button></div>`;
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
    S.owned = S.owned.filter((o) => o !== k); S.coins += gearValue(g); if (S.plus) delete S.plus[k]; S.hotbar = (S.hotbar || []).map((x) => (x === k ? null : x)); renderHotbar();
    toast(`Sold the ${g.name} for ${gearValue(g)} coins.`, ICONS.coins, g.unique);
    refreshUI(); save(); openWeaponShop(npc);
  }; });
  if ($('wforge')) $('wforge').onclick = () => { closeDialog(); openSheet('craft'); };
  if ($('wup')) $('wup').onclick = () => openUpgrade(npc);
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
  const glow = new THREE.PointLight('#ffd86b', 5, 5, 1.6); glow.position.set(player.pos.x, 1.2, player.pos.z); lightSpots.push(glow);
  pouches.push({ m, glow, n, where, until: now + 240 });
}
function pouchTick() {
  if (!player || player.dead) return;
  for (let i = pouches.length - 1; i >= 0; i--) {
    const P = pouches[i];
    P.m.rotation.y += 0.03;
    const gone = now > P.until, near = P.where === where && Math.hypot(P.m.position.x - player.pos.x, P.m.position.z - player.pos.z) < 1.6;
    if (near) { S.coins += P.n; toast(`You got your ${P.n} coins back!`, ICONS.coins, true); burst(P.m.position.clone().setY(1), '#ffe07a', 30, 5); refreshUI(); save(); }
    if (near || gone) { scene.remove(P.m); const gi = lightSpots.indexOf(P.glow); if (gi >= 0) lightSpots.splice(gi, 1); pouches.splice(i, 1); }
  }
}
function openTalk(npc) {
  talking = npc;
  const d = $('dialog');
  d.innerHTML = '<h3></h3><p></p><div class="row"><button id="talkbye">Goodbye</button></div>';
  d.querySelector('h3').textContent = npc.name;
  d.querySelector('p').textContent = npc.lines[Math.floor(rng() * npc.lines.length)];
  $('talkbye').onclick = closeDialog;
  showDialog(d, { talky: true });
  npc.actor.face(player.pos.x, player.pos.z);
}
function finishQuest(id, npc) {
  const q = QUESTS[id], st = S.quests[id];
  for (const [k, n] of Object.entries(q.need)) if (!QUEST_COUNTERS.includes(k)) takeItem(k, n);
  st.state = 'done'; S.coins += q.reward.coins;
  for (const [k, v] of Object.entries(q.reward.xp)) { if (k === 'hero') giveHeroXp(v); else giveXp(k, v); }
  toast(`Quest complete: ${q.name}`, ICONS.coins, true);
  if (id === 'st_socket') queueLetter('st_socket');
  burst(npc.actor.pos.clone().setY(2), '#9cff6b', 50, 6, 1.4);
  npc.actor.play('Cheer', { once: true, onFinish: () => npcIdle(npc) });
  refreshUI(); save();
}
function openPathUndo(npc) {
  talking = npc;
  const P = PATHS[S.path], d = $('dialog');
  d.innerHTML = `<h3>${npc.name}</h3><p>Hmm. I can feel the ${P.name.toLowerCase()} in you from here. I can draw it out, if you like, and you can choose again at the Marsh Wardstone. It is fiddly magic, mind: ${fmt(PATH_UNDO)} coins.</p>
    <div class="row"><button id="pundo" class="primary" ${S.coins < PATH_UNDO ? 'disabled' : ''}>Undo my path (${fmt(PATH_UNDO)} coins)</button><button id="pother">Something else</button></div>`;
  $('pundo').onclick = () => {
    if (S.coins < PATH_UNDO) return;
    S.coins -= PATH_UNDO; S.path = null; closeDialog(); sfx('special');
    burst(player.pos.clone().setY(2), '#c8a8ff', 60, 7, 1.4);
    toast('Your path is undone. Talk to Mayor Croakley in Gobbler Marsh to choose again.', ICONS.star, true);
    if (S.quests.st_choice && S.quests.st_choice.state === 'done') { /* choose again by talking to the Mayor */ S.repick = true; }
    rebuildHero(); refreshUI(); save();
  };
  $('pother').onclick = () => openDialog(npc, true);
  showDialog(d, { talky: true });
}

function openDialog(npc, plain = false) {
  if (npc.crew) { openCrewTalk(npc); return; }
  if (npc.id === 'croakley' && !S.path && S.quests.st_choice && (S.quests.st_choice.state === 'active' || S.repick)) { openPathChoice(npc); return; }
  if (npc.id === 'fenwick' && S.path && !plain) { openPathUndo(npc); return; }
  if (npc.id === 'cogsworth') { openRiddle(npc); return; }
  if (npc.sail) { openSail(npc); return; }
  if (npc.clerk) { openMayor(npc); return; }
  if (npc.board) { openBoard(npc); return; }
  if (npc.lines) { openTalk(npc); return; }
  if (npc.king) { openKing(npc); return; }
  if (npc.bank) { openBank(npc); return; }
  if (npc.shop && npc.shop !== 'food') { openWeaponShop(npc); return; }
  if (npc.shop) { openShop(npc); return; }
  talking = npc;
  let qid = Object.keys(QUESTS).find((k) => QUESTS[k].giver === npc.id && !QUESTS[k].story);
  if (!qid) {
    // story givers outside the castle (like Elder Mittens) hand out their chapter's quests in order
    const ks = Object.keys(QUESTS).filter((k) => QUESTS[k].giver === npc.id);
    qid = ks.find((k) => storyOpen(k) && S.quests[k].state !== 'done') || [...ks].reverse().find((k) => S.quests[k].state === 'done');
    if (!qid) {
      const d = $('dialog'); d.innerHTML = '<h3></h3><p></p><div class="row"><button>Goodbye</button></div>';
      d.querySelector('h3').textContent = npc.name;
      d.querySelector('p').textContent = npc.id === 'tinkerwell' ? 'Mind the gears! I am Professor Tinkerwell. Brassbolt has clockwork trouble, but you look like you have marsh trouble first. Finish Chapter 3 in Gobbler Marsh and choose your path, then come and see me.' : npc.id === 'croakley' ? 'Ribbit! Welcome to Lilypad Landing, traveller. Our troubles are BIG ones. Sort out the frozen north first (finish Chapter 2 for Elder Mittens), then hop back and see me.' : 'Welcome to Snowdrop, traveller! Our troubles are big ones. Help your own kingdom first (finish Chapter 1 for King Jerrold), then come back and see me.';
      d.querySelector('button').onclick = closeDialog; showDialog(d, { talky: true }); return;
    }
  }
  const q = QUESTS[qid], st = S.quests[qid];
  const parts = [`${q.reward.coins} coins`];
  for (const [k, v] of Object.entries(q.reward.xp)) parts.push(`${v} ${k === 'hero' ? 'hero' : SKILL_NAME[k]} XP`);
  let text, buttons;
  if (st.state === 'todo') {
    text = q.intro;
    buttons = [['Accept quest', 'primary', () => { st.state = 'active'; S.track = qid; if (q.onStart) later(0.5, q.onStart); toast(`Quest started: ${q.name}`); refreshUI(); save(); closeDialog(); }], ['Not now', '', closeDialog]];
  } else if (questReady(qid)) {
    text = q.ready;
    buttons = [['Hand it over', 'primary', () => { finishQuest(qid, npc); closeDialog(); }]];
  } else if (st.state === 'active') { text = `${q.desc} So far: ${questProgress(qid)}.`; buttons = [['On my way', '', closeDialog]]; }
  else { text = q.done; buttons = [['Goodbye', '', closeDialog]]; }
  // a quick shout to everyone online for quests that are better with friends
  if (net.on && st.state !== 'done' && !questReady(qid) && /friend/i.test(`${q.intro} ${q.desc}`)) buttons.push(['Call friends', '', () => {
    const r = sendChat(`I'm doing "${q.name}" in ${landName(q.land ? q.land : 'out')}. Come help! Type /p ${heroName()} to team up.`);
    if (r.error) toast(r.error, ICONS.star); else { chatLine(heroName(), r.text, 'me'); toast('Your friends have been called!', ICONS.star); }
  }]);
  const d = $('dialog');
  d.innerHTML = `<h3></h3><p></p>${st.state === 'todo' ? `<div class="reward">Reward: ${parts.join(', ')}</div>` : ''}<div class="row"></div>`;
  d.querySelector('h3').textContent = npc.name;
  d.querySelector('p').textContent = text;
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button'); b.textContent = label; if (cls) { b.className = cls; b.dataset.e = '1'; } b.onclick = fn;
    d.querySelector('.row').appendChild(b);
  }
  showDialog(d, { talky: true });
  npc.actor.face(player.pos.x, player.pos.z);
}
let typing = null, dlg = null;
// Split long speech into pages that fit the box, breaking between sentences.
function pagesOf(text, max = 150) {
  const parts = text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) || [text], out = [];
  let cur = '';
  for (const t of parts) { if (cur && (cur + t).length > max) { out.push(cur.trim()); cur = ''; } cur += t; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// Storybook speech: letters pop in one by one while the speaker chatters.
// Press interact (or tap the text) once to finish the line, again to turn the page.
function showDialog(d, opts = {}) {
  const fresh = d.hidden || !dlg || dlg.npc !== talking;
  d.hidden = false;
  document.body.classList.add('talking');
  if (fresh) { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
  d.classList.toggle('talky', !!opts.talky);
  if (opts.talky && !d.querySelector('.skiphint')) d.insertAdjacentHTML('beforeend', `<span class="skiphint">${keyOf('interact')} to skip</span>`);
  const p = d.querySelector('p');
  if (talking && talking.accent) d.style.setProperty('--accent', talking.accent);
  // a big portrait of whoever is talking, like a storybook
  const look = talking && talking.look;
  let por = d.querySelector('.portrait');
  if (look && opts.talky) { if (!por) { por = document.createElement('img'); por.className = 'portrait'; por.alt = ''; d.prepend(por); } por.src = portrait(look); d.classList.add('hasface'); }
  else { if (por) por.remove(); d.classList.remove('hasface'); }
  if (!p) { dlg = { d, npc: talking, done: true, pages: [''], i: 0, talky: false }; return; }
  const full = p.textContent;
  const same = !fresh && dlg && dlg.full === full;
  dlg = { d, p, npc: talking, full, pages: opts.talky ? pagesOf(full) : [full], i: 0, talky: !!opts.talky, done: false };
  if (same || matchMedia('(prefers-reduced-motion: reduce)').matches) { dlg.pages = [full]; typePage(true); return; }
  typePage(false);
  p.onclick = () => advanceDialog();
}
function typePage(instant) {
  const { p, d, pages, i } = dlg, text = pages[i];
  clearInterval(typing);
  dlg.done = false; d.classList.remove('ready');
  d.classList.toggle('more', i < pages.length - 1);
  // build every letter up front (hidden) so the box never jumps around while it types
  p.textContent = '';
  const letters = [];
  for (const [wi, word] of text.split(' ').entries()) {
    if (wi) p.appendChild(document.createTextNode(' '));
    const w = document.createElement('span'); w.className = 'w';
    for (const ch of word) { const l = document.createElement('span'); l.className = 'l'; l.textContent = ch; w.appendChild(l); letters.push(l); }
    p.appendChild(w);
  }
  const finish = () => { clearInterval(typing); for (const l of letters) l.classList.add('on'); dlg.done = true; d.classList.add('ready'); };
  dlg.finish = finish;
  if (instant) { finish(); return; }
  // time-based, so a slow frame never slows the words down
  let k = 0; const t0 = performance.now();
  typing = setInterval(() => {
    const upto = Math.min(letters.length, Math.floor((performance.now() - t0) / 1000 * 90));
    if (upto > k && (upto >> 2) !== (k >> 2)) sfx('talk');
    for (; k < upto; k++) letters[k].classList.add('on');
    if (dlg.npc && dlg.npc.actor) dlg.npc.actor.talkUntil = now + 0.12;
    if (k >= letters.length) finish();
  }, 24);
}
// Returns true when the press was used up by the dialogue.
function advanceDialog() {
  if (!dlg || $('dialog').hidden) return false;
  if (!dlg.done) { dlg.finish(); return true; }
  if (dlg.i < dlg.pages.length - 1) {
    dlg.i++; typePage(false);
    if (dlg.npc && dlg.npc.actor) dlg.npc.actor.hopUntil = now + 0.35;
    return true;
  }
  const btns = [...dlg.d.querySelectorAll('.row button')];
  if (dlg.talky && btns.length === 1) { btns[0].click(); return true; }
  // quest givers and letters: E presses the main button (accept, hand in, close the letter)
  const go = dlg.d.querySelector('.row button[data-e]'); if (go && !go.disabled) { go.click(); return true; }
  return false;
}
let dlgClosedAt = 0;
function closeDialog() { if (dlg) dlgClosedAt = performance.now(); $('dialog').hidden = true; talking = null; dlg = null; clearInterval(typing); document.body.classList.remove('talking'); }

// ---------- input ----------
// Keybinds: every action has two keys, and the player can change both from Options.
const BIND_ACTIONS = [
  ['up', 'Move up', ['KeyW', 'ArrowUp']], ['down', 'Move down', ['KeyS', 'ArrowDown']],
  ['left', 'Move left', ['KeyA', 'ArrowLeft']], ['right', 'Move right', ['KeyD', 'ArrowRight']],
  ['sprint', 'Sprint', ['ShiftLeft', 'ShiftRight']], ['attack', 'Attack', ['KeyJ', '']], ['charge', 'Charged attack (hold)', ['KeyK', '']],
  ['special', 'Special move', ['KeyR', '']], ['dash', 'Dash', ['KeyC', 'KeyZ']],
  ['jump', 'Jump', ['Space', '']], ['interact', 'Talk / use / skip', ['KeyE', 'KeyF']],
  ['eat', 'Eat best food', ['KeyH', '']], ['map', 'Map', ['KeyM', '']],
  ['hero', 'Hero sheet', ['KeyP', '']], ['card', 'Hero card (your worth and towns)', ['Tab', '']], ['bag', 'Bag', ['KeyI', 'KeyB']], ['quests', 'Quests', ['KeyQ', '']],
  ['emote', 'Emote wheel', ['KeyN', '']],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`hot${i}`, `Hotbar slot ${i}`, [`Digit${i}`, '']]),
];
const MOVE_KEY = { up: 'u', down: 'd', left: 'l', right: 'r', sprint: 'sprint' };
let codeToAct = {};
function binds() {
  if (S.binds && S.binds.hero && S.binds.hero.includes('KeyK') && !S.binds.charge) S.binds.hero = ['KeyP', ''];
  const b = {};
  for (const [a, , def] of BIND_ACTIONS) b[a] = (S.binds && S.binds[a]) ? S.binds[a].slice() : def.slice();
  return b;
}
function rebuildBinds() { codeToAct = {}; const b = binds(); for (const a in b) for (const c of b[a]) if (c && !codeToAct[c]) codeToAct[c] = a; }
function keyLabel(c) {
  if (!c) return '—';
  const named = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps' };
  return named[c] || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
const keyOf = (a) => keyLabel(binds()[a][0] || binds()[a][1]);
let bindCapture = null; // { act, slot } while waiting for the player to press a key
const keys = new Set();
let lastTap = { l: -9, r: -9, u: -9, d: -9 };
addEventListener('keydown', (e) => {
  if (bindCapture) {
    e.preventDefault(); e.stopPropagation();
    const { act, slot } = bindCapture; bindCapture = null;
    const b = binds();
    if (e.code === 'Backspace' || e.code === 'Delete') b[act][slot] = '';
    else if (e.code !== 'Escape') {
      for (const a in b) b[a] = b[a].map((c) => (c === e.code ? '' : c)); // a key does one job
      b[act][slot] = e.code;
    }
    S.binds = b; rebuildBinds(); save(); renderSheet(); return;
  }
  if (creator.open && e.key === 'Escape' && creator.mode !== 'new') { closeCreator(false); return; }
  if (roulette) { if (!e.repeat && (codeToAct[e.code] === 'interact' || codeToAct[e.code] === 'attack' || e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { e.preventDefault(); stopRoulette(); } return; }
  if (e.code === 'Escape') { closeSheet(); closeDialog(); }
  // boss and Percival scenes: E (or attack / jump) skips to the next line. This has to come before
  // the UI lock below, which is on for the whole scene.
  if (bossIntro && !e.repeat && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) {
    const a = codeToAct[e.code];
    if (a === 'interact' || a === 'attack' || a === 'jump' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); bossSkip(); return; }
  }
  if (!player || uiLock()) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !codeToAct[e.code] && !creator.open) { e.preventDefault(); openChat(); return; }
  const act = codeToAct[e.code];
  if (!act) return;
  e.preventDefault();
  const mk = MOVE_KEY[act];
  if (mk) {
    // tap a direction twice quickly to dash that way
    if (mk !== 'sprint' && !e.repeat) { if (now - lastTap[mk] < 0.28) dash({ u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] }[mk]); lastTap[mk] = now; }
    keys.add(mk); if (mk !== 'sprint') { cancelTask(); moveTarget = null; }
    return;
  }
  if (emoteWheelOpen() && !e.repeat) { const m = /^(Digit|Numpad)([1-9])$/.exec(e.code); if (m) { e.preventDefault(); doEmote(+m[2] - 1); return; } if (e.code === 'Escape') { toggleEmotes(false); return; } }
  if (e.repeat && act !== 'interact') return;
  if (act === 'attack') attackPress(true);
  else if (act === 'charge') chargeStart();
  else if (act === 'dash') dash();
  else if (act === 'special') special();
  // spamming E through a conversation: the extra presses after it ends don't start it all over again
  else if (act === 'interact') { if (!e.repeat && (talking || performance.now() - dlgClosedAt > 700)) { held = true; const t = !talking && swingTarget(), rc = !talking && (!t || t.type === 'attack') && nearCrew(5); if (rc && !uiLock() && !player.dead) openCrewTalk(rc); else doAction(); } }
  else if (act === 'jump') jump();
  else if (act === 'eat') eatBest();
  else if (act === 'map') toggleBigMap();
  else if (act === 'hero') openSheet('skills');
  else if (act === 'card') { e.preventDefault(); openSheet('card'); }
  else if (act === 'bag') { if (sheetMode !== 'bag') bagTab = 'items'; openSheet('bag'); }
  else if (act === 'quests') openSheet('quests');
  else if (act === 'emote') toggleEmotes();
  else if (act.startsWith('hot') && typeof useHotbar === 'function') useHotbar(+act.slice(3) - 1);
});
addEventListener('keyup', (e) => {
  const act = codeToAct[e.code];
  if (act && MOVE_KEY[act]) {
    // only let go if no other key for this direction is still held
    keys.delete(MOVE_KEY[act]);
  }
  if (act === 'interact') held = false;
  if (act === 'charge') chargeRelease();
});
addEventListener('blur', () => { keys.clear(); held = false; charge = null; });
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
  for (const c of crew) if (!isRival(c) && crewUp(c) && c.inside === where) consider({ type: 'npc', n: c }, c.x, c.z, 1.6);
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
    attackPress(false); return;
  }
  cancelTask();
  const t = targetAt(p.x, p.z);
  pending = t;
  moveTarget = new THREE.Vector2(p.x, p.z);
  marker.position.set(p.x, 0.08, p.z); marker.visible = !t; marker.scale.setScalar(1.4);
});
let zoom = 1, zoomGoal = 1; // the wheel sets where to zoom to; the camera glides there
renderer.domElement.addEventListener('wheel', (e) => { zoomGoal = THREE.MathUtils.clamp(zoomGoal + e.deltaY * 0.001, 0.55, 1.9); e.preventDefault(); }, { passive: false });
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
  if (!mouseHeld && !forceAttack) for (const n of npcs) if ((n.inside || 'out') === where && Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'npc', n };
  const brawl = enemies.some((e) => e.hp > 0 && (e.state === 'chase' || e.state === 'slam') && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 10);
  if (!mouseHeld && !forceAttack && !brawl) for (const c of crew) if (!isRival(c) && crewUp(c) && c.inside === where && Math.hypot(c.x - p.x, c.z - p.z) < 3.8) return { type: 'npc', n: c };
  for (const n of nodes) if (n.alive && n.def.skill === 'fishing' && Math.hypot(n.x - p.x, n.z - p.z) < n.reach + 0.6) return { type: 'node', n };
  let foe = null, fd = 1e9;
  const reach = w.reach;
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising') { const d = inArc(e.pos.x, e.pos.z, 0.8, reach, A.proj ? 0.3 : 0.95); if (d >= 0 && d < fd) { fd = d; foe = e; } }
  let node = null, nd = 1e9;
  for (const n of nodes) if (n.alive && n.def.skill !== 'fishing') { const d = inArc(n.x, n.z, n.r, TOOL_REACH, 0.8); if (d >= 0 && d < nd) { nd = d; node = n; } }
  if (node && (!foe || fd > 5)) return { type: 'gather', n: node };
  return { type: 'attack', e: foe };
}
// the nearest crew member of any side (rivals too), so you can always talk things over
function nearCrew(r) {
  if (!player) return null; let best = null, bd = r;
  for (const c of crew) { if (!crewUp(c) || c.inside !== where) continue; const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
function describe(t) {
  const rv = (!t || t.type === 'attack') && !matchMedia('(pointer: coarse)').matches && nearCrew(6);
  if (rv && isRival(rv)) return { label: 'Attack', icon: ICONS[W().type], hint: `${rv.name} wants a duel! Press ${keyOf('interact')} to talk instead.`, ok: true };
  const hint = matchMedia('(pointer: coarse)').matches ? 'Tap here to swing at whatever is in front of you.' : `Click or press ${keyOf('attack')} to attack. ${keyOf('jump')} jumps, ${keyOf('sprint')} sprints, ${keyOf('dash')} dashes.`;
  if (!t) return { label: 'Attack', icon: ICONS[W().type], hint, ok: true };
  if (t.type === 'npc') return { label: 'Talk', icon: ICONS.magic, hint: t.n.name, ok: true };
  if (t.type === 'chest') return { label: 'Open', icon: ICONS.chest, hint: 'A treasure chest! What could be inside?', ok: true };
  if (t.type === 'attack') return { label: 'Attack', icon: ICONS[W().type], hint: t.e ? `${t.e.T.name} (${t.e.hp} health)` : hint, ok: true };
  const d = t.n.def, l = lvl(d.skill);
  return { label: d.verb, icon: ICONS[d.skill], hint: l >= d.req ? `${d.name} · ${SKILL_NAME[d.skill]} ${d.req}+` : `${d.name} needs ${SKILL_NAME[d.skill]} level ${d.req}`, ok: l >= d.req };
}
function doAction() {
  if (!player || player.dead || uiLock()) return;
  if (talking) { if (!advanceDialog() && !(dlg && dlg.d.querySelectorAll('.row button').length > 1)) closeDialog(); return; }
  if (now < player.nextHit) { attackQueued = now; return; }
  swing();
}
const GRAV = 50;
// Dash: a quick sidestep to the left or right of the screen. Brief dodge window, short cooldown.
let dashUntil = 0, dashReady = 0, dashDir = { x: 0, z: 0 }, dashLeft = 0;
const dodging = () => player.pos.y > 0.7 || now < dashUntil + 0.08 || dashLeft > 0;
// dir: [x, z] on screen. Left out, you dash the way you are moving, or the way you face when standing still.
function dash(dir) {
  if (!player || player.dead || uiLock() || now < dashReady || stamina < 12) return;
  if (talking) closeDialog();
  if (player.task) cancelTask();
  if (!dir) {
    let x = 0, z = 0;
    if (keys.has('u')) z -= 1; if (keys.has('d')) z += 1; if (keys.has('l')) x -= 1; if (keys.has('r')) x += 1;
    if (!x && !z && moveTarget) { x = moveTarget.x - player.pos.x; z = moveTarget.y - player.pos.z; }
    if (!x && !z) { const f = fwdOf(player); x = f.x; z = f.z; }
    dir = [x, z];
  }
  const L = Math.hypot(dir[0], dir[1]) || 1;
  sfx('dash');
  dashDir = { x: dir[0] / L, z: dir[1] / L }; dashUntil = now + 0.18; dashReady = now + 0.55; dashLeft = 4.2;
  stamina = Math.max(0, stamina - 12); staminaAt = now + 1;
  burst(player.pos.clone().setY(0.4), '#f3e2bd', 12, 3);
}
function jump() {
  if (!player || player.dead || uiLock() || player.air) return;
  if (talking) closeDialog();
  if (player.task) cancelTask();
  player.air = true; player.vy = 13.5; sfx('jump');
  player.play(player.clips.Jump_Full_Short ? 'Jump_Full_Short' : 'Cheer', { once: true, fade: 0.05, speed: 1.65 });
  burst(player.pos.clone().setY(0.2), '#f3e2bd', 8, 2);
}
function showGear(which) {
  tool.visible = which === 'axe'; pick.visible = which === 'pick'; rod.visible = which === 'rod';
  player.weapons.forEach((w) => { w.visible = !which; });
}
// One swing: chop, mine, hit with a weapon, or shoot, in the direction you face.
// One press = one attack. A press during the current swing is remembered for a moment
// and fires the instant the swing allows, so fast tapping chains the combo in rhythm.
let attackQueued = -9, forceAttack = false, mouseAimed = false;
function attackPress(viaKey) {
  if (!player || player.dead || uiLock() || talking) return;
  if (gulped) { wriggle(); return; }
  if (now < player.nextHit) { attackQueued = now; return; }
  forceAttack = !!viaKey; swing(); forceAttack = false;
}
function swing() {
  if (!player || player.dead || now < player.nextHit) return;
  if (mouseHeld && now - aim.at < 0.1) { player.face(aim.x, aim.z); }
  if (player.task) cancelTask();
  if (now - aim.at < 2.5) { player.face(aim.x, aim.z); aim.at = -99; mouseAimed = true; }
  else {
    // no mouse? swing the way your arrow keys / WASD point, so the game plays fine on a keyboard alone
    const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), kz = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
    if (kx || kz) player.root.rotation.y = Math.atan2(kx, kz);
    mouseAimed = false;
  }
  const t = swingTarget();
  if (t.type === 'npc') { held = false; player.face(t.n.x, t.n.z); openDialog(t.n); return; }
  if (t.type === 'chest') { held = false; player.face(t.n.x, t.n.z); openChest(t.n); return; }
  if (t.type === 'node') { held = false; startTask(t); return; }
  moveTarget = null; pending = null; marker.visible = false;
  flashArc();
  if (t.type !== 'gather') sfx('swing');
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
  const sp = THREE.MathUtils.clamp(1.05 / w.cd, 0.95, 2.2);
  showGear(null);
  if (t.e && A.proj) player.face(t.e.pos.x, t.e.pos.z); // gentle aim help for ranged
  // Combo: keep attacking within a moment of the last swing to chain up to three different moves.
  // The third is a finisher: harder, wider and it sends enemies flying.
  if (now - lastSwingAt > w.cd + 0.55 || comboStep >= 3) comboStep = 0;
  comboStep++; lastSwingAt = now;
  const C = comboOf(w)[comboStep - 1], fin = comboStep === 3, spd = sp * C.speed * 1.55; // snappy: swings play fast so every press feels instant
  // the wind-up is skipped so the blow lands right on the keystroke
  player.nextHit = now + w.cd * (fin ? 0.6 : 0.34);
  const lead = 0.06 * spd, from = Math.max(0, C.hitAt - lead);
  const dur = player.play(C.anim, { once: true, fade: 0.04, speed: spd, from });
  player.busyUntil = now + Math.min(dur * 0.4, w.cd * 0.25);
  if (fin) { const fw = fwdOf(player); dashLunge = { x: fw.x, z: fw.z, left: A.proj ? 0 : 0.6 }; }
  later((C.hitAt - from) / spd, () => {
    if (player.dead) return;
    const fwd = fwdOf(player), dmg = () => Math.max(1, Math.round(heroDamage() * C.mult * 0.8)); // faster swings, slightly lighter hits
    if (A.proj) {
      const shots = fin && A.proj === 'bolt' ? [-0.12, 0.12] : [0];
      for (const a of shots) {
        const d = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        shoot(player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(d, 0.8), d, A.proj, w.reach, 'player', (e) => (e.isCrew ? hurtCrew(e, dmg(), player) : hurtEnemy(e, dmg(), null, C.power)));
      }
      if (fin) burst(player.pos.clone().setY(1.8).addScaledVector(fwd, 1), A.proj === 'orb' ? '#bff6ff' : '#ffe9a8', 18, 4);
      return;
    }
    const reach = w.reach * C.reach;
    burst(player.pos.clone().setY(1.5).addScaledVector(fwd, reach * 0.55), fin ? '#ffd27a' : '#fff2a8', fin ? 26 : 14, fin ? 7 : 5);
    let hit = false;
    for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.state !== 'gone' && e.inside === where && inArc(e.pos.x, e.pos.z, 0.8, reach + 0.3, C.arc) >= 0) { hurtEnemy(e, dmg(), null, C.power); hit = true; }
    for (const c of crew) if (isRival(c) && crewUp(c) && c.inside === where && inArc(c.pos.x, c.pos.z, 0.7, reach + 0.3, C.arc) >= 0) { hurtCrew(c, dmg(), player); hit = true; }
    if (net.on && hitPeers((x, z) => inArc(x, z, 0.7, reach + 0.3, C.arc) >= 0, dmg())) hit = true;
    if (!hit) for (const n of nodes) if (n.alive && n.def.skill !== 'fishing' && inArc(n.x, n.z, n.r, w.reach) >= 0) { burst(new THREE.Vector3(n.x, 1.4, n.z), '#ffe9a8', 6, 3); break; }
  });
}
let comboStep = 0, lastSwingAt = -9, dashLunge = null;
// ---------- charged attack ----------
// J is the normal combo. Hold K: a ring fills round your feet, and letting go unleashes a big
// blow with up to almost three times the damage, and melee weapons send a slash wave flying ahead.
const CHARGE_MIN = 0.45, CHARGE_FULL = 1.3;
let charge = null, chargeRing = null;
function chargeStart() { if (!player || player.dead || uiLock() || talking) return; charge = { at: now, full: false }; }
function chargeTick() {
  if (!chargeRing) {
    chargeRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    chargeRing.rotation.x = -Math.PI / 2; chargeRing.layers.set(1); chargeRing.visible = false; scene.add(chargeRing);
  }
  if (!charge || !player || player.dead || uiLock()) { chargeRing.visible = false; if (charge && (!player || player.dead || uiLock())) charge = null; return; }
  const t = now - charge.at;
  if (t < CHARGE_MIN * 0.6) { chargeRing.visible = false; return; }
  const k = Math.min(1, (t - CHARGE_MIN * 0.6) / (CHARGE_FULL - CHARGE_MIN * 0.6));
  chargeRing.visible = true; chargeRing.position.set(player.pos.x, 0.18 + player.pos.y, player.pos.z);
  chargeRing.scale.setScalar(3.2 - 1.6 * k);
  chargeRing.material.color.set(k >= 1 ? (Math.sin(now * 20) > 0 ? '#ffffff' : '#ff8a3a') : '#ffd23f');
  if (k >= 1 && !charge.full) { charge.full = true; sfx('door'); burst(player.pos.clone().setY(1.4), '#ffd23f', 24, 4); floatText(player.pos.clone().setY(3.8), 'Charged!', 'gain'); }
}
function chargeRelease() {
  const c = charge; charge = null; if (chargeRing) chargeRing.visible = false;
  if (!c || !player || player.dead || uiLock() || talking) return;
  const t = now - c.at; if (t < CHARGE_MIN) { attackPress(true); return; } // a quick tap of K is just a normal swing
  chargedAttack(Math.min(1, (t - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN)));
}
function chargedAttack(k) {
  const w = W(), A = STYLES[w.type];
  if (now - aim.at < 2.5) { player.face(aim.x, aim.z); aim.at = -99; }
  if (player.task) cancelTask();
  const mult = 1.7 + 1.1 * k, reachK = 1.45 + 0.45 * k;
  player.nextHit = now + Math.max(0.35, w.cd * 0.6); comboStep = 0;
  showGear(null); sfx('slam');
  player.play(A.proj ? (A.proj === 'orb' ? 'Spellcast_Shoot' : '1H_Ranged_Shoot') : w.heavy ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop', { once: true, fade: 0.04, speed: 1.9 });
  player.busyUntil = now + 0.22;
  const fwd = fwdOf(player), dmg = () => Math.max(1, Math.round(heroDamage() * mult));
  if (A.proj) {
    // a fan of five shots: the first one to reach a foe hits in full, extra shots on the same foe only graze,
    // so a big boss doesn't soak up all five for a one-button wipe
    const struck = new Set(), part = (e) => { const f = struck.has(e) ? 0.25 : 1; struck.add(e); return Math.max(1, Math.round(dmg() * f)); };
    for (const a of [-0.24, -0.12, 0, 0.12, 0.24]) {
      const d = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      shoot(player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(d, 0.8), d, A.proj, w.reach * 1.35, 'player', (e) => (e.isCrew ? hurtCrew(e, part(e), player) : hurtEnemy(e, part(e), null, 2)));
    }
    burst(player.pos.clone().setY(1.8).addScaledVector(fwd, 1.2), A.proj === 'orb' ? '#bff6ff' : '#ffe9a8', 30, 6);
    return;
  }
  const reach = w.reach * reachK, arc = 1.35;
  dashLunge = { x: fwd.x, z: fwd.z, left: 0.5 };
  later(0.08, () => {
    if (player.dead) return;
    // a golden shockwave fan in front of you shows how far the blow reached
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 32, Math.PI / 2 - arc, arc * 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.55, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = player.root.rotation.y + Math.PI; m.position.set(player.pos.x, 0.2, player.pos.z); m.layers.set(1); scene.add(m);
    fx.push({ m, t: 0, dur: 0.35, R: reach + 0.3 });
    burst(player.pos.clone().setY(1.2).addScaledVector(fwd, reach * 0.6), '#ffd27a', 40, 8, 1.3);
    for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.state !== 'gone' && e.inside === where && inArc(e.pos.x, e.pos.z, 0.8, reach + 0.3, arc) >= 0) hurtEnemy(e, dmg(), null, 2.6);
    for (const c of crew) if (isRival(c) && crewUp(c) && c.inside === where && inArc(c.pos.x, c.pos.z, 0.7, reach + 0.3, arc) >= 0) hurtCrew(c, dmg(), player);
    if (net.on) hitPeers((x, z) => inArc(x, z, 0.7, reach + 0.3, arc) >= 0, dmg());
    // ...and a crescent slash flies on ahead, cutting through everything in a short line
    const struck = new Set(enemies.filter((e) => e.hp > 0 && e.inside === where && inArc(e.pos.x, e.pos.z, 0.8, reach + 0.3, arc) >= 0));
    const wave = Math.max(1, Math.round(dmg() * 0.75));
    shoot(player.pos.clone().setY(1.1).addScaledVector(fwd, 0.6), fwd, 'slash', 6 + 5 * k + w.reach, 'player',
      (e) => (e.isCrew ? hurtCrew(e, wave, player) : hurtEnemy(e, wave, null, 1.8)), { pierce: struck, size: 1 + 0.5 * k });
  });
}
// three moves per weapon style: anim, when it lands, damage, knockback, reach and arc
function comboOf(w) {
  if (w.type === 'magic') return [
    { anim: 'Spellcast_Shoot', hitAt: 0.35, mult: 1, power: 1, speed: 1 },
    { anim: 'Spellcast_Shoot', hitAt: 0.3, mult: 1, power: 1, speed: 1.15 },
    { anim: 'Spellcasting', hitAt: 0.3, mult: 1.6, power: 2.2, speed: 1.1 }];
  if (w.type === 'ranged') return [
    { anim: '1H_Ranged_Shoot', hitAt: 0.22, mult: 1, power: 1, speed: 1 },
    { anim: '1H_Ranged_Shoot', hitAt: 0.2, mult: 1, power: 1, speed: 1.15 },
    { anim: '1H_Ranged_Shoot', hitAt: 0.24, mult: 1.15, power: 1.8, speed: 0.95 }];
  if (w.heavy) return [
    { anim: '2H_Melee_Attack_Slice', hitAt: 0.36, mult: 1, power: 1.1, speed: 1.1, reach: 1, arc: 0.95 },
    { anim: '2H_Melee_Attack_Chop', hitAt: 0.5, mult: 1.1, power: 1.2, speed: 1.15, reach: 1, arc: 0.85 },
    { anim: '2H_Melee_Attack_Stab', hitAt: 0.5, mult: 1.6, power: 2.4, speed: 1.35, reach: 1.25, arc: 0.6 }];
  return [
    { anim: '1H_Melee_Attack_Slice_Diagonal', hitAt: 0.32, mult: 1, power: 1, speed: 1, reach: 1, arc: 0.95 },
    { anim: '1H_Melee_Attack_Slice_Horizontal', hitAt: 0.34, mult: 1, power: 1.1, speed: 1.1, reach: 1.05, arc: 1.15 },
    { anim: '1H_Melee_Attack_Stab', hitAt: 0.5, mult: 1.5, power: 2.3, speed: 1.4, reach: 1.25, arc: 0.6 }];
}
let specialReady = 0;
function special() {
  if (!player || player.dead || uiLock() || where === 'castle' || where === 'tavern') return;
  if (now < specialReady) { toast(`${SPECIALS[specialOf(W())].name} is recharging...`, ICONS.star); return; }
  if (talking) closeDialog();
  if (player.task) cancelTask();
  if (now - aim.at < 2.5) { player.face(aim.x, aim.z); aim.at = -99; }
  const w = W(), key = specialOf(w), SP = SPECIALS[key];
  specialReady = now + SP.cd; player.nextHit = now + 0.6; sfx('special');
  const big = (w.unique ? 1.25 : 1) * (1 + 0.05 * rankOf(heroLvl()));
  const fwd = fwdOf(player), pp = player.pos;
  const hitIn = (cx, cz, R, mult) => { let n = 0; for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.inside === where && Math.hypot(e.pos.x - cx, e.pos.z - cz) < R + (e.T.boss ? 1.2 : 0.5)) { hurtEnemy(e, Math.round(heroDamage() * mult) || 1, { x: cx, z: cz }, 1.7); n++; } if (net.on) n += hitPeers((x, z) => Math.hypot(x - cx, z - cz) < R + 0.5, Math.round(heroDamage() * mult) || 1); return n; };
  const ring = (cx, cz, R, col) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.2, cz); m.layers.set(1); scene.add(m);
    fx.push({ m, t: 0, dur: 0.45, R });
  };
  floatText(pp.clone().setY(4.2), SP.name + '!', 'gain');
  rankFlourish(pp.x, pp.z, ring);
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
        shoot(pp.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(d, 0.8), d, 'bolt', w.reach, 'player', (e) => hurtEnemy(e, Math.round(heroDamage() * SP.mult), null, 1.2));
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
let gRhythm = { n: 0, at: -99 };
// a golden tree or rock: painted gold until it's harvested
function goldNode(n, on) {
  n.golden = on;
  n.full.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || Array.isArray(o.userData.mats.std)) return;
    if (on) { if (!o.userData.goldOrig) o.userData.goldOrig = o.userData.mats; const m = { std: o.userData.goldOrig.std.clone(), toon: o.userData.goldOrig.toon.clone() }; m.toon.onBeforeCompile = o.userData.goldOrig.toon.onBeforeCompile; for (const x of [m.std, m.toon]) { x.color.lerp(new THREE.Color('#ffd23f'), 0.9); if (x.emissive) x.emissive.set('#8a5a00'); } registerMesh(o, m); }
    else if (o.userData.goldOrig) registerMesh(o, o.userData.goldOrig);
  });
}
function hitNode(n) {
  if (!n.alive) return;
  const def = n.def, l = lvl(def.skill);
  const at = new THREE.Vector3(n.x, 1.6, n.z);
  burst(at, def.skill === 'mining' ? '#ffe2b0' : '#c9f59a', 10, 3.5);
  if (l < def.req) { floatText(at.clone().setY(3), 'Too tough!', 'miss'); toast(`You need ${SKILL_NAME[def.skill]} level ${def.req} for that.`, ICONS[def.skill]); return; }
  if (def.sun && env.preset === 'night') { floatText(at.clone().setY(3), 'Too dark!', 'miss'); toast('Sunstone only softens in daylight. Come back when the sun is up!', ICONS.sunstone_ore); return; }
  n.lastHit = now;
  const miss = THREE.MathUtils.clamp(0.12 - (l - def.req) * 0.03, 0, 0.12);
  if (rng() < miss) { floatText(at.clone().setY(3), 'Miss', 'miss'); return; }
  const dmg = 1 + Math.floor(rng() * (2 + l * 0.3));
  n.hp = Math.max(0, n.hp - dmg);
  floatText(at.clone().setY(3), String(dmg));
  giveXp(def.skill, Math.round(def.xp * 0.15 * dmg));
  sfx(def.skill === 'mining' ? 'mine' : 'chop');
  if (n.hp > 0) { n.full.rotation.z = 0.05; later(0.12, () => { n.full.rotation.z = 0; }); return; }
  // broken: tree falls / rock cracks, hand out the haul
  // gathering rhythm: keep chopping or mining without a long break and the hauls grow (up to x5)
  gRhythm = now - gRhythm.at < 45 ? { n: Math.min(5, gRhythm.n + 1), at: now } : { n: 1, at: now };
  let count = 2 + (rng() < 0.4 + l * 0.01 ? 1 : 0) + (rng() < gRhythm.n * 0.12 ? 1 : 0);
  if (n.golden) count *= 3;
  addItem(def.item, count);
  giveXp(def.skill, def.xp * count * (n.golden ? 2 : 1), player.pos.clone().setY(3.2));
  toast(`${n.golden ? 'Golden haul! ' : ''}You get ${count} ${ITEMS[def.item].toLowerCase()}.`, ICONS[def.item], !!n.golden);
  if (gRhythm.n >= 2) floatText(at.clone().setY(4.2), `Rhythm x${gRhythm.n}!`, 'gain');
  // rare finds: a golden acorn in trees, a gem in rocks
  if (rng() < 0.03 + l * 0.0006 + (n.golden ? 0.25 : 0)) {
    const find = def.skill === 'mining' ? (where === 'frost' ? 'frost_gem' : 'ruby') : 'golden_acorn';
    addItem(find); toast(`A rare find: ${ITEMS[find].toLowerCase()}!`, ICONS[find], true); sfx('win');
  }
  if (n.golden) { goldNode(n, false); S.goldenNodes = (S.goldenNodes || 0) + 1; }
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
  player.task = { ...t, next: now + 1.0 };
  showGear('rod'); player.play('1H_Ranged_Aiming');
}

function gatherTick(task) {
  const n = task.n, def = n.def;
  if (now < task.next) return;
  task.next = now + 1.6 + rng() * 0.8;
  const l = lvl(def.skill);
  const chance = THREE.MathUtils.clamp(0.42 + (l - def.req) * 0.04, 0.22, 0.85);
  burst(new THREE.Vector3(n.x, 1.5, n.z), '#bff4ff', 8, 3);
  if (rng() > chance) return;
  addItem(def.item);
  giveXp(def.skill, def.xp, player.pos.clone().setY(3.2));
  sfx('splash');
  toast(`You get some ${ITEMS[def.item].toLowerCase()}.`, ICONS[def.item]);
  refreshUI();
}

// ---------- combat ----------
const projectiles = [];
const orbGeo = new THREE.IcosahedronGeometry(0.4, 1);
// Projectiles fly in a straight line and hit whatever hitbox they pass through.
// A thin, wide crescent that tapers to sharp points at both tips, lying flat and bowed forward (+Z).
function crescentGeo(R, W, A, n = 40) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, t = -A + 2 * A * u, w = W * Math.pow(Math.sin(u * Math.PI), 0.9);
    const ri = R - w * 0.25, ro = R + w * 0.75; // the bulge sits on the leading edge
    pos.push(Math.sin(t) * ri, 0, Math.cos(t) * ri - R, Math.sin(t) * ro, 0, Math.cos(t) * ro - R);
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
const slashGeoA = crescentGeo(2.1, 0.32, 1.25), slashGeoB = crescentGeo(2.1, 0.13, 1.18);
function shoot(from, dir, kind, range, owner, onHit, opt = {}) {
  let mesh;
  if (kind === 'slash') {
    // a crisp, thin sword-beam crescent: glowing edge, white-hot core and a few fading after-images behind it
    mesh = new THREE.Group();
    const mat = (col, op, add) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const parts = [[slashGeoA, '#ffd86a', 0.95, true, 0], [slashGeoB, '#ffffff', 1, false, 0.01]];
    for (const [k, op] of [[1, 0.45], [2, 0.25], [3, 0.12]]) parts.push([slashGeoA, '#ffe9a8', op, true, -0.01 * k, -0.55 * k, 1 - 0.08 * k]);
    for (const [g, col, op, add, y, z = 0, sc = 1] of parts) { const m = new THREE.Mesh(g, mat(col, op, add)); m.position.set(0, y, z); m.scale.set(sc, 1, sc); m.userData.op = op; m.layers.set(1); m.renderOrder = 5; mesh.add(m); }
    mesh.userData.size = opt.size || 1; mesh.scale.set(0.5 * mesh.userData.size, 1, 0.8 * mesh.userData.size);
  } else if (kind === 'bolt') {
    // the arrow model stands upright, so lay it along the flight line (lookAt aims +Z)
    const a = lib.arrow.clone(true); stylize(a); a.rotation.x = -Math.PI / 2; a.scale.setScalar(2.6);
    mesh = new THREE.Group(); mesh.add(a);
  } else {
    mesh = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: kind === 'dark' ? '#c58bff' : '#8ff7ff', fog: false }));
    mesh.layers.set(1);
  }
  mesh.position.copy(from);
  mesh.lookAt(from.clone().add(dir));
  scene.add(mesh);
  const pr = { mesh, dir: dir.clone().setY(0).normalize(), kind, owner, onHit, speed: kind === 'bolt' ? 26 : kind === 'slash' ? 20 : kind === 'dark' ? 11 : 17, left: range + 1 };
  if (opt.pierce) { pr.pierce = opt.pierce; pr.R = 1.9 * (opt.size || 1); pr.range = range + 1; }
  projectiles.push(pr);
}
// Your damage: the weapon's base damage, multiplied by your Attack, with a little luck either way.
function heroDamage() {
  if (rng() < 0.1) return 0;
  return Math.max(1, Math.round(W().dmg * dmgMult() * pathDmg() * (heroLvl() < 5 ? 1.35 : 1) * (0.8 + rng() * 0.4)));
}
let hitStopUntil = 0;
// Every hit shoves the enemy away from where the blow came from. Heavy weapons and specials shove harder,
// a finishing blow launches small enemies, and big bosses barely move. A tiny freeze sells the impact.
function impact(e, dmg, src, power, killed) {
  const from = src || player.pos, w = W();
  const dx = e.pos.x - from.x, dz = e.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
  const force = (3.2 + Math.min(dmg, 30) * 0.2) * (w.heavy ? 1.3 : 1) * Math.min(power, 1.8) * (killed ? 1.3 : 1);
  const m = e.mass || 1;
  e.kb.set((dx / d) * force / m, (dz / d) * force / m);
  if (m < 3) { e.vy = (killed ? 6 : 2.5) * Math.min(1.4, power) / m; e.lift = Math.max(e.lift, 0.01); }
  e.staggerUntil = now + Math.min(0.45, 0.35 / Math.sqrt(m)) * (killed ? 0 : 1);
  e.flashT = now + 0.13;
  sfx(killed ? 'kill' : power > 1.4 || w.heavy ? 'bighit' : 'hit');
  hitStopUntil = now + (killed ? 0.12 : w.heavy || power > 1.4 ? 0.08 : 0.05) * (e.T.boss ? 0.7 : 1);
  const at = e.pos.clone().setY(e.T.boss ? 2.6 : 1.5);
  const col = w.type === 'magic' ? '#bff6ff' : w.type === 'ranged' ? '#ffe9a8' : '#fff4d0';
  burst(at, col, killed ? 34 : 20, killed ? 8 : 6, killed ? 1.3 : 1);
  burst(at, '#ffb347', 8, 4);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 32), new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  ring.position.copy(at); ring.lookAt(camera.position); ring.layers.set(1); scene.add(ring);
  fx.push({ m: ring, t: 0, dur: 0.22, R: (e.T.boss ? 2.2 : 1.2) * (killed ? 1.5 : 1) });
}
function knockTick(e, dt) {
  const ep = e.pos;
  if (Math.abs(e.kb.x) + Math.abs(e.kb.y) > 0.05) {
    ep.x += e.kb.x * dt; ep.z += e.kb.y * dt;
    e.kb.multiplyScalar(Math.exp(-10 * dt));
    if (e.inside === 'out' || LANDS[e.inside]) pushOut(ep, e.T.boss ? 1.2 : 0.6);
  }
  if (e.lift > 0) { e.vy -= 32 * dt; e.lift = Math.max(0, e.lift + e.vy * dt); if (!e.lift) e.vy = 0; ep.y = e.lift; }
  else if (e.T.fly) ep.y = e.state === 'dead' ? Math.max(0, ep.y - dt * 4) : e.T.fly + Math.sin(now * 3 + e.home.x) * 0.3;
  // white flash that fades over a few frames
  const f = Math.max(0, (e.flashT - now) / 0.13);
  const gk = f + (e.golden ? 10 : 0), g = e.golden ? 0.55 + Math.sin(now * 6) * 0.15 : 0;
  if (gk !== e.flashLast || e.golden) { e.flashLast = gk; for (const m of e.flashMats) if (m.emissive) { m.emissive.setRGB(f + g * 0.75, f * 0.95 + g * 0.5, f * 0.85); } }
}
let poisonHit = false;
function hurtEnemy(e, dmg, src = null, power = 1) {
  // never hurt something that is already down, fading out or still climbing out of the ground.
  // (Hitting a corpse used to run its death a second time, which queued a second respawn: that's
  // what made skeletons pop back up mid-fight and then keel over for no reason.)
  if (!e || e.hp <= 0 || e.state === 'dead' || e.state === 'gone' || e.state === 'rising') return;
  const head = e.pos.clone().setY(3.4);
  e.barAt = now; // its health bar shows for a little while after each hit
  if (e.state === 'idle' || e.state === 'walk') e.state = 'chase';
  if (e.under) { if (rng() < 0.5) floatText(head, 'It\'s underwater! Watch the bubbles', 'miss'); return; }
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  if (!crewHitting && !poisonHit) {
    const w = W();
    // marsh poison keeps hurting for a few seconds; the Fangblade drinks a little health back
    if (w.poison) e.poison = { left: 3, at: now + 1, dmg: Math.max(1, Math.round(dmg * 0.15)) };
    if (w.drain && S.hp < maxHp()) { S.hp = Math.min(maxHp(), S.hp + Math.max(1, Math.round(dmg * w.drain))); refreshUI(); }
  }
  if (e.shield) { dmg = Math.max(1, Math.round(dmg * 0.25)); if (rng() < 0.4) floatText(head.clone().setY(4.6), 'Shielded! Break the glowing crystal', 'miss'); }
  else if (now < (e.dizzyUntil || 0)) dmg = Math.round(dmg * 1.5);
  if (e.coreOpen) { dmg = Math.round(dmg * 1.3); if (rng() < 0.15) floatText(head.clone().setY(5), 'Core hit!', 'gain'); }
  e.hp = Math.max(0, e.hp - dmg);
  if (!bossRemote && !wbRemote) e.myDmg = (e.myDmg || 0) + dmg;
  wbShare(e, dmg); bossShare(e, dmg);
  // the Avalanche Twins share one strength: hurt one and the other feels it (and gets angry)
  if (e.T.twin) {
    const p = enemies.find((o) => o.type === e.T.twin);
    if (p && p.hp > 0 && p.state !== 'dead') {
      if (e.hp <= 0) { p.hp = 1; later(0.3, () => { if (p.hp > 0) hurtEnemy(p, 1); }); }
      else { p.hp = e.hp; phaseCheck(p); if (p.state === 'idle' || p.state === 'walk' || p.state === 'return') p.state = 'chase'; p.nextHit = Math.min(p.nextHit, now + 0.4); }
    }
  }
  phaseCheck(e);
  if (e.T.boss && !PHASE_LINES[e.type] && !e.lowSaid && e.hp > 0 && e.hp <= e.T.hp * 0.4) { e.lowSaid = true; bossShout(e); }
  floatText(head, String(dmg), e.hp <= 0 ? 'kill' : dmg >= Math.max(8, W().dmg * 1.6) ? 'big' : '');
  impact(e, dmg, src, power, e.hp <= 0);
  if (!crewHitting) giveHeroXp(dmg * HIT_HERO_XP);
  if (e.hp <= 0) {
    e.state = 'dead'; e.bar.hidden = true;
    const life = e.life = (e.life || 0) + 1; // each death gets its own id, so old timers can't touch a respawned monster
    e.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    if (!e.T.noBones) later(0.75, () => { if (e.state === 'dead' && e.life === life) collapse(e); });
    if (e.T.poof) later(0.8, () => { if (e.state === 'dead') { burst(e.pos.clone().setY(0.8), e.T.tintAll || '#9fe07a', 24, 4); e.root.visible = false; } });
    // a shared boss beaten by other heroes: only those who hit it get loot and quest credit
    const unpaid = e.T.boss && (bossRemote || wbRemote) && !e.myDmg;
    if (unpaid) {
      bossCleanup(e); if (e.type === 'boss_colossus') sandsCleanup(e); $('bossbar').hidden = true;
      toast(`Other heroes beat ${e.T.name}. Hit it next time to share the loot!`, ICONS.star);
    } else {
    giveHeroXp(e.T.xp, e.pos.clone().setY(4)); partyShareXp(e.T.xp, e.pos);
    const coins = e.T.coins ? e.T.coins[0] + Math.floor(rng() * (e.T.coins[1] - e.T.coins[0])) : 3 + Math.floor(rng() * 9);
    S.coins += coins; addItem('bones'); later(0.25, () => sfx('coin'));
    rollLoot(e);
    if (e.T.boss) {
      bossCleanup(e); lastBossKill = now; queueLetter(e.type); S.beat = { ...(S.beat || {}), [e.type]: ((S.beat || {})[e.type] || 0) + 1 };
      if (e.type === 'boss_gagron' && !S.gagronFree) { S.gagronFree = true; later(4, makeGagronFriend); }
      if (e.type === 'boss_sogg' && !S.soggFree) { S.soggFree = true; later(4, makeSoggFriend); }
      if (e.type === 'boss_pomp' && !S.pompFree) { S.pompFree = true; later(4, makePompFriend); }
      if (e.type === 'boss_colossus') sandsCleanup(e);
      addItem(e.T.drop);
      toast(`You defeated ${e.T.name}! It dropped ${ITEMS[e.T.drop].toLowerCase()}!`, ICONS[e.T.drop], true);
      burst(e.pos.clone().setY(2), '#ffe07a', 80, 8, 1.6);
      for (const k of Object.keys(QUESTS)) if (S.quests[k].state === 'active' && QUESTS[k].bossType === e.type) S.quests[k].boss = 1;
      $('bossbar').hidden = true;
      if ((BOSS_LINES[e.type] || {}).defeat && S.beat[e.type] === 1) { const be = e; later(0.5, () => { if (!bossIntro && !player.dead) startBossScene(be, 'defeat'); }); }
      if (e.T.town) { const T = TOWNS.find((t) => t.id === e.T.town); later(1.5, () => liberateTown(T)); }
    }
    floatText(e.pos.clone().setY(2.4), `+${coins} coins`, 'gain');
    if (e.golden) goldenCaught(e);
    for (const k of Object.keys(QUESTS)) if (S.quests[k].state === 'active' && QUESTS[k].need.kills !== undefined && (!QUESTS[k].land || QUESTS[k].land === e.inside)) S.quests[k].kills++;
    if (!e.temp || e.boss) boardToday().kills++;
    }
    refreshUI();
    later(e.temp ? 5 : e.T.boss ? 90 : 16, () => {
      if (e.temp) { removeEnemy(e); return; } // ambush skeletons don't come back
      if (!enemies.includes(e) || e.life !== life || e.state !== 'dead') return;
      if (e.T.town && townFree(e.T.town)) return; // freed towns stay free
      e.hp = e.T.hp; e.state = 'rising'; e.myDmg = 0;
      reassemble(e);
      const ok = e.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { e.state = 'idle'; e.play('Idle'); } });
      if (!ok) { e.state = 'idle'; e.play('Idle'); }
      burst(e.pos.clone().setY(0.5), '#b9ff8a', 30, 4);
    });
  } else if (e.state !== 'slam' && (e.mass < 3 || !['1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', 'Spellcast_Shoot', 'Spellcasting'].includes(e.name))) {
    // small enemies flinch even mid-swing (it interrupts them); bosses only flinch when idle
    e.play('Hit_A', { once: true, fade: 0.04, speed: 1.3, onFinish: () => e.play('Idle_Combat') });
  }
}
let lastHurt = -10;
function hurtPlayer(dmg, from = null) {
  if (player.dead || creator.open) return;
  const head = player.pos.clone().setY(3.6);
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  // Defense divides the hit; the leftover fraction rounds up or down by chance
  const d = dmg / defDiv();
  dmg = Math.floor(d) + (rng() < d - Math.floor(d) ? 1 : 0);
  if (dmg === 0) { floatText(head, 'Blocked', 'miss'); burst(player.pos.clone().setY(1.5), '#bfe0ff', 8, 3); return; }
  S.hp -= dmg; lastHurt = now; player.hurtFace = now + 0.45; sfx('hurt');
  floatText(head, String(dmg), 'hurt');
  burst(player.pos.clone().setY(1.5), '#ff8a7a', 10, 4);
  if (S.hp <= 0) {
    S.hp = 0; player.dead = true; cancelTask(); moveTarget = null;
    player.play('Death_A', { once: true, clamp: true, fade: 0.1 });
    const lost = Math.floor(S.coins / 2);
    const foe = from && net.peers.get(from);
    if (foe) {
      // beaten in a duel: you keep your coins on you, but the winner picks one prize from you
      duelLoss = { from, until: now + 60, offer: duelOffer() };
      sendNet('ko', { to: from, offer: duelLoss.offer });
      toast(`${foe.name || 'Another hero'} beat you in a duel! They get to pick one prize from you. Bank your coins to keep them safe.`, null, true);
    } else if (lost > 0) { S.coins -= lost; dropPouch(lost); }
    if (!foe) toast(lost > 0 ? `You were knocked out and dropped ${lost} coins where you fell! Go back for them, or bank your coins next time.` : 'You were knocked out! You wake up in the nearest village.', null, true);
    later(2.2, () => {
      // wake up in the nearest village: the one in the land you fell in, or just outside a cave or house
      const L = LANDS[where], I = !L && INTERIORS[where], at = L ? { x: L.village.x, z: L.village.z + 4 } : I && I.exitTo ? I.exitTo : { x: 0, z: 6 };
      where = L ? where : 'out'; player.root.position.set(at.x, 0, at.z); player.air = false;
      camPos.copy(player.pos).setY(0).add(CAM_OFF.clone().multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1)));
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
function hazard({ x, z, R, dir = 0, half = Math.PI, dur = 1.1, dmg, fire = true, col = null, inner = 0 }) {
  const geo = inner > 0 ? new THREE.RingGeometry(inner / R, 1, 48) : half >= Math.PI ? new THREE.CircleGeometry(1, 40) : new THREE.CircleGeometry(1, 30, Math.PI / 2 - half, half * 2);
  const m = new THREE.Mesh(geo, hazardMat()); if (col) m.material.color.set(col); m.rotation.x = -Math.PI / 2; m.rotation.z = dir; m.position.set(x, 0.14, z); m.layers.set(1); m.scale.setScalar(R * 0.1); scene.add(m);
  const edge = new THREE.Mesh(inner > 0 ? new THREE.RingGeometry(0.95, 1, 48) : half >= Math.PI ? new THREE.RingGeometry(0.95, 1, 48) : new THREE.RingGeometry(0.96, 1, 30, 1, Math.PI / 2 - half, half * 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  edge.rotation.x = -Math.PI / 2; edge.rotation.z = dir; edge.position.set(x, 0.15, z); edge.layers.set(1); edge.scale.setScalar(R); scene.add(edge);
  if (inner > 0) { const e2 = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), edge.material); e2.rotation.x = -Math.PI / 2; e2.position.set(x, 0.15, z); e2.layers.set(1); e2.scale.setScalar(inner); scene.add(e2); m.userData.inEdge = e2; }
  hazards.push({ x, z, R, dir, half, dur, dmg, fire, col, inner, m, edge, t: 0 });
}
function inHazard(h) {
  const dx = player.pos.x - h.x, dz = player.pos.z - h.z, d = Math.hypot(dx, dz);
  if (d > h.R || d < (h.inner || 0)) return false;
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
        const rr = h.inner ? h.inner + (h.R - h.inner) * rng() : h.R * Math.sqrt(rng()), aa = h.half >= Math.PI ? rng() * 6.28 : Math.PI / 2 + h.dir + (rng() * 2 - 1) * h.half;
        burst(new THREE.Vector3(h.x + Math.cos(aa) * rr, 0.6, h.z - Math.sin(aa) * rr), h.col ? (j % 2 ? '#ffffff' : h.col) : j % 2 ? '#ffb347' : '#ff5a1f', 14, 5, 1.2);
      }
      shake = Math.max(shake, 0.3);
      if (!player.dead && inHazard(h)) {
        if (dodging()) floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss');
        else hurtPlayer(h.dmg);
      }
      scene.remove(h.m, h.edge); if (h.m.userData.inEdge) scene.remove(h.m.userData.inEdge); h.m.material.dispose(); hazards.splice(i, 1);
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
      later(i * 0.25, () => hazard({ x, z, R: 2.4, dur: 1.2, dmg: bossDmg(e, 1.3) }));
    }
  } else if (toP < 5 && n % 2 === 0) {
    e.face(player.pos.x, player.pos.z);
    e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
    later(0.55, () => {
      if (e.hp <= 0 || Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z) > 5.5) return;
      if (dodging()) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; }
      hurtPlayer(bossDmg(e, 0.7 + rng() * 0.5));
    });
  } else {
    // fire breath: a wide cone in front of him
    e.face(player.pos.x, player.pos.z); e.state = 'slam';
    e.play('Spellcast_Shoot', { once: true, fade: 0.1 });
    hazard({ x: ep.x, z: ep.z, R: 12, dir: toward + Math.PI, half: 0.42, dur: 1.15, dmg: bossDmg(e, 1.6) });
    later(1.2, () => { if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); } });
  }
}


// ---------- boss phases ----------
// Every big boss changes how it fights at 60% and 30% health. Each new move is telegraphed on the
// ground first, and after its biggest moves the boss is left dizzy for a moment: hit it then for extra damage.
const PHASE_LINES = {
  boss_gagron: ['Enough! To the skies!', 'Not the face! Now I am REALLY cross!'],
  boss_crusher: ['Bonecrusher throw rocks now!', 'SPIN TIME! Mum hates spin time!'],
  boss_gloom: ['My crystals shield me, fool!', 'Which of us is real? Guess!'],
  boss_rattle: ['All hands on deck, ye scallywags!', 'Taste me anchor!'],
};
const bossPhaseOf = (e) => { const k = e.hp / e.T.hp; return k <= 0.3 ? 3 : k <= 0.6 ? 2 : 1; };
function bossSay(e, text) {
  if (!shoutEl) { shoutEl = document.createElement('div'); shoutEl.className = 'bossshout'; document.body.appendChild(shoutEl); }
  shoutEl.textContent = text; shoutEl.dataset.until = String(now + 2.6); shoutEl.e = e;
  shoutEl.classList.remove('pop'); void shoutEl.offsetWidth; shoutEl.classList.add('pop');
}
function phaseCheck(e) {
  if (!e.T.boss || e.hp <= 0 || !PHASE_LINES[e.type]) return;
  const ph = bossPhaseOf(e);
  if (ph <= (e.phase || 1)) return;
  e.phase = ph;
  bossSay(e, PHASE_LINES[e.type][ph - 2]);
  e.staggerUntil = now + 1.0; e.nextHit = now + 1.8; e.dizzyUntil = 0;
  burst(e.pos.clone().setY(2.5), '#ff6b5a', 50, 8, 1.3); sfx('slam');
  { const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffb070', transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(e.pos.x, 0.2, e.pos.z); m.layers.set(1); scene.add(m); fx.push({ m, t: 0, dur: 0.6, R: 7 }); }
  const el = $('banner'); el.textContent = `${e.T.name}: phase ${ph}!`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  const setup = PHASE_SETUP[e.type]; if (setup) setup(e, ph);
}
// the fair opening: a dizzy boss can't attack and takes 50% more damage
function dizzy(e, t) {
  if (e.hp <= 0) return;
  e.dizzyUntil = now + t; e.state = 'chase';
  e.play(e.T.dragon ? 'Hit_A' : 'Hit_A', { once: true, fade: 0.1, speed: 0.6, clamp: true });
  floatText(e.pos.clone().setY((e.T.scale || 2) * 2), 'Dizzy! Hit it now!', 'gain');
  later(t, () => { if (e.hp > 0 && now >= e.dizzyUntil - 0.05) e.play('Idle_Combat'); });
}
function dizzyTick(e, dt) {
  if (rng() < dt * 8) {
    const a = now * 5 + rng(), h = (e.T.scale || 2) * 2.1 + (e.root.position.y || 0);
    burst(new THREE.Vector3(e.pos.x + Math.cos(a) * 1.2, h, e.pos.z + Math.sin(a) * 1.2), '#ffe45a', 3, 1.5, 0.6);
  }
}
// adds that a boss calls in: they vanish when the fight ends and never respawn
function bossAdd(boss, k, x, z) {
  const a = spawnEnemy(k, x, z);
  a.temp = true; a.inside = boss.inside; a.state = 'rising'; a.boss = boss;
  boss.adds = boss.adds || []; boss.adds.push(a);
  a.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { a.state = 'chase'; a.play('Idle_Combat'); } }) || (a.state = 'chase');
  burst(new THREE.Vector3(x, 0.5, z), '#b9ff8a', 24, 4);
  return a;
}
function bossCleanup(e, reset = false) {
  e.phase = 1; e.shield = false; e.dizzyUntil = 0; e.flyN = 0; e.root.position.y = 0; frostCleanup(e); sandsCleanup(e);
  for (const r of e.runes || []) { scene.remove(r.g); }
  e.runes = null;
  // a boss that just walked home keeps its helpers: they fight on and fade away once they lose
  // interest. They only fall apart when the boss itself is beaten, so nothing near you dies for no reason.
  if (reset) { for (const a of e.adds || []) if (a.hp > 0) a.boss = null; e.adds = []; }
  for (const a of e.adds || []) if (enemies.includes(a)) { if (a.hp > 0) { a.hp = 0; a.state = 'dead'; a.bar.hidden = true; a.play('Death_A', { once: true, clamp: true }); later(0.75, () => collapse(a)); } later(4, () => removeEnemy(a)); }
  e.adds = []; e.addWave = 0; e.enraged = false; e.nextSpecial = null;
}

// ---------- boss specials (every boss) ----------
// On top of each boss's own moves, every big boss now has a set of telegraphed specials:
// a charge, shockwave rings, a meteor rain and cross beams. At 66% and 33% health it calls
// in helpers, and below 30% it gets ENRAGED and uses specials much more often.
const ADD_FOR = { out: 'skel_minion', frost: 'frost_minion', marsh: 'bog_slime', sands: 'clock_soldier' };
function bossSpecial(e) {
  const ep = e.pos, k = e.hp / e.T.hp, land = e.inside && ADD_FOR[e.inside] ? e.inside : 'out';
  // helpers at 66% and 33%
  e.addWave = e.addWave || 0;
  if ((e.addWave === 0 && k <= 0.66) || (e.addWave === 1 && k <= 0.33)) {
    e.addWave++;
    bossSay(e, e.addWave === 1 ? 'Minions! To me!' : 'More! Bring me MORE!');
    const n = land === 'out' ? 3 : 2;
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + rng(); bossAdd(e, ADD_FOR[land], ep.x + Math.cos(a) * 5, ep.z + Math.sin(a) * 5); }
    e.nextSpecial = now + 4; return true;
  }
  if (!e.enraged && k <= 0.3) {
    e.enraged = true; bossSay(e, 'ENRAGED!');
    burst(ep.clone().setY(2.5), '#ff3b2f', 60, 9, 1.4); sfx('slam');
  }
  e.nextSpecial = now + (e.enraged ? 3.6 : 6.5) + rng() * 1.5;
  const pick = (e.specN = (e.specN || 0) + 1 + Math.floor(rng() * 2)) % 4;
  const toward = Math.atan2(player.pos.x - ep.x, player.pos.z - ep.z), dir = toward + Math.PI;
  e.face(player.pos.x, player.pos.z);
  if (pick === 0) {
    // CHARGE: a long lane toward you, then it rushes down it and is left dizzy
    e.state = 'slam'; e.play('Spellcasting', { once: true, fade: 0.1 });
    const sx = ep.x, sz = ep.z, dx = Math.sin(toward), dz = Math.cos(toward);
    // it never charges off its own stage (into another boss's, or out of the arena)
    const [tx, tz] = e.home ? nearHome(e, sx + dx * 15, sz + dz * 15, bossLeash(e)) : [sx + dx * 15, sz + dz * 15];
    const L = Math.max(5, Math.min(15, Math.hypot(tx - sx, tz - sz)));
    hazard({ x: sx, z: sz, R: L + 1, dir, half: 0.17, dur: 1.0, dmg: bossDmg(e, 1.5), col: '#ff4a3a' });
    for (let s = 1; s <= 8; s++) later(1.0 + s * 0.035, () => { if (e.hp > 0) { ep.x = sx + dx * L * s / 8; ep.z = sz + dz * L * s / 8; } });
    later(1.0, () => { if (e.hp > 0) e.play('Running_A', { fade: 0.05 }); });
    later(1.35, () => { if (e.hp > 0) { burst(ep.clone().setY(1), '#ffd23f', 30, 6); dizzy(e, 1.6); } });
  } else if (pick === 1) {
    // SHOCKWAVE: three rings rolling outward. Stand in the gaps or jump through.
    e.state = 'slam'; e.play('Spellcast_Shoot', { once: true, fade: 0.1 });
    const cx = ep.x, cz = ep.z;
    [[0, 4], [4.5, 8.5], [9, 13]].forEach(([a, b], i) => later(i * 0.55, () => { if (e.hp > 0) hazard({ x: cx, z: cz, R: b, inner: a, dur: 1.0, dmg: bossDmg(e, 1.2), col: '#c06bff' }); }));
    later(1.9, () => { if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); } });
  } else if (pick === 2) {
    // METEOR RAIN: circles fall on and around you, one after another
    e.play('Spellcasting', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
    const n = e.enraged ? 7 : 5;
    for (let i = 0; i < n; i++) later(i * 0.3, () => {
      if (e.hp <= 0) return;
      const a = rng() * 6.28, r = i === 0 ? 0 : 1.5 + rng() * 4;
      hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2.6, dur: 1.15, dmg: bossDmg(e, 1.3) });
    });
  } else {
    // CROSS BEAMS: four thin beams, then four more turned halfway. Step between them.
    e.state = 'slam'; e.play('Spellcast_Shoot', { once: true, fade: 0.1 });
    const cx = ep.x, cz = ep.z;
    for (let j = 0; j < 4; j++) hazard({ x: cx, z: cz, R: 16, dir: dir + j * Math.PI / 2, half: 0.12, dur: 1.1, dmg: bossDmg(e, 1.4), col: '#4ad8ff' });
    later(1.0, () => { if (e.hp > 0) for (let j = 0; j < 4; j++) hazard({ x: cx, z: cz, R: 16, dir: dir + Math.PI / 4 + j * Math.PI / 2, half: 0.12, dur: 1.0, dmg: bossDmg(e, 1.4), col: '#4ad8ff' }); });
    later(2.1, () => { if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); } });
  }
  return true;
}

// Boss stages: a boss follows you round a big ring, but never so far that it walks into another
// boss's stage, and a second boss won't join in while you're already fighting one.
const isPair = (a, b) => a.T.twin === b.type || b.T.twin === a.type;
function bossLeash(e) {
  if (e.leash) return e.leash;
  let near = 999;
  for (const o of enemies) if (o !== e && o.T.boss && !o.temp && o.inside === e.inside && !isPair(e, o)) near = Math.min(near, Math.hypot(o.home.x - e.home.x, o.home.y - e.home.y));
  return (e.leash = Math.max(22, Math.min(48, near * 0.55)));
}
const otherBossBusy = (e) => enemies.some((o) => o !== e && o.T.boss && o.hp > 0 && o.state !== 'idle' && o.state !== 'walk' && o.state !== 'dead' && o.state !== 'return' && o.inside === e.inside && !isPair(e, o));
// little per-frame helpers for boss moves
const bossFx = [];
const tween = (dur, f, done) => bossFx.push({ t: 0, dur, f, done });
function bossFxTick(dt) {
  for (let i = bossFx.length - 1; i >= 0; i--) {
    const fx = bossFx[i]; fx.t += dt;
    const k = Math.min(1, fx.t / fx.dur);
    fx.f(k, dt);
    if (k >= 1) { bossFx.splice(i, 1); if (fx.done) fx.done(); }
  }
  for (const e of enemies) if (e.runes && e.hp > 0) runeTick(e, dt);
}
const nearHome = (e, x, z, r = 24) => { const dx = x - e.home.x, dz = z - e.home.y, d = Math.hypot(dx, dz); return d <= r ? [x, z] : [e.home.x + (dx / d) * r, e.home.y + (dz / d) * r]; };

// Gagron: phase 2 takes to the sky and rains fire, then crashes down where you stood. Phase 3 adds lava rings.
function gagronFly(e) {
  e.state = 'slam'; e.play('Running_A', { fade: 0.2 });
  sfx('slam');
  tween(0.8, (k) => { e.root.position.y = 7 * Math.sin(k * Math.PI / 2); });
  for (let i = 0; i < 6; i++) later(0.6 + i * 0.4, () => {
    if (e.hp <= 0 || player.dead) return;
    const a = rng() * 6.28, r = i % 2 ? 0 : 1 + rng() * 2;
    hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2.5, dur: 1.0, dmg: bossDmg(e, 1.2) });
  });
  later(3.0, () => {
    if (e.hp <= 0) return;
    const [x, z] = nearHome(e, player.pos.x, player.pos.z);
    hazard({ x, z, R: 4.8, dur: 1.1, dmg: bossDmg(e, 1.7) });
    later(0.75, () => {
      if (e.hp <= 0) return;
      e.pos.x = x; e.pos.z = z;
      tween(0.35, (k) => { e.root.position.y = 7 * (1 - k); }, () => { burst(e.pos.clone().setY(0.5), '#ffb347', 60, 9, 1.4); dizzy(e, 3); });
    });
  });
}
function lavaRings(e) {
  e.state = 'slam'; e.play('Spellcasting', { once: true, fade: 0.1 });
  const x = e.pos.x, z = e.pos.z;
  for (let i = 0; i < 3; i++) later(i * 0.8, () => { if (e.hp > 0) hazard({ x, z, R: 5 + i * 4.5, inner: 3.4 + i * 4.5, dur: 1.0, dmg: bossDmg(e, 1.4) }); });
  later(2.8, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}
// Bonecrusher: boulders from afar in phase 2, a whirling axe spin in phase 3
function boulder(e) {
  e.face(player.pos.x, player.pos.z);
  e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
  const x = player.pos.x, z = player.pos.z;
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: '#a08a70', flatShading: true }));
  rock.position.copy(e.pos).setY(4); scene.add(rock);
  const from = rock.position.clone();
  hazard({ x, z, R: 2.8, dur: 1.2, dmg: bossDmg(e, 1.4), col: '#c89a6a' });
  tween(1.2, (k) => { rock.position.set(from.x + (x - from.x) * k, 4 + 8 * Math.sin(k * Math.PI) - 3.5 * k, from.z + (z - from.z) * k); rock.rotation.x += 0.2; }, () => { scene.remove(rock); burst(new THREE.Vector3(x, 0.6, z), '#b89a78', 30, 6); });
}
function axeSpin(e) {
  e.state = 'slam'; e.play('2H_Melee_Attack_Spin', { fade: 0.1 }) || e.play('Running_A');
  let hitAt = 0;
  bossSay(e, 'WHEEEE!');
  tween(3.2, (k, dt) => {
    if (e.hp <= 0) return;
    e.root.rotation.y += dt * 14;
    const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { e.pos.x += (dx / d) * 2.6 * dt; e.pos.z += (dz / d) * 2.6 * dt; }
    if (rng() < dt * 10) burst(e.pos.clone().setY(1.2), '#ffd08a', 4, 5, 0.5);
    if (d < 3.6 && now > hitAt && !player.dead) { hitAt = now + 0.5; if (dodging()) floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); else hurtPlayer(bossDmg(e, 0.8)); }
  }, () => { if (e.hp > 0) { bossSay(e, 'So... dizzy...'); dizzy(e, 2.6); } });
}
// The Gloomcaster: crystal runes shield him in phase 2. Stand on the glowing rune to shatter it.
function makeRunes(e) {
  e.runes = [];
  for (let i = 0; i < 3; i++) {
    // find open ground (not inside a tree) so every rune can be reached
    let x = e.home.x, z = e.home.y;
    for (let t = 0; t < 40; t++) { const a = i * 2.094 + 0.5 + (t % 8) * 0.25, r = 6 + Math.floor(t / 8) * 1.5; x = e.home.x + Math.cos(a) * r; z = e.home.y + Math.sin(a) * r; if (isFree(x, z, 1.6)) break; }
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), new THREE.MeshBasicMaterial({ color: '#b07aff', transparent: true, opacity: 0.25, depthWrite: false, fog: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.13; disc.layers.set(1);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), new THREE.MeshLambertMaterial({ color: '#c8a8ff', emissive: '#5a2a9a', flatShading: true }));
    crystal.scale.set(0.8, 1.8, 0.8); crystal.position.y = 2.4;
    g.add(disc, crystal); scene.add(g);
    e.runes.push({ g, disc, crystal, x, z, broken: false, stand: 0 });
  }
  e.runeOn = 0; e.shield = true;
}
function runeTick(e, dt) {
  for (const [i, r] of e.runes.entries()) {
    if (r.broken) continue;
    const on = i === e.runeOn && e.shield;
    r.crystal.rotation.y += dt * (on ? 3 : 0.8); r.crystal.position.y = 2.4 + Math.sin(now * 2 + i) * 0.25;
    r.disc.material.opacity = on ? 0.35 + 0.25 * Math.sin(now * 6) : 0.12;
    r.crystal.material.emissive.set(on ? '#b06aff' : '#3a1a6a');
    if (!on || where !== e.inside || player.dead) { r.stand = 0; continue; }
    if (Math.hypot(player.pos.x - r.x, player.pos.z - r.z) < 1.9) {
      r.stand += dt;
      if (rng() < dt * 12) burst(new THREE.Vector3(r.x, 1, r.z), '#d8b8ff', 3, 2, 0.6);
      if (r.stand > 1.2) {
        r.broken = true; scene.remove(r.g); burst(new THREE.Vector3(r.x, 2.4, r.z), '#c8a8ff', 60, 8, 1.4); sfx('slam');
        e.shield = false; bossSay(e, 'My crystal! NO!'); dizzy(e, 4);
        const next = e.runes.findIndex((q) => !q.broken);
        if (next >= 0) later(9, () => { if (e.hp > 0 && e.runes) { e.runeOn = next; e.shield = true; bossSay(e, 'Shield, rise!'); } });
      }
    } else r.stand = Math.max(0, r.stand - dt);
  }
}
function gloomBlink(e) {
  const spots = (e.runes || []).filter((r) => !r.broken);
  const r = spots.length ? spots[Math.floor(rng() * spots.length)] : null;
  const a = rng() * 6.28, [x, z] = r ? [r.x + Math.cos(a) * 3, r.z + Math.sin(a) * 3] : nearHome(e, e.pos.x + Math.cos(a) * 6, e.pos.z + Math.sin(a) * 6, 14);
  burst(e.pos.clone().setY(2), '#8a3ad8', 40, 6, 1.2);
  e.pos.x = x; e.pos.z = z;
  burst(e.pos.clone().setY(2), '#c8a8ff', 40, 6, 1.2); sfx('whoosh');
}
// Captain Rattlebones: calls his crew in phase 2, swings his anchor in phase 3
function anchorSweep(e) {
  e.state = 'slam'; e.play('2H_Melee_Attack_Spin', { once: true, fade: 0.1 }) || e.play('1H_Melee_Attack_Chop', { once: true });
  hazard({ x: e.pos.x, z: e.pos.z, R: 7.5, inner: 2.4, dur: 1.2, dmg: bossDmg(e, 1.6), col: '#8fb8d8' });
  later(1.3, () => { if (e.hp > 0) dizzy(e, 2.4); });
}
function cannons(e) {
  for (let i = 0; i < 2; i++) later(i * 0.35, () => {
    if (e.hp <= 0 || player.dead) return;
    const a = rng() * 6.28, r = 1.5 + rng() * 3;
    hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2.2, dur: 1.2, dmg: bossDmg(e, 1.1), col: '#9aa8b8' });
  });
}
const PHASE_SETUP = {
  boss_gloom: (e, ph) => {
    if (ph === 2) makeRunes(e);
    if (ph === 3) for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, 'gloom_shadow', e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5); }
  },
  boss_rattle: (e, ph) => {
    if (ph !== 2) return;
    const wave = () => { for (let i = 0; i < 3; i++) { const a = i * 2.1 + rng(); bossAdd(e, 'skel_minion', e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5); } };
    wave(); later(14, () => { if (e.hp > 0 && e.phase >= 2 && e.state !== 'idle') { bossSay(e, 'More crew! Faster, ye lubbers!'); wave(); } });
  },
};
// Returns true when the boss used one of its phase moves instead of a normal attack.
const BOSS_AI = {
  boss_gagron(e) {
    const ph = e.phase || 1; e.flyN = (e.flyN || 0) + 1;
    if (ph >= 2 && e.flyN % 4 === 0) { gagronFly(e); return true; }
    if (ph === 3 && e.flyN % 4 === 2) { lavaRings(e); return true; }
    return false;
  },
  boss_crusher(e, toP) {
    const ph = e.phase || 1; e.flyN = (e.flyN || 0) + 1;
    if (ph === 3 && e.flyN % 4 === 0) { axeSpin(e); return true; }
    if (ph >= 2 && (toP > 4.5 || e.flyN % 3 === 1)) { boulder(e); return true; }
    return false;
  },
  boss_gloom(e) {
    const ph = e.phase || 1; e.flyN = (e.flyN || 0) + 1;
    if (ph >= 2 && e.flyN % 3 === 0) { gloomBlink(e); return true; }
    return false;
  },
  boss_rattle(e) {
    const ph = e.phase || 1; e.flyN = (e.flyN || 0) + 1;
    if (ph === 3 && e.flyN % 3 === 0) { anchorSweep(e); return true; }
    if (ph === 3) cannons(e);
    return false;
  },
};

// ---------- Chapter 2 bosses ----------
// Grumblefrost rolls giant snowballs down a line you can see coming.
function snowball(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  e.play('2H_Melee_Attack_Chop', { once: true, fade: 0.1 }) || e.play('1H_Melee_Attack_Chop', { once: true });
  const toward = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), len = 18;
  hazard({ x: e.pos.x, z: e.pos.z, R: len, dir: toward + Math.PI, half: 0.12, dur: 1.2, dmg: bossDmg(e, 1.6), col: '#e8f4ff' });
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshLambertMaterial({ color: '#f6fbff', flatShading: true }));
  const sx = e.pos.x, sz = e.pos.z; ball.position.set(sx, 1.4, sz); scene.add(ball);
  later(0.9, () => tween(0.7, (k) => { ball.position.set(sx + Math.sin(toward) * len * k, 1.4, sz + Math.cos(toward) * len * k); ball.rotation.x += 0.35; if (rng() < 0.5) burst(ball.position.clone().setY(0.4), '#ffffff', 3, 3, 0.5); },
    () => { scene.remove(ball); burst(ball.position.clone(), '#ffffff', 40, 7, 1.2); }));
  later(1.4, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}
// Queen Frostwhisker: icicles rain in phase 2, then a blizzard in phase 3. Stand by a lit brazier to stay warm.
function icicles(e) {
  e.play('Spellcasting', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
  for (let i = 0; i < 5; i++) later(i * 0.3, () => {
    if (e.hp <= 0 || player.dead) return;
    const a = rng() * 6.28, r = i === 0 ? 0 : 1.5 + rng() * 3.5;
    hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2.2, dur: 1.0, dmg: bossDmg(e, 1.1), col: '#9fe6ff' });
  });
}
function makeBraziers(e) {
  e.braziers = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, x = e.home.x + Math.cos(a) * 8, z = e.home.y + Math.sin(a) * 8;
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.45, 0.6, 10), new THREE.MeshLambertMaterial({ color: '#6a5a6a' })); bowl.position.y = 1.2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.0, 6), new THREE.MeshLambertMaterial({ color: '#4a3a4a' })); leg.position.y = 0.5;
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 8), new THREE.MeshBasicMaterial({ color: '#ffb347' })); fire.position.y = 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; glow.layers.set(1);
    g.add(bowl, leg, fire, glow); scene.add(g);
    e.braziers.push({ g, fire, x, z });
  }
  e.blizzard = true;
}
let chillAt = 0;
function blizzardTick(dt) {
  const q = enemies.find((e) => e.blizzard && e.hp > 0);
  const on = !!q && where === q.inside && !player.dead && Math.hypot(player.pos.x - q.pos.x, player.pos.z - q.pos.z) < 32;
  document.body.classList.toggle('blizzard', on);
  if (!q) return;
  for (const b of q.braziers) { b.fire.scale.setScalar(0.85 + 0.2 * Math.sin(now * 9 + b.x)); if (rng() < dt * 6) burst(new THREE.Vector3(b.x, 2.4, b.z), '#ffb347', 2, 2, 0.5); }
  if (!on) return;
  const warm = q.braziers.some((b) => Math.hypot(player.pos.x - b.x, player.pos.z - b.z) < 3.4);
  if (!warm && now > chillAt) { chillAt = now + 1.5; hurtPlayer(Math.max(2, Math.round(maxHp() * 0.04 * defDiv()))); floatText(player.pos.clone().setY(4.2), 'Brrr! Find a brazier!', 'miss'); }
  if (warm && rng() < dt * 3) burst(player.pos.clone().setY(1.5), '#ffd08a', 2, 2, 0.6);
}
function frostCleanup(e) {
  for (const b of e.braziers || []) scene.remove(b.g);
  e.braziers = null; e.blizzard = false; document.body.classList.remove('blizzard');
}
Object.assign(PHASE_LINES, {
  boss_grumble: ['Grumblefrost ROLL BIGGER!', 'Grumblefrost very cross now!'],
  boss_frost: ['Icicles, my darlings! Fall!', 'Then let the blizzard take you!'],
  boss_twin_a: ['Sleet! They hurt me!', 'Together, sister! Now!'],
  boss_twin_b: ['Hail! Are you alright?!', 'Together, brother! Now!'],
});
Object.assign(PHASE_SETUP, {
  boss_frost: (e, ph) => {
    if (ph === 2) for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, 'frost_minion', e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5); }
    if (ph === 3) makeBraziers(e);
  },
  boss_grumble: (e, ph) => { if (ph === 3) bossAdd(e, 'frost_warrior', e.pos.x + 4, e.pos.z); },
});
Object.assign(BOSS_AI, {
  boss_grumble(e, toP) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (e.flyN % (ph >= 2 ? 2 : 3) === 0 || toP > 5) { snowball(e); if (ph === 3) later(1.6, () => { if (e.hp > 0) snowball(e); }); return true; }
    return false;
  },
  boss_frost(e) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (ph >= 2 && e.flyN % 2 === 0) { icicles(e); return true; }
    return false;
  },
});
// the Thaw: Elder Mittens' last Chapter 2 job. Shadow wolves rush the cracked Wardstone at the palace.
function startThaw() {
  const P = LANDS.frost.zones.palace;
  toast('Defend the Wardstone! Shadow wolves are coming from every side.', ICONS.dark_omen, true);
  for (let w = 0; w < 3; w++) later(2 + w * 18, () => {
    if (S.quests.st_thaw.state !== 'active') return;
    toast(`Wave ${w + 1} of 3!`, ICONS.dark_omen);
    for (let i = 0; i < 4 + w; i++) {
      const a = (i / (4 + w)) * Math.PI * 2 + rng(), x = P.x + Math.cos(a) * 11, z = P.z + Math.sin(a) * 11;
      const m = spawnEnemy('thaw_shadow', x, z); m.temp = true; m.state = 'chase';
      burst(new THREE.Vector3(x, 1, z), '#5a3a8a', 30, 5, 1.2);
    }
  });
}

// ---------- Chapter 3 bosses ----------
// Mother Mire: poison puddles and slimes in phase 2, a rain of bubbling hexes in phase 3.
function mireHex(e) {
  e.play('Spellcasting', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
  for (let i = 0; i < 4; i++) later(i * 0.35, () => {
    if (e.hp <= 0 || player.dead) return;
    const a = rng() * 6.28, r = i === 0 ? 0 : 1.5 + rng() * 3;
    hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2.4, dur: 1.0, dmg: bossDmg(e, 1.1), col: '#8aff6a' });
  });
}
// Sir Soggington charges in a straight line you can see coming, then sloshes about with water rings.
function soggCharge(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  const dir = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), len = 14, sx = e.pos.x, sz = e.pos.z;
  hazard({ x: sx, z: sz, R: len, dir: dir + Math.PI, half: 0.14, dur: 1.0, dmg: bossDmg(e, 1.5), col: '#7fd0ff' });
  e.play('Running_A', { fade: 0.1 });
  later(0.9, () => tween(0.45, (k) => { if (e.hp <= 0) return; const [x, z] = nearHome(e, sx + Math.sin(dir) * len * k, sz + Math.cos(dir) * len * k); e.pos.x = x; e.pos.z = z; if (rng() < 0.6) burst(e.pos.clone().setY(0.4), '#bfe9ff', 3, 3, 0.5); },
    () => { if (e.hp > 0) { bossSay(e, 'Huff... puff... these boots are FULL.'); dizzy(e, 2); } }));
}
function soggRings(e) {
  e.state = 'slam'; e.play('2H_Melee_Attack_Chop', { once: true, fade: 0.1 });
  const x = e.pos.x, z = e.pos.z;
  for (let i = 0; i < 3; i++) later(0.3 + i * 0.75, () => { if (e.hp > 0) hazard({ x, z, R: 5 + i * 4, inner: 3.2 + i * 4, dur: 0.9, dmg: bossDmg(e, 1.3), col: '#7fd0ff' }); });
  later(2.8, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}
// The Gobbler: tongue lashes along a line; in phase 2 it dives and pops up under a lily pad;
// in phase 3 it tries to swallow you whole. Mash attack to wriggle out.
function tongueLash(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.1 });
  const dir = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), len = 15;
  hazard({ x: e.pos.x, z: e.pos.z, R: len, dir: dir + Math.PI, half: 0.1, dur: 0.9, dmg: bossDmg(e, 1.5), col: '#ff7aa8' });
  const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1, 10), new THREE.MeshLambertMaterial({ color: '#ff7aa8' }));
  tongue.rotation.set(Math.PI / 2, 0, 0); const holder = new THREE.Group(); holder.add(tongue); holder.position.set(e.pos.x, 1.6, e.pos.z); holder.rotation.y = dir; scene.add(holder);
  tongue.scale.set(1, 0.01, 1);
  later(0.85, () => tween(0.35, (k) => { const L = len * Math.sin(k * Math.PI); tongue.scale.y = Math.max(0.01, L); tongue.position.z = L / 2; }, () => scene.remove(holder)));
  later(1.4, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}
function mudSpit(e) {
  e.play('Spellcast_Shoot', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
  for (let i = 0; i < 3; i++) { const a = rng() * 6.28, r = i ? 2 + rng() * 2.5 : 0; hazard({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, R: 2, dur: 1.1, dmg: bossDmg(e, 0.9), col: '#a8845a' }); }
}
function gobblerDive(e) {
  e.state = 'slam'; e.under = true; sfx('whoosh');
  bossSay(e, 'Bloop!');
  const base = e.T.scale;
  tween(0.6, (k) => { e.root.scale.setScalar(base * (1 - k * 0.95)); e.root.position.y = -k * 1.5; });
  const [x, z] = nearHome(e, player.pos.x + (rng() - 0.5) * 4, player.pos.z + (rng() - 0.5) * 4, 12);
  for (let i = 0; i < 8; i++) later(0.5 + i * 0.2, () => burst(new THREE.Vector3(x + (rng() - 0.5) * 2, 0.3, z + (rng() - 0.5) * 2), '#bfffd8', 6, 3, 0.7));
  later(0.7, () => hazard({ x, z, R: 3.8, dur: 1.3, dmg: bossDmg(e, 1.6), col: '#8adfc0' }));
  later(2.0, () => {
    if (e.hp <= 0) return;
    e.pos.x = x; e.pos.z = z; e.under = false;
    tween(0.3, (k) => { e.root.scale.setScalar(base * (0.05 + k * 0.95)); e.root.position.y = -1.5 * (1 - k); }, () => { burst(e.pos.clone().setY(0.6), '#8adfc0', 50, 8, 1.3); if (e.hp > 0) dizzy(e, 2.6); });
  });
}
let gulped = null;
function gobblerGulp(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  const dir = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), x = e.pos.x + Math.sin(dir) * 3.5, z = e.pos.z + Math.cos(dir) * 3.5;
  bossSay(e, 'Open wiiide!');
  hazard({ x, z, R: 3.4, dur: 1.2, dmg: 0, col: '#ff7aa8' });
  e.play('Spellcasting', { once: true, fade: 0.1 });
  later(1.2, () => {
    if (e.hp <= 0 || player.dead || gulped) return;
    if (Math.hypot(player.pos.x - x, player.pos.z - z) > 3.4 || dodging()) { later(0.3, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } }); return; }
    // gulp!
    gulped = { e, taps: 0, until: now + 6, hurtAt: now + 0.8 };
    player.root.visible = false; moveTarget = null; cancelTask();
    sfx('slam'); toast('You got swallowed! Mash attack to wriggle out!', ICONS.star, true);
  });
}
function gulpTick() {
  if (!gulped) return;
  const g = gulped, e = g.e;
  player.pos.set(e.pos.x, 0, e.pos.z);
  if (rng() < 0.3) burst(e.pos.clone().setY(e.T.scale * 1.2), '#ff9ac0', 3, 3, 0.6);
  if (now > g.hurtAt) { g.hurtAt = now + 0.8; hurtPlayer(bossDmg(e, 0.35)); }
  if (player.dead || e.hp <= 0 || g.taps >= 8 || now > g.until) spitOut();
}
function wriggle() {
  if (!gulped) return false;
  gulped.taps++; floatText(gulped.e.pos.clone().setY(gulped.e.T.scale * 2), gulped.taps >= 8 ? 'Free!' : `Wriggle! ${gulped.taps}/8`, 'gain');
  if (gulped.e.hp > 0) hurtEnemy(gulped.e, Math.max(1, Math.round(heroDamage() * 0.6)));
  return true;
}
function spitOut() {
  const e = gulped.e; gulped = null;
  player.root.visible = true;
  const a = e.root.rotation.y; player.pos.set(e.pos.x + Math.sin(a) * 6, 0, e.pos.z + Math.cos(a) * 6); collide(player.pos);
  burst(player.pos.clone().setY(1), '#ff9ac0', 40, 7, 1.2);
  if (e.hp > 0) { bossSay(e, 'BLEUGH! You taste like armour!'); dizzy(e, 3.2); }
}
Object.assign(PHASE_LINES, {
  boss_mire: ['My pretties! Up from the mud!', 'Bubble, bubble, YOU\'RE in trouble!'],
  boss_sogg: ['A hundred years I waited! CHARGE!', 'The tide is coming IN!'],
  boss_gobbler: ['*gurgle* Hide-and-seek!', '*SLURP* Still hungry!'],
});
Object.assign(PHASE_SETUP, {
  boss_mire: (e, ph) => { if (ph === 2) for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, 'bog_slime', e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5); } },
  boss_gobbler: (e, ph) => { if (ph === 3) for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, 'mud_gloop', e.pos.x + Math.cos(a) * 7, e.pos.z + Math.sin(a) * 7); } },
});
Object.assign(BOSS_AI, {
  boss_mire(e) { e.flyN = (e.flyN || 0) + 1; if ((e.phase || 1) >= 3 && e.flyN % 2 === 0) { mireHex(e); return true; } return false; },
  boss_sogg(e, toP) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (ph >= 2 && (e.flyN % 3 === 1 || toP > 6)) { soggCharge(e); return true; }
    if (ph >= 3 && e.flyN % 3 === 2) { soggRings(e); return true; }
    return false;
  },
  boss_gobbler(e, toP) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (ph >= 3 && e.flyN % 3 === 0) { gobblerGulp(e); return true; }
    if (ph >= 2 && e.flyN % 3 === 1) { gobblerDive(e); return true; }
    if (e.flyN % 2 === 0 || toP > 5) { tongueLash(e); return true; }
    if (rng() < 0.4) { mudSpit(e); return true; }
    return false;
  },
});

// ---------- Lantern Night ----------
// Five lantern posts stand dark around the marsh. Walk up to each to light it; every flame wakes mud gloops.
const lanterns = [];
function makeLanterns() {
  if (lanterns.length) return;
  const L = LANDS.marsh, Z = L.zones, V = L.village;
  const spots = [[V.x - 14, V.z - 14], [Z.mire.x + 12, Z.mire.z + 10], [Z.ruins.x - 12, Z.ruins.z + 8], [Z.gobbler.x - 10, Z.gobbler.z + 16], [L.pond.x - 4, L.pond.z + 12]];
  for (const [x0, z0] of spots) {
    let x = x0, z = z0;
    for (let t = 0; t < 20 && !isFree(x, z, 1.2); t++) { x = x0 + (rng() - 0.5) * 6; z = z0 + (rng() - 0.5) * 6; }
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3, 8)); post.position.y = 1.5; registerMesh(post, toon('#5a3a22')); g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12)); arm.position.set(0.4, 2.9, 0); registerMesh(arm, toon('#5a3a22')); g.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10)); lamp.position.set(0.8, 2.45, 0); registerMesh(lamp, toon('#6a6a5a')); g.add(lamp);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(3, 28), new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0, depthWrite: false, fog: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; glow.layers.set(1); g.add(glow);
    addInk(g); scene.add(g); colliders.push({ x, z, r: 0.4 });
    lanterns.push({ g, lamp, glow, x, z, lit: false });
  }
}
function startLanternNight() {
  makeLanterns();
  for (const l of lanterns) setLantern(l, false);
  if (S.quests.st_lantern) { S.quests.st_lantern.lit = []; S.quests.st_lantern.lanterns = 0; }
  toast('Lantern Night! Light the five lantern posts around the marsh. Watch out for mud gloops!', ICONS.star, true);
}
function setLantern(l, on) {
  l.lit = on;
  l.lamp.userData.mats.toon.color.set(on ? '#ffd23f' : '#6a6a5a'); l.lamp.userData.mats.std.color.set(on ? '#ffd23f' : '#6a6a5a');
  for (const m of [l.lamp.userData.mats.toon, l.lamp.userData.mats.std]) if (m.emissive) m.emissive.set(on ? '#a86a00' : '#000000');
  l.glow.material.opacity = on ? 0.3 : 0;
}
function lanternTick(dt) {
  const st = S.quests.st_lantern;
  if (!st || where !== 'marsh' || !player || player.dead) { document.body.classList.remove('lanternnight'); return; }
  const active = st.state === 'active';
  document.body.classList.toggle('lanternnight', active && (st.lanterns || 0) < 5);
  if (!lanterns.length) { if (st.state === 'todo') return; makeLanterns(); lanterns.forEach((l, i) => setLantern(l, st.state === 'done' || (st.lanterns || 0) >= 5 || (st.lit || []).includes(i))); }
  for (const l of lanterns) {
    if (l.lit) { if (rng() < dt * 3) burst(new THREE.Vector3(l.x + 0.8, 2.6, l.z), '#ffcf6a', 2, 1.5, 0.6); continue; }
    if (!active) continue;
    if (Math.hypot(player.pos.x - l.x, player.pos.z - l.z) < 2.4) {
      setLantern(l, true); st.lanterns = (st.lanterns || 0) + 1; st.lit = [...(st.lit || []), lanterns.indexOf(l)]; sfx('win');
      burst(new THREE.Vector3(l.x + 0.8, 2.5, l.z), '#ffd23f', 40, 6, 1.2);
      toast(`Lantern lit! ${st.lanterns} of 5.`, ICONS.star);
      for (let i = 0; i < 2; i++) { const a = rng() * 6.28, m = spawnEnemy('mud_gloop', l.x + Math.cos(a) * 6, l.z + Math.sin(a) * 6); m.temp = true; m.state = 'chase'; burst(m.pos.clone().setY(0.5), '#9a7a52', 20, 4); }
      if (st.lanterns >= 5) toast('All five lanterns are lit! Go back to Mayor Croakley.', ICONS.star, true);
      refreshUI(); save();
    }
  }
}

// ---------- Light or Dark: the path choice ----------
const PATHS = {
  vampire: { name: 'Vampire', icon: 'fang', blurb: 'Take in the dark half. +12% damage, +6% speed, and you heal twice as fast. Little fangs, bat wings and a high dark collar (keep any eye colour you like).' },
  angel: { name: 'Angel', icon: 'halo', blurb: 'Take in the light half. +15% defense. A soft glowing halo and little feathered wings.' },
  human: { name: 'Human', icon: 'human', blurb: 'Touch neither. +15% max health. The villagers will call you "the stubborn one".' },
};
const PATH_UNDO = 5000;
// paths and gadgets both nudge your stats; Sunsteel burns 15% hotter in daylight
const sunBoost = () => (W().sun && env.preset !== 'night' && (where === 'out' || LANDS[where]) ? 1.15 : 1);
const pathDmg = () => (S.path === 'vampire' ? 1.12 : 1) * gadgetMult('dmg') * sunBoost();
const pathSpeed = () => (S.path === 'vampire' ? 1.06 : 1) * gadgetMult('speed');
const pathDef = () => (S.path === 'angel' ? 1.15 : 1) * gadgetMult('def');
const pathHp = () => (S.path === 'human' ? 1.15 : 1) * gadgetMult('hp');
function openPathChoice(npc) {
  const d = $('dialog'); talking = npc || null;
  d.innerHTML = `<h3>The Marsh Wardstone</h3><p>The two halves hum in your hands. One is black as a moonless bog, one is white as a lily. A whisper rises from the dark half: <i>"He chose dark too, once. Long ago, when he was only a man..."</i></p>
    <div class="paths">${Object.entries(PATHS).map(([k, P]) => `<button class="pathpick" data-path="${k}"><img src="${ICONS[P.icon]}" alt=""><b>${P.name}</b><span>${P.blurb}</span></button>`).join('')}</div>
    <p class="hint">Old Fenwick in Jerry Valley can undo your choice later for ${fmt(PATH_UNDO)} coins.</p><div class="row"><button id="pthink">Let me think</button></div>`;
  d.querySelectorAll('[data-path]').forEach((b) => { b.onclick = () => choosePath(b.dataset.path); });
  $('pthink').onclick = closeDialog;
  showDialog(d);
}
function choosePath(k) {
  S.path = k; S.repick = false; closeDialog();
  const st = S.quests.st_choice; if (st && st.state === 'active') st.choice = 1;
  const P = PATHS[k];
  burst(player.pos.clone().setY(2), k === 'vampire' ? '#c8243a' : k === 'angel' ? '#fff2a0' : '#9fd8ff', 90, 8, 1.6); sfx('win');
  const el = $('banner'); el.textContent = `You are now: ${P.name}!`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (k === 'vampire') queueLetter('path_vampire');
  rebuildHero(); refreshUI(); save();
}
// fangs, red eyes, a halo and wings: built on the hero (and on other players) from their path
// Vampires get folded bat wings with a blood-red lining, a tall dark collar and a faint crimson mist.
const batWingGeo = (() => {
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.95, 0.5); sh.lineTo(0.85, 0.12); sh.quadraticCurveTo(0.72, -0.02, 0.62, -0.18);
  sh.quadraticCurveTo(0.5, -0.05, 0.4, -0.22); sh.quadraticCurveTo(0.28, -0.08, 0.16, -0.2); sh.lineTo(0, 0);
  return new THREE.ShapeGeometry(sh, 6);
})();
function vampDecor(a) {
  let head = null, chest = null;
  a.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; if (o.isBone && o.name === 'chest') chest = o; });
  const outer = toon('#2a1830'), inner = toon('#8a1424', { emissive: '#2a0006' });
  for (const m of [outer, inner]) for (const k of ['std', 'toon']) m[k].side = THREE.DoubleSide;
  if (chest) for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    const o = new THREE.Mesh(batWingGeo); registerMesh(o, outer); o.scale.set(sx * 0.62, 0.62, 1);
    const i = new THREE.Mesh(batWingGeo); registerMesh(i, inner); i.scale.set(sx * 0.5, 0.5, 1); i.position.set(sx * 0.04, 0.03, -0.01);
    w.add(o, i); w.position.set(sx * 0.14, 0.3, -0.34); w.rotation.set(0.15, sx * 0.55, sx * 0.1); w.userData.bat = sx;
    chest.add(w); a.pathDecor.push(w);
  }
  if (head && a.headInfo) {
    // a high collar that flares up behind the jaw
    const H = a.headInfo, y = H.box.min.y + 0.02;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.3, 0.4, 20, 1, true, Math.PI * 0.42, Math.PI * 1.16)); registerMesh(col, outer);
    col.position.set(0, y + 0.08, -0.04); col.rotation.x = -0.12; head.add(col); a.pathDecor.push(col);
    const lin = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.28, 0.38, 20, 1, true, Math.PI * 0.44, Math.PI * 1.12)); registerMesh(lin, inner);
    lin.position.copy(col.position); lin.rotation.copy(col.rotation); head.add(lin); a.pathDecor.push(lin);
  }
  for (const o of a.pathDecor) addInk(o);
}
function pathDecor(a, path) {
  if (a.pathDecor) { for (const o of a.pathDecor) o.removeFromParent(); }
  a.pathDecor = [];
  if (path === 'vampire') { vampDecor(a); return; }
  if (path !== 'angel') return;
  let head = null, chest = null;
  a.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; if (o.isBone && o.name === 'chest') chest = o; });
  const H = a.headInfo, hy = H ? H.box.max.y + 0.32 : 1.4;
  const gold = toon('#ffe27a', { emissive: '#8a6a10' });
  if (head) { const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 32)); registerMesh(halo, gold); halo.rotation.x = Math.PI / 2; halo.position.y = hy; head.add(halo); a.pathDecor.push(halo); }
  if (chest) {
    const wingMat = toon('#ffffff');
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      for (const [i, len] of [[0, 0.7], [1, 0.55], [2, 0.42]].entries()) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, len[1], 4, 8)); registerMesh(f, wingMat); f.position.set(sx * (0.18 + i * 0.07), 0.1 - i * 0.12, 0); f.rotation.z = sx * (1.0 + i * 0.25); w.add(f); }
      w.position.set(sx * 0.2, 0.25, -0.32); w.rotation.y = -sx * 0.5; chest.add(w); a.pathDecor.push(w);
    }
  }
  for (const o of a.pathDecor) addInk(o);
}
const pathLook = (L, path) => (path === 'vampire' ? { ...L, mouth: 'fang' } : L); // vampires keep whatever eye colour they chose
function wingTick() {
  if (!player || !player.pathDecor) return;
  for (const w of player.pathDecor) if (w.isGroup) {
    if (w.userData.bat) { w.rotation.y = w.userData.bat * (0.55 + Math.sin(now * 2.2) * 0.12); if (rng() < 0.02) burst(player.pos.clone().setY(0.4 + rng()), '#b0203a', 1, 0.8); }
    else w.rotation.z = Math.sin(now * 3) * 0.12 * Math.sign(w.position.x);
  }
}
// Sir Soggington dries out in Lilypad Landing once he's beaten, and drills the tadpoles.
let soggFriend = null;
function makeSoggFriend() {
  if (soggFriend || !S.soggFree) return;
  const V = LANDS.marsh.village;
  soggFriend = { id: 'sogg_pal', name: 'Sir Soggington (drying off)', model: 'knight', x: V.x + 3, z: V.z - 6, hide: [], tint: '#9ab0a0', inside: 'marsh',
    look: { skin: 'blue', eyes: 'grey', eyeStyle: 'sleepy', mouth: 'smile', hair: 'none', beard: 'full', hairCol: 'green', hat: true },
    lines: ['A hundred years under the bog! My socks will never be the same.', 'That witch woke me up and pointed me at you. I am terribly sorry. I was very damp and confused.', 'The Wardstone went down the Gobbler\'s gullet the night it cracked. I saw it with my own soggy eyes.', 'Keep your shield up and your boots dry, young hero. Mostly the boots.'] };
  soggFriend = makeNpc(soggFriend);
}

// ===================== Chapter 4: Brassbolt Sands =====================
// The Sphinx Engine asks three riddles. Wrong answers wake its clockwork guards.
const RIDDLES = [
  ['I have hands but cannot clap, a face but cannot smile. What am I?', ['A clock', 'A statue', 'A scarecrow'], 0],
  ['The more you take, the more you leave behind. What are they?', ['Coins', 'Footsteps', 'Biscuits'], 1],
  ['What has teeth but never bites?', ['A gear', 'A dragon', 'A goose'], 0],
  ['What gets wetter the more it dries?', ['The sea', 'A towel', 'A sandcastle'], 1],
  ['I am full of holes but I still hold water. What am I?', ['A bucket', 'A sponge', 'A cloud'], 1],
  ['What can run but never walks, has a mouth but never talks?', ['A river', 'A rumour', 'A clockwork dog'], 0],
  ['The poor have it, the rich need it, and if you eat it you die. What is it?', ['Gold', 'Nothing', 'Sand'], 1],
  ['What goes up but never comes down?', ['A kite', 'Your age', 'The Colossus'], 1],
];
const riddleGuards = [];
function openRiddle(npc) {
  for (let k = riddleGuards.length - 1; k >= 0; k--) if (!enemies.includes(riddleGuards[k]) || riddleGuards[k].state === 'dead') riddleGuards.splice(k, 1);
  talking = npc;
  const st = S.quests.st_sphinx, d = $('dialog');
  const say = (text, btns) => {
    d.innerHTML = '<h3></h3><p></p><div class="row"></div>';
    d.querySelector('h3').textContent = npc.name; d.querySelector('p').textContent = text;
    for (const [label, cls, fn] of btns) { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; d.querySelector('.row').appendChild(b); }
    showDialog(d, { talky: true });
  };
  if (!st || st.state !== 'active') {
    say(st && st.state === 'done' ? 'Click, whirr. Riddler recognised. You may pass, clever one.' : 'Click, whirr. The Sphinx Engine is not taking questions today. Come back with Professor Tinkerwell\'s permission.', [['Goodbye', '', closeDialog]]);
    return;
  }
  if ((st.riddles || 0) >= 3) { say('Three riddles answered! The desert Wardstone was carried to the Colossus. It beats in its chest. Go and tell the Professor.', [['Goodbye', '', closeDialog]]); return; }
  if (riddleGuards.some((m) => m.state !== 'dead' && enemies.includes(m))) { say('Intruder alarm still on! Beat my guards first.', [['Goodbye', '', closeDialog]]); return; }
  const used = st.used || [], pool = RIDDLES.map((r, i) => i).filter((i) => !used.includes(i));
  if (st.cur == null || !pool.includes(st.cur)) st.cur = pool[Math.floor(rng() * pool.length)];
  const i = st.cur, [q, opts, right] = RIDDLES[i];
  say(`Riddle ${(st.riddles || 0) + 1} of 3. ${q}`, opts.map((o, k) => [o, 'primary', () => {
    st.used = [...used, i]; st.cur = null;
    if (k === right) {
      st.riddles = (st.riddles || 0) + 1; sfx('win'); burst(npc.actor.pos.clone().setY(3), '#7fe8ff', 40, 6, 1.2);
      toast(`Correct! ${st.riddles} of 3 riddles.`, ICONS.sphinx_coin);
      if (st.riddles >= 3) { addItem('sphinx_coin'); toast('The Sphinx Engine gives you a Sphinx coin!', ICONS.sphinx_coin, true); }
      save(); refreshUI(); openRiddle(npc);
    } else {
      sfx('slam'); closeDialog();
      toast('Wrong! Intruder alarm! (Beat the guards, then try another riddle.)', ICONS.dark_omen, true);
      for (let j = 0; j < 2; j++) { const a = rng() * 6.28, m = spawnEnemy(j ? 'clock_conjurer' : 'clock_soldier', npc.actor.pos.x + Math.cos(a) * 6, npc.actor.pos.z + 4 + Math.sin(a) * 4); m.temp = true; m.state = 'chase'; riddleGuards.push(m); burst(m.pos.clone().setY(1), '#ffd27a', 30, 5, 1.2); }
      if (st.used.length >= RIDDLES.length) st.used = [];
      save();
    }
  }]));
}

// The sandstorm: four caravan crates lie scattered in the dust. Dust bats swoop when you grab one.
const crates = [];
function makeCrates() {
  if (crates.length) return;
  const L = LANDS.sands, Z = L.zones, V = L.village;
  const spots = [[V.x - 22, V.z - 12], [Z.sphinx.x + 14, Z.sphinx.z + 16], [Z.workshop.x - 14, Z.workshop.z + 14], [V.x + 24, V.z - 20]];
  for (const [x0, z0] of spots) {
    let x = x0, z = z0;
    for (let t = 0; t < 20 && !isFree(x, z, 1.2); t++) { x = x0 + (rng() - 0.5) * 6; z = z0 + (rng() - 0.5) * 6; }
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1)); box.position.y = 0.45; box.rotation.y = rng() * 3; registerMesh(box, toon('#c8884a')); g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.16, 1.14)); band.position.y = 0.45; band.rotation.y = box.rotation.y; registerMesh(band, toon('#6a3a1a')); g.add(band);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 14, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.35, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    beam.position.y = 7; beam.layers.set(1); g.add(beam);
    addInk(g); scene.add(g);
    crates.push({ g, x, z, got: false });
  }
}
function startSandstorm() {
  makeCrates();
  for (const c of crates) { c.got = false; c.g.visible = true; }
  if (S.quests.st_storm) { S.quests.st_storm.got = []; S.quests.st_storm.crates = 0; }
  toast('Sandstorm! Find the four lost caravan crates. Follow the golden beams!', ICONS.crate, true);
}
let storm = null;
function makeStorm() {
  const N = 600, geo = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 70; p[i * 3 + 1] = Math.random() * 12; p[i * 3 + 2] = (Math.random() - 0.5) * 70; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8c890', size: 0.3, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
  pts.frustumCulled = false; pts.layers.set(1); scene.add(pts);
  return pts;
}
function stormTick(dt) {
  const st = S.quests.st_storm;
  const on = !!st && st.state === 'active' && where === 'sands' && (st.crates || 0) < 4 && !player.dead;
  document.body.classList.toggle('sandstorm', on);
  if (on && !storm) storm = makeStorm();
  if (storm) {
    storm.visible = on;
    if (on) {
      const a = storm.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) { let x = a.getX(i) + dt * (14 + (i % 7)); if (x > 35) x -= 70; a.setX(i, x); a.setY(i, (a.getY(i) + Math.sin(now * 2 + i) * dt * 0.6 + 12) % 12); }
      a.needsUpdate = true; storm.position.set(player.pos.x, 0, player.pos.z);
    }
  }
  if (!st || where !== 'sands') return;
  if (!crates.length) { if (st.state !== 'active') return; makeCrates(); crates.forEach((c, i) => { c.got = (st.got || []).includes(i); }); }
  for (const c of crates) {
    c.g.visible = st.state === 'active' && !c.got && (st.crates || 0) < 4;
    if (!c.g.visible) continue;
    c.g.children[2].material.opacity = 0.25 + Math.sin(now * 3) * 0.1;
    if (Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 2.2) {
      c.got = true; st.crates = (st.crates || 0) + 1; st.got = [...(st.got || []), crates.indexOf(c)]; sfx('coin');
      burst(new THREE.Vector3(c.x, 1, c.z), '#ffe27a', 40, 6, 1.2);
      toast(`Crate found! ${st.crates} of 4.`, ICONS.crate);
      for (let i = 0; i < 2; i++) { const a = rng() * 6.28, m = spawnEnemy(i ? 'sand_gloop' : 'dust_bat', c.x + Math.cos(a) * 7, c.z + Math.sin(a) * 7); m.temp = true; m.state = 'chase'; }
      if (st.crates >= 4) toast('All four crates! Take them back to Professor Tinkerwell.', ICONS.crate, true);
      refreshUI(); save();
    }
  }
}

// After the Colossus falls, the Dark King's Floating Castle rises over the northern dunes.
function castleTick(dt) {
  const fc = SANDS_FX.castle; if (!fc) return;
  const col = S.quests.st_colossus, cq = S.quests.st_castle;
  const risen = !!col && (col.state === 'done' || (col.state === 'active' && questReady('st_colossus')));
  fc.visible = risen && where === 'sands';
  if (!fc.visible) return;
  fc.position.y = 15 + Math.sin(now * 0.6) * 1.2; fc.rotation.y += dt * 0.05;
  if (rng() < dt * 4) burst(fc.position.clone().add(new THREE.Vector3((rng() - 0.5) * 20, -6, (rng() - 0.5) * 20)), '#c85aff', 4, 3, 1);
  if (cq && cq.state === 'active' && !cq.castle) {
    const P = LANDS.sands.lookout;
    if (Math.hypot(player.pos.x - P.x, player.pos.z - P.z) < 6) {
      cq.castle = 1; sfx('bossintro'); save(); refreshUI();
      toast('The Floating Castle! Purple lights flicker in its towers...', ICONS.dark_omen, true);
      camMoment = { t: 0, dur: 4.5, target: fc.position };
      later(4.8, () => queueLetter('st_castle'));
    }
  }
}

// Sir Percival Pompington, in Professor Tinkerwell's stolen battle-suit.
ENEMY_TYPES.boss_pomp.look = { skin: 'porcelain', eyes: 'blue', eyeStyle: 'sleepy', mouth: 'grin', hair: 'swept', hairCol: 'blonde', head: 'big', beard: 'none' };
function rocketDash(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  const dir = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z), len = 16, sx = e.pos.x, sz = e.pos.z;
  bossSay(e, 'Rocket boots, ENGAGE!');
  hazard({ x: sx, z: sz, R: len, dir: dir + Math.PI, half: 0.15, dur: 0.9, dmg: bossDmg(e, 1.5), col: '#ffb347' });
  e.play('Running_A', { fade: 0.1 });
  later(0.9, () => tween(0.35, (k) => { if (e.hp <= 0) return; const [x, z] = nearHome(e, sx + Math.sin(dir) * len * k, sz + Math.cos(dir) * len * k); e.pos.x = x; e.pos.z = z; burst(e.pos.clone().setY(1), '#ff8a3a', 4, 3, 0.5); },
    () => { if (e.hp > 0) { if (rng() < 0.5) bossSay(e, 'Whoops! Who designed these brakes?!'); dizzy(e, 1.8); } }));
}
function missileVolley(e) {
  e.play('Spellcast_Shoot', { once: true, fade: 0.1, onFinish: () => e.play('Idle_Combat') });
  bossSay(e, rng() < 0.5 ? 'Behold! Pompington Patented Pop-Rockets!' : 'Fire ze fireworks!');
  const n = e.phase >= 3 ? 7 : 5;
  for (let i = 0; i < n; i++) later(0.15 + i * 0.22, () => {
    if (e.hp <= 0 || player.dead) return;
    const a = rng() * 6.28, r = i === 0 ? 0 : 2 + rng() * 4, x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
    burst(new THREE.Vector3(e.pos.x, 4, e.pos.z), '#ffcf6a', 6, 4, 0.6);
    hazard({ x, z, R: 2.1, dur: 1.0, dmg: bossDmg(e, 1.0), col: '#ff8a3a' });
  });
}
function gloryBeam(e) {
  e.state = 'slam'; e.play('Spellcasting', { once: true, fade: 0.1 });
  bossSay(e, 'Witness my GLORY BEAM!');
  const base = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  for (let i = 0; i < 4; i++) later(i * 0.45, () => { if (e.hp > 0) hazard({ x: e.pos.x, z: e.pos.z, R: 14, dir: base + Math.PI + i * (Math.PI / 2), half: 0.32, dur: 1.0, dmg: bossDmg(e, 1.4), col: '#fff27a' }); });
  later(2.6, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}

// The Brassbolt Colossus: fist slams leave its gear exposed, knee lasers sweep the plaza
// (jump them, or short it out on a glowing pressure plate), and in the end its core opens.
function colossusFist(e) {
  e.face(player.pos.x, player.pos.z); e.state = 'slam';
  e.play('2H_Melee_Attack_Chop', { once: true, fade: 0.1 });
  const x = player.pos.x, z = player.pos.z;
  hazard({ x, z, R: 3.8, dur: 1.3, dmg: bossDmg(e, 1.5), col: '#ffb347' });
  later(1.3, () => {
    if (e.hp <= 0) return;
    burst(new THREE.Vector3(x, 0.5, z), '#e8c890', 50, 8, 1.4); sfx('slam');
    // the fist sticks in the sand: the elbow gear pops loose
    bossSay(e, 'CLUNK. FIST. STUCK.');
    weakGear(e, true); dizzy(e, 3.2);
    later(3.2, () => weakGear(e, false));
  });
}
function weakGear(e, on) {
  if (!e.gearFx) {
    const g = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 8, 12), new THREE.MeshBasicMaterial({ color: '#ffe27a', fog: false }));
    g.layers.set(1); scene.add(g); e.gearFx = g;
  }
  e.gearFx.visible = on;
}
function kneeLaser(e) {
  e.state = 'slam'; e.play('Spellcasting', { once: true, fade: 0.1 });
  bossSay(e, 'KNEE. LASER. CHARGING.');
  toast('Its knees are glowing! Jump the laser (Space) or stand on a glowing plate!', ICONS.star);
  const x = e.pos.x, z = e.pos.z;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff3a5a', transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.6, z); ring.layers.set(1); ring.visible = false; scene.add(ring);
  let hit = false;
  later(1.1, () => tween(1.7, (k) => {
    if (e.hp <= 0) { ring.visible = false; return; }
    const r = 2 + k * 22; ring.visible = true; ring.scale.setScalar(r);
    const d = Math.hypot(player.pos.x - x, player.pos.z - z);
    if (!hit && Math.abs(d - r) < 0.9 && player.pos.y < 0.7 && !player.dead) { hit = true; hurtPlayer(bossDmg(e, 1.4)); floatText(player.pos.clone().setY(4), 'Zapped! Jump next time!', 'miss'); }
  }, () => scene.remove(ring)));
  later(3, () => { if (e.hp > 0 && e.state === 'slam') { e.state = 'chase'; e.play('Idle_Combat'); } });
}
function makePlates(e) {
  e.plates = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5, x = e.home.x + Math.cos(a) * 9, z = e.home.y + Math.sin(a) * 9;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.18, 20)); m.position.set(x, 0.09, z); registerMesh(m, toon('#7fe8ff', { emissive: '#2a8ab0' })); scene.add(m);
    e.plates.push({ m, x, z, readyAt: 0 });
  }
}
function colossusTick(dt) {
  const e = enemies.find((q) => q.type === 'boss_colossus' && q.hp > 0 && q.state !== 'idle');
  if (!e) return;
  if (e.gearFx && e.gearFx.visible) { e.gearFx.position.copy(e.pos).setY((e.T.scale || 5) * 1.5); e.gearFx.rotation.z += dt * 4; e.gearFx.lookAt(camera.position); }
  if (e.core) { e.core.position.copy(e.pos).setY((e.T.scale || 5) * 1.25); e.core.scale.setScalar(1 + Math.sin(now * 6) * 0.12); }
  for (const p of e.plates || []) {
    const ready = now >= p.readyAt;
    for (const m of [p.m.userData.mats.toon, p.m.userData.mats.std]) { m.color.set(ready ? '#7fe8ff' : '#6a5a4a'); if (m.emissive) m.emissive.set(ready ? '#2a8ab0' : '#000000'); }
    if (ready && !player.air && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 1.5) {
      p.readyAt = now + 16; sfx('special');
      burst(new THREE.Vector3(p.x, 0.6, p.z), '#7fe8ff', 50, 7, 1.3);
      bossSay(e, 'BZZT. SHORT. CIRCUIT.'); weakGear(e, true); dizzy(e, 3.5); later(3.5, () => weakGear(e, false));
    }
  }
}
function sandsCleanup(e) {
  for (const p of e.plates || []) scene.remove(p.m);
  e.plates = null;
  if (e.core) { scene.remove(e.core); e.core = null; }
  e.coreOpen = false;
  if (e.gearFx) e.gearFx.visible = false;
}
Object.assign(PHASE_LINES, {
  boss_pomp: ['Overdrive! Let us see you handle THIS!', 'Maximum GLORY! Maximum SHINE!'],
  boss_colossus: ['PLATING. DAMAGED. ENGAGING. LASERS.', 'CORE. EXPOSED. THIS. IS. FINE.'],
});
Object.assign(PHASE_SETUP, {
  boss_pomp: (e, ph) => { if (ph === 2) for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, 'clock_soldier', e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5); } },
  boss_colossus: (e, ph) => {
    if (ph === 2) makePlates(e);
    if (ph === 3) {
      e.coreOpen = true;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 14), new THREE.MeshBasicMaterial({ color: '#7fe8ff', fog: false })); c.layers.set(1); scene.add(c); e.core = c;
      for (let i = 0; i < 2; i++) { const a = i * 3.14 + rng(); bossAdd(e, i ? 'clock_conjurer' : 'clock_soldier', e.pos.x + Math.cos(a) * 7, e.pos.z + Math.sin(a) * 7); }
    }
  },
});
Object.assign(BOSS_AI, {
  boss_pomp(e, toP) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (ph >= 3 && e.flyN % 3 === 0) { gloryBeam(e); return true; }
    if (ph >= 2 && e.flyN % 3 === 1) { missileVolley(e); return true; }
    if (toP > 7 || e.flyN % 4 === 2) { rocketDash(e); return true; }
    return false;
  },
  boss_colossus(e, toP) {
    e.flyN = (e.flyN || 0) + 1; const ph = e.phase || 1;
    if (ph >= 2 && e.flyN % 3 === 0) { kneeLaser(e); return true; }
    if (e.flyN % 2 === 1 || toP > 5) { colossusFist(e); return true; }
    return false;
  },
});
// Pompington, beaten and sorry, polishes pots at Oasis Rest.
let pompFriend = null;
function makePompFriend() {
  if (pompFriend || !S.pompFree) return;
  const V = LANDS.sands.village;
  pompFriend = makeNpc({ id: 'pomp_pal', name: 'Sir Percival Pompington (sorry)', model: 'knight', x: V.x + 4, z: V.z - 6, hide: ['Knight_Helmet'], tint: '#ffe28a', inside: 'sands',
    look: { ...ENEMY_TYPES.boss_pomp.look, mouth: 'calm', eyeStyle: 'sleepy' },
    lines: ['I am polishing these pots to say sorry. They have never been shinier. Neither have I, frankly.', 'The Dark King said I would be the most famous knight in history. Then he called me "the shiny one" and stopped writing back.', 'I may have taken credit for one or two of your victories. Or six. I have written you a very long apology. It is mostly about me.', 'If you see the Floating Castle, do mind the moat. It is made of clouds. Nobody can swim in clouds.'] });
}
// Your path changes how Brassbolt greets you
function pathArrive() {
  if (where !== 'sands' || !S.path || (S.pathGift || {})[S.path]) return;
  S.pathGift = { ...(S.pathGift || {}), [S.path]: 1 };
  if (S.path === 'vampire') queueLetter('path_vamp_recruit');
  if (S.path === 'angel') queueLetter('vision_angel');
  if (S.path === 'human') later(1.5, () => {
    if (!S.owned.includes('g_heart')) S.owned.push('g_heart');
    toast('Professor Tinkerwell gave you a Clockwork heart gadget! (Stubborn humans need all the help they can get.) Equip it from your bag.', ICONS.gadget, true);
    save();
  });
  save();
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
      const e = s2.e; sfx('slam');
      burst(e.pos.clone().setY(0.5), '#ffd08a', 60, 9, 1.4);
      shake = 0.5;
      if (e.hp > 0 && !player.dead && where === e.inside && Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z) < s2.R) {
        if (dodging()) floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss');
        else hurtPlayer(bossDmg(e, 1.6));
      }
      if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); if (e.T.stuck) { bossSay(e, e.T.stuckLine || 'Stuck!'); dizzy(e, e.T.stuck); } }
      scene.remove(s2.m, s2.edge); slams.splice(i, 1);
    }
  }
}
let shake = 0;
function enemyTick(e, dt) {
  const ep = e.pos;
  knockTick(e, dt);
  if (e.state === 'dead' || e.state === 'rising' || e.state === 'gone') return;
  if (e.poison && now > e.poison.at && e.hp > 0) {
    const P = e.poison; P.at = now + 1; poisonHit = true; hurtEnemy(e, P.dmg, e.pos, 0); poisonHit = false;
    burst(e.pos.clone().setY(1.6), '#8aff6a', 8, 2, 0.7); if (--P.left <= 0) e.poison = null;
  }
  if (now < e.staggerUntil && e.state !== 'slam') return;
  if (now < (e.dizzyUntil || 0)) { dizzyTick(e, dt); return; }
  if (goldenRun(e, dt)) return;
  // a crew member who hit it gets its attention instead of you
  let foe = e.foe;
  if (foe && (e.T.boss || !crewUp(foe) || foe.inside !== e.inside || Math.hypot(foe.pos.x - ep.x, foe.pos.z - ep.z) > 12)) foe = e.foe = null;
  const tp = foe ? foe.pos : player.pos;
  const toP = Math.hypot(tp.x - ep.x, tp.z - ep.z), toHero = Math.hypot(player.pos.x - ep.x, player.pos.z - ep.z);
  const fromHome = Math.hypot(ep.x - e.home.x, ep.z - e.home.y);
  const big = e.T.boss, reach = e.T.ranged ? (big ? 10 : 8) : big ? 3.6 : 2.4;
  if (player.dead && (e.state === 'chase') && !foe) e.state = 'return';
  if (where !== e.inside && e.state === 'chase' && !foe) e.state = 'return';
  if ((e.state === 'idle' || e.state === 'walk') && foe) e.state = 'chase';
  if ((e.state === 'idle' || e.state === 'walk') && toHero < (big ? 11 : 6.5) && !player.dead && !uiLock() && where === e.inside
    && (!big || !otherBossBusy(e)) && (big || enemies.filter((o) => o.state === 'chase' && !o.T.boss).length < 3)) e.state = 'chase';
  if (e.state === 'slam') return;
  if (e.state === 'chase') {
    if (fromHome > (big ? bossLeash(e) : 20)) { e.state = 'return'; return; }
    e.face(tp.x, tp.z);
    if (big && !foe && !e.T.world && toHero < 30 && now > (e.nextSpecial ??= now + 3) && now > (e.dizzyUntil || 0) && now > (e.staggerUntil || 0) && bossSpecial(e)) return;
    if (toP > reach) {
      const dx = tp.x - ep.x, dz = tp.z - ep.z;
      ep.x += (dx / toP) * 4.2 * dt; ep.z += (dz / toP) * 4.2 * dt;
      if (e.name !== '1H_Melee_Attack_Chop' && e.name !== 'Spellcast_Shoot' && e.name !== 'Hit_A') e.play('Running_A', { fade: 0.15 });
    } else if (now > e.nextHit) {
      e.nextHit = now + (big ? 1.5 : 1.9) + rng() * 0.6;
      const dmg = big ? bossDmg(e, 0.65 + rng() * 0.45) : rng() < 0.3 ? 0 : 1 + Math.floor(rng() * e.T.maxHit);
      if (BOSS_AI[e.type] && BOSS_AI[e.type](e, toP)) return;
      if (e.T.dragon) { dragonAttack(e, toP); return; }
      if (big && ++e.swings % 3 === 0) { bossSlam(e); return; }
      if (e.T.ranged) {
        e.play('Spellcast_Shoot', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        const tgt = foe;
        later(0.35, () => {
          if (e.hp <= 0 || (tgt ? !crewUp(tgt) : player.dead)) return;
          const tq = tgt ? tgt.pos : player.pos;
          const dir = new THREE.Vector3(tq.x - ep.x, 0, tq.z - ep.z);
          const spreads = e.T.spread ? [-0.3, 0, 0.3] : [0];
          for (const sp of spreads) {
            const d2 = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sp);
            shoot(ep.clone().setY(big ? 3 : 1.8).addScaledVector(d2.clone().normalize(), big ? 1.4 : 0.6), d2, 'dark', big ? 15 : 12, 'enemy', () => (tgt ? hurtCrew(tgt, dmg, e) : hurtPlayer(dmg)));
            if (tgt) projectiles[projectiles.length - 1].tgt = tgt;
          }
        });
      } else {
        e.play('1H_Melee_Attack_Chop', { once: true, fade: 0.08, onFinish: () => e.play('Idle_Combat') });
        const tgt = foe;
        later(0.4, () => {
          const tq = tgt ? tgt.pos : player.pos;
          if (e.hp <= 0 || Math.hypot(tq.x - ep.x, tq.z - ep.z) >= reach + 1) return;
          if (tgt) { hurtCrew(tgt, dmg, e); return; }
          if (dodging()) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; }
          hurtPlayer(dmg);
        });
      }
    } else if (e.name === 'Running_A' || e.name === 'Idle' || e.name === 'Walking_A') e.play('Idle_Combat');
    pushOut(ep, big ? 1.3 : 0.6);
  } else if (e.state === 'return') {
    const dx = e.home.x - ep.x, dz = e.home.y - ep.z, d = Math.hypot(dx, dz);
    if (d < 0.5 && e.temp && !e.boss && !e.T.boss) { e.state = 'gone'; e.hp = 0; e.bar.hidden = true; burst(ep.clone().setY(1), '#d8d0ff', 16, 3); e.root.visible = false; later(1, () => removeEnemy(e)); return; }
    if (d < 0.5) { e.state = 'idle'; e.hp = e.T.hp; e.swings = 0; e.play('Idle'); if (e.T.boss) bossCleanup(e, true); }
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
const PLACES = [['Village', 0, -4], ['Skeleton camp', CAMP.x, CAMP.z + 9], ['Mine', MINE.x, MINE.z - 9], ['Castle', 4, -54], ['Ship', VALLEY_DOCK.x + 8, VALLEY_DOCK.z - 9], ...Object.values(ZONES).map((Z) => [Z.name, Z.x, Z.z - Z.r * 0.55]), ...TOWNS.map((T) => [T.name, T.x, T.z - 9])];
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
  // Paint the map like a game board: flat land colours, fat cream roads, clumps of round trees.
  // The photo from above sits faintly underneath for the little details.
  const M2 = (v) => ((v + MAP_R) / (MAP_R * 2)) * MAP_PX, R2 = (r) => (r / (MAP_R * 2)) * MAP_PX;
  const ink = '#3a2010';
  g.fillStyle = '#8fd16a'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.beginPath(); g.arc(M2(0), M2(0), R2(WORLD_R), 0, 7); g.fillStyle = '#7cc35a'; g.fill();
  for (const Z of Object.values(ZONES)) { g.beginPath(); g.arc(M2(Z.x), M2(Z.z), R2(Z.r + 4), 0, 7); g.fillStyle = Z.grass; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(58,32,16,.45)'; g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]); }
  for (const T of TOWNS) { if (T.land) continue; g.beginPath(); g.arc(M2(T.x), M2(T.z), R2(T.r), 0, 7); g.fillStyle = '#b8d878'; g.fill(); }
  g.beginPath(); g.arc(M2(LAKE.x), M2(LAKE.z), R2(LAKE.r), 0, 7); g.fillStyle = '#4aa8f0'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#f1d79c'; g.stroke();
  const road = (x1, z1, x2, z2, w) => { g.lineCap = 'round'; g.beginPath(); g.moveTo(M2(x1), M2(z1)); g.lineTo(M2(x2), M2(z2)); g.lineWidth = w + 5; g.strokeStyle = ink; g.stroke(); g.lineWidth = w; g.strokeStyle = '#f5dfa6'; g.stroke(); };
  for (const [tx, tz, fx, fz] of ROADS) road(fx, fz, tx, tz, 9);
  road(0, 0, 4, -50, 8); road(0, 0, 0, 52, 8); road(0, 0, -28, -4, 8); road(0, 0, 22, 10, 7);
  for (const [x, z, r] of [[0, 0, 9], ...TOWNS.map((T) => [T.x, T.z, 7.5]), [ZONES.meadow.x, ZONES.meadow.z, 6]]) { g.beginPath(); g.arc(M2(x), M2(z), R2(r), 0, 7); g.fillStyle = '#f5dfa6'; g.fill(); g.lineWidth = 3; g.strokeStyle = ink; g.stroke(); }
  // the photo, faintly, for buildings and rocks
  const ph = document.createElement('canvas'); ph.width = ph.height = MAP_PX; ph.getContext('2d').putImageData(img, 0, 0);
  g.globalAlpha = 0.28; g.drawImage(ph, 0, 0); g.globalAlpha = 1;
  // trees as chunky round clumps
  for (const c of colliders) {
    if (c.r < 0.95 || c.r > 1.4 || Math.hypot(c.x, c.z) > WORLD_R) continue;
    if (Math.abs(Math.sin(c.x * 12.99 + c.z * 78.23) * 43758.5) % 1 < 0.5) continue; // half the trees keep the board readable
    const x = M2(c.x), y = M2(c.z), r = R2(c.r * 1.9);
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = '#2f8a3c'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(30,50,20,.8)'; g.stroke();
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, 7); g.fillStyle = 'rgba(160,230,120,.45)'; g.fill();
  }
  g.beginPath(); g.arc(M2(0), M2(0), R2(WORLD_R), 0, 7); g.lineWidth = 8; g.strokeStyle = ink; g.stroke();
}
// Each faraway land gets its own board-style map, painted once from its layout.
const LAND_MAP_R = 88, landMaps = {};
function landMap(L) {
  if (landMaps[L.id]) return landMaps[L.id];
  const cv = document.createElement('canvas'); cv.width = cv.height = MAP_PX; const g = cv.getContext('2d'), C = L.map;
  const M2x = (v) => ((v - L.x + LAND_MAP_R) / (LAND_MAP_R * 2)) * MAP_PX, M2z = (v) => ((v - L.z + LAND_MAP_R) / (LAND_MAP_R * 2)) * MAP_PX, R2 = (r) => (r / (LAND_MAP_R * 2)) * MAP_PX, ink = '#3a2010';
  g.fillStyle = C.bg; g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.fillStyle = C.sea; g.fillRect(M2x(L.x - 34), M2z(L.z + 56), R2(68), MAP_PX);
  g.beginPath(); g.arc(M2x(L.x), M2z(L.z), R2(L.r), 0, 7); g.fillStyle = C.ground; g.fill();
  for (const [k, Z] of Object.entries(L.zones)) { g.beginPath(); g.arc(M2x(Z.x), M2z(Z.z), R2(Z.r + 3), 0, 7); g.fillStyle = k === L.boss ? C.boss : C.zone; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(58,32,16,.4)'; g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]); }
  g.beginPath(); g.arc(M2x(L.pond.x), M2z(L.pond.z), R2(L.pond.r), 0, 7); g.fillStyle = C.pond; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
  const road = (x1, z1, x2, z2) => { g.lineCap = 'round'; g.beginPath(); g.moveTo(M2x(x1), M2z(z1)); g.lineTo(M2x(x2), M2z(z2)); g.lineWidth = 13; g.strokeStyle = ink; g.stroke(); g.lineWidth = 8; g.strokeStyle = '#f5dfa6'; g.stroke(); };
  const V = L.village, Z = L.zones;
  for (const T of TOWNS) if (T.land === L.id) { g.beginPath(); g.arc(M2x(T.x), M2z(T.z), R2(T.r), 0, 7); g.fillStyle = C.town; g.fill(); }
  for (const r of landRoads(L)) road(...r);
  g.beginPath(); g.arc(M2x(V.x), M2z(V.z), R2(7), 0, 7); g.fillStyle = '#f5dfa6'; g.fill(); g.lineWidth = 3; g.strokeStyle = ink; g.stroke();
  for (const T of TOWNS) if (T.land === L.id) { g.beginPath(); g.arc(M2x(T.x), M2z(T.z), R2(7.5), 0, 7); g.fillStyle = '#f5dfa6'; g.fill(); g.lineWidth = 3; g.strokeStyle = ink; g.stroke(); }
  for (const c of colliders) {
    if (c.r < 0.9 || c.r > 1.9 || Math.hypot(c.x - L.x, c.z - L.z) > L.r + 6) continue;
    g.beginPath(); g.arc(M2x(c.x), M2z(c.z), R2(c.r * 1.7), 0, 7); g.fillStyle = C.tree; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(20,40,40,.8)'; g.stroke();
    g.beginPath(); g.arc(M2x(c.x) - 2, M2z(c.z) - 3, R2(c.r * 0.7), 0, 7); g.fillStyle = C.treeHi; g.fill();
  }
  g.beginPath(); g.arc(M2x(L.x), M2z(L.z), R2(L.r), 0, 7); g.lineWidth = 8; g.strokeStyle = ink; g.stroke();
  // the ship in the harbour
  g.fillStyle = '#8a5230'; g.beginPath(); g.ellipse(M2x(L.x), M2z(L.z + 66), R2(2), R2(4), 0, 0, 7); g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
  L.places = [...TOWNS.filter((T) => T.land === L.id).map((T) => [T.name, T.x, T.z - 9]), [L.villageName, V.x, V.z - 9], ['Harbour', L.x, L.z + 58], ...Object.values(Z).map((z2) => [z2.name, z2.x, z2.z - z2.r * 0.6]), [L.pond.name, L.pond.x, L.pond.z - L.pond.r - 2]];
  return (landMaps[L.id] = cv);
}
const mini = $('minimap'), bigMap = $('bigmap');
let lastMap = 0, mapBaked = 0;
function toggleBigMap(force) {
  const show = force ?? bigMap.hidden;
  bigMap.hidden = !show;
  if (show) {
    bigMap.querySelector('h3').textContent = LANDS[where] ? `Map of ${LANDS[where].name}` : 'Map of Jerry Valley'; drawMap(bigMap.querySelector('canvas'), true);
    const box = $('travel'); box.innerHTML = '<b>Fast travel:</b> ' + travelSpots().map((T, i) => `<button data-go="${i}">${T.name.split(' (')[0]}</button>`).join('');
    box.querySelectorAll('[data-go]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); fastTravel(+b.dataset.go); }; });
  }
}
mini.addEventListener('click', () => toggleBigMap(true));
$('jumpbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
$('dashr').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(); });
$('specialbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); special(); });
$('sprintbtn').addEventListener('pointerdown', (e) => { e.preventDefault(); sprintToggle = !sprintToggle; $('sprintbtn').setAttribute('aria-pressed', String(sprintToggle)); });
bigMap.addEventListener('click', () => toggleBigMap(false));
$('bosstalk').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); bossSkip(); });
function drawMap(cv, full) {
  if (!player) return;
  // reading a size from the page forces a re-layout, so only measure the map again after a resize
  if (!cv._css || cv._cssAt !== resizeCount) { cv._css = cv.clientWidth; cv._cssAt = cv._css ? resizeCount : -1; }
  const dpr = Math.min(devicePixelRatio || 1, 2), css = cv._css || 150;
  if (cv.width !== Math.round(css * dpr)) { cv.width = cv.height = Math.round(css * dpr); }
  const W = cv.width, g = cv.getContext('2d');
  const Lm = LANDS[where], MR = Lm ? LAND_MAP_R : MAP_R, ox = Lm ? Lm.x : 0, oz = Lm ? Lm.z : 0, bg = Lm ? landMap(Lm) : mapBg;
  const p = player.pos, half = full ? MR : 34;
  const cx = full ? ox : p.x, cz = full ? oz : p.z;
  const k = W / (half * 2);
  const toPx = (x, z) => [(x - cx + half) * k, (z - cz + half) * k];
  const srcX = (v) => ((v - ox + MR) / (MR * 2)) * MAP_PX, srcZ = (v) => ((v - oz + MR) / (MR * 2)) * MAP_PX;
  g.clearRect(0, 0, W, W);
  if (where !== 'out' && !Lm) {
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, W, W);
    g.font = `700 ${(full ? 22 : 13) * dpr}px Fredoka, Trebuchet MS, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ffe9a0';
    const words = INTERIORS[where].name.split(' ');
    words.forEach((w2, i) => g.fillText(w2, W / 2, W / 2 + (i - (words.length - 1) / 2) * (full ? 26 : 15) * dpr));
    return;
  }
  g.save();
  if (!full) { g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip(); }
  g.fillStyle = '#3f7a3a'; g.fillRect(0, 0, W, W);
  g.drawImage(bg, srcX(cx - half), srcZ(cz - half), srcX(cx + half) - srcX(cx - half), srcZ(cz + half) - srcZ(cz - half), 0, 0, W, W);
  const dot = (x, z, r, fill) => { const [u, v] = toPx(x, z); if (u < -12 || v < -12 || u > W + 12 || v > W + 12) return; g.beginPath(); g.arc(u, v, r * dpr, 0, 7); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#3a2010'; g.stroke(); };
  const S1 = (full ? 1 : 0.85) * dpr;
  const flag = (x, z, col) => { const [u, v] = toPx(x, z); g.lineWidth = 2.5 * S1; g.strokeStyle = '#3a2010'; g.beginPath(); g.moveTo(u, v + 8 * S1); g.lineTo(u, v - 12 * S1); g.stroke(); g.beginPath(); g.moveTo(u, v - 12 * S1); g.lineTo(u + 12 * S1, v - 8 * S1); g.lineTo(u, v - 3 * S1); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 1.5 * S1; g.stroke(); };
  const skull = (x, z, r) => { const [u, v] = toPx(x, z); g.beginPath(); g.arc(u, v, r * S1, 0, 7); g.fillStyle = '#ff3a5a'; g.fill(); g.lineWidth = 2 * S1; g.strokeStyle = '#3a2010'; g.stroke(); g.beginPath(); g.arc(u, v - r * 0.1 * S1, r * 0.55 * S1, 0, 7); g.fillStyle = '#fff'; g.fill(); g.fillStyle = '#3a2010'; for (const sx of [-1, 1]) { g.beginPath(); g.arc(u + sx * r * 0.22 * S1, v - r * 0.12 * S1, r * 0.14 * S1, 0, 7); g.fill(); } };
  const chestIcon = (x, z) => { const [u, v] = toPx(x, z), w = 7 * S1; g.fillStyle = '#ffd23f'; g.strokeStyle = '#3a2010'; g.lineWidth = 1.5 * S1; g.beginPath(); g.roundRect(u - w, v - w * 0.7, w * 2, w * 1.4, 2 * S1); g.fill(); g.stroke(); g.beginPath(); g.moveTo(u - w, v - w * 0.1); g.lineTo(u + w, v - w * 0.1); g.stroke(); };
  for (const c of chests) if (!c.open) chestIcon(c.x, c.z);
  for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.state !== 'gone' && e.inside === where) { if (e.T.boss) skull(e.pos.x, e.pos.z, 8); else dot(e.pos.x, e.pos.z, full ? 2.5 : 3.5, '#ff5a4a'); }
  if (party) for (const m of party.members) { const p = net.peers.get(m.id); if (p && p.where === where && m.id !== myId()) { dot(p.x, p.z, full ? 6 : 5.5, '#4fc3ff'); if (full) { const [u, v] = toPx(p.x, p.z); g.font = `800 ${11 * dpr}px Fredoka, sans-serif`; g.textAlign = 'center'; g.lineWidth = 3 * dpr; g.strokeStyle = '#3a2010'; g.strokeText(m.name, u, v - 9 * dpr); g.fillStyle = '#bfe9ff'; g.fillText(m.name, u, v - 9 * dpr); } } }
  for (const c of crew) if (c.inside === where) dot(c.x, c.z, full ? 3.5 : 4, crewCfg(c).mode === 'ally' ? '#5ad87a' : crewCfg(c).mode === 'rival' ? '#ff7a3a' : '#c8a8ff');
  for (const T of TOWNS) if ((T.land || null) === (Lm ? Lm.id : null)) flag(T.x - 5, T.z - 3, townFree(T.id) ? '#3a8fe8' : '#d8324a');
  for (const n of npcs) {
    if ((n.inside || 'out') !== where) continue;
    const qid = Object.keys(QUESTS).find((q) => QUESTS[q].giver === n.id && !QUESTS[q].story);
    const st = qid && S.quests[qid].state;
    const col = n.king ? '#c58bff' : n.shop ? '#ffe9a0' : st === 'todo' ? '#ffd23f' : qid && questReady(qid) ? '#ff6ad5' : '#f6efdc';
    dot(n.x, n.z, full ? 4 : 4.5, col);
  }
  // event pickups: unlit lanterns and lost crates
  if (where === 'marsh' && S.quests.st_lantern && S.quests.st_lantern.state === 'active') for (const l of lanterns) if (!l.lit) dot(l.x, l.z, full ? 4.5 : 4, '#ffb43a');
  if (where === 'sands' && S.quests.st_storm && S.quests.st_storm.state === 'active') for (const c of crates) if (!c.got) dot(c.x, c.z, full ? 4.5 : 4, '#ffb43a');
  if (full) {
    const fs = Math.max(9, Math.min(13, W / dpr / 38)); // smaller ribbons on a phone so names don't pile up
    g.font = `700 ${fs * dpr}px Fredoka, Trebuchet MS, sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round';
    // place names on little ribbons
    for (const [name, x, z] of (Lm ? Lm.places : PLACES)) {
      const [u, v] = toPx(x, z), w = g.measureText(name).width + fs * 1.05 * dpr, h = fs * 1.45 * dpr;
      g.fillStyle = '#7a4ac8'; g.strokeStyle = '#3a2010'; g.lineWidth = 2 * dpr;
      g.beginPath(); g.roundRect(u - w / 2, v - h * 0.72, w, h, 6 * dpr); g.fill(); g.stroke();
      g.fillStyle = '#fff3c4'; g.fillText(name, u, v + 1 * dpr);
    }
    // under each town: who is mayor, or that monsters hold it
    {
      g.font = `700 ${fs * 0.82 * dpr}px Fredoka, Trebuchet MS, sans-serif`;
      for (const T of TOWNS) {
        if ((T.land || null) !== (Lm ? Lm.id : null)) continue;
        const [u, v] = toPx(T.x, T.z - 9), txt = townFree(T.id) ? `Mayor ${mayorName(T)}` : 'Monsters!';
        g.lineWidth = 3 * dpr; g.strokeStyle = '#3a2010'; g.strokeText(txt, u, v + fs * 1.45 * dpr); g.fillStyle = townFree(T.id) ? '#bfe6ff' : '#ffb0b8'; g.fillText(txt, u, v + fs * 1.45 * dpr);
      }
      g.font = `700 ${fs * dpr}px Fredoka, Trebuchet MS, sans-serif`;
    }
    // compass
    const cxp = W - 30 * dpr, cyp = 34 * dpr;
    g.beginPath(); g.arc(cxp, cyp, 18 * dpr, 0, 7); g.fillStyle = '#fff3c4'; g.fill(); g.lineWidth = 2.5 * dpr; g.strokeStyle = '#3a2010'; g.stroke();
    g.beginPath(); g.moveTo(cxp, cyp - 14 * dpr); g.lineTo(cxp + 6 * dpr, cyp); g.lineTo(cxp - 6 * dpr, cyp); g.closePath(); g.fillStyle = '#d8324a'; g.fill();
    g.beginPath(); g.moveTo(cxp, cyp + 14 * dpr); g.lineTo(cxp + 6 * dpr, cyp); g.lineTo(cxp - 6 * dpr, cyp); g.closePath(); g.fillStyle = '#8a7a6a'; g.fill();
    g.fillStyle = '#3a2010'; g.fillText('N', cxp, cyp - 20 * dpr);
  } else {
    g.font = `800 ${10 * dpr}px Fredoka, Trebuchet MS, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#d8324a'; g.strokeStyle = '#fff'; g.lineWidth = 3 * dpr;
    g.strokeText('N', W / 2, 12 * dpr); g.fillText('N', W / 2, 12 * dpr);
  }
  // you: an arrow pointing the way you face
  const [u, v] = toPx(p.x, p.z), a = player.root.rotation.y, sz = (full ? 7 : 8) * dpr;
  g.translate(u, v); g.rotate(-a);
  g.beginPath(); g.moveTo(0, sz * 1.2); g.lineTo(sz * 0.8, -sz * 0.7); g.lineTo(0, -sz * 0.25); g.lineTo(-sz * 0.8, -sz * 0.7); g.closePath();
  g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = '#3a2010'; g.stroke();
  g.restore();
}

// ---------- main loop ----------
const camPos = new THREE.Vector3(0, 30, 40), camLook = new THREE.Vector3(), camOff = new THREE.Vector3(), camAim = new THREE.Vector3();
let camFollow = false;
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
  const Lw = LANDS[where];
  if (Lw) {
    // stay on the land: inside its ring, and on the shore side of the harbour
    let dx = p.x - Lw.x, dz = p.z - Lw.z; const d = Math.hypot(dx, dz);
    if (d > Lw.r) { dx *= Lw.r / d; dz *= Lw.r / d; }
    if (dz > 54) dz = 54;
    p.x = Lw.x + dx; p.z = Lw.z + dz; return;
  }
  if (where !== 'out') return;
  const d = Math.hypot(p.x, p.z);
  if (d > WORLD_R) { p.x *= WORLD_R / d; p.z *= WORLD_R / d; }
}
let stamina = 100, staminaAt = 0, sprintToggle = false;
let lastUi = 0, lastSave = 0, regenAt = 0, lastAct = '', stuck = 0, staminaTired = null;
// Day slides into golden hour, then a cosy blue night with fireflies, then dawn. A full
// day takes 24 minutes. Rooms indoors always use the daytime light.
const DAY_LEN = 24 * 60;
const DAY_KEYS = [[0, 'day'], [0.46, 'day'], [0.54, 'golden'], [0.6, 'golden'], [0.67, 'night'], [0.86, 'night'], [0.92, 'golden'], [0.96, 'golden'], [1, 'day']];
let dayLast = '', dayPhase = '';
function dayTick(dt, force) {
  const mode = S.tod || 'cycle';
  S.gameDays = (S.gameDays || 0) + dt / DAY_LEN;
  if (mode === 'cycle') S.dayT = ((S.dayT || 0) + dt / DAY_LEN) % 1;
  const indoors = where !== 'out' && !LANDS[where];
  let a = 'day', b = 'day', k = 0;
  if (indoors) { a = b = 'day'; }
  else if (mode !== 'cycle') { a = b = mode; }
  else {
    const t = S.dayT || 0;
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      const [t0, p0] = DAY_KEYS[i], [t1, p1] = DAY_KEYS[i + 1];
      if (t >= t0 && t <= t1) { a = p0; b = p1; k = t1 > t0 ? (t - t0) / (t1 - t0) : 0; k = k * k * (3 - 2 * k); break; }
    }
  }
  const key = a + b + k.toFixed(3);
  if (!force && key === dayLast) return;
  dayLast = key; env.preset = k < 0.5 ? a : b;
  blendPresets(a, b, k);
  const phase = a + '>' + b;
  if (!force && phase !== dayPhase && !indoors) {
    if (phase === 'night>golden') toast(`The sun is coming up. Good morning! Day ${dayOfWeek()} of the week.`);
    if (phase === 'golden>night') toast('Night falls. The fireflies come out.');
  }
  dayPhase = phase;
}

// Every lamp, chest glow and lava pool used to be its own light, and each one made every
// material do more work. Now the lamps are just spots, and four real lights hop to the
// spots nearest the hero each frame. The count never changes, so shaders never rebuild.
// The valley, the frost land and the rooms are far apart, so only the one the hero is in
// gets drawn or updated at all. The others are skipped wholesale each frame.
const regions = {};
const regionOfX = (x) => (x > 2500 ? 'sands' : x > 1600 ? 'marsh' : x > 700 ? 'frost' : x > 230 ? 'rooms' : 'valley');
function groupRegions(objs) {
  const box = new THREE.Box3(), c = new THREE.Vector3();
  for (const k of ['valley', 'rooms', 'frost', 'marsh', 'sands']) { regions[k] = new THREE.Group(); regions[k].name = 'region_' + k; scene.add(regions[k]); }
  for (const o of objs) {
    box.setFromObject(o); if (box.isEmpty()) c.copy(o.position); else box.getCenter(c);
    regions[regionOfX(c.x)].attach(o);
  }
}
// Hundreds of little fences, rocks, walls and barrels never move, but each was its own draw.
// Glue the ones that share a material into one mesh per patch of ground, so the GPU gets a
// few dozen big jobs instead of thousands of tiny ones. Anything that moves, fades or hides
// is left alone.
// Some models store their points squeezed into small whole numbers. Moving those into place
// would clip them, so copy everything out as plain floats first.
function floatGeo(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, at] of Object.entries(src.attributes)) {
    const n = at.count, k = at.itemSize, out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) { out[i * k] = at.getX(i); if (k > 1) out[i * k + 1] = at.getY(i); if (k > 2) out[i * k + 2] = at.getZ(i); if (k > 3) out[i * k + 3] = at.getW(i); }
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  return g;
}
function mergeStatic() {
  const keep = new Set();
  const skip = (o) => { if (o && o.isObject3D) keep.add(o); };
  clouds.forEach(skip); lavaPools.forEach(skip);
  for (const k of ['flames', 'crystals']) (dynamic[k] || []).forEach(skip);
  for (const O of occluders) skip(O.o);
  for (const T of TOWNS) { skip(T.flagRed); skip(T.flagBlue); (T.junk || []).forEach(skip); (T.homely || []).forEach(skip); }
  const CELL = 36, bins = new Map(), m4 = new THREE.Matrix4();
  for (const k in regions) {
    const R = regions[k]; R.updateMatrixWorld(true);
    const take = [];
    const walk = (o) => {
      if (keep.has(o) || !o.visible || o.isLight || o.isPoints) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.userData.mats && !Array.isArray(o.material) && !o.userData.isInk
        && o.layers.mask === 1 && o.frustumCulled && !o.material.transparent && !o.geometry.morphAttributes.position) take.push(o);
      for (const c of o.children) walk(c);
    };
    walk(R);
    for (const o of take) {
      const g = o.geometry, names = Object.keys(g.attributes).sort().join(',');
      const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const key = [k, o.userData.mats.std.uuid, o.userData.mats.toon.uuid, names, !!g.index, o.castShadow, o.receiveShadow, Math.floor(c.x / CELL), Math.floor(c.z / CELL)].join('|');
      if (!bins.has(key)) bins.set(key, { R, mats: o.userData.mats, cast: o.castShadow, recv: o.receiveShadow, list: [] });
      bins.get(key).list.push(o);
    }
  }
  let before = 0, after = 0;
  for (const b of bins.values()) {
    if (b.list.length < 2) continue;
    const geos = b.list.map((o) => { m4.copy(o.matrixWorld); return floatGeo(o.geometry).applyMatrix4(m4); });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged); m.castShadow = b.cast; m.receiveShadow = b.recv; m.matrixAutoUpdate = false;
    registerMesh(m, b.mats); b.R.add(m);
    for (const o of b.list) o.removeFromParent();
    before += b.list.length; after++;
  }
  // Big batches of trees and grass were one mesh spread over the whole map, so all of them
  // were drawn even when only a few were on screen. Cut each batch into patches of ground,
  // and the patches off screen get skipped.
  const inst = [];
  for (const k in regions) regions[k].traverse((o) => { if (o.isInstancedMesh && o.count > 12 && !keep.has(o)) inst.push([o, regions[k]]); });
  let split = 0;
  const im = new THREE.Matrix4(), p = new THREE.Vector3(), col = new THREE.Color();
  for (const [o, R] of inst) {
    o.updateMatrixWorld(true);
    const cells = new Map();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, im); im.premultiply(o.matrixWorld); p.setFromMatrixPosition(im);
      const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    if (cells.size < 2) continue;
    for (const ids of cells.values()) {
      const n = new THREE.InstancedMesh(o.geometry, o.material, ids.length);
      ids.forEach((i, j) => { o.getMatrixAt(i, im); im.premultiply(o.matrixWorld); n.setMatrixAt(j, im); if (o.instanceColor) { o.getColorAt(i, col); n.setColorAt(j, col); } });
      n.castShadow = o.castShadow; n.receiveShadow = o.receiveShadow; n.layers.mask = o.layers.mask; n.renderOrder = o.renderOrder;
      n.matrixAutoUpdate = false; n.computeBoundingSphere();
      if (o.userData.mats) registerMesh(n, o.userData.mats); else n.material = o.material;
      R.add(n); // region groups sit at the origin, so world matrices go in as-is
    }
    o.removeFromParent(); split++;
  }
  console.log(`split ${split} instanced batches`);
  // tidy away the empty groups the meshes came from
  const prune = (o) => { for (const c of [...o.children]) prune(c); if (o.parent && !o.isMesh && !o.isLight && !o.children.length && !keep.has(o) && !o.name.startsWith('region_')) o.removeFromParent(); };
  for (const k in regions) prune(regions[k]);
  console.log(`merged ${before} meshes into ${after}`);
}

let regionNow = '';
function regionTick() {
  if (!player || !regions.valley) return;
  const r = regionOfX(player.pos.x);
  if (r === regionNow) return;
  regionNow = r;
  for (const k in regions) { const on = k === r; regions[k].visible = on; regions[k].matrixWorldAutoUpdate = on; }
}

const lightSpots = [], lightPool = [];
function poolLights() {
  scene.traverse((o) => { if (o.isPointLight && !lightSpots.includes(o)) lightSpots.push(o); });
  for (const l of lightSpots) if (l.parent) l.parent.remove(l);
  for (let i = 0; i < 4; i++) { const p = new THREE.PointLight('#ffffff', 0, 1, 1.5); scene.add(p); lightPool.push(p); }
}
const _lpick = [];
function lightTick() {
  if (!lightPool.length) return;
  const c = player ? player.pos : camera.position;
  _lpick.length = 0;
  for (const l of lightSpots) {
    if (!l.visible || l.intensity <= 0) continue;
    const d = Math.hypot(l.position.x - c.x, l.position.z - c.z) - l.distance * 0.6;
    if (d < 30) _lpick.push([d, l]);
  }
  _lpick.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < lightPool.length; i++) {
    const p = lightPool[i], s = _lpick[i] && _lpick[i][1];
    if (!s) { p.intensity = 0; continue; }
    p.position.copy(s.position); p.color.copy(s.color); p.distance = s.distance; p.decay = s.decay;
    // fade the light in as it comes into range, so lamps don't pop
    p.intensity = s.intensity * Math.min(1, Math.max(0, (30 - _lpick[i][0]) / 8));
  }
}

function tick() {
  now = clock.elapsedTime;
  const dt = Math.min(clock.getDelta(), 0.05) * (now < hitStopUntil ? 0.08 : 1);
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const f = timers[i].f; timers.splice(i, 1); f(); } }
  regionTick(); lightTick();
  if (player) { spotTick(); goldenTick(); tinyTick(dt); pompTick(dt); }

  if (player) { gulpTick(); lanternTick(dt); wingTick(); stormTick(dt); castleTick(dt); colossusTick(dt); cosTick(); wbTick(); bossSyncTick(); weaponSparkle(); flairTick(player, dt, player.name === 'Running_A' || player.name === 'Walking_A' || (player.name || '').startsWith('Running')); }
  if (player && !player.dead && !uiLock() && !gulped) {
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
    if (dashLunge && dashLunge.left > 0) { const st = Math.min(dashLunge.left, 9 * dt); dashLunge.left -= st; pp.x += dashLunge.x * st; pp.z += dashLunge.z * st; collide(pp); }
    if (dashLeft > 0) { const st = Math.min(dashLeft, 25 * dt); dashLeft -= st; pp.x += dashDir.x * st; pp.z += dashDir.z * st; collide(pp); if (dashLeft <= 0) dashUntil = Math.min(dashUntil, now); player.root.rotation.z = -dashDir.x * 0.25; player.root.rotation.x = dashDir.z * 0.18; if (rng() < 0.6) burst(pp.clone().setY(0.9), '#ffffff', 2, 1.5, 0.6); }
    else if (player.root.rotation.z || player.root.rotation.x) { player.root.rotation.z = 0; player.root.rotation.x = 0; }
    // you can always move, even mid-swing; while a swing plays you keep facing where you aimed
    if (mx || mz) {
      if (talking) closeDialog();
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
      const sprinting = (keys.has('sprint') || sprintToggle) && stamina > 1 && !busy;
      // sprinting only tires you out in a fight: out of combat you can run as long as you like
      if (sprinting && inCombat()) { stamina = Math.max(0, stamina - dt * 15); staminaAt = now + 0.8; if (stamina <= 1) sprintToggle = false; }
      const speed = 8.4 * (1 + (lvl('speed') - 1) * 0.006) * (sprinting ? 1.55 : 1) * pathSpeed();
      const ox = pp.x, oz = pp.z;
      pp.x += mx * speed * dt; pp.z += mz * speed * dt;
      collide(pp); collide(pp);
      // blocked head-on? try veering a little left or right so you slide round trees and rocks
      const step = speed * dt;
      if (Math.hypot(pp.x - ox, pp.z - oz) < step * 0.5) {
        // find what we bumped into and walk round its edge, keeping to the side we picked last time
        let hit = null, hd = 1e9;
        for (const c of colliders) { const d = Math.hypot(ox - c.x, oz - c.z) - c.r - 0.7; if (d < 0.15 && d < hd) { hd = d; hit = c; } }
        if (hit) {
          const nx = ox - hit.x, nz = oz - hit.z, nl = Math.hypot(nx, nz) || 1;
          let tx = -nz / nl, tz = nx / nl;
          const along = tx * mx + tz * mz;
          if (Math.abs(along) < 0.15) { if (!player.steerSide || now - (player.steerAt || 0) > 1) player.steerSide = rng() < 0.5 ? 1 : -1; tx *= player.steerSide; tz *= player.steerSide; }
          else if (along < 0) { tx = -tx; tz = -tz; }
          player.steerAt = now;
          const t = { x: ox + tx * step, z: oz + tz * step }; collide(t); collide(t);
          pp.x = t.x; pp.z = t.z;
        }
      }
      const moved = Math.hypot(pp.x - ox, pp.z - oz);
      if (moved > 0.001) giveXp('speed', moved * (sprinting ? 0.9 : 0.5));
      // give up on a tap target we can't reach
      stuck = moved < speed * dt * 0.2 ? stuck + dt : 0;
      if (stuck > 1.2 && moveTarget) { moveTarget = null; marker.visible = false; if (pending) { const t = pending; pending = null; startTask(t); } stuck = 0; }
      if (!busy || (!mouseAimed && !moveTarget)) {
        const want = Math.atan2(mx, mz);
        let diff = want - player.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        player.root.rotation.y += diff * Math.min(1, dt * (busy ? 20 : 14));
        if (!player.air && !busy) player.play('Running_A', { fade: 0.08, speed: sprinting ? 1.55 : 1.2 });
        if (sprinting && rng() < 0.3) burst(pp.clone().setY(0.15), '#f3e2bd', 1, 1.5);
      }
    } else if (!busy && player.task) {
      gatherTick(player.task);
    } else if (!busy && (player.name === 'Running_A' || player.name === 'Idle_Combat')) {
      player.play('Idle', { fade: 0.15 }); player.idleAt = now;
    } else if (!busy && player.name === 'Idle' && now - (player.idleAt || 0) > 2.5 && now - aim.at > 2.5) {
      // stand still for a moment and your hero turns to smile at the camera
      let diff = 0 - player.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      player.root.rotation.y += diff * Math.min(1, dt * 3);
    }
    checkDoors();
    if (now > staminaAt && stamina < 100) stamina = Math.min(100, stamina + dt * 24);
    setW($('stamfill'), stamina); const tired = stamina < 99; if (tired !== staminaTired) { staminaTired = tired; $('status').classList.toggle('tired', tired); }
    if (player.air) {
      pp.y += player.vy * dt; player.vy -= GRAV * dt;
      if (pp.y <= 0) { pp.y = 0; player.air = false; player.vy = 0; sfx('land'); burst(pp.clone().setY(0.15), '#f3e2bd', 10, 2.5); if (now > player.busyUntil) player.play(mx || mz ? 'Running_A' : 'Idle', { fade: 0.1 }); }
    }
    if (now >= player.nextHit && !talking) { if (now - attackQueued < 0.4) { attackQueued = -9; forceAttack = true; swing(); forceAttack = false; } else if (held && swingTarget().type !== 'attack') swing(); }
    if (now - lastHurt > 6 && now > regenAt && S.hp < maxHp()) { S.hp = Math.min(maxHp(), S.hp + 1); regenAt = now + (S.path === 'vampire' ? 1.25 : 2.5); refreshUI(); }
  }
  if (marker.visible) { marker.scale.setScalar(Math.max(1, marker.scale.x - dt * 2)); marker.material.opacity = 0.6 + 0.3 * Math.sin(now * 8); }

  for (const e of enemies) {
    const near = !player || Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 55;
    if (player && (near || e.state !== 'idle') && !bossIntro) enemyTick(e, dt);
    if (near) e.mixer.update(dt);
  }
  slamTick(dt);
  hazardTick(dt);
  bossFxTick(dt);
  if (player) blizzardTick(dt);
  fxTick(dt);
  pileTick(dt);
  pouchTick();
  bossUi();
  zoneBanner();
  for (const [i, c] of dynamic.crystals.entries()) { c.position.y = 2.4 + Math.sin(now * 1.6 + i) * 0.4; c.rotation.y = now * 0.8 + i; }
  if (player) { player.mixer.update(dt); headPose(player); faceTick(player); }
  for (const n of npcs) npcLife(n, dt);
  crewTick(dt); crewTags(); heroTag(); peersTick(dt); partyTick(); emoteTick(); bossShoutTick(); townTick(); letterTick(); if (snowFx) { snowFx.visible = where === 'frost'; if (snowFx.visible && player) snowFx.userData.tick(dt, player.pos.x, player.pos.z); } if (now > 45 && !document.body.classList.contains('nohint')) document.body.classList.add('nohint'); occluderTick(dt);
  guideTick(); chargeTick(); musicTick();
  if (now > shimAt) { shimAt = now + 0.1; shimmerTick(player, cosState().eq); }

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
      // now and then a tree or rock grows back golden: triple haul
      if (n.def.skill !== 'fishing' && rng() < 0.06) goldNode(n, true);
      if (n.full.userData.collider) n.full.userData.collider.r = 1.2;
    }
    if (n.golden && n.alive && rng() < dt * 6) burst(new THREE.Vector3(n.x + (rng() - 0.5) * 2, 0.6 + rng() * 2.6, n.z + (rng() - 0.5) * 2), '#ffd84a', 3, 2, 0.9);
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
    if (pr.pierce) {
      // the slash wave cuts through: each foe is struck once, and it fades as it flies
      for (const e of enemies) if (e.hp > 0 && !pr.pierce.has(e) && e.state !== 'rising' && e.state !== 'gone' && e.inside === where && Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) < pr.R + (e.T.boss ? 1.2 : 0.3)) { pr.pierce.add(e); pr.onHit(e); }
      for (const c of crew) if (!pr.pierce.has(c) && isRival(c) && crewUp(c) && c.inside === where && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < pr.R) { pr.pierce.add(c); pr.onHit(c); }
      // it snaps open wide right after launch, then thins and fades as it runs out
      const life = Math.max(0, pr.left / pr.range), age = 1 - life, sz = pr.mesh.userData.size || 1;
      const open = Math.min(1, age * 6), wide = 0.5 + 0.7 * (1 - Math.pow(1 - open, 3)) + age * 0.25;
      pr.mesh.scale.set(wide * sz, 1, (0.8 + 0.2 * open) * sz);
      pr.mesh.children.forEach((m) => { m.material.opacity = m.userData.op * Math.min(1, life * 2.5); });
      if (rng() < 0.7) burst(pp.clone().addScaledVector(pr.dir, 0.4), '#ffe9a8', 1, 1.5);
      if (pr.left <= 0) { scene.remove(pr.mesh); projectiles.splice(i, 1); }
      continue;
    }
    if (pr.owner === 'player' || pr.owner === 'ally') {
      for (const e of enemies) if (e.hp > 0 && e.state !== 'rising' && e.state !== 'gone' && e.inside === where && Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) < 0.95) { pr.onHit(e); hitSomething = true; break; }
      if (!hitSomething) for (const c of crew) if (isRival(c) && crewUp(c) && c.inside === where && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 0.95) { pr.onHit(c); hitSomething = true; break; }
    } else if (pr.tgt) {
      if (crewUp(pr.tgt) && Math.hypot(pr.tgt.pos.x - pp.x, pr.tgt.pos.z - pp.z) < 0.9) { pr.onHit(); hitSomething = true; }
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
    let show = n.alive && n.hp < n.maxHp, v = null;
    if (show) { v = tmpV.set(n.x, n.cut ? 4.2 : 2.6, n.z).project(camera); show = v.z <= 1; }
    setShown(n.bar, show);
    if (show) { pin(n.bar, v); setW(n.bar.firstChild, (n.hp / n.maxHp) * 100); }
  }
  if (player) {
    arcHolder.position.set(player.pos.x, 0, player.pos.z); arcHolder.rotation.y = player.root.rotation.y;
    arcHolder.visible = !player.dead && !uiLock();
    arcFlash = Math.max(0, arcFlash - dt * 4);
    arcMat.opacity = 0.12 + arcFlash * 0.3;
  }

  // a monster's health bar only shows once it is hurt and still in the thick of it
  // (hit in the last few seconds, or right next to you), so a big fight doesn't fill the screen with bars
  for (const e of enemies) {
    if (e.T.boss) continue; // bosses use the big bar at the top
    let show = e.hp > 0 && e.hp < e.T.hp && e.state !== 'rising' && e.inside === where && !!player, v = null;
    if (show) {
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      show = d < 30 && (now - (e.barAt || 0) < 6 || d < 9);
    }
    if (show) { v = tmpV.copy(e.pos).setY(3.3).project(camera); show = v.z <= 1; }
    setShown(e.bar, show);
    if (show) { pin(e.bar, v); setW(e.bar.firstChild, (e.hp / e.T.hp) * 100); }
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
  if (player && now - lastMap > 0.1) { lastMap = now; setShown(mini, $('sheet').hidden); if (!mini.hidden) drawMap(mini, false); if (!bigMap.hidden) drawMap(bigMap.querySelector('canvas'), true); }
  if (player && now - lastSave > 6) { lastSave = now; save(); }

  dayTick(dt);
  const P = env.cur;
  if (dynamic.waterMat) dynamic.waterMat.uniforms.time.value = now;
  const fl = 0.85 + 0.15 * Math.sin(now * 17) + 0.1 * Math.sin(now * 7.3);
  if (dynamic.fireLight) dynamic.fireLight.intensity = 30 * fl * P.fire;
  dynamic.flames.forEach((f, i) => { f.scale.set(1, fl * (i ? 1.1 : 1), 1); f.rotation.y = now * (i ? -2 : 2); });
  if (dynamic.lavas && player) for (const L of dynamic.lavas) {
    if (Math.abs(L.x - player.pos.x) > 50 || Math.abs(L.z - player.pos.z) > 50) continue;
    L.hot.scale.setScalar(1 + Math.sin(now * 2 + L.x) * 0.12);
    if (rng() < dt * 3) burst(new THREE.Vector3(L.x + (rng() - 0.5) * L.r, 0.3, L.z + (rng() - 0.5) * L.r), rng() < 0.5 ? '#ffb02a' : '#ff5a1f', 3, 2.5, 2.5);
  }
  for (const c of clouds) { c.position.x += dt * 0.8; if (c.position.x > 110) c.position.x = -110; }

  const focus = player ? tmpF.copy(player.pos).setY(0) : tmpF.set(0, 0, 4);
  updateParticles(dt, now, focus);
  zoom += (zoomGoal - zoom) * (1 - Math.pow(0.0005, dt));
  const off = camOff.copy(CAM_OFF).multiplyScalar(zoom * (camera.aspect < 1 ? 1.3 : 1));
  const following = !(creator.open && player) && !bossIntro && !(camMoment && player && camMoment.t < camMoment.dur) && !(player && dlg && dlg.talky && talking && talking.actor && !$('dialog').hidden) && !(!player && !$('pick').hidden);
  if (!following) camFollow = false;
  bossIntroTick(dt);
  if (creator.open && player) creatorCam(dt);
  else if (bossIntro) introCam(dt);
  else if (camMoment && player && camMoment.t < camMoment.dur) momentCam(dt);
  else if (player && dlg && dlg.talky && talking && talking.actor && !$('dialog').hidden) talkCam(dt);
  else if (!player && !$('pick').hidden) titleCam();
  else {
    if (camera.view && camera.view.enabled) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
    if (talkCam.near0 && camera.near !== talkCam.near0) { camera.near = talkCam.near0; camera.updateProjectionMatrix(); }
    // the camera glides after the hero, and so does the point it looks at, so it never snaps or
    // twitches; coming back from a cut-scene it eases round from wherever it was looking
    camAim.set(focus.x, 1.7, focus.z - 1.5);
    if (!camFollow) { camFollow = true; camera.getWorldDirection(camLook); camLook.multiplyScalar(off.length()).add(camera.position); }
    camPos.lerp(tmpV.copy(focus).add(off), 1 - Math.pow(0.002, dt));
    camLook.lerp(camAim, 1 - Math.pow(0.0006, dt));
    if (camLook.distanceToSquared(camAim) > 100) camLook.copy(camAim); // after a teleport, just be there
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }
  sky.position.copy(camera.position);
  const sd = P.sunDir;
  sun.position.set(focus.x + sd[0], sd[1], focus.z + sd[2]);
  sun.target.position.set(focus.x, 0, focus.z);
  cullActors();
  render();
  previewTick();
  for (const r of culled) r.visible = true;
  culled.length = 0;
}

// Characters are drawn with culling off (their poses move outside their boxes), so every one
// on the map was drawn every frame, even miles away. Hide the ones the camera can't see just
// for the draw, then put them straight back so nothing else notices.
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), culled = [];
function cullActors() {
  camera.updateMatrixWorld();
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
  const test = (root) => {
    if (!root || !root.visible) return;
    _sph.center.set(root.position.x, root.position.y + 1.5, root.position.z); _sph.radius = 3.5 * root.scale.x;
    if (!_frus.intersectsSphere(_sph)) { root.visible = false; culled.push(root); }
  };
  for (const e of enemies) test(e.root);
  for (const n of npcs) test(n.actor.root);
  for (const c of crew) test(c.actor.root);
}
addEventListener('pagehide', () => { if (!resetting) save(); });
// sound starts on the first key or tap (browsers require that)
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { unlockAudio(); if (S.vol) setVolumes(S.vol.music, S.vol.sfx); }, { capture: true });
addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) sfx('click'); }, { capture: true });
// pick the tune for where you are
let musicAt = 0;
// ---------- boss intros ----------
// The first time a boss notices you (and again after a while), the action pauses: black bars slide in,
// the camera swoops to the boss, it roars, and its name slams onto the screen.
const BOSS_TITLES = { boss_pomp: 'In a Stolen Battle-Suit', boss_colossus: 'Guardian of the Old Kingdom', boss_mire: 'Bog Witch of Mire Hollow', boss_sogg: 'The Sunken Knight', boss_gobbler: 'Terror of Gobbler Marsh', boss_frost: 'Ice Queen of Frostwhisker Peaks', boss_crusher: 'Brute of the Grumble Crags', boss_gloom: 'Sorcerer of Glimmerwood', boss_rattle: 'Terror of Haunted Hollow', boss_gagron: 'Fire Dragon of the Ember Cave' };
let bossIntro = null;
function bossIntroTick(dt = 0) {
  if (bossIntro) {
    bossIntro.t += Math.min(dt, 0.1); // frame time, capped, so a hitch never skips the show
    // the bars and title card follow the same clock, so they stay in step with the camera
    const B = bossIntro, talky = B.lines.length > 0, start = B.kind === 'intro' ? 2.5 : 0.6;
    const at = talky ? Math.min(B.t, B.kind === 'intro' && B.t < start ? B.t : 1.5) : B.t;
    for (const el of $('bossintro').children) el.style.animationDelay = `-${at.toFixed(3)}s`;
    if (talky && B.t >= start) {
      if (B.li < 0 || B.t - B.lineAt > (B.lineLen || 4)) bossNextLine();
    }
    const over = talky ? B.li >= B.lines.length : B.t > 3.2;
    if (over || !player || player.dead || (B.kind === 'intro' && B.e.hp <= 0)) endBossIntro();
    return;
  }
  if (!player || creator.open || player.dead) return;
  for (const e of enemies) {
    // only a boss that has actually come for you (not one just wandering about its stage) starts its intro
    if (!e.T.boss || e.hp <= 0 || e.inside !== where || ['idle', 'walk', 'return', 'dead'].includes(e.state)) continue;
    if (e.T.world || (e.introAt && (now - e.introAt < 150 || e.hp < e.T.hp))) continue;
    if (beatenBoss(e)) { e.introAt = now; continue; } // seen it already: straight into the fight
    if (Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) > 26) continue;
    startBossIntro(e); return;
  }
}
// What each boss says: before the fight, when it gets low on health, and when it is beaten.
// ['h', text] lines are your hero talking back.
const POMP_BOSSES = ['boss_gagron', 'boss_crusher', 'boss_gloom', 'boss_rattle', 'boss_frost', 'boss_gobbler'];
const BOSS_LINES = {
  boss_pomp: { intro: ['Ah, the little helper! Admire my new suit. Rockets! Lasers! A cup holder!', ['h', 'That is Professor Tinkerwell\'s suit. And you work for the Dark King?!'], 'He promised me GLORY. Statues! Songs! My face on every coin! You would not understand.', 'Now hold still while I become a legend!'],
    low: 'Not the paint! Do you know how much this gold leaf costs?!', defeat: ['*sniff* The suit is ruined. My hair is ruined. EVERYTHING is ruined.', ['h', 'Why did you do it?'], 'Nobody ever cheered for me. Not once. The Dark King said they would...', 'He has a castle, you know. It FLIES. I was going to have the room with the balcony.'] },
  boss_colossus: { intro: ['*CLANK* *WHIRR* ...INTRUDER. DETECTED.', ['h', 'That is the biggest robot I have ever seen.'], 'I. AM. THE. BRASSBOLT. COLOSSUS. THE WARDSTONE. IS. MINE.'],
    low: 'WARNING. WARNING. SPRINGS. COMING. LOOSE.', defeat: ['*CLUNK* ...POWER. FAILING.', ['h', 'The Wardstone! It is in its chest!'], 'THANK. YOU. I. WAS. VERY. TIRED.', '*the ground rumbles... something enormous rises in the north*'] },
  boss_mire: { intro: ['Visitors! How lovely. Come closer, dearie, the cauldron is nice and warm.', ['h', 'What are you cooking?'], 'Oh, just a little something for a friend of mine. A BIG friend. A HUNGRY friend.'],
    low: 'My beautiful wrinkles! You scuffed them!', defeat: ['Fine! FINE! Yes, I fed the Gobbler. Boots, boats, bridges, all of it.', ['h', 'Why?!'], 'The Dark King promised to make me young again. Young! Do you know how creaky my knees are?', 'He never kept his word, of course. They never do...'] },
  boss_sogg: { intro: ['*glub* WHO DISTURBS SIR PERCIVAL SOGGINGTON?', ['h', 'Wait, another Sir Percival?'], 'There is only ONE Sir Percival! The other one is a fraud with shiny armour! CHARGE!'],
    low: 'My armour is filling with tadpoles!', defeat: ['Oh... oh dear. A hundred years asleep and I attack the first nice person I see.', 'That witch woke me with a spell. Listen, young hero: the Marsh Wardstone is not lost.', 'The Gobbler SWALLOWED it. The very night the Heartstone cracked.'] },
  boss_gobbler: { intro: ['*BURRRRP*', ['h', 'Excuse YOU.'], '*gurgle gurgle* ...HUNGRY.'],
    low: '*sad gurgle*', defeat: ['*HURK*', ['h', 'It coughed something up!'], ['h', 'The Wardstone! But it\'s... split in two?'], '*tiny burp* ...sorry.'] },
  boss_gagron: { intro: ['WHO dares walk into my beautiful cave?', ['h', 'Um, hello? Are you Gagron the Hideous?'], 'HIDEOUS?! Who keeps calling me that?! I will roast you for that, tiny hero!'],
    low: 'Not the face! Anything but the face!', defeat: ['Ugh... my chest... something is coming loose...', ['h', 'The shard! It was stuck inside you!'], 'Oh. OH. That feels SO much better. That nasty thing was whispering to me for weeks.', 'I think... I am shrinking? I am going to the village. I need a nap and a biscuit.', ['h', 'Wait, you were being controlled?'], 'Somebody threw that shard into my cave on purpose. Find them, little hero.'] },
  boss_crusher: { intro: ['BONECRUSHER SMASH!', 'Mum said I can keep the shiny rock if I smash everyone who comes!', ['h', 'Your mum said that?']],
    low: "Ow! I'm telling my mum!", defeat: ['MUUUUM! The hero was mean to me!'] },
  boss_gloom: { intro: ['Ah. More colour, walking right into my grey little forest.', ['h', 'Why did you steal all the colours?'], 'Red, green, they all look the same to me. So NOBODY gets to have them!'],
    low: 'Stop sparkling at me!', defeat: ["The colours... they're coming back. Ugh.", "They're so... pretty."] },
  boss_rattle: { intro: ['Yarr! Who goes there? Have ye seen me ship?', ['h', 'Your ship? This is a graveyard.'], 'No ship? Then ye be walkin\' the plank!'],
    low: 'Me bones! Me lovely bones!', defeat: ['Arr... I only wanted me ship back...', 'If ye ever find a boat, tell her old Rattlebones misses her.'] },
  boss_frost: { intro: ['Another warm little visitor. How dreadfully cosy.', ['h', 'Stop freezing everything, Your Majesty!'], 'Soon every land will be as quiet and lovely as mine. Frozen SOLID!'],
    defeat: ['Wait... stop! Look at the sky!', ['h', "It's... turning purple?"], 'You fool! My cold was the only thing slowing the dark magic down!', 'Without my snow, the Wardstone of the North will crack. Go to Elder Mittens. Hurry!'] },
  boss_grumble: { intro: ['WHO walks on Grumblefrost\'s path?!', ['h', 'Just passing through!'], 'Nobody passes! Grumblefrost guards the Queen. Grumblefrost ROLL you flat!'],
    defeat: ['Grumblefrost... sleepy now...', 'Wake Grumblefrost in spring. Or never. Never is good.'] },
  boss_twin_a: { intro: ['Two heroes against one? No, no...', 'TWO twins against one hero! Ha!', ['h', 'Can we talk about this?'], 'Hurt one of us and you hurt both. Try it!'],
    defeat: ['Sleet... we lost...', 'At least we lost TOGETHER.'] },
  thornbury_boss: { intro: ['Oi! Everything in Thornbury is MINE now!', ['h', 'Give it back!'], 'Ha! Including your pockets!'],
    low: 'Hands off my loot!', defeat: ['Alright, alright! Take your town back.', "I'm keeping the spoons, though."] },
  mossbrook_boss: { intro: ["Darling, you're just in time for my magic show!", 'For my next trick, I shall make YOU disappear!'],
    low: "You're ruining my big finale!", defeat: ['Nobody appreciates true art...'] },
  cinderholt_boss: { intro: ['KNEEL before the Lord of Cinderholt!', "It is very hot in this armour, so let's make this quick."],
    low: 'My armour is getting toasty!', defeat: ["I'm moving somewhere with... less lava."] },
};
// Once you have beaten a boss, its intro and defeat talk never play again for you.
const beatenBoss = (e) => [e.type, e.T.twin].some((k) => k && ((S.beat || {})[k] || Object.keys(QUESTS).some((q) => QUESTS[q].bossType === k && S.quests[q] && S.quests[q].state === 'done')));
function bossNextLine() {
  const B = bossIntro; B.li++; B.lineAt = B.t;
  const el = $('bosstalk');
  if (B.li >= B.lines.length) { el.hidden = true; return; }
  const ln = B.lines[B.li], hero = Array.isArray(ln), text = hero ? ln[1] : ln, e = B.e;
  B.lineLen = 5 + text.length * 0.09; // plenty of time to read; click or E moves on sooner
  const face = hero ? portrait(S.look) : e.T.look ? portrait({ ...NPC_BASE, ...e.T.look }) : null;
  el.className = hero ? 'hero' : 'boss';
  el.innerHTML = `<div class="bt-face">${face ? `<img src="${face}" alt="">` : `<span>${e.T.dragon ? '🐉' : '💀'}</span>`}</div><div class="bt-body"><b></b><p></p><small>Click or press E</small></div>`;
  el.querySelector('b').textContent = hero ? heroName() : e.T.name; el.querySelector('p').textContent = text;
  el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  if (hero) player.talkUntil = now + 1.2; else { e.play(e.clips.Cheer ? 'Cheer' : 'Idle_Combat', { once: true, fade: 0.15 }); sfx('slam'); }
  $('bossintro').classList.add('talking');
}
// Every press of E (or click) moves on straight away, even during the opening, so spamming E skips a scene fast.
function bossSkip() {
  const B = bossIntro, ms = performance.now(); if (!B || !B.lines.length || ms - (B.skipAt || 0) < 120) return;
  B.skipAt = ms;
  if (B.li < 0) B.t = Math.max(B.t, B.kind === 'intro' ? 2.5 : 0.6);
  bossNextLine();
}
// A boss shouts when it gets low on health: it reels back for a moment and the line pops up over its head.
let shoutEl = null;
function bossShout(e) {
  const L = BOSS_LINES[e.type]; if (!L || !L.low) return;
  if (!shoutEl) { shoutEl = document.createElement('div'); shoutEl.className = 'bossshout'; document.body.appendChild(shoutEl); }
  shoutEl.textContent = L.low; shoutEl.dataset.until = String(now + 2.6); shoutEl.e = e;
  shoutEl.classList.remove('pop'); void shoutEl.offsetWidth; shoutEl.classList.add('pop');
  e.staggerUntil = now + 0.8; burst(e.pos.clone().setY(3), '#ff6b5a', 40, 6, 1.2); sfx('slam');
}
function bossShoutTick() {
  if (!shoutEl) return;
  const e = shoutEl.e, on = e && now < +shoutEl.dataset.until && e.hp > 0 && e.inside === where;
  setShown(shoutEl, on); if (!on) return;
  const v = tmpV.copy(e.pos).setY((e.T.scale || 2) * 2.4 + 1.5).project(camera);
  pin(shoutEl, v);
}
function startBossScene(e, kind, custom) {
  requeueLetter(); closeDialog(); closeSheet(); cancelTask(); keys.clear(); moveTarget = null;
  const lines = custom || (BOSS_LINES[e.type] || {})[kind] || [];
  bossIntro = { e, t: 0, kind, lines, li: -1, lineAt: 0 };
  const el = $('bossintro');
  el.innerHTML = '<div class="bi-bar top"></div><div class="bi-bar bot"></div>';
  el.hidden = false; el.classList.remove('go', 'talking'); void el.offsetWidth; el.classList.add('go');
}
function startBossIntro(e) {
  e.introAt = now; e.lowSaid = false; requeueLetter(); closeDialog(); closeSheet(); cancelTask(); keys.clear(); moveTarget = null;
  bossIntro = { e, t: 0, kind: 'intro', lines: (BOSS_LINES[e.type] || {}).intro || [], li: -1, lineAt: 0 };
  $('bossintro').classList.remove('talking');
  e.face(player.pos.x, player.pos.z);
  e.play(e.clips.Cheer ? 'Cheer' : e.T.dragon ? 'Spellcasting' : 'Idle_Combat', { once: true, fade: 0.15 });
  const el = $('bossintro');
  el.innerHTML = `<div class="bi-bar top"></div><div class="bi-bar bot"></div><div class="bi-card"><small>${BOSS_TITLES[e.type] || e.T.title || 'A fearsome foe'}</small><b>${e.T.name}</b></div>`;
  el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  sfx('bossintro'); later(0.9, () => sfx('slam'));
  later(0.9, () => { if (bossIntro) burst(e.pos.clone().setY(2), '#ff6b5a', 60, 8, 1.6); });
}
function endBossIntro() {
  const e = bossIntro.e, kind = bossIntro.kind; bossIntro = null;
  if (e.type === 'pomp') { later(0.1, pompLeave); }
  // a big boss just lost: here comes Pompington to steal the glory
  else if (kind === 'defeat' && POMP_BOSSES.includes(e.type) && !(S.pompSeen || {})[e.type]) {
    S.pompSeen = { ...(S.pompSeen || {}), [e.type]: 1 }; const be = e;
    later(1.2, () => { if (!bossIntro && !player.dead && !roulette) pompArrive(be); });
  }
  $('bossintro').hidden = true; $('bosstalk').hidden = true;
  if (e.hp > 0) { e.state = 'chase'; e.play('Idle_Combat'); }
}
function introCam(dt) {
  const e = bossIntro.e, k = Math.min(1, bossIntro.t / 0.8);
  const p = player.pos, dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
  const big = e.T.scale || 2;
  if (e.type === 'pomp') {
    // a side-on two-shot for a person-sized chat, so both faces show
    const mx = (p.x + e.pos.x) / 2, mz = (p.z + e.pos.z) / 2, nx = -dz / d, nz = dx / d;
    const sx = nz < 0 ? -1 : 1; // always film from the camera's usual (south) side
    const want = tmpV.set(mx + nx * sx * 19, 6.5, mz + nz * sx * 19);
    camPos.lerp(want, 1 - Math.pow(0.02, dt)); camera.position.copy(camPos); camera.lookAt(mx, 1.9, mz);
    return;
  }
  // stand in front of the boss, looking up at it
  const back = 9 + big * 3.4 - k * 1.5; // starts wide and creeps in
  // swing round to the side a little, so your hero never blocks the view of the boss
  const sw = 0.6, ux = (dx / d) * Math.cos(sw) - (dz / d) * Math.sin(sw), uz = (dx / d) * Math.sin(sw) + (dz / d) * Math.cos(sw);
  const want = tmpV.set(e.pos.x - ux * back, 2.5 + big * 1.5, e.pos.z - uz * back);
  camPos.lerp(want, 1 - Math.pow(0.02, dt) * (1 - k * 0.5));
  camera.position.copy(camPos);
  camera.lookAt(e.pos.x, 1.2 + big * 1.0, e.pos.z);
}
function musicTick() {
  if (now < musicAt) return; musicAt = now + 0.5;
  if (!S.started || creator.open) { playMusic('village'); return; }
  const boss = player && enemies.some((e) => e.T.boss && e.inside === where && e.hp > 0 && (e.state === 'chase' || e.state === 'slam') && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 32);
  if (boss) playMusic('boss');
  else if (where === 'cave') playMusic('cave');
  else if (LANDS[where]) playMusic(where === 'marsh' || where === 'sands' ? where : 'frost');
  else if (where !== 'out' || (player && Math.hypot(player.pos.x, player.pos.z) < 50) || (player && Math.hypot(player.pos.x - 4, player.pos.z + 64) < 28)) playMusic('village');
  else playMusic('field');
}

// ---------- hero creator ----------
// A full-screen character screen: the hero turns on the left (drag to spin), choices on the right.
const NAME_IDEAS = ['Pip', 'Rowan', 'Elara', 'Bram', 'Juniper', 'Tamsin', 'Fen', 'Wren', 'Corin', 'Maeve', 'Odo', 'Lyra', 'Hollis', 'Briar', 'Cass', 'Nell', 'Alden', 'Isolde', 'Thorne', 'Mira', 'Toby', 'Saffron', 'Gideon', 'Posy'];
const creator = { open: false, mode: 'new', tab: 'body', yaw: 0, drag: null, close: false, before: null, light: null };
const uiLock = () => !$('pick').hidden || creator.open || !!roulette || !!bossIntro;
// Online, your name is your account's username: it is unique, so nobody can pretend to be someone else.
const heroName = () => (net.on && net.user ? net.user.name : (S.name || '').trim() || 'Hero');
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
  L.beard = L.sex === 'm' && Math.random() < 0.3 ? pickKey(BEARDS, ['none']) : 'none';
}
// Swap the hero's body (male knight or female rogue) without losing where they stand.
function rebuildHero() {
  if (!player) return;
  const pos = player.root.position.clone(), rot = player.root.rotation.y;
  for (const [k, g] of hairCache) if (k.endsWith(`|${HERO_HAIR.uid}`)) g.removeFromParent();
  for (const t of [tool, rod, pick]) if (t) t.removeFromParent();
  scene.remove(player.root);
  const hp = S.hp;
  startHero();
  S.hp = hp; player.root.position.copy(pos); player.root.rotation.y = rot;
}
// the Mythic Dark Skeleton look swaps your whole body for a skeleton's
const isSkel = (cos) => { const c = cos && cos.outfit && COS.outfit[cos.outfit]; return !!(c && c.skin === 'skeleton'); };
const heroSkel = () => isSkel(cosState().eq);
function heroModel() { return heroSkel() ? G.skel_minion : S.look.sex === 'f' ? G.heroine : G.knight; }
const SKEL_HIDE = ['Skeleton_Blade_1'];
// dark bones, a tattered violet cloak and glowing eyes
function skelPaint(a) {
  a.root.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || Array.isArray(o.userData.mats.toon) || !/^Skeleton_/.test(o.name)) return;
    if (!o.userData.ownMats) { o.userData.ownMats = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() }; o.userData.ownMats.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile; o.userData.mats = o.userData.ownMats; o.material = styled.on ? o.userData.mats.toon : o.userData.mats.std; }
    const eyes = /_Eyes$/.test(o.name), cloak = /_Cloak$/.test(o.name);
    for (const m of [o.userData.mats.std, o.userData.mats.toon]) {
      if (eyes) { m.color.set('#d9a8ff'); if (m.emissive) m.emissive.set('#a050ff').multiplyScalar(1.2); continue; }
      colourise(m, cloak ? 0.9 : 0.55); m.color.set(cloak ? '#3a2458' : '#5a5470');
      if (m.emissive) m.emissive.set(cloak ? '#1a0830' : '#120c22');
    }
  });
}
// The female body has no sword, shield or helmet of its own, so it borrows the knight's.
function borrowKnightGear() {
  if (heroModel() === G.knight) return;
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
const shadeSlider = (k) => `<label class="cc-shade"><span>Darker</span><input type="range" min="-100" max="100" step="5" data-shade="${k}" value="${Math.round((S.look[k] || 0) * 100)}" aria-label="Lighter or darker"><span>Lighter</span></label>`;
const field = (label, body, note = '') => `<section class="cc-field"><h4>${label}${note ? `<small>${note}</small>` : ''}</h4>${body}</section>`;
function renderCreator() {
  const L = S.look, el = $('creator');
  const tabs = { body: 'Body', face: 'Face', hair: 'Hair', outfit: 'Outfit' };
  let body = '';
  if (creator.tab === 'body') {
    body = field('Body', `<div class="cc-sex">${Object.entries(SEXES).map(([k, nm]) => `<button class="cc-sexbtn" data-part="sex" data-val="${k}" aria-pressed="${L.sex === k}"><b>${k === 'm' ? '&#9794;' : '&#9792;'}</b>${nm}</button>`).join('')}</div>`)
      + field('Skin tone', swatchRow('skin', SKIN_TONES) + shadeSlider('skinShade'))
      + field('Head size', chipRow('head', HEAD_SIZES))
      + field('Height', `<label class="cc-shade"><span>Shorter</span><input type="range" min="-100" max="100" step="5" data-shade="height" value="${Math.round((L.height || 0) * 100)}" aria-label="Height"><span>Taller</span></label>`)
      + field('Ears', chipRow('ears', { human: 'Round', elf: 'Pointy elf' }));
  } else if (creator.tab === 'face') {
    body = field('Eyes', picRow('eyeStyle', EYE_STYLES, 'eyes'))
      + field('Eye colour', swatchRow('eyes', EYE_COLOURS) + shadeSlider('eyeShade'))
      + field('Mouth', picRow('mouth', MOUTHS, 'mouth'))
      + field('Face marks', picRow('mark', MARKS, 'mark'))
      + field('Facial hair', chipRow('beard', BEARDS), 'matches your hair colour');
  } else if (creator.tab === 'hair') {
    body = field('Hair style', chipRow('hair', HAIR_STYLES))
      + (L.hair === 'none' ? '' : field('Length', chipRow('hairLen', HAIR_LENGTHS), 'how far it falls down your back'))
      + field('Hair colour', swatchRow('hairCol', HAIR_COLOURS) + shadeSlider('hairShade'), 'eyebrows match');
  } else {
    body = field('Outfit colour', swatchRow('outfit', LOOK_COLOURS) + shadeSlider('outfitShade'))
      + field('Cape colour', swatchRow('trim', LOOK_COLOURS) + shadeSlider('trimShade'))
      + field('Wear', `<div class="cc-chips"><button class="cc-chip" id="cc-cape" aria-pressed="${L.cape}">Cape</button><button class="cc-chip" id="cc-hat" aria-pressed="${L.hat}">Helmet</button></div>`, 'a helmet hides your hair')
      + '<p class="cc-note">Armour you find changes the colour of your arms and legs.</p>';
  }
  const isNew = creator.mode === 'new';
  el.innerHTML = `<div class="cc-stage" id="cc-stage" aria-hidden="true"><div class="cc-zoom"><button id="cc-zface" aria-pressed="${creator.close}">Face</button><button id="cc-zbody" aria-pressed="${!creator.close}">Full body</button></div><p class="cc-spin">Drag to turn your hero</p></div>
    <div class="cc-panel panel">
      <h2 class="cc-title">${isNew ? 'Create your hero' : 'Change your look'}</h2>
      ${net.on ? `<label class="cc-name"><span>Name</span><input id="cc-name" value="${heroName().replace(/"/g, '&quot;')}" disabled></label><p class="cc-namehint" id="cc-namehint">Online, your hero uses your username.</p>` : `<label class="cc-name"><span>Name</span><input id="cc-name" maxlength="16" autocomplete="off" spellcheck="false" value="${(S.name || '').replace(/"/g, '&quot;')}" placeholder="Name your hero"><button id="cc-rname" title="Pick a name for me" aria-label="Pick a name for me">&#127922;</button></label>
      <p class="cc-namehint" id="cc-namehint">Up to 16 letters, numbers, spaces, ' or -</p>`}
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
  let shadeAt = 0;
  el.querySelectorAll('[data-shade]').forEach((r) => {
    const upd = () => { L[r.dataset.shade] = +r.value / 100; const t = performance.now(); if (t - shadeAt > 60) { shadeAt = t; applyLook(); } };
    r.oninput = upd; r.onchange = () => { L[r.dataset.shade] = +r.value / 100; applyLook(); };
    r.ondblclick = () => { r.value = 0; r.onchange(); };
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
  if ($('cc-rname')) $('cc-rname').onclick = () => { S.name = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]; nm.value = S.name; updateTitle(); };
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
  if (!creator.light) { creator.light = new THREE.PointLight('#fff1dc', 9, 12, 1.6); lightSpots.unshift(creator.light); }
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
// While someone talks, the camera swoops in on them so you can see their face.
const tmpT = new THREE.Vector3();
// Short story camera moments: swing round to look at something big, then hand back to the player.
let camMoment = null;
function momentCam(dt) {
  const m = camMoment, p = player.pos, t = m.target; m.t += dt;
  let dx = p.x - t.x, dz = p.z - t.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  camPos.lerp(tmpV.set(p.x + dx * 11 - dz * 7, p.y + 3, p.z + dz * 11 + dx * 7), 1 - Math.pow(0.02, dt));
  camera.position.copy(camPos);
  if (camera.view && camera.view.enabled) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  if (talkCam.near0 && camera.near !== talkCam.near0) { camera.near = talkCam.near0; camera.updateProjectionMatrix(); }
  camera.lookAt(t.x, t.y + 2, t.z);
}
function talkCam(dt) {
  const n = talking.actor.pos, pp = player.pos, phone = camera.aspect < 1;
  let dx = pp.x - n.x, dz = pp.z - n.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  // stand off to one side of the pair so the speaker's face is in view and the hero isn't in the way
  const side = (a) => [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
  const A = side(1.5), B = side(-1.5), [cx, cz] = A[1] > B[1] ? A : B;
  const dist = phone ? 12 : 10;
  const mid = tmpT.set(n.x + (pp.x - n.x) * 0.25, 0, n.z + (pp.z - n.z) * 0.25);
  camPos.lerp(tmpV.set(mid.x + cx * dist, phone ? 5.6 : 4.4, mid.z + cz * dist), 1 - Math.pow(0.004, dt));
  camera.position.copy(camPos);
  camera.lookAt(mid.x, 2.5, mid.z);
  // slice away walls, rocks and bushes between the camera and the speaker
  if (!talkCam.near0) talkCam.near0 = camera.near;
  const near = Math.max(talkCam.near0, camPos.distanceTo(tmpV.set(mid.x, 2.5, mid.z)) - 3.2);
  if (Math.abs(camera.near - near) > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, 0, h * (phone ? 0.2 : 0.15), w, h);
}
function creatorCam(dt) {
  const p = player.pos, phone = innerWidth < 760;
  if (!creator.drag && now > creator.idleAt) creator.yaw += (Math.sin(now * 0.5) * 0.45 - creator.yaw) * Math.min(1, dt * 1.2);
  player.root.rotation.y = creator.yaw;
  const headY = 2.5 * (player.headScale || 1) ** 0.3;
  const hs = player.headScale || 1;
  const ty = creator.close ? headY + (hs - 1) * 0.4 - NECK_DROP * hs - 0.1 : 1.3 + (hs - 1) * 0.4, dist = (creator.close ? 4.9 * hs : 8.2 + (hs - 1) * 3) * (phone ? (creator.close ? 1.9 : 2.4) : 1);
  const want = tmpV.set(p.x, ty + (creator.close ? 0.5 : 1.6), p.z + dist);
  // clip away anything standing between the camera and the hero (bushes, fences)
  const near = Math.max(0.1, dist - 2.2);
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  camPos.lerp(want, 1 - Math.pow(0.0005, dt));
  camera.position.copy(camPos);
  camera.lookAt(p.x, ty, p.z);
  const w = innerWidth, h = innerHeight;
  // shift the picture so the hero sits in the open space: above the panel on phones, left of it on wider screens
  if (phone) camera.setViewOffset(w, h, 0, h * 0.33, w, h);
  else camera.setViewOffset(w, h, (Math.min(460, w * 0.42) + 24) / 2, 0, w, h);
  creator.light.position.set(p.x + 1.5, ty + 1.2, p.z + 3.5);
}

// ---------- crafting ----------
// Turn what you gather into food and gear. Cooking needs a fire, smithing needs Brom's forge,
// woodwork can be done anywhere. Crafting levels up as you make things and unlocks better recipes.
const CRAFTS = [
  { out: 'grilled_shrimp', n: 1, need: { shrimp: 1 }, lvl: 1, xp: 10, at: 'fire', cat: 'Cooking' },
  { out: 'grilled_trout', n: 1, need: { trout: 1 }, lvl: 5, xp: 22, at: 'fire', cat: 'Cooking' },
  { out: 'fish_pie', n: 1, need: { trout: 1, shrimp: 2, bread: 1 }, lvl: 10, xp: 45, at: 'fire', cat: 'Cooking' },
  { out: 'k_dagger', need: { copper_ore: 3, logs: 1 }, lvl: 1, xp: 30, at: 'forge', cat: 'Smithing' },
  { out: 'k_steel', need: { iron_ore: 4, logs: 1 }, lvl: 4, xp: 55, at: 'forge', cat: 'Smithing' },
  { out: 'sh_square', need: { iron_ore: 3, oak_logs: 2 }, lvl: 7, xp: 70, at: 'forge', cat: 'Smithing' },
  { out: 'ar_chain', need: { iron_ore: 8, bones: 4 }, lvl: 10, xp: 110, at: 'forge', cat: 'Smithing' },
  { out: 'k_axe', need: { iron_ore: 6, oak_logs: 3 }, lvl: 13, xp: 140, at: 'forge', cat: 'Smithing' },
  { out: 'sh_spike', need: { iron_ore: 6, bone_dust: 4 }, lvl: 16, xp: 170, at: 'forge', cat: 'Smithing' },
  { out: 'k_gold', need: { golden_crown: 1, iron_ore: 4 }, lvl: 20, xp: 260, at: 'forge', cat: 'Smithing' },
  { out: 'ar_gold', need: { golden_crown: 2, iron_ore: 6, ruby: 1 }, lvl: 25, xp: 380, at: 'forge', cat: 'Smithing' },
  { out: 'a_xbow', need: { logs: 4, copper_ore: 2 }, lvl: 2, xp: 35, at: 'any', cat: 'Woodwork' },
  { out: 'm_wand', need: { logs: 2, dark_essence: 1 }, lvl: 3, xp: 40, at: 'any', cat: 'Woodwork' },
  { out: 'm_staff', need: { oak_logs: 4 }, lvl: 6, xp: 60, at: 'any', cat: 'Woodwork' },
  { out: 'ar_leather', need: { logs: 2, bones: 6 }, lvl: 5, xp: 50, at: 'any', cat: 'Woodwork' },
  { out: 'a_heavy', need: { oak_logs: 5, iron_ore: 3 }, lvl: 12, xp: 130, at: 'any', cat: 'Woodwork' },
  { out: 'm_crystal', need: { oak_logs: 4, dark_essence: 3, ruby: 1 }, lvl: 18, xp: 220, at: 'any', cat: 'Woodwork' },
];
const STATION = { fire: 'a fire (the forge, the tavern or a campfire)', forge: "Brom's forge in the village", any: '' };
function nearStation(at) {
  if (at === 'any') return true;
  const p = player.pos, near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
  const brom = npcs.find((n) => n.id === 'brom');
  const forge = where === 'out' && brom && near(brom.actor.pos.x, brom.actor.pos.z, 7);
  if (at === 'forge') return forge;
  return forge || where === 'tavern' || (where === 'out' && near(CAMP.x, CAMP.z - 2, 6));
}
const craftName = (c) => (GEAR[c.out] ? GEAR[c.out].name : ITEMS[c.out]);
const craftIcon = (c) => (GEAR[c.out] ? gearIcon(GEAR[c.out]) : ICONS[c.out]);
function craftState(c) {
  const lack = Object.entries(c.need).filter(([k, n]) => (S.inv[k] || 0) < n);
  const times = Math.min(...Object.entries(c.need).map(([k, n]) => Math.floor((S.inv[k] || 0) / n)));
  if (GEAR[c.out] && S.owned.includes(c.out)) return { ok: false, why: 'You already have one', times: 0 };
  if (lvl('crafting') < c.lvl) return { ok: false, why: `Needs Crafting level ${c.lvl}`, times: 0 };
  if (lack.length) return { ok: false, why: 'Missing materials', times: 0 };
  if (!nearStation(c.at)) return { ok: false, why: `Go to ${STATION[c.at]}`, times };
  return { ok: true, times };
}
function craft(c, times = 1) {
  const st = craftState(c);
  if (!st.ok) { toast(st.why + '.', ICONS.hammer); return; }
  times = Math.max(1, Math.min(times, st.times, GEAR[c.out] ? 1 : 99));
  for (const [k, n] of Object.entries(c.need)) takeItem(k, n * times);
  if (GEAR[c.out]) { S.owned.push(c.out); toast(`You made a ${craftName(c)}! Equip it from your bag.`, craftIcon(c), true); }
  else { addItem(c.out, (c.n || 1) * times); toast(`You made ${times > 1 ? `${times} × ` : ''}${craftName(c).toLowerCase()}.`, craftIcon(c)); }
  player.play('Interact', { once: true, fade: 0.08, onFinish: () => player.play('Idle') }); player.busyUntil = now + 0.6;
  burst(player.pos.clone().setY(1.2), c.at === 'forge' ? '#ffb347' : c.at === 'fire' ? '#ff8a3a' : '#e8c890', 24, 4);
  giveXp('crafting', c.xp * times, player.pos.clone().setY(3.4));
  refreshUI(); save(); renderSheet();
}
function renderCraft(el) {
  const cats = [...new Set(CRAFTS.map((c) => c.cat))];
  el.innerHTML = `<h3>Crafting <small>level ${lvl('crafting')}</small></h3>
    <p class="hint">Cook fish at a fire, smith metal gear at Brom's forge, and carve wood anywhere. Making things levels up Crafting.</p>
    ${cats.map((cat) => `<h4 class="sub">${cat}${cat === 'Cooking' ? ' <small>at a fire</small>' : cat === 'Smithing' ? " <small>at Brom's forge</small>" : ' <small>anywhere</small>'}</h4><div class="crafts">${CRAFTS.filter((c) => c.cat === cat).map((c) => {
      const st = craftState(c), i = CRAFTS.indexOf(c), g = GEAR[c.out];
      const stats = g ? gearStats(g) : FOOD[c.out] ? `Heals ${FOOD[c.out].heal}` : '';
      return `<div class="craft${st.ok ? ' ready' : ''}${lvl('crafting') < c.lvl ? ' locked' : ''}">
        <img class="out" src="${craftIcon(c)}" alt="">
        <div class="cinfo"><b>${craftName(c)}</b><small>${stats}${stats ? ' · ' : ''}Lv ${c.lvl}</small>
          <div class="need">${Object.entries(c.need).map(([k, n]) => `<span class="${(S.inv[k] || 0) >= n ? 'have' : 'miss'}" title="${ITEMS[k]}"><img src="${ICONS[k]}" alt="">${S.inv[k] || 0}/${n}</span>`).join('')}</div>
          ${st.ok ? '' : `<em>${st.why}</em>`}</div>
        <div class="cbtns"><button data-craft="${i}" ${st.ok ? '' : 'disabled'}>Make</button>${!g && st.ok && st.times > 1 ? `<button data-craftall="${i}">All ${st.times}</button>` : ''}</div>
      </div>`;
    }).join('')}</div>`).join('')}`;
  el.querySelectorAll('[data-craft]').forEach((b) => { b.onclick = () => craft(CRAFTS[+b.dataset.craft], 1); });
  el.querySelectorAll('[data-craftall]').forEach((b) => { b.onclick = () => craft(CRAFTS[+b.dataset.craftall], 99); });
}



// ---------- see-through buildings ----------
// When a building stands between the camera and your hero, it fades so you can still see them.
const occluders = [];
const occRay = new THREE.Ray();
let occAt = 0;
function buildOccluders() {
  for (const o of [...scene.children, ...(regions.valley ? regions.valley.children : [])]) if (/^building_|^tent$/.test(o.name)) { o.updateMatrixWorld(true); occluders.push({ o, box: new THREE.Box3().setFromObject(o), f: 1, want: 1 }); }
}
function setFade(O, f) {
  O.f = f;
  O.o.traverse((m) => {
    if (!m.isMesh || !m.userData.mats || m.userData.isInk) return;
    if (!m.userData.ownMats) {
      const k = { std: m.userData.mats.std.clone(), toon: m.userData.mats.toon.clone() };
      k.toon.onBeforeCompile = m.userData.mats.toon.onBeforeCompile; registerMesh(m, k); m.userData.ownMats = true;
    }
    for (const mat of [m.userData.mats.std, m.userData.mats.toon]) { mat.transparent = f < 0.99; mat.opacity = f; mat.depthWrite = f > 0.99; }
    m.layers.set(f < 0.99 ? 1 : 0); m.castShadow = true;
  });
}
function occluderTick(dt) {
  if (!player) return;
  if (now > occAt) {
    occAt = now + 0.12;
    const to = tmpV.copy(player.pos).setY(1.6);
    occRay.origin.copy(camera.position); occRay.direction.copy(to).sub(camera.position);
    const far = occRay.direction.length(); occRay.direction.normalize();
    const hit = new THREE.Vector3();
    for (const O of occluders) {
      const p = where === 'out' && occRay.intersectBox(O.box, hit);
      O.want = p && hit.distanceTo(camera.position) < far - 1 ? 0.3 : 1;
    }
  }
  for (const O of occluders) if (Math.abs(O.f - O.want) > 0.01) setFade(O, O.f + Math.sign(O.want - O.f) * Math.min(Math.abs(O.want - O.f), dt * 4));
}

// ---------- monster towns ----------
// Monsters have taken over little towns in the woods. Each town has a star rating: the monsters there are
// tougher than out in the fields, and the more stars, the nastier they get. Beat the town's tyrant to free it,
// fly your flag, and the grateful townsfolk send coins to your bank every few minutes.
const TOWN_TIERS = {
  1: { hp: 1.6, hit: 2, xp: 1.8, tint: '#e8b070', tag: 'Tough' },
  2: { hp: 2.4, hit: 4, xp: 2.8, tint: '#e07a6a', tag: 'Fierce' },
  3: { hp: 3.4, hit: 6, xp: 4, tint: '#9a7ae8', tag: 'Dreadful' },
};
const TOWN_BOSS = {
  thornbury: { name: 'Gristle the Grabby', model: 'skel_minion', weapon: 'axe_1handed', drop: 'silver_ring' },
  mossbrook: { name: 'Madame Marrow', model: 'skel_mage', weapon: 'Skeleton_Staff', ranged: true, spread: true, drop: 'ruby' },
  cinderholt: { name: 'Lord Cinderbones', model: 'skel_warrior', weapon: 'axe_2handed', drop: 'golden_crown' },
  iciclehollow: { name: 'Sir Shiverbones', model: 'skel_minion', weapon: 'Skeleton_Blade', drop: 'frost_gem' },
  pinecrest: { name: 'Granny Frostbite', model: 'skel_mage', weapon: 'Skeleton_Staff', ranged: true, spread: true, drop: 'frost_gem' },
  glaciergate: { name: 'The Glacier Baron', model: 'skel_warrior', weapon: 'axe_2handed', drop: 'golden_crown' },
  bogbottom: { name: 'Lord Mudsworth', model: 'skel_warrior', weapon: 'axe_2handed', drop: 'ruby' },
  reedwhistle: { name: 'The Reed Hag', model: 'skel_mage', weapon: 'Skeleton_Staff', ranged: true, spread: true, drop: 'golden_crown' },
  dunecrest: { name: 'Baron Rivet', model: 'skel_warrior', weapon: 'axe_2handed', drop: 'ruby' },
  copperspring: { name: 'The Copper Countess', model: 'skel_mage', weapon: 'Skeleton_Staff', ranged: true, spread: true, drop: 'golden_crown' },
};
// which monsters guard each town: tougher towns have more of the nasty ones
const TOWN_MIX = {
  1: ['skel_minion', 'skel_minion', 'skel_warrior', 'skel_minion', 'skel_mage'],
  2: ['skel_warrior', 'skel_mage', 'skel_minion', 'skel_warrior', 'skel_mage', 'skel_minion'],
  3: ['skel_warrior', 'skel_warrior', 'skel_mage', 'skel_mage', 'skel_warrior', 'skel_minion', 'skel_mage'],
};
const TOWN_FOLK = {
  thornbury: [{ name: 'Tuppence', model: 'barbarian', look: { skin: 'tan', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'none', beard: 'curly', hairCol: 'snow', head: 'chibi' }, tint: '#ffd9a8' },
    { name: 'Clover', model: 'heroine', look: { sex: 'f', skin: 'peach', eyes: 'green', eyeStyle: 'round', mouth: 'smile', hair: 'twin', hairLen: 'shoulder', hairCol: 'ginger', mark: 'freckles' }, tint: '#c8f0a0' }],
  mossbrook: [{ name: 'Elder Willow', model: 'mage', look: { sex: 'f', skin: 'porcelain', eyes: 'sky', eyeStyle: 'sleepy', mouth: 'calm', hair: 'bun', hairCol: 'snow', mark: 'rosy' }, tint: '#a8e0c8' },
    { name: 'Pebble', model: 'knight', look: { skin: 'bronze', eyes: 'gold', eyeStyle: 'round', mouth: 'grin', hair: 'spiky', hairCol: 'black' }, tint: '#ffe08a' }],
  cinderholt: [{ name: 'Baroness Ember', model: 'mage', look: { sex: 'f', skin: 'ebony', eyes: 'red', eyeStyle: 'sharp', mouth: 'cat', hair: 'hime', hairLen: 'long', hairCol: 'pink', mark: 'star' }, tint: '#ffb0a0' },
    { name: 'Old Flint', model: 'barbarian', look: { skin: 'honey', eyes: 'grey', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', beard: 'full', hairCol: 'chestnut' }, tint: '#d0c0a0' }],
  iciclehollow: [{ name: 'Mitzi Snowdrift', model: 'heroine', look: { sex: 'f', skin: 'porcelain', eyes: 'blue', eyeStyle: 'round', mouth: 'smile', hair: 'bob', hairCol: 'snow', mark: 'rosy' }, tint: '#cfe8ff' },
    { name: 'Bjorn Mittens', model: 'barbarian', look: { skin: 'peach', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'none', beard: 'full', hairCol: 'ginger', head: 'chibi' }, tint: '#a8c8ff' }],
  pinecrest: [{ name: 'Old Needles', model: 'mage', look: { skin: 'tan', eyes: 'green', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', beard: 'long', hairCol: 'snow' }, tint: '#9fd8b0' },
    { name: 'Juniper', model: 'heroine', look: { sex: 'f', skin: 'bronze', eyes: 'gold', eyeStyle: 'sharp', mouth: 'grin', hair: 'pony', hairLen: 'long', hairCol: 'black' }, tint: '#c8f0d8' }],
  glaciergate: [{ name: 'Captain Floe', model: 'knight', look: { skin: 'ebony', eyes: 'sky', eyeStyle: 'round', mouth: 'smile', hair: 'short', hairCol: 'snow' }, tint: '#bfe6ff' },
    { name: 'Lady Hailstone', model: 'mage', look: { sex: 'f', skin: 'porcelain', eyes: 'violet', eyeStyle: 'sharp', mouth: 'cat', hair: 'hime', hairLen: 'long', hairCol: 'lilac', mark: 'star' }, tint: '#d8c8ff' }],
  bogbottom: [{ name: 'Granny Reedle', model: 'mage', look: { sex: 'f', skin: 'green', eyes: 'gold', eyeStyle: 'sleepy', mouth: 'smile', hair: 'bun', hairCol: 'snow', mark: 'rosy' }, tint: '#a8d890' },
    { name: 'Puddles', model: 'barbarian', look: { skin: 'tan', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'shag', hairCol: 'chestnut', beard: 'stache', head: 'chibi' }, tint: '#c8b080' }],
  reedwhistle: [{ name: 'Piper Wren', model: 'heroine', look: { sex: 'f', skin: 'bronze', eyes: 'green', eyeStyle: 'round', mouth: 'smile', hair: 'twin', hairLen: 'shoulder', hairCol: 'ginger', mark: 'freckles' }, tint: '#b8e09a' },
    { name: 'Old Croaker', model: 'knight', look: { skin: 'green', eyes: 'gold', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', beard: 'full', hairCol: 'snow' }, tint: '#9ac08a' }],
  dunecrest: [{ name: 'Sandy Saffron', model: 'heroine', look: { sex: 'f', skin: 'bronze', eyes: 'gold', eyeStyle: 'round', mouth: 'smile', hair: 'braid', hairLen: 'long', hairCol: 'black', mark: 'freckles' }, tint: '#f0c070' },
    { name: 'Grandpa Gasket', model: 'barbarian', look: { skin: 'tan', eyes: 'grey', eyeStyle: 'sleepy', mouth: 'calm', hair: 'none', beard: 'long', hairCol: 'snow', head: 'chibi' }, tint: '#d8a850' }],
  copperspring: [{ name: 'Rosie Rivets', model: 'heroine', look: { sex: 'f', skin: 'peach', eyes: 'green', eyeStyle: 'sharp', mouth: 'grin', hair: 'twin', hairLen: 'shoulder', hairCol: 'ginger', mark: 'paint' }, tint: '#e0885a' },
    { name: 'Mr Sprocket', model: 'knight', look: { skin: 'ebony', eyes: 'sky', eyeStyle: 'round', mouth: 'smile', hair: 'short', hairCol: 'snow' }, tint: '#c8984a' }],
};
// frost towns are a chapter harder: they use the frost monsters, and pay (and cost) more
const LAND_TOWN = { frost: { mobs: { skel_minion: 'frost_minion', skel_warrior: 'frost_warrior', skel_mage: 'frost_mage' }, mult: 2.5, hp: 1.8, hit: 1.7, xp: 3 },
  marsh: { mobs: { skel_minion: 'bog_knight', skel_warrior: 'bog_knight', skel_mage: 'bog_witchling' }, mult: 5, hp: 3.2, hit: 2.8, xp: 8 },
  sands: { mobs: { skel_minion: 'clock_soldier', skel_warrior: 'clock_soldier', skel_mage: 'clock_conjurer' }, mult: 9, hp: 4.8, hit: 4, xp: 14 } };
const townMult = (T) => (T.land ? LAND_TOWN[T.land].mult : 1);
for (const T of TOWNS) {
  const tier = TOWN_TIERS[T.stars];
  const m = townMult(T), inside = T.land || 'out';
  for (const k of ['skel_minion', 'skel_warrior', 'skel_mage']) {
    const b = ENEMY_TYPES[T.land ? LAND_TOWN[T.land].mobs[k] : k];
    ENEMY_TYPES[`${T.id}_${k}`] = { ...b, model: k, name: `${tier.tag} ${b.name}`, hp: Math.round(b.hp * tier.hp), maxHit: b.maxHit + tier.hit, xp: Math.round(b.xp * tier.xp), tint: tier.tint, town: T.id, inside, coins: [Math.round(5 * T.stars * m), Math.round(12 * T.stars * m)] };
  }
  ENEMY_TYPES[`${T.id}_boss`] = { ...TOWN_BOSS[T.id], title: `Tyrant of ${T.name}`, hp: Math.round((110 + 90 * T.stars) * (T.land ? LAND_TOWN[T.land].hp : 1)), maxHit: Math.round((5 + 2 * T.stars) * (T.land ? LAND_TOWN[T.land].hit : 1)), xp: Math.round((500 + 400 * T.stars) * (T.land ? LAND_TOWN[T.land].xp : 1)), boss: true,
    scale: 2 + 0.15 * T.stars, coins: [Math.round(80 * T.stars * m), Math.round(140 * T.stars * m)], slam: 4.5 + T.stars * 0.5, town: T.id, tint: tier.tint, inside };
  toughen(ENEMY_TYPES[`${T.id}_boss`]);
}
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const townFree = (id) => !!((S.towns && S.towns[id]) || remoteMayor(id));
const townMine = (id) => !!(S.towns && S.towns[id]);
// online: a town another player runs
const remoteMayor = (id) => { const r = net.on && net.towns.get(id); return r && r.mayor_id && r.mayor_id !== net.user.id ? r : null; };
function buildTownMonsters() {
  for (const T of TOWNS) {
    const mix = TOWN_MIX[T.stars];
    mix.forEach((k, i) => { const a = (i / mix.length) * Math.PI * 2 + 0.3, r = 4.5 + (i % 2) * 2.5; spawnEnemy(`${T.id}_${k}`, T.x + Math.cos(a) * r, T.z + Math.sin(a) * r); });
    spawnEnemy(`${T.id}_boss`, T.x + 2.6, T.z + 1.2);
  }
}
// after loading a save: towns you already freed stay free
function applyTowns() {
  for (const T of TOWNS) if (!T.signTex) buildTownSign(T);
  for (const T of TOWNS) { if (townFree(T.id)) liberateTown(T, true); else applyTownLooks(T); }
}
function liberateTown(T, quiet = false, remote = false) {
  S.towns = S.towns || {};
  if (!remote && !S.towns[T.id]) {
    S.towns[T.id] = heroName();
    // online, the buildings stay with the town when it changes hands
    const r = net.on && net.towns.get(T.id);
    if (r && r.lvl) S.townLvl = { ...(S.townLvl || {}), [T.id]: r.lvl };
  }
  if (!remote && net.on) setTown(T.id, { mayor_id: net.user.id, mayor_name: heroName(), lvl: townLvl(T) });
  for (const n of T.folk || []) { n.inside = undefined; n.actor.root.visible = true; }
  T.flagRed.visible = false; T.flagBlue.visible = true;
  for (const o of T.junk) o.visible = false;
  for (const o of T.homely) o.visible = true;
  for (const e of enemies) {
    if (e.T.town !== T.id) continue;
    if (quiet) { e.hp = 0; e.state = 'gone'; e.root.visible = false; e.bar.hidden = true; continue; }
    if (e.hp > 0) {
      // the rest of the gang falls apart when their tyrant goes down
      e.hp = 0; e.state = 'dead'; e.bar.hidden = true;
      later(0.2 + rng() * 0.8, () => { e.play('Death_A', { once: true, clamp: true, fade: 0.1 }); later(0.75, () => collapse(e)); });
    }
    later(5, () => { e.state = 'gone'; if (e.pile) { scene.remove(e.pile.g); piles.splice(piles.indexOf(e.pile), 1); e.pile = null; } e.root.visible = false; });
  }
  if (!T.folk) {
    T.folk = (TOWN_FOLK[T.id] || []).map((f, i) => {
      const a = (i ? -0.9 : 0.9) + townFacing(T);
      return makeNpc({ id: `${T.id}_folk${i}`, name: f.name, model: f.model, x: T.x + Math.cos(a) * 4, z: T.z + Math.sin(a) * 4, hide: [], tint: f.tint, look: f.look,
        clerk: i === 0 ? T.id : undefined,
        lines: [`Thank you, Mayor! ${T.name} is ours again!`, `We pay our taxes into your bank every game week. Talk to the town clerk to spend them on the town!`, `The monsters left an awful mess. And they never once wiped their feet.`] });
    });
    T.folk[0].name = `${T.folk[0].name}, town clerk`;
  }
  applyTownLooks(T);
  if (quiet) return;
  const coins = 120 * T.stars, xp = 600 * T.stars;
  S.coins += coins; giveHeroXp(xp, new THREE.Vector3(T.x, 5, T.z));
  later(1.2, () => { sfx('win'); toast(`${T.name} is free, and you are its new Mayor! The citizens give you ${coins} coins and will pay taxes every game week. Talk to the town clerk to upgrade the town.`, ICONS.coins, true); });
  burst(new THREE.Vector3(T.x, 4, T.z), '#8fd0ff', 90, 9, 1.8);
  burst(new THREE.Vector3(T.x, 2, T.z), '#ffe07a', 60, 6, 1.4);
  floatText(new THREE.Vector3(T.x, 6, T.z), `${T.name} freed!`, 'gain');
  refreshUI(); save();
}
function townTick() { mayorTick(); }
function syncTowns() {
  if (!player) return;
  for (const T of TOWNS) {
    const r = net.towns.get(T.id), mine = townMine(T.id);
    if (!r) { if (mine) setTown(T.id, { mayor_id: net.user.id, mayor_name: heroName(), lvl: townLvl(T) }); continue; }
    if (r.mayor_id === net.user.id) { if (!mine) { S.towns = S.towns || {}; S.towns[T.id] = heroName(); liberateTown(T, true, true); } continue; }
    const wasFree = T.flagBlue.visible;
    if (mine) {
      delete S.towns[T.id];
      toast(r.mayor_id ? `${r.mayor_name || 'Another player'} took ${T.name} from you!` : `Someone used a Dark Omen on ${T.name}! Monsters have taken it back.`, ICONS.dark_omen, true);
      save();
    }
    if (r.mayor_id && !wasFree) liberateTown(T, true, true);
    else if (!r.mayor_id && wasFree) darkOmen(T, true);
    else refreshSign(T);
  }
}

// ---------- crew ----------
// Adventurers who live around the valley. Talk to them (or open the Crew menu) to set each one as:
//   Ally    - follows you everywhere and fights by your side (you pick how: charge in, protect you, or just follow)
//   Neutral - lives their own life near home and only fights monsters that come too close
//   Rival   - hunts you down for a duel whenever you wander near. Beat them for coins and XP!
const CREW_DEFS = [
  { id: 'bramble', name: 'Sir Bramble', title: 'Knight of the Hedgerow', model: 'knight', hide: ['Knight_Helmet'], style: 'melee', anim: '1H_Melee_Attack_Slice_Diagonal', hp: 60, hit: [3, 6], cd: 1.0, reach: 2.4, tint: '#a8d8ff', home: [9, 36],
    look: { skin: 'peach', eyes: 'blue', eyeStyle: 'round', mouth: 'grin', hair: 'hero', hairCol: 'blonde' },
    say: { hi: 'Ho there, friend! Sir Bramble, knight of the hedgerow, at your service. Shall we ride together?', ally: ['Onward!', 'I have your back!', 'For glory!'], hit: ['Have at thee!', 'Hah!', 'Take that, rascal!'], hurt: ['Oof!', 'A mere scratch!'], ko: 'I shall... rest my eyes... briefly...', rival: ['En garde!', 'A duel! At last!'], lose: 'You fight well! I yield... for now.', win: 'Victory! Better luck next time, friend.', idle: ['Polishing my sword. Again.', 'Lovely day for a quest, is it not?', 'I once fought a goose. It won.'], talkAlly: 'Where to next, partner? Point me at a monster!', talkRival: 'Ha! Come to settle our duel, have you?' } },
  { id: 'saffy', name: 'Saffy Quickshot', title: 'Wandering Crossbow', model: 'heroine', weapon: 'crossbow_1handed', style: 'ranged', anim: '1H_Ranged_Shoot', hp: 45, hit: [2, 6], cd: 1.0, reach: 9, tint: '#c8f0a0', home: [11, 27],
    look: { sex: 'f', skin: 'tan', eyes: 'green', eyeStyle: 'sharp', mouth: 'fang', hair: 'long', hairLen: 'long', hairCol: 'ginger', mark: 'freckles' },
    say: { hi: 'Name is Saffy. Fastest crossbow in the valley. Need a sharp eye on your team?', ally: ['Got it in my sights!', 'Right behind you!', 'Let us go!'], hit: ['Bullseye!', 'Too easy!', 'Got one!'], hurt: ['Hey!', 'Ow, rude!'], ko: 'Ugh... somebody... bring snacks...', rival: ['Try and keep up!', 'Bet you cannot dodge this!'], lose: 'Fine, fine. You win this round!', win: 'Ha! Too slow!', idle: ['Just counting my bolts. Forty two. Again.', 'Saw a squirrel earlier. Very suspicious.'], talkAlly: 'I will cover you from back here. Lead the way!', talkRival: 'Back for another lesson?' } },
  { id: 'gus', name: 'Big Gus', title: 'Gentle Giant', model: 'barbarian', hide: ['Mug'], weapon: 'axe_2handed', style: 'melee', label: 'Big axe', heavy: true, anim: '2H_Melee_Attack_Chop', hp: 85, hit: [4, 9], cd: 1.6, reach: 2.8, tint: '#ffcf9a', home: [-6, 31],
    look: { skin: 'bronze', eyes: 'brown', eyeStyle: 'happy', mouth: 'grin', hair: 'mohawk', hairCol: 'black', beard: 'full', head: 'chibi' },
    say: { hi: 'Gus big. Gus strong. Gus also likes flowers. You want Gus to come smash things?', ally: ['Gus coming!', 'Smash time!', 'Gus help friend!'], hit: ['SMASH!', 'Bonk!', 'Gus hit good!'], hurt: ['Gus not like that.', 'Ouchie.'], ko: 'Gus... take... little nap...', rival: ['Gus fight you now. Sorry.', 'No hard feelings. SMASH!'], lose: 'You strong! Gus proud of you!', win: 'Gus win! You want hug?', idle: ['This flower called Daisy. Gus named her.', 'Gus hungry. Gus always hungry.'], talkAlly: 'Gus stay close. Gus protect friend!', talkRival: 'Gus ready for rematch!' } },
  { id: 'nyx', name: 'Nyx', title: 'Mischief Mage', model: 'mage', style: 'magic', anim: 'Spellcast_Shoot', hp: 40, hit: [3, 7], cd: 1.3, reach: 9, tint: '#e0b0ff', home: [-30, 3],
    look: { sex: 'f', skin: 'porcelain', eyes: 'violet', eyeStyle: 'sleepy', mouth: 'cat', hair: 'bob', hairCol: 'pink', mark: 'star', ears: 'elf', hat: true },
    say: { hi: 'Oh! A hero. How delightful. I am Nyx. I do magic, mostly on purpose. Want some on your side?', ally: ['Ooh, sparkly!', 'Magic time!', 'Leave it to me!'], hit: ['Kazam!', 'Fizz!', 'Oops, was that you?'], hurt: ['Rude!', 'My hat!'], ko: 'I meant to do that...', rival: ['Hee hee, let us play!', 'Prepare to be turned into a toad! Probably.'], lose: 'Hmph. Lucky shot. I let you win.', win: 'Toad time! Kidding. Mostly.', idle: ['I turned a frog into a slightly different frog today.', 'Do you smell burnt toast? That might be me.'], talkAlly: 'Lead on! I will make things go boom.', talkRival: 'Oh, you again! Shall we sparkle?' } },
];
const CREW_STYLE = { melee: 'Sword', ranged: 'Crossbow', magic: 'Magic' };
const CREW_MODES = { ally: ['Ally', 'Follows you and fights with you'], neutral: ['Neutral', 'Does their own thing'], rival: ['Rival', 'Hunts you for a duel'] };
const CREW_TACTICS = { charge: ['Charge in', 'Attacks any monster near you'], guard: ['Protect me', 'Only fights monsters that go for you'], follow: ['Just follow', 'Stays out of fights'] };
const crew = [];
const pickOne = (arr) => arr[Math.floor(rng() * arr.length)];
const crewCfg = (c) => { S.crew = S.crew || {}; return (S.crew[c.id] = S.crew[c.id] || { mode: 'neutral', tactic: 'charge' }); };
const isRival = (c) => crewCfg(c).mode === 'rival';
const crewMax = (c) => Math.round((c.def.hp + heroLvl() * 5) * (isRival(c) ? 0.75 : 1)); // rivals are a fair duel, not a wall
const crewUp = (c) => c.hp > 0 && c.state !== 'ko';
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const NPC_BASE = { skin: 'peach', eyes: 'brown', eyeStyle: 'round', mouth: 'smile', mark: 'none', hair: 'short', hairLen: 'short', hairCol: 'chestnut', ears: 'human', head: 'big', beard: 'none', hat: false, sex: 'm' };
function buildCrew() {
  for (const d of CREW_DEFS) {
    const L = { ...NPC_BASE, ...d.look };
    const hide = [...(d.hide || [])];
    if (!L.hat) hide.push('Barbarian_Hat', 'Mage_Hat', 'Knight_Helmet');
    const a = new Actor(G[d.model], { hide, scale: 1.3 });
    dressNpc(a, L);
    if (d.weapon && lib[d.weapon]) { const w = lib[d.weapon].clone(true); stylize(w); a.attach(w); addInk(w); }
    a.root.traverse((o) => {
      if (!o.isMesh || !o.userData.mats || !/_(Body)$/.test(o.name)) return;
      const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
      m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
      m.std.color.set(d.tint); m.toon.color.set(d.tint); registerMesh(o, m);
    });
    a.root.position.set(d.home[0], 0, d.home[1]); pushOut(a.root.position, 0.8);
    a.play('Idle');
    const tag = document.createElement('div'); tag.className = 'crewtag'; tag.hidden = true;
    tag.innerHTML = '<span class="cs" hidden></span><b></b><i><u></u></i>';
    tag.querySelector('b').textContent = d.name;
    document.body.appendChild(tag);
    const c = {
      crew: true, isCrew: true, def: d, id: d.id, name: d.name, actor: a, look: L, reach: 3, hp: null, inside: 'out', tag,
      home: new THREE.Vector2(a.pos.x, a.pos.z), state: 'idle', nextHit: 0, busyUntil: 0, wanderAt: 0, wander: null, koUntil: 0, calmUntil: 0, sayUntil: 0, hurtAt: -99,
      kb: new THREE.Vector2(), foe: null, stuckT: 0,
      get x() { return this.actor.pos.x; }, get z() { return this.actor.pos.z; }, get pos() { return this.actor.pos; },
      get accent() { const m = crewCfg(this).mode; return m === 'ally' ? '#3aa860' : m === 'rival' ? '#d8433a' : '#8f62d8'; },
    };
    crew.push(c);
  }
}
function say(c, text) {
  if (!text) return;
  c.sayUntil = now + 2.8;
  const s = c.tag.querySelector('.cs'); s.textContent = text; s.hidden = false;
  s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
}
// Walk towards a spot; returns how far is left. Slides round trees, and warps if properly stuck.
function crewMove(c, x, z, speed, dt, stopAt = 0.3) {
  const p = c.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d <= stopAt) return d;
  const ox = p.x, oz = p.z, st = Math.min(d - stopAt, speed * dt);
  p.x += (dx / d) * st; p.z += (dz / d) * st;
  collide(p, 0.6);
  // bumped into something: try sliding along it
  if (Math.hypot(p.x - ox, p.z - oz) < st * 0.4) { const side = (c.id.length % 2 ? 1 : -1); p.x = ox + (-dz / d) * st * side; p.z = oz + (dx / d) * st * side; collide(p, 0.6); }
  c.stuckT = Math.hypot(p.x - ox, p.z - oz) < st * 0.2 ? c.stuckT + dt : 0;
  const want = Math.atan2(dx, dz); let diff = want - c.actor.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  c.actor.root.rotation.y += diff * Math.min(1, dt * 12);
  if (now > c.busyUntil) c.actor.play(speed > 5 ? 'Running_A' : 'Walking_A', { fade: 0.12, speed: speed > 9 ? 1.4 : 1.1 });
  return d;
}
function crewIdle(c, combat) { if (now > c.busyUntil && c.actor.name !== 'Lie_Idle') c.actor.play(combat ? '2H_Melee_Idle' : 'Idle', { fade: 0.2 }); }
function crewWarp(c, x, z) { burst(c.pos.clone().setY(1), '#ffffff', 14, 3); c.pos.set(x, 0, z); collide(c.pos, 0.6); burst(c.pos.clone().setY(1), '#ffffff', 14, 3); c.stuckT = 0; }
// the nearest thing this crew member should hit: monsters (and rivals, for allies)
function crewFindFoe(c, center, radius, onlyAngry) {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (e.hp <= 0 || e.state === 'dead' || e.state === 'rising' || e.state === 'gone' || e.inside !== c.inside) continue;
    if (onlyAngry && e.state !== 'chase' && e.state !== 'slam') continue;
    if (dist2d(e.pos, center) > radius) continue;
    const d = dist2d(e.pos, c.pos); if (d < bd) { bd = d; best = e; }
  }
  if (crewCfg(c).mode === 'ally') for (const o of crew) {
    if (o === c || !isRival(o) || !crewUp(o) || o.inside !== c.inside || dist2d(o.pos, center) > radius) continue;
    const d = dist2d(o.pos, c.pos); if (d < bd) { bd = d; best = o; }
  }
  return best;
}
const foeAlive = (f) => f && (f === player ? !player.dead : f.isCrew ? crewUp(f) && isRival(f) : f.hp > 0 && f.state !== 'dead' && f.state !== 'gone' && f.state !== 'rising');
const crewDmg = (c) => (rng() < 0.12 ? 0 : Math.round((c.def.hit[0] + rng() * (c.def.hit[1] - c.def.hit[0])) * (1 + (heroLvl() - 1) * 0.07)));
let crewHitting = false;
// a crew member lands a blow on t (a monster, a rival, or you)
function crewStrike(c, t) {
  const dmg = crewDmg(c);
  if (t === player) { const d = Math.round(dmg * 0.6); if (dodging()) { floatText(player.pos.clone().setY(3.6), 'Dodged!', 'miss'); return; } hurtPlayer(d); return; }
  if (t.isCrew) { hurtCrew(t, dmg, c); return; }
  const hs = hitStopUntil; crewHitting = true;
  hurtEnemy(t, dmg, c.pos, c.def.heavy ? 1.3 : 1);
  crewHitting = false; hitStopUntil = hs;
  if (!t.T.boss && t.hp > 0) t.foe = c;
  if (rng() < 0.18) say(c, pickOne(c.def.say.hit));
}
function crewFight(c, foe, dt) {
  const fp = foe.pos, d = dist2d(fp, c.pos), D = c.def, far = D.style !== 'melee';
  if (d > D.reach) { crewMove(c, fp.x, fp.z, 7.6, dt, D.reach * 0.85); return; }
  c.actor.face(fp.x, fp.z);
  if (now < c.nextHit) { crewIdle(c, true); return; }
  c.nextHit = now + D.cd + rng() * 0.5; c.busyUntil = now + 0.6;
  c.actor.play(D.anim, { once: true, fade: 0.08, speed: 1.2, onFinish: () => crewIdle(c, true) });
  later(far ? 0.3 : 0.32, () => {
    if (!crewUp(c) || !foeAlive(foe)) return;
    if (far) {
      const dir = new THREE.Vector3(fp.x - c.pos.x, 0, fp.z - c.pos.z).normalize();
      const owner = foe === player ? 'enemy' : 'ally';
      shoot(c.pos.clone().setY(1.7).addScaledVector(dir, 0.8), dir, D.style === 'ranged' ? 'bolt' : 'orb', D.reach + 3, owner, (t) => crewStrike(c, t || player));
      if (foe === player) projectiles[projectiles.length - 1].onHit = () => crewStrike(c, player);
    } else if (dist2d(fp, c.pos) < D.reach + 1) {
      burst(c.pos.clone().setY(1.4).addScaledVector(fwdOf(c.actor), 1.4), '#fff2a8', 10, 4);
      sfx('swing'); crewStrike(c, foe);
    }
  });
}
function hurtCrew(c, dmg, src) {
  if (!crewUp(c)) return;
  const head = c.pos.clone().setY(3.4);
  if (dmg === 0) { floatText(head, 'Miss', 'miss'); return; }
  c.hp = Math.max(0, c.hp - dmg); c.hurtAt = now; c.actor.hurtFace = now + 0.45;
  floatText(head, String(dmg), isRival(c) ? (c.hp <= 0 ? 'kill' : '') : 'hurt');
  const s = src ? (src.pos || src) : player.pos, dx = c.pos.x - s.x, dz = c.pos.z - s.z, d = Math.hypot(dx, dz) || 1;
  c.kb.set((dx / d) * 4, (dz / d) * 4);
  sfx('hit'); burst(head.setY(1.6), '#ff8a7a', 10, 4);
  if (c.hp <= 0) { crewKo(c, src); return; }
  if (now > c.busyUntil) c.actor.play('Hit_A', { once: true, fade: 0.05, speed: 1.3, onFinish: () => crewIdle(c) });
  if (rng() < 0.25) say(c, pickOne(c.def.say.hurt));
}
function crewKo(c, by) {
  c.state = 'ko'; c.foe = null;
  const rival = isRival(c);
  c.koUntil = now + (rival ? 25 : 12);
  c.actor.play('Death_A', { once: true, clamp: true, fade: 0.1, onFinish: () => { if (c.state === 'ko') c.actor.play('Lie_Idle', { fade: 0.3 }); } });
  if (rival && by === player) {
    const coins = 25 + heroLvl() * 6;
    S.coins += coins; giveHeroXp(80 + heroLvl() * 15, c.pos.clone().setY(4)); later(0.25, () => sfx('coin'));
    floatText(c.pos.clone().setY(2.4), `+${coins} coins`, 'gain');
    say(c, c.def.say.lose); c.calmUntil = now + 60;
    toast(`You won the duel against ${c.name}! +${coins} coins`, ICONS.coins, true);
    refreshUI();
  } else {
    say(c, c.def.say.ko);
    if (crewCfg(c).mode === 'ally') toast(`${c.name} is knocked out! They will be back on their feet soon.`, null);
  }
}
function crewGetUp(c) {
  c.state = 'idle'; c.hp = Math.round(crewMax(c) * (isRival(c) ? 1 : 0.6));
  c.actor.play('Cheer', { once: true, fade: 0.2, onFinish: () => crewIdle(c) }); c.busyUntil = now + 1;
  burst(c.pos.clone().setY(1), '#b9ff8a', 20, 4);
}
function setCrewMode(c, mode) {
  const cf = crewCfg(c); cf.mode = mode; c.foe = null; c.taunted = false;
  c.calmUntil = mode === 'rival' ? now + 2.5 : 0;
  if (crewUp(c)) { c.actor.hopUntil = now + 0.35; c.actor.play('Cheer', { once: true, fade: 0.15, speed: 1.3, onFinish: () => crewIdle(c) }); c.busyUntil = now + 0.8; }
  say(c, mode === 'ally' ? pickOne(c.def.say.ally) : mode === 'rival' ? pickOne(c.def.say.rival) : 'See you around!');
  toast(mode === 'ally' ? `${c.name} joined your crew!` : mode === 'rival' ? `${c.name} is now your rival. Watch out!` : `${c.name} is doing their own thing.`, null);
  save(); if (sheetMode === 'crew' && !$('sheet').hidden) renderSheet();
}
function openCrewTalk(c) {
  talking = c;
  const m = crewCfg(c).mode, S2 = c.def.say;
  const text = m === 'ally' ? S2.talkAlly : m === 'rival' ? S2.talkRival : S2.hi;
  const now0 = { ally: 'in your crew', neutral: 'doing their own thing', rival: 'your rival' }[m];
  const opts = [['ally', m === 'rival' ? "Let's be friends. Join my crew!" : 'Join my crew!'], ['neutral', m === 'ally' ? 'You can go your own way now' : m === 'rival' ? "Let's call a truce" : 'Do your own thing'], ['rival', m === 'ally' ? "I challenge you. Be my rival!" : 'Be my rival!']].filter(([k]) => k !== m);
  const d = $('dialog');
  d.innerHTML = '<h3></h3><p></p><p class="crewnow"></p><div class="row"></div>';
  d.querySelector('h3').textContent = c.name;
  d.querySelector('p').textContent = text;
  d.querySelector('.crewnow').textContent = `Right now ${c.name.split(' ').pop()} is ${now0}.`;
  const row = d.querySelector('.row');
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; row.appendChild(b); };
  for (const [k, label] of opts) add(label, () => { closeDialog(); setCrewMode(c, k); });
  if (m === 'ally') for (const [k, [nm]] of Object.entries(CREW_TACTICS)) if (crewCfg(c).tactic !== k) add(nm, () => { crewCfg(c).tactic = k; c.foe = null; save(); closeDialog(); say(c, { charge: 'Charging in!', guard: "I've got your back!", follow: "I'll stay close." }[k]); });
  add('Bye', () => { closeDialog(); if (isRival(c)) c.calmUntil = now + 2; });
  showDialog(d, { talky: true });
  c.actor.face(player.pos.x, player.pos.z);
}
function crewTick(dt) {
  if (!player) return;
  let slot = 0;
  for (const c of crew) {
    const a = c.actor, p = a.pos, cf = crewCfg(c), m = cf.mode;
    if (c.hp === null) c.hp = crewMax(c);
    // allies follow you through doors; everyone else stays outside
    if (m === 'ally' && c.inside !== where) { c.inside = where; const b = player.root.rotation.y + Math.PI; p.set(player.pos.x + Math.sin(b) * 2, 0, player.pos.z + Math.cos(b) * 2); collide(p, 0.6); }
    if (m !== 'ally' && c.inside !== 'out') { c.inside = 'out'; p.set(c.home.x, 0, c.home.y); }
    const here = c.inside === where, near = here && dist2d(p, player.pos) < 70;
    a.root.visible = here;
    if (near) {
      a.mixer.update(dt);
      headPose(a);
      faceTick(a);
      const hop = Math.max(0, (a.hopUntil || 0) - now);
      p.y = hop > 0 ? Math.sin((1 - hop / 0.35) * Math.PI) * 0.45 : 0;
    }
    if (Math.abs(c.kb.x) + Math.abs(c.kb.y) > 0.05) { p.x += c.kb.x * dt; p.z += c.kb.y * dt; c.kb.multiplyScalar(Math.exp(-10 * dt)); collide(p, 0.6); }
    if (c.state === 'ko') { if (now > c.koUntil) crewGetUp(c); continue; }
    if (now - c.hurtAt > 6 && c.hp < crewMax(c)) c.hp = Math.min(crewMax(c), c.hp + dt * 2);
    if (talking === c || bossIntro || creator.open) { if (talking === c) a.face(player.pos.x, player.pos.z); crewIdle(c); continue; }
    // don't bunch up: nudge away from other crew and from you
    for (const o of crew) if (o !== c && o.inside === c.inside && crewUp(o)) { const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 1.3 && d > 0.001) { p.x += (dx / d) * (1.3 - d) * 0.5; p.z += (dz / d) * (1.3 - d) * 0.5; } }
    if (c.inside === where && !isRival(c)) { const dx = p.x - player.pos.x, dz = p.z - player.pos.z, d = Math.hypot(dx, dz); if (d < 1.1 && d > 0.001) { p.x += (dx / d) * (1.1 - d); p.z += (dz / d) * (1.1 - d); } }
    if (m === 'ally') crewAlly(c, dt, slot++);
    else if (m === 'rival') crewRival(c, dt);
    else crewNeutral(c, dt);
  }
}
function crewAlly(c, dt, slot) {
  const t = crewCfg(c).tactic, pp = player.pos;
  let foe = foeAlive(c.foe) && dist2d(c.foe.pos, pp) < 16 ? c.foe : null;
  if (!foe && t !== 'follow' && !player.dead) foe = crewFindFoe(c, pp, t === 'charge' ? 13 : 8, t === 'guard');
  c.foe = foe;
  if (foe && t !== 'follow') { crewFight(c, foe, dt); return; }
  // stand in a little fan behind the hero
  const b = player.root.rotation.y + Math.PI + (slot - 1) * 0.75, spot = { x: pp.x + Math.sin(b) * 2.8, z: pp.z + Math.cos(b) * 2.8 };
  const d = dist2d(spot, c.pos);
  if (d > 40 || c.stuckT > 1.5) { crewWarp(c, spot.x, spot.z); return; }
  if (d > 1) crewMove(c, spot.x, spot.z, d > 8 ? 11 : 8, dt, 0.6);
  else { crewIdle(c); let diff = player.root.rotation.y - c.actor.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); c.actor.root.rotation.y += diff * Math.min(1, dt * 4); }
  if (rng() < dt * 0.01) say(c, pickOne(c.def.say.ally));
}
function crewRival(c, dt) {
  const toP = dist2d(c.pos, player.pos), fromHome = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.y);
  if (player.dead && c.taunted) { say(c, c.def.say.win); c.taunted = false; c.calmUntil = now + 30; }
  const hunt = now > c.calmUntil && !player.dead && where === c.inside && !uiLock() && !talking && toP < 16 && fromHome < 45;
  if (!hunt) { if (toP > 24) c.taunted = false; crewNeutral(c, dt); return; }
  if (!c.taunted) { c.taunted = true; say(c, pickOne(c.def.say.rival)); }
  crewFight(c, player, dt);
}
function crewNeutral(c, dt) {
  // stand up for yourself if a monster comes close
  const foe = foeAlive(c.foe) && dist2d(c.foe.pos, c.pos) < 10 ? c.foe : crewFindFoe(c, c.pos, 5.5, false);
  c.foe = foe;
  if (foe) { crewFight(c, foe, dt); return; }
  const fromHome = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.y);
  if (fromHome > 22) c.wander = { x: c.home.x, z: c.home.y };
  if (c.stuckT > 2) { crewWarp(c, c.home.x, c.home.y); c.wander = null; }
  if (c.wander) {
    if (crewMove(c, c.wander.x, c.wander.z, 2.2, dt, 0.4) <= 0.4) { c.wander = null; c.wanderAt = now + 3 + rng() * 4; crewIdle(c); }
    return;
  }
  if (now > c.wanderAt) {
    // wander, or do something characterful for a moment
    if (rng() < 0.4) {
      const act = pickOne(['Interact', 'Cheer', 'PickUp', 'Use_Item', 'Sit_Floor_Idle']);
      c.actor.play(act, { once: act !== 'Sit_Floor_Idle', fade: 0.2, onFinish: () => crewIdle(c) }); c.busyUntil = now + (act === 'Sit_Floor_Idle' ? 5 : 1.5);
      c.wanderAt = now + (act === 'Sit_Floor_Idle' ? 6 : 3);
    } else {
      const ang = rng() * 6.28, r = 2 + rng() * 6;
      c.wander = { x: c.home.x + Math.cos(ang) * r, z: c.home.y + Math.sin(ang) * r };
    }
  } else if (now > c.busyUntil) crewIdle(c);
  // say hello when you walk past
  const toP = dist2d(c.pos, player.pos);
  if (where === c.inside && toP < 6 && !c.greeted) { c.greeted = true; c.actor.face(player.pos.x, player.pos.z); say(c, pickOne(c.def.say.idle)); }
  else if (toP > 12) c.greeted = false;
}
// name tags with a health bar and speech bubbles, drawn over each crew member
// ---------- your name tag ----------
// Grey up to level 30, green past 30, blue from 50 and red from 100. When accounts go live it shows the account name.
const tagColour = (l) => (l >= 100 ? '#d8324a' : l >= 50 ? '#3a7ae8' : l > 30 ? '#3aa860' : '#8a8a94');
let heroTagEl = null;
function setTagTitle(tag, text, col) {
  let em = tag.querySelector('em');
  if (!em) { em = document.createElement('em'); tag.insertBefore(em, tag.firstChild); }
  em.textContent = text || ''; em.hidden = !text; em.style.setProperty('--ttc', col || '#e8a93a');
}
function heroTag() {
  if (!heroTagEl) { heroTagEl = document.createElement('div'); heroTagEl.className = 'herotag'; heroTagEl.innerHTML = '<b></b>'; document.body.appendChild(heroTagEl); }
  const show = player && S.started && !player.dead && !creator.open && !bossIntro && S.nameTag !== false;
  if (!show) { setShown(heroTagEl, false); return; }
  const v = tmpV.set(player.pos.x, player.pos.y + 4.4, player.pos.z).project(camera);
  if (v.z > 1) { setShown(heroTagEl, false); return; }
  setShown(heroTagEl, true);
  pin(heroTagEl, v);
  const l = heroLvl(), txt = `${heroName()} · Lv ${l}`, col = tagColour(l), t = heroTitle(), tt = t ? t.name : '';
  if (heroTagEl.dataset.t !== txt + col + tt) { heroTagEl.dataset.t = txt + col + tt; heroTagEl.querySelector('b').textContent = txt; heroTagEl.style.setProperty('--tc', col); setTagTitle(heroTagEl, tt, t ? t.col : ''); }
}

// ---------- emotes ----------
// Press N for the wheel, then 1-9 or click. Your hero acts it out with a big face and a pop-up bubble.
const EMOTES = [
  { name: 'Wave', icon: '👋', anim: 'Interact', face: 'talk', say: 'Hi!' },
  { name: 'Cheer', icon: '🎉', anim: 'Cheer', face: 'blink', say: 'Woo!' },
  { name: 'Laugh', icon: '😆', anim: 'Cheer', speed: 1.7, face: 'blink', say: 'Ha ha!' },
  { name: 'Angry', icon: '💢', anim: 'Unarmed_Melee_Attack_Kick', face: 'hurt', say: 'Grr!' },
  { name: 'Sad', icon: '😢', anim: 'Sit_Floor_Idle', loop: true, face: 'hurt', say: 'Aww...' },
  { name: 'Love', icon: '💖', anim: 'Spellcasting', face: 'blink', say: '' },
  { name: 'Shock', icon: '❗', anim: 'Hit_A', face: 'hurt', say: 'Eek!' },
  { name: 'Sleep', icon: '💤', anim: 'Lie_Idle', loop: true, face: 'blink', say: 'Zzz' },
  { name: 'Taunt', icon: '😜', anim: 'Use_Item', speed: 1.4, face: 'talk', say: 'Nyah!' },
];
let emoteEl = null, emoteBubble = null;
const emoteWheelOpen = () => !!(emoteEl && !emoteEl.hidden);
function toggleEmotes(force) {
  if (!emoteEl) {
    emoteEl = document.createElement('div'); emoteEl.id = 'emotewheel'; emoteEl.hidden = true;
    emoteEl.innerHTML = `<div class="ew-ring">${EMOTES.map((m, i) => { const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2; return `<button data-i="${i}" style="left:calc(50% + ${Math.cos(a) * 112}px);top:calc(50% + ${Math.sin(a) * 112}px)" aria-label="${m.name} (${i + 1})"><span>${m.icon}</span><small>${i + 1} ${m.name}</small></button>`; }).join('')}<div class="ew-mid">Emotes<small>1-9 or click</small></div></div>`;
    emoteEl.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); e.stopPropagation(); if (b) doEmote(+b.dataset.i); else toggleEmotes(false); });
    document.body.appendChild(emoteEl);
  }
  const show = force ?? emoteEl.hidden;
  if (show && (!player || player.dead || uiLock())) return;
  emoteEl.hidden = !show;
}
function doEmote(i) {
  toggleEmotes(false);
  const m = EMOTES[i]; if (!m || !player || player.dead || player.air) return;
  cancelTask(); moveTarget = null;
  player.play(m.anim, m.loop ? { fade: 0.15 } : { once: true, fade: 0.1, speed: m.speed || 1, onFinish: () => { if (player.name === m.anim) player.play('Idle', { fade: 0.15 }); } });
  player.busyUntil = now + 0.2; player.emoteUntil = now + 2.2; player.emoteFace = m.face;
  if (m.face === 'talk') player.talkUntil = now + 0.8;
  if (!emoteBubble) { emoteBubble = document.createElement('div'); emoteBubble.className = 'emotebubble'; document.body.appendChild(emoteBubble); }
  emoteBubble.innerHTML = `<span>${m.icon}</span>${m.say ? `<b>${m.say}</b>` : ''}`;
  emoteBubble.classList.remove('pop'); void emoteBubble.offsetWidth; emoteBubble.classList.add('pop');
  emoteBubble.dataset.until = String(now + 2.2);
  burst(player.pos.clone().setY(3.2), m.face === 'hurt' ? '#ff8a6a' : '#ffe07a', 14, 3);
}
function emoteTick() {
  if (!emoteBubble || !player) return;
  const on = now < +emoteBubble.dataset.until && !creator.open;
  setShown(emoteBubble, on); if (!on) return;
  const v = tmpV.set(player.pos.x, player.pos.y + 5.6, player.pos.z).project(camera);
  pin(emoteBubble, v);
}
function crewTags() {
  for (const c of crew) {
    // only adventurers close by (or on your side, or talking) wear a name tag, so the screen stays calm
    const d = c.inside === where && player ? dist2d(c.pos, player.pos) : 1e9;
    const show = d < (crewCfg(c).mode === 'ally' || now < c.sayUntil ? 34 : 20) && !creator.open && !bossIntro;
    if (!show) { setShown(c.tag, false); continue; }
    const v = tmpV.set(c.pos.x, c.pos.y + 4.3, c.pos.z).project(camera);
    if (v.z > 1) { setShown(c.tag, false); continue; }
    setShown(c.tag, true);
    pin(c.tag, v);
    const m = crewCfg(c).mode; if (c.tag.dataset.mode !== m) c.tag.dataset.mode = m;
    setW(c.tag.u || (c.tag.u = c.tag.querySelector('u')), (Math.max(0, c.hp || 0) / crewMax(c)) * 100);
    if (now > c.sayUntil) { const s = c.tag.querySelector('.cs'); if (!s.hidden) s.hidden = true; }
  }
}
const crewFaces = {};
function renderCrew(el) {
  el.innerHTML = `<h3>Crew <small>Pick a side for each adventurer</small></h3><div class="crewlist">${crew.map((c) => {
    const cf = crewCfg(c), D = c.def;
    if (!crewFaces[c.id]) crewFaces[c.id] = portrait(c.look);
    const status = c.state === 'ko' ? `Knocked out, back in ${Math.max(1, Math.ceil(c.koUntil - now))}s` : cf.mode === 'ally' ? (c.foe ? 'Fighting!' : 'Following you') : cf.mode === 'rival' ? (now < c.calmUntil ? 'Sulking after your last duel' : 'Looking for you...') : 'Hanging around near home';
    return `<div class="crewcard" style="--c:${D.tint}">
      <div class="ctop"><img class="cface" src="${crewFaces[c.id]}" alt=""><div class="cinfo"><b>${D.name}</b><small>${D.title} · ${D.label || CREW_STYLE[D.style]}</small><div class="chp"><i style="width:${(Math.max(0, c.hp || 0) / crewMax(c)) * 100}%"></i></div><small class="cstat">${status}</small></div></div>
      <div class="seg" role="group" aria-label="${D.name}'s side">${Object.entries(CREW_MODES).map(([k, [nm, tip]]) => `<button data-crew="${c.id}" data-mode="${k}" class="m-${k}" aria-pressed="${cf.mode === k}" title="${tip}">${nm}</button>`).join('')}</div>
      ${cf.mode === 'ally' ? `<div class="seg tac" role="group" aria-label="How ${D.name} fights">${Object.entries(CREW_TACTICS).map(([k, [nm, tip]]) => `<button data-crew="${c.id}" data-tactic="${k}" aria-pressed="${cf.tactic === k}" title="${tip}">${nm}</button>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>
  <p class="hint"><b>Ally</b>: follows you everywhere (even indoors) and fights by your side. <b>Neutral</b>: lives near home and only fights monsters that get too close. <b>Rival</b>: challenges you to a duel whenever you wander near. Beat a rival for coins and XP! You can also talk to them to change sides.</p>`;
  el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { const c = crew.find((x) => x.id === b.dataset.crew); if (crewCfg(c).mode !== b.dataset.mode) setCrewMode(c, b.dataset.mode); }; });
  el.querySelectorAll('[data-tactic]').forEach((b) => { b.onclick = () => { const c = crew.find((x) => x.id === b.dataset.crew); crewCfg(c).tactic = b.dataset.tactic; c.foe = null; save(); renderSheet(); }; });
}

// ===================== v28: luck and mischief =====================
// ---------- Surprise Spots: bright board-game tiles along the roads ----------
// Step on one and something happens. Each spot rests for a while afterwards, then rolls a new colour.
const SPOT_KINDS = {
  gold: { col: '#ffd23f', glyph: '$', w: 30 },
  blue: { col: '#4aa8ff', glyph: '+', w: 22 },
  red: { col: '#ff5a5a', glyph: '!', w: 16 },
  purple: { col: '#b47cff', glyph: '?', w: 18 },
  rainbow: { col: '#ffffff', glyph: '★', w: 10 },
};
const spotTex = {};
function spotTexture(k) {
  if (spotTex[k]) return spotTex[k];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fillStyle = '#4a2a17'; g.fill();
  g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fillStyle = '#fff3c4'; g.fill();
  g.beginPath(); g.arc(64, 64, 45, 0, 7);
  if (k === 'rainbow') { const gr = g.createConicGradient(0, 64, 64); ['#ff6b6b', '#ffd23f', '#5ad06a', '#4aa8ff', '#b47cff', '#ff6b6b'].forEach((s, i) => gr.addColorStop(i / 5, s)); g.fillStyle = gr; }
  else g.fillStyle = k === 'used' ? '#c9bfa8' : SPOT_KINDS[k].col;
  g.fill();
  if (k !== 'used') {
    g.font = '900 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = '#4a2a17'; g.strokeText(SPOT_KINDS[k].glyph, 64, 68); g.fillStyle = '#fff'; g.fillText(SPOT_KINDS[k].glyph, 64, 68);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (spotTex[k] = t);
}
const spots = [];
const spotGeo = new THREE.CircleGeometry(1.15, 32);
function rollSpot() { let r = rng() * 96, k = 'gold'; for (const [n, s] of Object.entries(SPOT_KINDS)) { if ((r -= s.w) < 0) { k = n; break; } } return k; }
function buildSpots() {
  for (const [x1, z1, x2, z2] of ROADS) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    for (let t = 9; t < L - 5; t += 17) {
      const x = x1 + ((x2 - x1) * t) / L, z = z1 + ((z2 - z1) * t) / L;
      if (Math.hypot(x, z) < 16 || TOWNS.some((T) => Math.hypot(x - T.x, z - T.z) < T.r + 3) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < 12)) continue;
      const kind = rollSpot();
      const m = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ map: spotTexture(kind), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.07, z); m.renderOrder = 2; m.layers.set(1); scene.add(m);
      spots.push({ x, z, m, kind, until: 0 });
    }
  }
}
function setSpot(s, kind) { s.kind = kind; s.m.material.map = spotTexture(kind); s.m.material.needsUpdate = true; }
function spotTick() {
  if (!player || player.dead || where !== 'out' || uiLock()) return;
  for (const s of spots) {
    if (s.kind === 'used') { if (now > s.until) { setSpot(s, rollSpot()); burst(new THREE.Vector3(s.x, 0.4, s.z), '#fff3a0', 14, 3); } continue; }
    const k = 1 + Math.sin(now * 3 + s.x) * 0.04; s.m.scale.set(k, k, 1);
    if (player.air || Math.hypot(player.pos.x - s.x, player.pos.z - s.z) > 1.2) continue;
    const kind = s.kind; setSpot(s, 'used'); s.until = now + 150;
    spotEffect(kind, s);
  }
}
function spotEffect(kind, s) {
  const at = new THREE.Vector3(s.x, 0.6, s.z);
  if (kind === 'gold') {
    const c = 10 + Math.floor(rng() * 20) + heroLvl() * 2; S.coins += c;
    for (let i = 0; i < 4; i++) later(i * 0.12, () => { burst(at.clone().setY(0.3), '#ffe07a', 22, 6, 2.4); sfx('coin'); });
    floatText(at.clone().setY(2.6), `+${c} coins`, 'gain'); toast(`Gold Spot! A little coin fountain: ${c} coins.`, ICONS.coins);
  } else if (kind === 'blue') {
    const f = rng() < 0.6 ? 'bread' : rng() < 0.7 ? 'pie' : 'stew'; addItem(f);
    S.hp = Math.min(maxHp(), S.hp + Math.ceil(maxHp() * 0.15));
    burst(at, '#8fd0ff', 30, 4); sfx('win'); toast(`Snack Spot! A free ${ITEMS[f].toLowerCase()} and a little heal.`, ICONS[f]);
  } else if (kind === 'red') {
    toast('Ambush! Skeletons burst out of the road!', null, true); sfx('slam');
    const n = heroLvl() >= 8 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng(), x = s.x + Math.cos(a) * 3.2, z = s.z + Math.sin(a) * 3.2;
      const e = spawnEnemy(heroLvl() >= 12 && i === 0 ? 'skel_warrior' : 'skel_minion', x, z);
      e.temp = true; e.state = 'rising'; e.face(player.pos.x, player.pos.z);
      burst(new THREE.Vector3(x, 0.4, z), '#b9ff8a', 24, 4);
      const ok = e.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { e.state = 'chase'; e.play('Idle_Combat'); } });
      if (!ok) e.state = 'chase';
    }
  } else if (kind === 'purple') {
    const p = Math.floor(rng() * 3);
    if (p === 0) { setTiny(20); toast('Prank Spot! Poof, you are tiny for 20 seconds!', null, true); }
    else if (p === 1) { player.air = true; player.vy = 17; toast('Prank Spot! A hidden spring sends you flying!', null, true); }
    else { setTiny(0); player.vy = 0; player.spinUntil = now + 1.2; toast('Prank Spot! A banana peel! Wheee!', null, true); }
    sfx('boing'); burst(at, '#ff9af0', 40, 5);
  } else if (kind === 'rainbow') {
    burst(at, '#fff3a0', 50, 6, 1.6); spinWheel('Lucky Spot!');
  }
  refreshUI(); save();
}
var tinyUntil = 0;
function setTiny(sec) {
  if (!sec) return;
  if (!player.baseScale) player.baseScale = heroScale(S.look);
  tinyUntil = now + sec; setHeroScale(player, player.baseScale * 0.55);
  burst(player.pos.clone().setY(1), '#ff9af0', 40, 5);
}
function tinyTick(dt) {
  if (player && player.spinUntil && now < player.spinUntil) player.root.rotation.y += dt * 16;
  if (tinyUntil && now > tinyUntil) { tinyUntil = 0; setHeroScale(player, player.baseScale); burst(player.pos.clone().setY(1), '#ffffff', 30, 4); toast('Pop! Back to full size.'); }
}
function removeEnemy(e) {
  scene.remove(e.root);
  if (e.pile) { scene.remove(e.pile.g); piles.splice(piles.indexOf(e.pile), 1); e.pile = null; }
  if (e.bar && e.bar.remove) e.bar.remove();
  const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1);
}

// ---------- Golden monsters ----------
// Every so often a skeleton nearby turns gold. It runs from you, sparkling. Catch it before it
// vanishes for a big coin bag and a spin on the golden wheel.
let goldenAt = 60, goldenE = null;
function setGolden(e, on) {
  if (on) { e.golden = true; e.goldUntil = now + 45; e.goldCols = e.flashMats.map((m) => m.color.clone()); e.flashMats.forEach((m) => m.color.set('#ffe066')); }
  else { e.golden = false; if (e.goldCols) e.flashMats.forEach((m, i) => m.color.copy(e.goldCols[i])); if (goldenE === e) goldenE = null; }
}
const GOLDEN_ON = false; // golden monsters are switched off (Callum's call)
function goldenTick() {
  if (!GOLDEN_ON || !player || player.dead || where !== 'out') return;
  if (goldenE) {
    const e = goldenE;
    if (e.hp > 0 && rng() < 0.25) burst(e.pos.clone().setY(1 + rng() * 2), '#ffe07a', 2, 1.5);
    if (now > e.goldUntil && e.hp > 0) { burst(e.pos.clone().setY(1.2), '#ffe07a', 40, 5); setGolden(e, false); toast('The golden monster got away!'); }
    return;
  }
  if (now < goldenAt) return;
  goldenAt = now + 100 + rng() * 80;
  const pick = enemies.filter((e) => {
    if (e.T.boss || e.temp || e.inside !== 'out' || e.hp <= 0 || e.state !== 'idle') return false;
    const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z); return d > 14 && d < 45;
  });
  if (!pick.length || rng() < 0.35) return;
  const e = pick[Math.floor(rng() * pick.length)];
  setGolden(e, true); goldenE = e; burst(e.pos.clone().setY(1.5), '#ffe07a', 50, 6);
  toast(`A golden ${e.T.name} appeared nearby! Catch it before it runs off!`, ICONS.coins, true); sfx('win');
}
// Golden monsters run instead of fighting. Returns true when it handled the monster this frame.
function goldenRun(e, dt) {
  if (!e.golden || e.state === 'dead' || e.state === 'rising' || e.state === 'gone') return false;
  const ep = e.pos, dx = ep.x - player.pos.x, dz = ep.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
  if (d < 11) {
    let vx = dx / d, vz = dz / d;
    const hx = e.home.x - ep.x, hz = e.home.y - ep.z, hd = Math.hypot(hx, hz);
    if (hd > 18) { vx += (hx / hd) * 0.8; vz += (hz / hd) * 0.8; const n = Math.hypot(vx, vz) || 1; vx /= n; vz /= n; }
    ep.x += vx * 5.4 * dt; ep.z += vz * 5.4 * dt; collide(ep, 0.5);
    e.face(ep.x + vx, ep.z + vz); e.play('Running_A', { fade: 0.15 });
  } else e.play('Idle', { fade: 0.25 });
  return true;
}
function goldenCaught(e) {
  setGolden(e, false); S.goldenN = (S.goldenN || 0) + 1;
  const c = 120 + heroLvl() * 10; S.coins += c; giveHeroXp(e.T.xp * 4, e.pos.clone().setY(4));
  burst(e.pos.clone().setY(2), '#ffe07a', 90, 8, 1.6); sfx('jackpot');
  floatText(e.pos.clone().setY(3), `+${c} coins`, 'gain');
  toast(`You caught the golden ${e.T.name}! ${c} coins!`, ICONS.coins, true);
  if (rng() < 0.2) { addItem('dark_omen'); later(0.6, () => toast('It dropped a DARK OMEN! Take it to a freed town to call the monsters back.', ICONS.dark_omen, true)); }
  later(1.2, () => { if (!roulette && !player.dead) spinWheel('Golden Roulette!'); });
}

// ===================== v36: renown ranks, glowing gear, auras, titles and cosmetics =====================
// The more you play, the more your hero shows it: a rank every few levels (with a small power bonus),
// glowing weapons by tier, a ground aura that grows with rank, flashier specials, titles, and cosmetics
// you earn only by playing (beating bosses, reaching ranks, catching golden monsters, freeing towns).
const RANKS = [
  { min: 1, name: 'Rookie', col: '#9a9aa8' },
  { min: 10, name: 'Adventurer', col: '#5fbf6a' },
  { min: 25, name: 'Veteran', col: '#4f9ae8' },
  { min: 45, name: 'Champion', col: '#b06ae8' },
  { min: 70, name: 'Legend', col: '#ffb02e' },
  { min: 90, name: 'Mythic', col: '#ff4a6a' },
];
function rankOf(l) { let r = 0; for (let i = 0; i < RANKS.length; i++) if (l >= RANKS[i].min) r = i; return r; }
// each rank: +5% damage and +5% max health
function renown() { return 1 + 0.05 * rankOf(heroLvl()); }
const COS = {
  hat: {
    beanie: { name: 'Cosy beanie', r: 0, how: 'drop' }, bandana: { name: 'Red bandana', r: 0, how: 'drop' },
    flowers: { name: 'Flower crown', r: 1, how: 'Free a monster town' }, chef: { name: 'Chef hat', r: 1, how: 'drop' }, mushroom: { name: 'Mushroom cap', r: 1, how: 'drop' }, catears: { name: 'Cat ears', r: 1, how: 'drop' },
    horns: { name: 'Viking horns', r: 2, how: 'Defeat Bonecrusher' }, tricorn: { name: 'Pirate tricorn', r: 2, how: 'Defeat Rattlebones' }, wizard: { name: 'Starry wizard hat', r: 2, how: 'Defeat the Gloomcaster' },
    witch: { name: 'Witch hat', r: 2, how: 'drop' }, plume: { name: 'Knight plume', r: 2, how: 'drop' },
    tiara: { name: 'Ice tiara', r: 3, how: 'Defeat Queen Frostwhisker' }, frog: { name: 'Frog hat', r: 3, how: 'Defeat the Gobbler' }, tophat: { name: 'Dapper top hat', r: 3, how: 'Defeat Pompington' }, halo: { name: 'Golden halo', r: 3, how: 'drop' },
    goggles: { name: 'Brass goggles', r: 4, how: 'Defeat the Brassbolt Colossus' }, crown: { name: 'Royal crown', r: 4, how: 'Reach level 70 (Legend)' }, flame: { name: 'Crown of flames', r: 4, how: 'drop' },
    star: { name: 'Starfall diadem', r: 5, how: 'drop' },
  },
  outfit: {
    ranger: { name: 'Ranger greens', r: 0, body: '#5f9a46', trim: '#3a5a2a', how: 'drop' }, sailor: { name: 'Sailor blues', r: 0, body: '#4a78d0', trim: '#ffffff', how: 'drop' },
    guard: { name: 'Royal guard', r: 1, body: '#2f4fb0', trim: '#ffcc33', how: 'drop' }, pirate: { name: 'Pirate captain', r: 1, body: '#c0343c', trim: '#2a2230', how: 'drop' }, bloom: { name: 'Bubblegum', r: 1, body: '#ff9ad0', trim: '#ffffff', how: 'drop' },
    shadow: { name: 'Shadow assassin', r: 2, body: '#2e2c3c', trim: '#8a4aff', how: 'drop' }, frostk: { name: 'Frost knight', r: 2, body: '#d8f2ff', trim: '#4aa0d8', how: 'drop' }, nomad: { name: 'Desert nomad', r: 2, body: '#e0bc7a', trim: '#a8501a', how: 'drop' },
    paladin: { name: 'Paladin white', r: 3, body: '#fbf8ef', trim: '#ffc22e', glow: 0.18, how: 'drop' }, bog: { name: 'Bog witch', r: 3, body: '#5a8a4a', trim: '#b06ae8', glow: 0.12, how: 'drop' },
    dragon: { name: 'Dragonscale', r: 4, body: '#c8361a', trim: '#ffb02e', glow: 0.3, how: 'drop' },
    starlight: { name: 'Starlight regalia', r: 5, body: '#2a2a78', trim: '#ffe27a', glow: 0.35, shimmer: true, how: 'drop' },
    vnoble: { name: 'Crimson Noble', r: 3, body: '#6a1020', trim: '#1a0a12', style: 'vamp', how: 'drop' },
    vlord: { name: 'Vampire Lord', r: 4, body: '#2a1424', trim: '#b01830', glow: 0.15, style: 'vamp', how: 'drop' },
    dknight: { name: 'Dark Knight', r: 4, body: '#26262f', trim: '#7a5aff', style: 'knight', helm: '#45455a', how: 'drop' },
    abyss: { name: 'Abyssal Knight', r: 5, body: '#16121e', trim: '#ff3a5a', glow: 0.2, style: 'knight', helm: '#3a2c40', how: 'drop' },
    templar: { name: 'Sunlit Templar', r: 3, body: '#fff3da', trim: '#f2b632', glow: 0.1, style: 'holy', how: 'drop' },
    seraph: { name: 'Seraph Raiment', r: 5, body: '#ffffff', trim: '#8fd4ff', glow: 0.3, style: 'holy', shimmer: true, how: 'drop' },
    skeleton: { name: 'Dark Skeleton', r: 5, body: '#5a5470', trim: '#a050ff', skin: 'skeleton', how: 'drop' },
  },
  cape: {
    crimson: { name: 'Crimson cape', r: 0, col: '#c8323a', how: 'drop' }, sky: { name: 'Sky cape', r: 0, col: '#6ab4f0', how: 'drop' },
    royal: { name: 'Royal purple cape', r: 1, col: '#7a3ac8', how: 'Reach level 25 (Veteran)' }, sunset: { name: 'Sunset cape', r: 1, col: '#ff8a5a', how: 'drop' }, lavender: { name: 'Lavender cape', r: 1, col: '#c8a4ff', how: 'drop' },
    wood: { name: "Woodcutter's cape", r: 2, col: '#3f9a3e', how: 'Reach Woodcutting 50' }, mine: { name: "Miner's cape", r: 2, col: '#c8733a', how: 'Reach Mining 50' }, fish: { name: "Angler's cape", r: 2, col: '#3a8ae0', how: 'Reach Fishing 50' },
    ember: { name: 'Ember cape', r: 2, col: '#ff6a2a', how: 'Defeat Gagron' }, obsidian: { name: 'Obsidian cape', r: 2, col: '#22202c', how: 'drop' },
    midnight: { name: 'Midnight cape', r: 3, col: '#2a2a6a', glow: 0.15, how: 'Defeat Sir Soggington' }, starry: { name: 'Starry night cape', r: 3, col: '#1e2a6a', glow: 0.35, how: 'drop' },
    gold: { name: 'Cloth-of-gold cape', r: 4, col: '#ffc83a', glow: 0.25, how: 'Reach level 70 (Legend)' }, phoenix: { name: 'Phoenix cape', r: 4, col: '#ff7a1a', glow: 0.45, how: 'drop' },
    prism: { name: 'Prism cape', r: 5, col: '#ff6ad5', glow: 0.4, shimmer: true, how: 'drop' },
  },
  aura: {
    leaf: { name: 'Leafy aura', r: 0, col: '#8ad86a', how: 'drop' }, bubble: { name: 'Bubble aura', r: 1, col: '#9ae8ff', how: 'drop' },
    gold: { name: 'Golden harvest aura', r: 2, col: '#ffe08a', how: 'Gather from 10 golden trees or rocks' }, sakura: { name: 'Sakura aura', r: 2, col: '#ff9ac8', how: 'drop' }, jelly: { name: 'Royal jelly aura', r: 2, col: '#ffd84a', how: 'drop' },
    frost: { name: 'Frost aura', r: 3, col: '#7fe8ff', how: 'Defeat Queen Frostwhisker' }, royal: { name: 'Royal aura', r: 3, col: '#b06ae8', how: 'Reach level 45 (Champion)' }, storm: { name: 'Storm aura', r: 3, col: '#a8c8ff', how: 'drop' },
    rose: { name: 'Rose aura', r: 4, col: '#ff5a9a', how: 'Be worth 100,000 coins' }, sun: { name: 'Sunfire aura', r: 4, col: '#ffa02e', how: 'Defeat the Brassbolt Colossus' }, inferno: { name: 'Inferno aura', r: 4, col: '#ff5a1a', how: 'drop' },
    void: { name: 'Void aura', r: 5, col: '#7a3aff', how: 'Reach level 90 (Mythic)' }, prism: { name: 'Prism aura', r: 5, col: '#ff6ad5', shimmer: true, how: 'drop' },
  },
  trail: {
    leaves: { name: 'Leaf trail', r: 0, col: '#8ad86a', how: 'drop' }, sparkle: { name: 'Sparkle trail', r: 1, col: '#fff2a0', how: 'Reach level 10' }, petals: { name: 'Petal trail', r: 1, col: '#ffb0d8', how: 'drop' },
    ember: { name: 'Ember trail', r: 2, col: '#ff8a3a', how: 'Defeat Gagron' }, frost: { name: 'Snowflake trail', r: 2, col: '#dff6ff', how: 'Defeat Grumblefrost' }, bubbles: { name: 'Bubble trail', r: 2, col: '#b8ffd8', how: 'Defeat Mother Mire' },
    hearts: { name: 'Heart trail', r: 3, col: '#ff8ac8', how: 'drop' }, stars: { name: 'Star trail', r: 3, col: '#ffe27a', how: 'drop' },
    shadow: { name: 'Shadow trail', r: 4, col: '#6a3aa8', how: 'Reach level 90 (Mythic)' }, rainbow: { name: 'Rainbow trail', r: 5, col: '#ff6ad5', shimmer: true, how: 'drop' },
  },
};
for (const [id, c] of Object.entries(COS.outfit)) c.id = id;
// how cosmetics drop: monsters rarely, bosses often. Better lands roll better rarities.
const COS_ODDS = { out: [70, 24, 5, 1, 0, 0], frost: [50, 32, 13, 4.5, 0.5, 0], marsh: [35, 33, 20, 10, 1.8, 0.2], sands: [22, 30, 25, 17, 5.2, 0.8] };
function cosDrop(e, at, boss) {
  const land = ['frost', 'marsh', 'sands'].includes(e.inside) ? e.inside : 'out';
  if (rng() > (boss ? 0.3 : e.temp ? 0.002 : 0.012)) return;
  const odds = COS_ODDS[land].slice(); if (boss) { odds[0] *= 0.4; odds[3] *= 1.6; odds[4] *= 2; odds[5] *= 2; }
  let roll = rng() * odds.reduce((a, b) => a + b, 0), r = 0;
  while (r < 5 && roll > odds[r]) { roll -= odds[r]; r++; }
  const C = cosState();
  for (let rr = r; rr >= 0; rr--) {
    const pool = []; for (const [sl, list] of Object.entries(COS)) for (const [k, c] of Object.entries(list)) if (c.how === 'drop' && c.r === rr && !C.got[`${sl}:${k}`]) pool.push([sl, k]);
    if (!pool.length) continue;
    const [sl, k] = pool[Math.floor(rng() * pool.length)], c = COS[sl][k], R = RARITY[rr];
    C.got[`${sl}:${k}`] = 1; popLoot(at, 'chest', 0.5);
    toast(`${R.name.toUpperCase()} LOOK: ${c.name}! Wear it from your Bag.`, ICONS.star, rr >= 2);
    if (rr >= 3) burst(at.clone().setY(2), R.col, 30 + rr * 10, 6, 1.4);
    if (rr >= 4 && net.on) sendChat(`I found a ${R.name} look: ${c.name}!`);
    save(); return;
  }
}
const cosLabel = (c) => (c.how === 'drop' ? 'Drops from monsters (better lands, rarer looks)' : c.how);
const COS_SLOTS = { hat: 'Hat', outfit: 'Outfit', cape: 'Cape', aura: 'Aura', trail: 'Trail' };
const COS_BOSS = { boss_gagron: ['cape:ember', 'trail:ember'], boss_crusher: ['hat:horns'], boss_gloom: ['hat:wizard'], boss_rattle: ['hat:tricorn'], boss_frost: ['hat:tiara', 'aura:frost'], boss_grumble: ['trail:frost'], boss_mire: ['trail:bubbles'], boss_sogg: ['cape:midnight'], boss_gobbler: ['hat:frog'], boss_pomp: ['hat:tophat'], boss_colossus: ['hat:goggles', 'aura:sun'] };
const beaten = (t) => !!((S.beat || {})[t] || (S.letters || {})[t]);
function cosEarned() {
  const out = new Set(), l = heroLvl();
  for (const [t, ids] of Object.entries(COS_BOSS)) if (beaten(t)) ids.forEach((i) => out.add(i));
  if (l >= 10) out.add('trail:sparkle');
  if (l >= 25) out.add('cape:royal');
  if (l >= 45) out.add('aura:royal');
  if (l >= 70) { out.add('hat:crown'); out.add('cape:gold'); }
  if (l >= 90) { out.add('aura:void'); out.add('trail:shadow'); }
  if ((S.goldenN || 0) > 0) out.add('trail:hearts');
  if (lvl('woodcutting') >= 50) out.add('cape:wood');
  if (lvl('mining') >= 50) out.add('cape:mine');
  if (lvl('fishing') >= 50) out.add('cape:fish');
  if ((S.wbKills || 0) > 0) out.add('aura:jelly');
  if ((S.goldenNodes || 0) >= 10) out.add('aura:gold');
  if (Object.keys(S.towns || {}).length) out.add('hat:flowers');
  if (S.started && netWorth() >= 100000) out.add('aura:rose');
  return out;
}
const cosState = () => (S.cos = S.cos || { got: {}, eq: {} });
let cosAt = 0;
function cosTick() {
  if (!player || now < cosAt) return;
  cosAt = now + 2;
  const C = cosState(), fresh = [];
  for (const id of cosEarned()) {
    if (C.got[id]) continue;
    C.got[id] = 1;
    const [slot, k] = id.split(':');
    fresh.push(COS[slot][k].name);
  }
  if (!fresh.length) return;
  toast(fresh.length === 1 ? `New look unlocked: ${fresh[0]}! Wear it from your Bag (Style tab).` : `${fresh.length} new looks unlocked: ${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? '...' : ''}! See your Bag (Style tab).`, ICONS.star, true);
  burst(player.pos.clone().setY(2), '#ffe07a', 40, 6, 1.2);
  save();
}
// titles shown over your name tag
function titleList() {
  const l = heroLvl(), T = [];
  RANKS.forEach((r, i) => T.push({ id: `rank${i}`, name: r.name, how: `Reach level ${r.min}`, ok: l >= r.min, col: r.col }));
  const extra = [
    ['dragon', 'Dragon Tamer', 'Defeat Gagron', beaten('boss_gagron')], ['frostbane', 'Frostbane', 'Defeat Queen Frostwhisker', beaten('boss_frost')],
    ['gulper', 'Gobbler Gulper', 'Defeat the Gobbler', beaten('boss_gobbler')], ['riddler', 'Riddle Master', 'Answer the Sphinx Engine', S.quests.st_sphinx && S.quests.st_sphinx.state === 'done'],
    ['nemesis', "Pompington's Nemesis", 'Defeat Pompington', beaten('boss_pomp')], ['breaker', 'Colossus Breaker', 'Defeat the Brassbolt Colossus', beaten('boss_colossus')],
    ['night', 'Child of the Night', 'Choose the Vampire path', S.path === 'vampire'], ['halo', 'Halo Bearer', 'Choose the Angel path', S.path === 'angel'], ['stubborn', 'The Stubborn One', 'Choose the Human path', S.path === 'human'],
    ['mayor', 'The Mayor', 'Free a monster town', Object.keys(S.towns || {}).length > 0], ['tycoon', 'Tycoon', 'Be worth 100,000 coins', S.started && netWorth() >= 100000],
    ['worldbreaker', 'Worldbreaker', 'Helped beat King Wobblegut (retired)', (S.wbKills || 0) > 0],
    ['gatherer', 'Master Gatherer', 'Reach level 50 in any gathering skill', SKILLS.some(([k]) => lvl(k) >= 50)],
  ];
  for (const [id, name, how, ok] of extra) T.push({ id, name, how, ok: !!ok, col: '#e8a93a' });
  return T;
}
function heroTitle() {
  const T = titleList(), pick = S.title && T.find((t) => t.id === S.title && t.ok);
  return pick || T.filter((t) => t.id.startsWith('rank') && t.ok).pop();
}

// ---------- hats ----------
function makeHat(id) {
  const g = new THREE.Group(), M = (geo, col, opts) => { const m = new THREE.Mesh(geo); registerMesh(m, toon(col, opts)); m.castShadow = true; g.add(m); return m; };
  if (id === 'crown') return makeCrown();
  if (id === 'wizard') {
    M(new THREE.CylinderGeometry(0.86, 0.86, 0.07, 24), '#4a2a9a').position.y = 1.0;
    const c = M(new THREE.ConeGeometry(0.5, 1.25, 16), '#5a3ab8'); c.position.set(0, 1.62, -0.05); c.rotation.x = -0.18;
    const st = M(new THREE.OctahedronGeometry(0.12), '#ffe27a', { emissive: '#a87a00' }); st.position.set(0, 1.5, 0.42);
  } else if (id === 'horns') {
    M(new THREE.SphereGeometry(0.56, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#9aa4b0').position.y = 0.88;
    for (const s of [-1, 1]) { const h = M(new THREE.ConeGeometry(0.12, 0.6, 10), '#fff6e0'); h.position.set(s * 0.6, 1.2, 0); h.rotation.z = -s * 0.7; }
  } else if (id === 'tricorn') {
    const b = M(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 3), '#2a2230'); b.position.y = 1.02; b.rotation.y = Math.PI / 6;
    M(new THREE.CylinderGeometry(0.42, 0.5, 0.42, 16), '#2a2230').position.y = 1.24;
    const sk = M(new THREE.SphereGeometry(0.09, 10, 8), '#fff6e0'); sk.position.set(0, 1.25, 0.47);
  } else if (id === 'tiara') {
    M(new THREE.TorusGeometry(0.5, 0.04, 8, 28), '#dff6ff', { emissive: '#3a7aa8' }).rotation.x = Math.PI / 2;
    g.children[0].position.y = 1.0;
    for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i - 2) * 0.42, c = M(new THREE.OctahedronGeometry(i === 2 ? 0.16 : 0.1), '#9fe6ff', { emissive: '#2a8ab0' }); c.position.set(Math.cos(a) * 0.5, 1.12 + (i === 2 ? 0.08 : 0), Math.sin(a) * 0.5); c.scale.y = 1.6; }
  } else if (id === 'frog') {
    M(new THREE.SphereGeometry(0.6, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#6ac04a').position.y = 0.86;
    for (const s of [-1, 1]) { const e = M(new THREE.SphereGeometry(0.17, 12, 10), '#ffffff'); e.position.set(s * 0.26, 1.38, 0.24); const p = M(new THREE.SphereGeometry(0.08, 8, 6), '#1a1a1a'); p.position.set(s * 0.26, 1.4, 0.39); }
  } else if (id === 'tophat') {
    M(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 24), '#1a1a22').position.y = 1.02;
    M(new THREE.CylinderGeometry(0.38, 0.38, 0.82, 20), '#1a1a22').position.y = 1.44;
    M(new THREE.CylinderGeometry(0.39, 0.39, 0.12, 20), '#d8324a').position.y = 1.13;
  } else if (id === 'goggles') {
    M(new THREE.TorusGeometry(0.55, 0.06, 8, 28), '#8a5a2a').rotation.x = Math.PI / 2;
    g.children[0].position.y = 1.0;
    for (const s of [-1, 1]) { const l = M(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16), '#d8a850'); l.rotation.x = Math.PI / 2; l.position.set(s * 0.2, 1.08, 0.5); const gl = M(new THREE.CircleGeometry(0.12, 16), '#7fe8ff', { emissive: '#2a8ab0' }); gl.position.set(s * 0.2, 1.08, 0.565); }
  } else if (id === 'beanie') {
    M(new THREE.SphereGeometry(0.58, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#e0574a').position.y = 0.9;
    M(new THREE.TorusGeometry(0.55, 0.09, 8, 28), '#f4e8d0').rotation.x = Math.PI / 2; g.children[1].position.y = 0.92;
    M(new THREE.SphereGeometry(0.16, 12, 10), '#f4e8d0').position.y = 1.5;
  } else if (id === 'bandana') {
    M(new THREE.SphereGeometry(0.565, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), '#d8323a').position.y = 0.88;
    const k1 = M(new THREE.ConeGeometry(0.12, 0.34, 8), '#d8323a'); k1.position.set(0.12, 1.0, -0.58); k1.rotation.x = 1.9;
    const k2 = M(new THREE.ConeGeometry(0.1, 0.3, 8), '#d8323a'); k2.position.set(-0.12, 0.96, -0.58); k2.rotation.set(2.1, 0, 0.4);
  } else if (id === 'chef') {
    M(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 20), '#ffffff').position.y = 1.05;
    for (const [x, z] of [[0, 0], [0.22, 0.1], [-0.22, 0.1], [0, -0.2]]) M(new THREE.SphereGeometry(0.32, 14, 10), '#ffffff').position.set(x, 1.38, z);
  } else if (id === 'mushroom') {
    M(new THREE.SphereGeometry(0.78, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#e8324a').position.y = 0.95;
    for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2, sp = M(new THREE.SphereGeometry(0.1, 8, 6), '#ffffff'); sp.position.set(Math.cos(a2) * 0.5, 1.4, Math.sin(a2) * 0.5); sp.scale.y = 0.5; }
    M(new THREE.SphereGeometry(0.12, 8, 6), '#ffffff').position.y = 1.73;
  } else if (id === 'catears') {
    for (const sd of [-1, 1]) { const e = M(new THREE.ConeGeometry(0.2, 0.42, 4), '#3a3040'); e.position.set(sd * 0.34, 1.22, 0); e.rotation.z = -sd * 0.25; const inn = M(new THREE.ConeGeometry(0.11, 0.26, 4), '#ff9ac8'); inn.position.set(sd * 0.34, 1.2, 0.06); inn.rotation.z = -sd * 0.25; }
  } else if (id === 'witch') {
    M(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 26), '#2a2240').position.y = 1.0;
    const c = M(new THREE.ConeGeometry(0.52, 1.4, 16), '#2a2240'); c.position.set(0, 1.68, -0.1); c.rotation.x = -0.3;
    M(new THREE.CylinderGeometry(0.53, 0.55, 0.12, 18), '#8a4aff').position.y = 1.08;
  } else if (id === 'plume') {
    M(new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#c3cedc', { emissive: '#1a2230' }).position.y = 0.86;
    for (let i = 0; i < 5; i++) { const f = M(new THREE.SphereGeometry(0.16, 10, 8), '#e0343c'); f.position.set(0, 1.45 + i * 0.05, 0.2 - i * 0.16); f.scale.set(0.7, 1.2, 1); }
  } else if (id === 'halo') {
    const h = M(new THREE.TorusGeometry(0.42, 0.06, 10, 32), '#ffe27a', { emissive: '#c89a00' }); h.rotation.x = Math.PI / 2; h.position.y = 1.55;
  } else if (id === 'flame') {
    M(new THREE.TorusGeometry(0.47, 0.05, 8, 28), '#ffb02e', { emissive: '#a84a00' }).rotation.x = Math.PI / 2; g.children[0].position.y = 1.02;
    for (let i = 0; i < 7; i++) { const a2 = (i / 7) * Math.PI * 2, h = 0.26 + (i % 2) * 0.1, f = M(new THREE.ConeGeometry(0.085, h, 8), i % 2 ? '#ffd23f' : '#ff5a1a', { emissive: i % 2 ? '#c89a00' : '#a82a00' }); f.position.set(Math.cos(a2) * 0.47, 1.04 + h / 2, Math.sin(a2) * 0.47); }
  } else if (id === 'star') {
    M(new THREE.TorusGeometry(0.5, 0.045, 8, 32), '#fff6d0', { emissive: '#ff6ab0' }).rotation.x = Math.PI / 2; g.children[0].position.y = 1.04;
    for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2, st = M(new THREE.OctahedronGeometry(0.13), '#ffe27a', { emissive: '#ff6ab0' }); st.position.set(Math.cos(a2) * 0.62, 1.42 + (i % 2) * 0.12, Math.sin(a2) * 0.62); st.scale.y = 1.5; }
  } else if (id === 'flowers') {
    M(new THREE.TorusGeometry(0.5, 0.05, 8, 28), '#5a9a3a').rotation.x = Math.PI / 2;
    g.children[0].position.y = 1.02;
    const cols = ['#ff8ac8', '#fff27a', '#ffffff', '#ffb0d8'];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, f = M(new THREE.SphereGeometry(0.1, 10, 8), cols[i % 4]); f.position.set(Math.cos(a) * 0.5, 1.06, Math.sin(a) * 0.5); }
  }
  return g;
}

// ---------- the flair kit on any hero (you or a friend): aura ring, hat, trail ----------
const auraGeo = new THREE.RingGeometry(0.78, 1, 48);
// Cosmetic auras: a glowing rune circle that turns under your feet, motes that spiral up around you,
// and for the rarest ones a soft pillar of light. Rarer auras get more of everything.
const runeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.translate(128, 128); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  const ring = (r, w, a = 1) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(120, 5); ring(104, 2, 0.8); ring(62, 3, 0.9); ring(52, 1.5, 0.6);
  g.globalAlpha = 0.95;
  for (let i = 0; i < 12; i++) { g.save(); g.rotate((i / 12) * Math.PI * 2); g.lineWidth = 3; g.beginPath(); g.moveTo(0, -100); g.lineTo(8, -86); g.lineTo(0, -72); g.lineTo(-8, -86); g.closePath(); g.stroke(); g.beginPath(); g.arc(0, -112, 3, 0, Math.PI * 2); g.fill(); g.restore(); }
  g.lineWidth = 2.5; g.globalAlpha = 0.7; g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2 * 2 - Math.PI / 2; const x = Math.cos(a) * 62, y = Math.sin(a) * 62; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 128); grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(0.5, 'rgba(255,255,255,.08)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalAlpha = 1; g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 128, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const pillarTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 128, 0, 0); grd.addColorStop(0, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })();
const moteGeo = new THREE.SphereGeometry(0.09, 8, 6);
function auraKit(a, c) {
  const F = a.flair;
  if (F.kit) { F.kit.removeFromParent(); F.kit.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry && o.geometry !== moteGeo) o.geometry.dispose(); }); F.kit = null; }
  if (!c) return;
  const r = c.r || 0, kit = new THREE.Group(), add = (m) => { m.layers.set(1); kit.add(m); return m; };
  const blend = { transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending };
  const disc = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: runeTex, color: c.col, opacity: 0.55 + r * 0.06, side: THREE.DoubleSide, ...blend })));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.07; disc.scale.setScalar(2.6 + r * 0.25);
  const motes = [];
  for (let i = 0; i < 4 + r * 3; i++) { const m = add(new THREE.Mesh(moteGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? c.col : '#ffffff', opacity: 0.9, ...blend }))); m.userData.o = { ph: i / (4 + r * 3), sp: 0.35 + rng() * 0.25, rad: 0.8 + rng() * 0.5, s: 0.7 + rng() * 0.8 }; motes.push(m); }
  let pillar = null;
  if (r >= 3) { pillar = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 3.4, 24, 1, true), new THREE.MeshBasicMaterial({ map: pillarTex, color: c.col, opacity: 0.18 + (r - 3) * 0.08, side: THREE.DoubleSide, ...blend }))); pillar.position.y = 1.7; }
  a.root.add(kit); F.kit = kit; F.kitParts = { disc, motes, pillar, r, shimmer: !!c.shimmer, col: new THREE.Color(c.col) };
}
function auraKitTick(F) {
  const P = F.kitParts; if (!P) return;
  P.disc.rotation.z = now * (0.4 + P.r * 0.08);
  P.disc.material.opacity = (0.5 + P.r * 0.06) * (0.85 + 0.15 * Math.sin(now * 3));
  if (P.shimmer) { _shim.setHSL((now * 0.15) % 1, 0.85, 0.62); P.disc.material.color.copy(_shim); if (P.pillar) P.pillar.material.color.copy(_shim); }
  for (const m of P.motes) {
    const o = m.userData.o, t = (now * o.sp + o.ph) % 1, ang = o.ph * 6.283 + now * (0.8 + o.sp);
    m.position.set(Math.cos(ang) * o.rad * (1 - t * 0.35), 0.15 + t * 2.6, Math.sin(ang) * o.rad * (1 - t * 0.35));
    m.scale.setScalar(o.s * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85));
    if (P.shimmer) m.material.color.setHSL((now * 0.15 + o.ph) % 1, 0.85, 0.65);
  }
  if (P.pillar) P.pillar.material.opacity = (0.16 + (P.r - 3) * 0.08) * (0.8 + 0.2 * Math.sin(now * 2));
}
function setFlair(a, { rank = 0, aura = null, trail = null, hat = null, helmet = false } = {}) {
  const F = a.flair || (a.flair = {});
  if (F.auraKey !== aura) { F.auraKey = aura; auraKit(a, aura && COS.aura[aura] ? COS.aura[aura] : null); }
  const col = aura && COS.aura[aura] ? COS.aura[aura].col : RANKS[rank].col;
  const show = rank >= 2 || !!aura;
  if (!F.ring) {
    F.ring = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    F.ring.rotation.x = -Math.PI / 2; F.ring.position.y = 0.06; F.ring.layers.set(1); a.root.add(F.ring);
    F.ring2 = F.ring.clone(); F.ring2.material = F.ring.material.clone(); a.root.add(F.ring2);
  }
  F.ring.visible = show && !F.kit; F.ring2.visible = show && !F.kit && rank >= 4;
  F.ring.material.color.set(col); F.ring2.material.color.set(col);
  F.rank = rank; F.col = col; F.rainbow = rank >= 5 && !aura;
  F.trail = trail && COS.trail[trail] ? COS.trail[trail].col : null; F.trailShimmer = !!(trail && COS.trail[trail] && COS.trail[trail].shimmer); F.trailAt = 0; F.moteAt = 0;
  if (F.hatKey !== `${hat}|${helmet}` && (a.headInfo || !hat)) {
    if (F.hat) F.hat.removeFromParent();
    F.hat = null; F.hatKey = `${hat}|${helmet}`;
    if (hat && COS.hat[hat] && !helmet && a.headInfo) {
      // hats are modelled on a head of radius 0.5 whose top is at y = 1.12; fit them to this hero's head
      const box = a.headInfo.box, c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const k = (sz.x * 0.5 * 1.08) / 0.5, top = c.y + sz.y * 0.49;
      F.hat = makeHat(hat); F.hat.scale.setScalar(k); F.hat.position.set(c.x, top - 1.12 * k, c.z - sz.z * 0.04);
      a.headInfo.bone.add(F.hat); addInk(F.hat);
    }
  }
}
const _fx = new THREE.Vector3();
function flairTick(a, dt, moving) {
  const F = a.flair; if (!F || !a.root.visible) return;
  if (F.kit) auraKitTick(F);
  if (F.ring.visible) {
    const k = 1 + Math.sin(now * 2.4) * 0.06;
    F.ring.scale.setScalar(1.25 * k); F.ring.material.opacity = 0.28 + 0.1 * F.rank / 5 + Math.sin(now * 3) * 0.06;
    if (F.ring2.visible) { F.ring2.scale.setScalar(1.9 - ((now * 0.6) % 1) * 0.7); F.ring2.material.opacity = 0.3 * ((now * 0.6) % 1); }
    if (F.rainbow) { const c = new THREE.Color().setHSL((now * 0.15) % 1, 0.8, 0.62); F.ring.material.color.copy(c); F.ring2.material.color.copy(c); F.col = `#${c.getHexString()}`; }
    if (F.rank >= 3 && now > F.moteAt) {
      F.moteAt = now + (F.rank >= 4 ? 0.12 : 0.25);
      const ang = rng() * 6.28; _fx.set(a.root.position.x + Math.cos(ang) * 1.1, 0.3, a.root.position.z + Math.sin(ang) * 1.1);
      burst(_fx, F.col, 1, 1.5, 0.9);
    }
  }
  if (F.trail && moving && now > F.trailAt) { F.trailAt = now + 0.06; burst(_fx.copy(a.root.position).setY(0.3), F.trailShimmer ? `#${_shim.setHSL((now * 0.4) % 1, 0.85, 0.65).getHexString()}` : F.trail, 2, 1.6, 0.7); }
}
function heroFlair() {
  if (!player) return;
  const C = cosState();
  setFlair(player, { rank: rankOf(heroLvl()), aura: C.eq.aura, trail: C.eq.trail, hat: C.eq.hat, helmet: S.look.hat });
}
// glowing weapons: brighter for higher tiers, boss uniques and smith upgrades
function gearGlow(g, k) {
  if (!g) return 0;
  return Math.min(0.75, (g.unique ? 0.55 : g.tier === 4 ? 0.5 : g.tier === 3 ? 0.32 : g.tier === 2 ? 0.16 : 0) + plusOf(k) * 0.04);
}
function glowMesh(m, col, k) {
  if (k <= 0) return;
  m.traverse((o) => {
    if (!o.isMesh || !o.userData.mats || Array.isArray(o.userData.mats.toon)) return;
    const mm = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() }; mm.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile;
    for (const x of [mm.std, mm.toon]) if (x.emissive) x.emissive.set(col).multiplyScalar(k);
    registerMesh(o, mm);
  });
}
let sparkAt = 0;
function weaponSparkle() {
  if (!player || !player.weapons || now < sparkAt) return;
  const k = gearGlow(W(), S.equip.weapon); if (k < 0.3) return;
  sparkAt = now + (k >= 0.5 ? 0.08 : 0.18);
  const m = player.weapons.find((w) => w.visible); if (!m) return;
  m.getWorldPosition(_fx); _fx.x += (rng() - 0.5) * 0.6; _fx.y += rng() * 0.8; _fx.z += (rng() - 0.5) * 0.6;
  burst(_fx, W().tint || '#ffe9a0', 1, 1.2, 0.5);
}
// flashier specials: a rank-coloured shockwave on top, bigger for higher ranks
function rankFlourish(x, z, ringFn) {
  const rk = rankOf(heroLvl()); if (rk < 2) return;
  const col = RANKS[rk].col;
  later(0.35, () => {
    ringFn(x, z, 3 + rk * 0.8, col);
    burst(new THREE.Vector3(x, 1, z), col, 16 * rk, 5 + rk, 1.3);
    if (rk >= 4) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      p.position.set(x, 7, z); p.layers.set(1); scene.add(p);
      tween(0.6, (k) => { p.material.opacity = 0.5 * (1 - k); p.scale.set(1 + k, 1, 1 + k); }, () => { scene.remove(p); p.geometry.dispose(); p.material.dispose(); });
    }
  });
}

// ---------- the inventory: a paper doll of what you wear, your bag, and your style ----------
const itemRarIx = (k) => { const v = SELL[k] || 0; return v >= 5000 ? 5 : v >= 800 ? 4 : v >= 250 ? 3 : v >= 40 ? 2 : v >= 10 ? 1 : 0; };
const itemRarity = (k) => { const r = RARITY[itemRarIx(k)]; return [r.id, r.name]; };
const gearRarity = (g) => { const r = RARITY[gearRarIx(g)]; return [r.id, r.name]; };
let bagTab = 'gear', dollSlot = 'weapon', bagPick = null;
// ---------- live preview: your actual hero, drawn in the loadout window, wearing what you pick ----------
const prev = { cv: null, r: null, scene: null, cam: null, yaw: 0.5, drag: null, at: 0 };
function previewMount() {
  const slot = document.querySelector('#sheet .dprev'); if (!slot) return;
  if (!prev.cv) {
    prev.cv = document.createElement('canvas'); prev.cv.className = 'prevcv';
    try { prev.r = new THREE.WebGLRenderer({ canvas: prev.cv, alpha: true, antialias: true }); } catch (e) { prev.r = null; }
    if (prev.r) { prev.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); prev.r.outputColorSpace = renderer.outputColorSpace; prev.r.toneMapping = renderer.toneMapping; prev.r.toneMappingExposure = renderer.toneMappingExposure; }
    prev.scene = new THREE.Scene();
    prev.scene.add(new THREE.HemisphereLight('#fff6e8', '#8a7a6a', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4); sun.position.set(3, 6, 5); prev.scene.add(sun);
    prev.cam = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50); prev.cam.layers.enableAll();
    prev.cv.addEventListener('pointerdown', (e) => { prev.drag = e.clientX; prev.cv.setPointerCapture(e.pointerId); });
    prev.cv.addEventListener('pointermove', (e) => { if (prev.drag !== null) { prev.yaw += (e.clientX - prev.drag) * 0.012; prev.drag = e.clientX; } });
    prev.cv.addEventListener('pointerup', () => { prev.drag = null; });
  }
  // no second 3D view on this device: show the painted portrait instead
  if (!prev.r) { slot.innerHTML = `<img src="${portrait(S.look)}" alt="" style="width:100%;height:100%;object-fit:contain">`; return; }
  slot.appendChild(prev.cv);
}
function previewTick() {
  if (!prev.r || !player || !prev.cv || !prev.cv.isConnected || $('sheet').hidden || now < prev.at) return;
  prev.at = now + 1 / 30;
  const w = prev.cv.clientWidth, h = prev.cv.clientHeight; if (!w || !h) return;
  if (prev.cv.width !== Math.round(w * prev.r.getPixelRatio())) { prev.r.setSize(w, h, false); prev.cam.aspect = w / h; prev.cam.updateProjectionMatrix(); }
  if (prev.drag === null) prev.yaw += 0.006;
  // borrow the real hero for one quick draw, then put everything back exactly where it was
  const R = player.root, parent = R.parent, px = R.position.x, py = R.position.y, pz = R.position.z, ry = R.rotation.y, vis = R.visible;
  // the see-through silhouettes only make sense behind trees, so they stay out of the portrait
  const sils = prev.sils || (prev.sils = []); sils.length = 0;
  R.traverse((o) => { if (o.userData.isSil && o.visible) { sils.push(o); o.visible = false; } });
  prev.scene.add(R); R.position.set(0, 0, 0); R.rotation.y = prev.yaw; R.visible = true;
  prev.cam.position.set(0, 2.3, 8.6); prev.cam.lookAt(0, 1.6, 0);
  try { prev.r.render(prev.scene, prev.cam); } finally { if (parent) parent.add(R); R.position.set(px, py, pz); R.rotation.y = ry; R.visible = vis; for (const o of sils) o.visible = true; }
}
const SLOT_NAMES = { weapon: 'Weapon', shield: 'Shield', armour: 'Armour', gadget: 'Gadget' };
function gearDelta(g, cur) {
  if (g.slot === 'weapon') { const d = Math.round((g.dmg - (cur ? cur.dmg : 0)) * 10) / 10; return d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d} dmg</em>` : ''; }
  if (g.slot === 'gadget') return '';
  const d = Math.round((g.def - (cur ? cur.def : 0)) * 10) / 10; return d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d} def</em>` : '';
}
function dollList() {
  const C = cosState();
  if (dollSlot.startsWith('cos:')) {
    const sl = dollSlot.slice(4), got = C.got;
    const rows = Object.entries(COS[sl]).sort((x, y) => (y[1].r || 0) - (x[1].r || 0)).map(([k, c]) => {
      const have = got[`${sl}:${k}`], on = C.eq[sl] === k, R = RARITY[c.r || 0];
      return `<button class="cosrow ${R.id} ${have ? '' : 'locked'}" data-cos="${sl}:${k}" aria-pressed="${on}" ${have ? '' : 'disabled'}><span class="swatch" style="--sw:${c.col || c.body || '#e8a93a'}${c.trim ? `;--sw2:${c.trim}` : ''}"></span><b>${c.name}</b><i class="rar">${R.name}</i><small>${have ? (on ? 'Wearing' : 'Tap to wear') : `Locked: ${cosLabel(c)}`}</small></button>`;
    }).join('');
    return `<h4 class="sub">${COS_SLOTS[sl]}s <small>${Object.keys(COS[sl]).filter((k) => got[`${sl}:${k}`]).length} of ${Object.keys(COS[sl]).length} found</small></h4><div class="coslist">${C.eq[sl] ? `<button class="cosrow" data-cos="${sl}:">Take it off</button>` : ''}${rows}</div><p class="hint">Looks never change your stats. You earn them only by playing: beating bosses, reaching new ranks and freeing towns.</p>`;
  }
  const cur = GEAR[S.equip[dollSlot]];
  const mine = S.owned.filter((k) => GEAR[k] && GEAR[k].slot === dollSlot);
  if (!mine.length) return `<h4 class="sub">${SLOT_NAMES[dollSlot]}</h4><p class="hint">${dollSlot === 'gadget' ? 'Gadgets are clockwork trinkets from Gizmo the Gearsmith in Brassbolt Sands. Each gives a small bonus.' : 'Nothing here yet. The smiths sell gear, and bosses sometimes drop their own.'}</p>`;
  return `<h4 class="sub">${SLOT_NAMES[dollSlot]}</h4><div class="gearlist">${mine.map((k) => { const g = GEAR[k], on = S.equip[dollSlot] === k, [rc, rn] = gearRarity(g);
    return `<div class="gearwrap"><button class="gearbtn ${rc}" data-gear="${k}" aria-pressed="${on}"><b><img src="${gearIcon(g)}" alt="">${plusOf(k) ? plusName(k) : g.name}</b><span>${gearStats(g)} · <i class="rar">${rn}</i>${on ? '' : ` ${gearDelta(g, cur)}`}</span></button><button class="pin" data-pin="${k}" title="Put on hotbar" aria-label="Put ${g.name} on the hotbar" aria-pressed="${(S.hotbar || []).includes(k)}">+</button></div>`; }).join('')}</div>${dollSlot === 'gadget' && S.equip.gadget ? '<p class="hint">Tap your gadget again to take it off.</p>' : ''}`;
}
// ---------- bag order and drag and drop ----------
// Your bag holds materials, food, treasures and spare gear (gear you own but aren't wearing).
// S.bagOrder remembers how you arranged it; new things go at the end.
function bagKeys() {
  const worn = Object.values(S.equip);
  const have = (k) => (GEAR[k] ? S.owned.includes(k) && !worn.includes(k) : (S.inv[k] || 0) > 0 && ITEMS[k]);
  const order = (Array.isArray(S.bagOrder) ? S.bagOrder : []).filter((k, i, a) => have(k) && a.indexOf(k) === i);
  for (const k of Object.keys(S.inv)) if (have(k) && !order.includes(k)) order.push(k);
  for (const k of S.owned) if (have(k) && !order.includes(k)) order.push(k);
  S.bagOrder = order;
  return order;
}
function bagSort(how) {
  const keys = bagKeys(), rar = (k) => (GEAR[k] ? gearRarIx(GEAR[k]) : itemRarIx(k));
  const kind = (k) => (GEAR[k] ? 0 : FOOD[k] ? 1 : SELL[k] && SELL[k] >= 50 ? 2 : 3);
  const name = (k) => (GEAR[k] ? GEAR[k].name : ITEMS[k] || k);
  keys.sort(how === 'rar' ? (a, b) => rar(b) - rar(a) || kind(a) - kind(b) || name(a).localeCompare(name(b)) : (a, b) => kind(a) - kind(b) || rar(b) - rar(a) || name(a).localeCompare(name(b)));
  S.bagOrder = keys; save();
}
// Pointer-based dragging, so it works with a mouse and on touch screens (hold, then drag).
let drag = null;
function dragStart(e) {
  const src = e.target.closest('[data-drag]'); if (!src || e.button > 0) return;
  const fromHot = src.dataset.hot != null;
  if (e.pointerType === 'mouse') e.preventDefault(); // stop the browser's own image drag, which cancels ours
  drag = { k: src.dataset.drag, from: fromHot ? +src.dataset.hot : -1, src, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, touch: e.pointerType !== 'mouse', t0: performance.now() };
}
function dragMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  if (!drag.on) {
    // on touch, a quick swipe scrolls; holding still for a moment picks the item up
    if (drag.touch && performance.now() - drag.t0 < 220) { if (far > 10) drag = null; return; }
    if (far < 6) return;
    drag.on = true;
    const img = drag.src.querySelector('img');
    const gh = document.createElement('div'); gh.className = 'dragghost'; gh.innerHTML = img ? `<img src="${img.src}" alt="">` : ''; document.body.appendChild(gh);
    drag.ghost = gh; drag.src.classList.add('dragging'); document.body.classList.add('dragging-item');
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`;
  const over = document.elementFromPoint(e.clientX, e.clientY), tgt = over && over.closest('[data-hot], [data-bagdrop]');
  document.querySelectorAll('.dropover').forEach((x) => x !== tgt && x.classList.remove('dropover'));
  if (tgt && tgt !== drag.src) tgt.classList.add('dropover');
}
function dragEnd(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (!d.on) return;
  d.ghost.remove(); d.src.classList.remove('dragging'); document.body.classList.remove('dragging-item');
  document.querySelectorAll('.dropover').forEach((x) => x.classList.remove('dropover'));
  dragJustEnded = performance.now();
  const over = document.elementFromPoint(e.clientX, e.clientY), hot = over && over.closest('#hotbar [data-hot]'), bag = over && over.closest('[data-bagdrop]');
  const hb = hotbar();
  if (hot) {
    const to = +hot.dataset.hot;
    if (d.from >= 0) [hb[to], hb[d.from]] = [hb[d.from], hb[to]]; // swap two hotbar slots
    else { const was = hb.indexOf(d.k); if (was >= 0) hb[was] = hb[to]; hb[to] = d.k; }
    hotPick = -1; sfx('equip');
  } else if (bag && d.from < 0) {
    const keys = bagKeys(), a = keys.indexOf(d.k), b = +bag.dataset.bagdrop;
    if (a >= 0) { if (b < keys.length) [keys[a], keys[b]] = [keys[b], keys[a]]; else { keys.splice(a, 1); keys.push(d.k); } S.bagOrder = keys; }
  } else if (d.from >= 0 && !(over && over.closest('#hotbar'))) {
    hb[d.from] = null; // dragged off the bar: clear the slot
  }
  save(); renderHotbar(); if (sheetMode === 'bag') renderSheet();
}
let dragJustEnded = 0;
addEventListener('pointerdown', dragStart);
addEventListener('pointermove', dragMove, { passive: false });
addEventListener('pointerup', dragEnd);
addEventListener('pointercancel', (e) => { if (drag && drag.on) dragEnd(e); else drag = null; });
// a drag shouldn't also count as a click on what you dropped it on
addEventListener('click', (e) => { if (performance.now() - dragJustEnded < 250) { e.stopPropagation(); e.preventDefault(); } }, true);

function renderBag(el) {
  const tabs = { gear: 'Gear', items: 'Bag', style: 'Style' };
  let body = '';
  if (bagTab === 'gear') {
    const rk = rankOf(heroLvl()), R = RANKS[rk], t = heroTitle(), C = cosState(), w = W();
    const slot = (sl) => { const k = S.equip[sl], g = GEAR[k]; return `<button class="dslot ${g ? gearRarity(g)[0] : 'empty'}" data-dslot="${sl}" aria-pressed="${dollSlot === sl}">${g ? `<img src="${gearIcon(g)}" alt="">` : '<i></i>'}<small>${g ? g.name : SLOT_NAMES[sl]}</small>${g && plusOf(k) ? `<b>+${plusOf(k)}</b>` : ''}</button>`; };
    const cslot = (sl) => { const id = C.eq[sl], c = id && COS[sl][id]; return `<button class="dslot cos ${c ? RARITY[c.r || 0].id : 'empty'}" data-dslot="cos:${sl}" aria-pressed="${dollSlot === `cos:${sl}`}">${c ? `<span class="swatch" style="--sw:${c.col || c.body || '#e8a93a'}"></span>` : '<i></i>'}<small>${c ? c.name : COS_SLOTS[sl]}</small></button>`; };
    body = `<div class="doll" style="--rank:${R.col}">
      <div class="dcol">${slot('weapon')}${slot('shield')}${slot('armour')}${slot('gadget')}${cslot('trail')}</div>
      <div class="dfig"><div class="dprev" title="Drag to turn your hero"></div><b>${esc(heroName())}</b><span class="drank">${R.name} · Lv ${heroLvl()}</span>${t && !t.id.startsWith('rank') ? `<em>${esc(t.name)}</em>` : ''}</div>
      <div class="dcol">${cslot('hat')}${cslot('outfit')}${cslot('cape')}${cslot('aura')}</div></div>
      <div class="dstats"><div><img src="${ICONS[w.type]}" alt=""><span>Hit</span><b>${Math.round(w.dmg * dmgMult() * pathDmg())}</b></div><div><img src="${ICONS.shield}" alt=""><span>Defense</span><b>${totalDef()}</b></div><div><img src="${ICONS.heart}" alt=""><span>Health</span><b>${maxHp()}</b></div><div><img src="${ICONS.star}" alt=""><span>Renown</span><b>+${Math.round((renown() - 1) * 100)}%</b></div></div>
      ${(() => { const oc = COS.outfit[C.eq.outfit || '']; return oc && oc.helm ? `<button id="helmtog" class="helmtog" aria-pressed="${!S.look.helmOff}">${S.look.helmOff ? 'Show helmet' : 'Hide helmet'}</button>` : ''; })()}
      ${outfitOn() ? '<p class="hint">Your outfit is a full look: armour and shield stats still count, they just stay hidden under it.</p>' : ''}
      ${dollList()}`;
  } else if (bagTab === 'items') {
    const keys = bagKeys(), slots = [];
    for (let i = 0; i < Math.max(20, Math.ceil((keys.length + 1) / 5) * 5); i++) {
      const k = keys[i];
      if (!k) { slots.push(`<div class="slot empty" data-bagdrop="${i}"></div>`); continue; }
      const g = GEAR[k], [rc] = g ? gearRarity(g) : itemRarity(k), nm = g ? g.name : ITEMS[k];
      slots.push(`<button class="slot ${rc}${bagPick === k ? ' on' : ''}${(S.hotbar || []).includes(k) ? ' pinned' : ''}" data-item="${k}" data-drag="${k}" data-bagdrop="${i}" title="${nm}"><img src="${g ? gearIcon(g) : ICONS[k]}" alt="${nm}">${g ? (plusOf(k) ? `<span>+${plusOf(k)}</span>` : '') : `<span>${S.inv[k]}</span>`}</button>`);
    }
    let info = '<p class="hint">Drag things to rearrange your bag, or drag them onto the hotbar. Drag a hotbar slot off the bar to clear it. Tap an item to see what it is worth.</p>';
    if (bagPick && GEAR[bagPick] && S.owned.includes(bagPick)) {
      const k = bagPick, g = GEAR[k], [rc, rn] = gearRarity(g);
      info = `<div class="iteminfo ${rc}"><img src="${gearIcon(g)}" alt=""><div><b>${g.name}${plusOf(k) ? ` +${plusOf(k)}` : ''}</b><small><i class="rar">${rn}</i> · ${SLOT_NAMES[g.slot]} · spare, not equipped</small></div><div class="row"><button class="primary" data-equip="${k}">Equip</button><button data-pin="${k}" aria-pressed="${(S.hotbar || []).includes(k)}">Hotbar</button></div></div>`;
    } else if (bagPick && S.inv[bagPick]) {
      const k = bagPick, [rc, rn] = itemRarity(k), f = FOOD[k];
      info = `<div class="iteminfo ${rc}"><img src="${ICONS[k]}" alt=""><div><b>${ITEMS[k]}</b><small><i class="rar">${rn}</i> · ${S.inv[k]} in your bag${SELL[k] ? ` · sells for ${fmt(SELL[k])} each` : ''}${f ? ` · heals ${f.heal}` : ''}</small></div><div class="row">${f ? `<button class="primary" data-eat="${k}">Eat</button>` : ''}<button data-pin="${k}" aria-pressed="${(S.hotbar || []).includes(k)}">Hotbar</button></div></div>`;
    }
    body = `<div class="bagbar"><span>${keys.length} things</span><button data-bagsort="kind">Sort by type</button><button data-bagsort="rar">Sort by rarity</button></div><div class="bag five">${slots.join('')}</div>${info}`;
  } else {
    const C = cosState(), T = titleList(), cur = heroTitle();
    const total = Object.values(COS).reduce((a, s) => a + Object.keys(s).length, 0), have = Object.keys(C.got).length;
    body = `<button id="b-appear" class="primary">Change appearance (face, hair, body)</button><h4 class="sub">Title <small>shown over your name</small></h4><div class="titles">${T.map((t) => `<button class="titlebtn${t.ok ? '' : ' locked'}" data-title="${t.id}" aria-pressed="${cur && cur.id === t.id}" ${t.ok ? '' : 'disabled'} style="--tc:${t.col}" title="${t.how}">${t.name}${t.ok ? '' : `<small>${t.how}</small>`}</button>`).join('')}</div>
      <h4 class="sub">Looks <small>${have} of ${total} found</small></h4><div class="cosgrid">${Object.entries(COS_SLOTS).map(([sl, nm]) => { const c = C.eq[sl] && COS[sl][C.eq[sl]]; return `<button class="dslot cos ${c ? RARITY[c.r || 0].id : 'empty'}" data-dslot="cos:${sl}"><span class="swatch" style="--sw:${c ? c.col || c.body || '#e8a93a' : '#d8c8a8'}"></span><small>${nm}</small></button>`; }).join('')}</div>
      <p class="hint">Ranks: ${RANKS.map((r) => `<b style="color:${r.col}">${r.name}</b> (${r.min})`).join(' · ')}. Every rank gives +5% damage and health, a bigger aura and flashier specials.</p>`;
  }
  el.innerHTML = `<h3>Inventory <small>${fmt(S.coins)} coins${S.bank ? ` · ${fmt(S.bank)} banked` : ''}</small></h3><div class="bagtabs">${Object.entries(tabs).map(([k, n]) => `<button data-btab="${k}" aria-pressed="${bagTab === k}">${n}</button>`).join('')}</div>${body}`;
  previewMount();
  el.querySelectorAll('[data-btab]').forEach((b) => { b.onclick = () => { bagTab = b.dataset.btab; renderSheet(); }; });
  el.querySelectorAll('[data-dslot]').forEach((b) => { b.onclick = () => { dollSlot = b.dataset.dslot; bagTab = 'gear'; renderSheet(); }; });
  el.querySelectorAll('[data-item]').forEach((b) => { b.onclick = () => { bagPick = bagPick === b.dataset.item ? null : b.dataset.item; renderSheet(); }; });
  el.querySelectorAll('[data-eat]').forEach((b) => { b.onclick = () => { eat(b.dataset.eat); renderSheet(); }; });
  el.querySelectorAll('[data-equip]').forEach((b) => { b.onclick = () => { const k = b.dataset.equip, g = GEAR[k]; if (!g || !S.owned.includes(k)) return; S.equip[g.slot] = k; bagPick = null; cancelTask(); equipGear(); buildGearBar(); updateTitle(); save(); renderSheet(); renderHotbar(); sfx('equip'); toast(`Equipped ${g.name}.`, gearIcon(g)); }; });
  el.querySelectorAll('[data-bagsort]').forEach((b) => { b.onclick = () => { bagSort(b.dataset.bagsort); renderSheet(); }; });
  el.querySelectorAll('[data-pin]').forEach((b) => { b.onclick = () => { pinToHotbar(b.dataset.pin); renderSheet(); }; });
  el.querySelectorAll('[data-gear]').forEach((b) => { b.onclick = () => { const g = GEAR[b.dataset.gear]; S.equip[g.slot] = g.slot === 'gadget' && S.equip.gadget === b.dataset.gear ? null : b.dataset.gear; cancelTask(); equipGear(); buildGearBar(); updateTitle(); save(); renderSheet(); burst(player.pos.clone().setY(1.6), '#ffe07a', 20, 4); sfx('equip'); }; });
  el.querySelectorAll('[data-cos]').forEach((b) => { b.onclick = () => { const [sl, k] = b.dataset.cos.split(':'); const C = cosState(); const wasSkel = heroSkel(); C.eq[sl] = k && C.eq[sl] !== k ? k : null; if (sl === 'outfit' && wasSkel !== heroSkel()) { rebuildHero(); if (net.on) profileKey = ''; } else if (sl === 'cape' || sl === 'outfit') { applyLook(); if (sl === 'outfit') equipGear(); } heroFlair(); save(); renderSheet(); burst(player.pos.clone().setY(1.6), '#ffe07a', 24, 4); }; });
  el.querySelectorAll('[data-title]').forEach((b) => { b.onclick = () => { S.title = b.dataset.title; save(); renderSheet(); }; });
  if ($('helmtog')) $('helmtog').onclick = () => { S.look.helmOff = !S.look.helmOff; applyLook(); save(); renderSheet(); };
  if ($('b-appear')) $('b-appear').onclick = () => { closeSheet(); openCreator('edit'); };
}

// ---------- Sir Percival Pompington, the glory thief ----------
// After you beat a big boss, a smug shiny knight strolls up and claims he did it.
const POMP_LOOK = { ...NPC_BASE, skin: 'porcelain', eyes: 'blue', eyeStyle: 'sleepy', mouth: 'grin', hair: 'swept', hairCol: 'blonde', head: 'big', beard: 'none' };
const POMP_LINES = [
  (b) => [`Stand aside, peasant! I, Sir Percival Pompington, have vanquished ${b}!`, ['h', 'You literally just got here.'], 'Details! Everyone saw my magnificent chin do all the work.', 'Off I go to tell the King of MY victory! Toodle-oo!'],
  (b) => [`Ahem! Another triumph for Sir Percival Pompington! ${b} trembled at my name!`, ['h', 'You were hiding behind that tree.'], 'Strategic observation, my dear simpleton. Look it up.', 'Do try to keep up. Pompington, AWAY!'],
  (b) => [`Oh, splendid, you softened up ${b} for me. Jolly good, little helper!`, ['h', "I'm not your helper!"], 'Of course you are. Now hold my cape while I pose for the statue.', 'Hmph! Nobody appreciates true heroism! Farewell!'],
];
let pomp = null;
function pompArrive(boss) {
  if (pomp || player.dead || S.pompFree || (S.quests.st_storm && S.quests.st_storm.state === 'done')) return;
  if (roulette || bossIntro || talking) { later(1, () => pompArrive(boss)); return; }
  const a = new Actor(G.knight, { hide: ['Knight_Helmet'], scale: 1.3 });
  dressNpc(a, POMP_LOOK);
  a.root.traverse((o) => {
    if (!o.isMesh || !/_(Body|Cape)$/.test(o.name) || !o.userData.mats || Array.isArray(o.userData.mats.toon)) return;
    const m = { std: o.userData.mats.std.clone(), toon: o.userData.mats.toon.clone() };
    m.toon.onBeforeCompile = o.userData.mats.toon.onBeforeCompile; m.std.color.set('#ffe28a'); m.toon.color.set('#ffe28a'); registerMesh(o, m);
  });
  const side = player.root.rotation.y + Math.PI / 2;
  a.root.position.set(player.pos.x + Math.sin(side) * 3.2, 0, player.pos.z + Math.cos(side) * 3.2);
  collide(a.root.position, 0.6);
  a.face(player.pos.x, player.pos.z); a.play('Cheer', { once: true, onFinish: () => a.play('Idle') });
  burst(a.pos.clone().setY(1.2), '#fff3a0', 50, 6); sfx('door');
  a.T = { name: 'Sir Percival Pompington', look: POMP_LOOK, scale: 1.3 }; a.type = 'pomp'; a.hp = 0; a.inside = where;
  pomp = a;
  S.pompN = (S.pompN || 0) + 1;
  startBossScene(a, 'credit', POMP_LINES[(S.pompN - 1) % POMP_LINES.length](boss.T.name));
}
function pompLeave() {
  const a = pomp; if (!a) return;
  a.play('Cheer', { once: true });
  later(1.4, () => { burst(a.pos.clone().setY(1.2), '#fff3a0', 50, 6); scene.remove(a.root); if (pomp === a) pomp = null; toast('Sir Percival Pompington marched off to take the credit. Nobody believed him.'); });
}
function pompTick(dt) {
  if (!pomp) return;
  pomp.mixer.update(dt);
  headPose(pomp);
  faceTick(pomp);
}

// ===================== v29: mayors, taxes, net worth and the Dark Omen =====================
// Free a town and you become its mayor. Citizens pay taxes once every game week (7 in-game days,
// so about 2 hours 48 minutes of play), straight into your bank. Spend coins on upgrades to make
// the town grander and the taxes bigger. Upgrades take in-game time to build.
const WEEK_DAYS = 7;
const TOWN_LEVELS = [
  { name: 'Freed town' },
  { name: 'Market town', cost: 250, days: 0.5, what: 'a market with stalls and crates' },
  { name: 'Busy town', cost: 700, days: 1, what: 'a watchtower and a grain store' },
  { name: 'Grand town', cost: 1600, days: 2, what: 'a golden fountain with your statue' },
];
const townLvl = (T) => { const r = remoteMayor(T.id); return r ? r.lvl || 0 : (S.townLvl && S.townLvl[T.id]) || 0; };
const townBuild = (T) => !remoteMayor(T.id) && S.townBuild && S.townBuild[T.id];
const mayorName = (T) => { const r = remoteMayor(T.id); if (r) return r.mayor_name || 'a friend'; return typeof (S.towns || {})[T.id] === 'string' ? S.towns[T.id] : heroName(); };
const weeklyTax = (T) => Math.round(400 * T.stars * townMult(T) * (1 + 0.75 * townLvl(T)));
const upgradeCost = (T, l) => Math.round(TOWN_LEVELS[l].cost * T.stars * townMult(T));
// Tab: a hero card with your look, level, gold, net worth and the towns you run
function renderCard(el) {
  const nw = netWorth(), mine = TOWNS.filter((T) => townMine(T.id)), rk = rankOf(heroLvl()), R = RANKS[rk], t = heroTitle(), ch = chapterNow();
  const L = heroLvl(), cur = HXT[L], next = HXT[Math.min(HERO_MAX, L + 1)], pct = L >= 99 ? 100 : ((S.hero.xp - cur) / (next - cur)) * 100;
  el.innerHTML = `<h3>${esc(heroName())} <small>${ch.tag}</small></h3>
    <div class="herocard" style="--rank:${R.col}">
      <div class="dfig"><div class="dprev" title="Drag to turn your hero"></div><span class="drank">${R.name}</span>${t && t.name !== R.name ? `<em>${esc(t.name)}</em>` : ''}</div>
      <div class="hcstats">
        <div class="hclvl"><b>Level ${L}</b><div class="hcbar"><i style="width:${pct.toFixed(1)}%"></i></div><small>${L >= 99 ? 'Max level' : `${fmt(S.hero.xp - cur)} / ${fmt(next - cur)} XP`}</small></div>
        <div class="hcrow"><img src="${ICONS.coins}" alt=""><span>Gold</span><b>${fmt(nw.coins)}</b></div>
        <div class="hcrow"><img src="${ICONS.coins}" alt=""><span>In the bank</span><b>${fmt(nw.bank)}</b></div>
        <div class="hcrow"><img src="${ICONS.star}" alt=""><span>Items</span><b>${fmt(nw.items)}</b></div>
        <div class="hcrow"><img src="${ICONS.star}" alt=""><span>Towns</span><b>${fmt(nw.towns)}</b></div>
        <div class="hcrow total"><span>Net worth</span><b>${fmt(nw.total)}</b></div>
      </div>
    </div>
    <h4 class="sub">Your towns <small>${mine.length} of ${TOWNS.length}</small></h4>
    ${mine.length ? `<div class="hctowns">${mine.map((T) => `<div class="hctown"><b>${esc(T.name)}</b><span>${'★'.repeat(T.stars || 1)} · ${TOWN_LEVELS[townLvl(T)] ? TOWN_LEVELS[townLvl(T)].name : 'Town'}</span><small>${fmt(weeklyTax(T))} tax a week · worth ${fmt(townValue(T))}</small></div>`).join('')}</div>`
      : '<p class="hint">You don\'t run any towns yet. Beat the monster holding a town to become its mayor and collect taxes every week.</p>'}
    ${heroStatsHtml()}
    <div class="row"><button id="cardclose">Close (Tab)</button></div>`;
  previewMount();
  el.querySelectorAll('[data-stat]').forEach((b) => { b.onclick = () => spendPoint(b.dataset.stat); });
  $('cardclose').onclick = closeSheet;
}
// stat points, weapon, gathering skills and the rich list (this used to be its own Hero sheet)
function heroStatsHtml() {
  const free = freePoints();
  const effect = { atk: `Weapon damage × ${dmgMult().toFixed(1)}`, def: `Damage taken ÷ ${defDiv().toFixed(1)}${gearDef() ? ` (gear +${gearDef()})` : ''}`, hp: `${maxHp()} max health` };
  return `<h4 class="sub">Stats ${free > 0 ? `<small><b>${free} point${free > 1 ? 's' : ''} to spend</b></small>` : ''}</h4>
      <div class="stats">${Object.entries(STATS).map(([k, [nm, ic]]) => `<div class="stat"><img src="${ICONS[ic]}" alt=""><span class="nm">${nm}</span><span class="lv">${stat(k)}</span><small>${effect[k]}</small>${free > 0 ? `<button class="plus" data-stat="${k}" aria-label="Add a point to ${nm}">+</button>` : ''}</div>`).join('')}</div>
      <p class="hint">Each level gives +1 to every stat and ${FREE_PER_LEVEL} points to spend. Defense and Health keep you alive about equally, so mixing them works best.</p>
      <h4 class="sub">Gathering</h4><div class="skills">${SKILLS.filter(([k]) => k !== 'crafting').map(([k, nm]) => {
      const l = lvl(k), c0 = XPT[l], n0 = XPT[Math.min(99, l + 1)];
      const pc = l >= 99 ? 100 : ((S.xp[k] - c0) / (n0 - c0)) * 100;
      return `<div class="skill" title="${Math.floor(S.xp[k])} XP"><img src="${ICONS[k]}" alt=""><span class="nm">${nm}</span><span class="lv">${l}</span><div class="xp"><i style="width:${pc}%"></i></div></div>`;
    }).join('')}</div>${worthHtml()}`;
}
function townValue(T) {
  let v = 1000 * T.stars + weeklyTax(T) * 2;
  for (let l = 1; l <= townLvl(T); l++) v += upgradeCost(T, l);
  return v;
}
const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const gameDay = () => Math.floor(S.gameDays || 0) + 1;
const dayOfWeek = () => (Math.floor(S.gameDays || 0) % WEEK_DAYS) + 1;
function untilTax() { const d = WEEK_DAYS - ((S.gameDays || 0) % WEEK_DAYS); return d; }
function daysText(d) {
  const hrs = Math.max(1, Math.round(d * 24)), dd = Math.floor(hrs / 24), hh = hrs % 24;
  return [dd ? `${dd} day${dd === 1 ? '' : 's'}` : '', hh ? `${hh} hour${hh === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}

// the town sign: a painted board at the gate saying who runs the place and what it is worth
function signTexture(T) {
  const c = T.signCanvas || (T.signCanvas = document.createElement('canvas')); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7a4a26'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#f6e2b8'; g.fillRect(14, 14, 484, 228);
  g.strokeStyle = '#4a2a17'; g.lineWidth = 6; g.strokeRect(14, 14, 484, 228);
  g.textAlign = 'center'; g.fillStyle = '#4a2a17';
  g.font = '800 54px Fredoka, Trebuchet MS, sans-serif'; g.fillText(T.name, 256, 78);
  g.font = '700 30px Fredoka, Trebuchet MS, sans-serif'; g.fillStyle = '#c8901c'; g.fillText(stars(T.stars), 256, 116);
  g.fillStyle = '#4a2a17'; g.font = '700 34px Fredoka, Trebuchet MS, sans-serif';
  if (townFree(T.id)) { g.fillText(`Mayor: ${mayorName(T)}`, 256, 166); g.fillText(`Worth ${fmt(townValue(T))} coins`, 256, 212); }
  else { g.fillStyle = '#a8243a'; g.fillText('Held by monsters!', 256, 166); g.font = '600 26px Fredoka, Trebuchet MS, sans-serif'; g.fillText('Beat the tyrant to become mayor', 256, 208); }
  if (T.signTex) T.signTex.needsUpdate = true;
  if (T.signBack) T.signBack.needsUpdate = true;
  return c;
}
function buildTownSign(T) {
  const a0 = townFacing(T), x = T.x + Math.cos(a0) * 9.5, z = T.z + Math.sin(a0) * 9.5;
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(Math.cos(a0), Math.sin(a0));
  const wood = toon('#7a4a26');
  for (const sx of [-1.25, 1.25]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 8)); p.position.set(sx, 1.3, 0); registerMesh(p, wood); p.castShadow = true; g.add(p); }
  T.signTex = new THREE.CanvasTexture(signTexture(T)); T.signTex.colorSpace = THREE.SRGBColorSpace; T.signTex.anisotropy = 4;
  const face = new THREE.MeshBasicMaterial({ map: T.signTex });
  // the back of the board shows the same words, so it reads from either side of the road
  const backTex = T.signTex.clone(); backTex.wrapS = THREE.RepeatWrapping; backTex.repeat.x = -1; backTex.offset.x = 1; T.signBack = backTex;
  const back = new THREE.MeshBasicMaterial({ map: backTex });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.14));
  registerMesh(board, { std: [wood.std, wood.std, wood.std, wood.std, face, back], toon: [wood.toon, wood.toon, wood.toon, wood.toon, face, back] });
  board.position.y = 2.1; board.castShadow = true; g.add(board);
  scene.add(g); colliders.push({ x, z, r: 0.6 });
}
function refreshSign(T) { if (T.signTex) signTexture(T); }

// what each upgrade adds to the town, so you can see it from the road
function townExtras(T, lvl) {
  T.extras = T.extras || {};
  if (T.extras[lvl]) return;
  const a0 = townFacing(T), at = (a, r) => [T.x + Math.cos(a) * r, T.z + Math.sin(a) * r], objs = [];
  const put = (name, a, r, s, opt) => { const [x, z] = at(a, r); const o = place(name, x, z, s, Math.atan2(T.x - x, T.z - z), opt); if (o) objs.push(o); };
  if (lvl === 1) {
    for (const [da, col] of [[2.3, '#e8743a'], [-2.3, '#3a8fe8']]) { const [x, z] = at(a0 + da, 7.6); const t = tentAt(x, z, Math.atan2(T.x - x, T.z - z), col); if (t) objs.push(t); }
    put('crate_A_big', a0 + 2.75, 8.4, S_PROP); put('barrel', a0 - 2.75, 8.4, S_PROP); put('sack', a0 + 1.95, 8.6, S_PROP, { collide: false });
  } else if (lvl === 2) {
    put('building_tower_A_red', a0 + Math.PI, 17.5, S_BUILD * 0.9);
    put('building_grain', a0 + Math.PI + 0.75, 17.5, S_BUILD * 0.8);
    put('flag_blue', a0 + 0.55, 10.5, S_PROP * 1.6, { collide: false }); put('flag_blue', a0 - 0.55, 10.5, S_PROP * 1.6, { collide: false });
  } else if (lvl === 3) {
    const [x, z] = at(a0 + Math.PI, 6.2), g = new THREE.Group(); g.position.set(x, 0, z);
    const stone = toon('#d8d0c0'), gold = toon('#ffd23f', { emissive: '#7a5a00', emissiveIntensity: 0.25 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.7, 24)); basin.position.y = 0.35; registerMesh(basin, stone); basin.castShadow = true; g.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.1, 24), new THREE.MeshBasicMaterial({ color: '#7fd0ff' })); water.position.y = 0.66; g.add(water);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.4, 12)); ped.position.y = 1.3; registerMesh(ped, stone); g.add(ped);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 1.1, 12)); body.position.y = 2.55; registerMesh(body, gold); body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12)); head.position.y = 3.45; registerMesh(head, gold); head.castShadow = true; g.add(head);
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12)); sword.position.set(0.55, 3.2, 0); sword.rotation.z = -0.3; registerMesh(sword, gold); g.add(sword);
    scene.add(g); objs.push(g); colliders.push({ x, z, r: 2.2 });
    T.fountain = { x, z };
  }
  T.extras[lvl] = objs;
}
function buildSite(T, on) {
  if (T.site) { T.site.forEach((o) => scene.remove(o)); T.site = null; }
  if (!on) return;
  const b = townBuild(T), a0 = townFacing(T), a = b.lvl === 1 ? a0 + 2.3 : b.lvl === 2 ? a0 + Math.PI : a0 + Math.PI;
  const r = b.lvl === 2 ? 15.5 : 7, x = T.x + Math.cos(a) * r, z = T.z + Math.sin(a) * r;
  T.site = [place('resource_lumber', x, z, S_PROP, 0.4, { collide: false }), place('resource_stone', x + 1.6, z + 0.8, S_PROP, 1.1, { collide: false }), place('wheelbarrow', x - 1.4, z + 1.1, S_PROP, 2.2, { collide: false })].filter(Boolean);
  T.siteAt = { x, z };
}
function applyTownLooks(T) {
  for (let l = 1; l <= townLvl(T); l++) townExtras(T, l);
  buildSite(T, !!townBuild(T));
  refreshSign(T);
}

// taxes and builds both run on in-game time, so they only move while you play
let mayorCheckAt = 0;
function mayorTick() {
  if (!player || now < mayorCheckAt) return;
  mayorCheckAt = now + 1;
  const week = Math.floor((S.gameDays || 0) / WEEK_DAYS);
  if (S.taxWeek === undefined) S.taxWeek = week;
  if (week > S.taxWeek) {
    const weeks = week - S.taxWeek; S.taxWeek = week;
    const mine = TOWNS.filter((T) => townMine(T.id));
    if (mine.length) {
      const amount = weeks * mine.reduce((a, T) => a + weeklyTax(T), 0);
      S.bank = (S.bank || 0) + amount; sfx('jackpot');
      toast(`Tax day! ${mine.map((T) => T.name).join(' and ')} paid ${fmt(amount)} coins into your bank.`, ICONS.coins, true);
      refreshUI(); save();
    }
  }
  for (const T of TOWNS) {
    const b = townBuild(T);
    if (b && S.gameDays >= b.done) {
      S.townLvl = { ...(S.townLvl || {}), [T.id]: b.lvl }; delete S.townBuild[T.id];
      buildSite(T, false); townExtras(T, b.lvl); refreshSign(T);
      if (net.on && townMine(T.id)) setTown(T.id, { mayor_id: net.user.id, mayor_name: heroName(), lvl: b.lvl });
      burst(new THREE.Vector3(T.x, 4, T.z), '#ffe07a', 70, 7, 1.6); sfx('win');
      toast(`${T.name} is now a ${TOWN_LEVELS[b.lvl].name}! Weekly taxes rise to ${fmt(weeklyTax(T))} coins.`, ICONS.coins, true);
      save();
    } else if (b && T.siteAt && where === 'out' && rng() < 0.5 && Math.hypot(player.pos.x - T.x, player.pos.z - T.z) < 40) burst(new THREE.Vector3(T.siteAt.x, 0.6, T.siteAt.z), '#e8d8b0', 8, 2.5);
  }
}

// The town clerk runs the Mayor's office: taxes, upgrades and the Dark Omen.
function openMayor(npc) {
  talking = npc;
  const T0 = TOWNS.find((t) => t.id === npc.clerk), r = remoteMayor(T0.id);
  if (r) {
    const dd = $('dialog'), omen0 = (S.inv.dark_omen || 0) > 0;
    dd.innerHTML = `<h3>${T0.name} town hall</h3><p>Welcome, traveller! Our town is run by Mayor ${r.mayor_name || 'a friend'}. Taxes go to them every game week.</p>
      <div class="mayorgrid"><div><small>Mayor</small><b>${r.mayor_name || '?'}</b></div><div><small>Town</small><b>${TOWN_LEVELS[r.lvl || 0].name}</b></div><div><small>Weekly taxes</small><b>${fmt(weeklyTax(T0))}</b></div><div><small>Town worth</small><b>${fmt(townValue(T0))}</b></div></div>
      <p class="mnote">${omen0 ? 'You carry a Dark Omen. Use it here and the monsters return. Beat their tyrant and the town is yours.' : 'Want this town? Find a Dark Omen (bosses drop them), bring it here, then beat the monsters it releases.'}</p>
      <div class="row wrap">${omen0 ? '<button id="m-omen" class="danger">Use a Dark Omen here</button>' : ''}<button id="m-bye">Goodbye</button></div>`;
    if ($('m-omen')) $('m-omen').onclick = () => {
      const btn = $('m-omen');
      if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = `Are you sure? ${r.mayor_name || 'They'} will lose the town. Tap again.`; return; }
      S.inv.dark_omen--; closeDialog(); darkOmen(T0);
    };
    $('m-bye').onclick = closeDialog;
    showDialog(dd); npc.actor.face(player.pos.x, player.pos.z);
    return;
  }
  const T = T0, d = $('dialog'), lvl = townLvl(T), b = townBuild(T), next = TOWN_LEVELS[lvl + 1];
  const omen = (S.inv.dark_omen || 0) > 0;
  let up = '';
  if (b) up = `<div class="mayorbuild"><b>Building: ${TOWN_LEVELS[b.lvl].name}</b><div class="bar"><i style="width:${Math.round(100 * (1 - (b.done - S.gameDays) / TOWN_LEVELS[b.lvl].days))}%"></i></div><small>Ready in ${daysText(Math.max(0, b.done - S.gameDays))} of game time</small></div>`;
  else if (next) up = `<button id="m-up" class="primary" ${S.coins + (S.bank || 0) < upgradeCost(T, lvl + 1) ? 'disabled' : ''}>Build ${next.what}: ${fmt(upgradeCost(T, lvl + 1))} coins</button><small class="mnote">Takes ${daysText(next.days)} of game time. Taxes go up to ${fmt(Math.round(400 * T.stars * (1 + 0.75 * (lvl + 1))))} a week. Paid from your pocket first, then your bank.</small>`;
  else up = '<p class="mnote">This is as grand as a town gets. Splendid work, Mayor!</p>';
  d.innerHTML = `<h3>${T.name} town hall</h3><p>Good day, Mayor ${mayorName(T)}! ${lvl ? `The citizens love the new ${TOWN_LEVELS[lvl].name.toLowerCase()}.` : 'The citizens are so happy to be free.'}</p>
    <div class="mayorgrid"><div><small>Town</small><b>${TOWN_LEVELS[lvl].name}</b></div><div><small>Weekly taxes</small><b>${fmt(weeklyTax(T))}</b></div><div><small>Town worth</small><b>${fmt(townValue(T))}</b></div><div><small>Next tax day</small><b>${daysText(untilTax())}</b></div></div>
    ${up}
    <div class="row wrap">${omen ? '<button id="m-omen" class="danger">Use a Dark Omen here</button>' : ''}<button id="m-bye">Goodbye</button></div>`;
  if ($('m-up')) $('m-up').onclick = () => {
    const cost = upgradeCost(T, lvl + 1); let left = cost;
    const fromPocket = Math.min(S.coins, left); S.coins -= fromPocket; left -= fromPocket; S.bank -= left;
    S.townBuild = { ...(S.townBuild || {}), [T.id]: { lvl: lvl + 1, done: (S.gameDays || 0) + TOWN_LEVELS[lvl + 1].days } };
    buildSite(T, true); sfx('coin'); toast(`The builders get to work on ${T.name}!`, ICONS.hammer); refreshUI(); save(); openMayor(npc);
  };
  if ($('m-omen')) $('m-omen').onclick = () => {
    const btn = $('m-omen');
    if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Are you sure? Monsters will take the town back. Tap again.'; return; }
    S.inv.dark_omen--; closeDialog(); darkOmen(T);
  };
  $('m-bye').onclick = closeDialog;
  showDialog(d);
  npc.actor.face(player.pos.x, player.pos.z);
}
// A Dark Omen calls the monsters back. The town loses its mayor (the buildings stay), and whoever
// beats the tyrant again becomes the new mayor. With friends online, this is how you steal a town.
function darkOmen(T, remote = false) {
  if (S.towns) delete S.towns[T.id];
  if (S.townBuild) delete S.townBuild[T.id];
  if (!remote && net.on) setTown(T.id, { mayor_id: null, mayor_name: null, lvl: townLvl(T) });
  T.flagRed.visible = true; T.flagBlue.visible = false;
  for (const o of T.junk) o.visible = true;
  for (const o of T.homely) o.visible = false;
  for (const n of T.folk || []) { n.inside = 'gone'; n.actor.root.visible = false; }
  for (const e of enemies) {
    if (e.T.town !== T.id) continue;
    e.hp = e.T.hp; e.state = 'rising'; e.introAt = 0;
    reassemble(e);
    later(0.3, () => { const ok = e.play('Spawn_Ground_Skeletons', { once: true, clamp: true, onFinish: () => { e.state = 'idle'; e.play('Idle'); } }); if (!ok) { e.state = 'idle'; e.play('Idle'); } });
  }
  burst(new THREE.Vector3(T.x, 3, T.z), '#8a3ad8', 120, 9, 1.8);
  if (remote) { refreshSign(T); return; }
  sfx('slam');
  toast(`The Dark Omen cracks open! Monsters pour back into ${T.name}. Beat the tyrant to claim it.`, ICONS.dark_omen, true);
  refreshSign(T); refreshUI(); save();
}

// ---------- net worth ----------
function itemsValue() { let v = 0; for (const [k, n] of Object.entries(S.inv || {})) v += (SELL[k] || 0) * n; return v; }
function netWorth() {
  const towns = TOWNS.filter((T) => townMine(T.id)).reduce((a, T) => a + townValue(T), 0);
  return { coins: S.coins, bank: S.bank || 0, items: itemsValue(), towns, total: S.coins + (S.bank || 0) + itemsValue() + towns };
}
let richAsked = 0;
// Online, the list shows real players. Offline, you race the valley's other adventurers. They get richer as the days go by.
const RIVAL_WORTH = [['Sir Percival Pompington', 2400, 420], ['Big Gus', 900, 160], ['Saffy Quickshot', 650, 190], ['Sir Bramble', 800, 140], ['Nyx', 500, 230]];
function richList() {
  if (net.on) {
    if (!richAsked || performance.now() - richAsked > 30000) { richAsked = performance.now(); refreshBoard().then(() => { if (!$('sheet').hidden && sheetMode === 'card') renderSheet(); }); }
    const rows = (net.board || []).map((r) => ({ name: r.name, worth: Number(r.net_worth) }));
    if (!rows.some((r) => r.name === heroName())) rows.push({ name: heroName(), worth: netWorth().total });
    for (const r of rows) if (r.name === heroName()) { r.me = true; r.worth = netWorth().total; }
    return rows.sort((a, b) => b.worth - a.worth).slice(0, 20);
  }
  const d = S.gameDays || 0;
  const rows = RIVAL_WORTH.map(([n, base, per]) => ({ name: n, worth: Math.round(base + per * d) }));
  rows.push({ name: heroName(), worth: netWorth().total, me: true });
  return rows.sort((a, b) => b.worth - a.worth);
}
function worthHtml() {
  const w = netWorth(), list = richList();
  return `<h4>Net worth <small>${fmt(w.total)} coins</small></h4>
    <div class="worthgrid"><span>Pocket <b>${fmt(w.coins)}</b></span><span>Bank <b>${fmt(w.bank)}</b></span><span>Items <b>${fmt(w.items)}</b></span><span>Towns <b>${fmt(w.towns)}</b></span></div>
    <h4>Richest in the kingdom</h4><ol class="richlist">${list.map((r) => `<li class="${r.me ? 'me' : ''}"><span>${r.name}</span><b>${fmt(r.worth)}</b></li>`).join('')}</ol>
    <p class="hint">${net.on ? 'Every player in JerryQuest, richest first.' : 'Play online to race your friends on this list.'}</p>`;
}


// ---------- smith upgrades ----------
// Brom can upgrade any weapon, shield or armour from +1 to +5. Each step adds 8% to its stats,
// costs coins and ore, and never fails. A +5 old sword keeps up with a plain sword from the next chapter.
const PLUS_MAX = 5, PLUS_STEP = 0.08;
const plusOf = (k) => (S.plus && S.plus[k]) || 0;
const plusMult = (k) => 1 + PLUS_STEP * plusOf(k);
const plusName = (k) => `${GEAR[k].name}${plusOf(k) ? ` +${plusOf(k)}` : ''}`;
function gearUpCost(k) {
  const n = plusOf(k) + 1, g = GEAR[k], base = g.price || (g.unique ? 600 : 120);
  return { coins: Math.round(base * 0.2 * n + 30 * n * n), ore: g.tier === 4 ? 'sunstone_ore' : g.tier === 3 ? 'mireiron_ore' : g.tier === 2 ? 'frostsilver_ore' : n <= 2 ? 'copper_ore' : 'iron_ore', count: 2 * n };
}
function openUpgrade(npc) {
  talking = npc;
  const d = $('dialog');
  const rows = ['weapon', 'shield', 'armour'].map((sl) => S.equip[sl]).filter((k) => GEAR[k]).map((k) => {
    const g = GEAR[k], p = plusOf(k);
    if (p >= PLUS_MAX) return `<div class="upg"><img src="${gearIcon(g)}" alt=""><b>${plusName(k)}</b><span>Fully upgraded!</span><em>Max</em></div>`;
    const c = gearUpCost(k), have = S.inv[c.ore] || 0, ok = S.coins >= c.coins && have >= c.count;
    return `<button class="upg" data-up="${k}" ${ok ? '' : 'disabled'}><img src="${gearIcon(g)}" alt=""><b>${plusName(k)} → +${p + 1}</b><span>${fmt(c.coins)} coins and ${c.count} ${ITEMS[c.ore].toLowerCase()} (you have ${have})</span><em>Upgrade</em></button>`;
  }).join('');
  d.innerHTML = `<h3>${npc.name}</h3><p>Bring me ore and coin and I'll hammer your gear stronger. Each upgrade adds 8%, up to +5. My hammer never slips, I promise!</p>
    <div class="upgs">${rows}</div><p class="hint">Upgrades go on the gear you have equipped. Copper ore for +1 and +2, iron ore after that.</p>
    <div class="row"><button id="ubk">Back to the shop</button><button id="ubye">Goodbye</button></div>`;
  d.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.up, c = gearUpCost(k);
    if (S.coins < c.coins || (S.inv[c.ore] || 0) < c.count || plusOf(k) >= PLUS_MAX) return;
    S.coins -= c.coins; takeItem(c.ore, c.count);
    S.plus = { ...(S.plus || {}), [k]: plusOf(k) + 1 };
    sfx('slam'); later(0.25, () => sfx('win'));
    npc.actor.play('2H_Melee_Attack_Chop', { once: true, onFinish: () => npcIdle(npc) });
    burst(player.pos.clone().setY(1.6), '#ffd84a', 40, 5, 1.3);
    toast(`Clang! Your ${plusName(k)} is ready.`, gearIcon(GEAR[k]), true);
    equipGear(); buildGearBar(); refreshUI(); save(); openUpgrade(npc);
  }; });
  $('ubk').onclick = () => openWeaponShop(npc);
  $('ubye').onclick = closeDialog;
  showDialog(d);
}

// ---------- the request board ----------
// Pip pins up three orders every game day: gather, fish or hunt. Each pays coins and XP,
// and finishing all three in one day spins the prize wheel.
const ORDER_POOL = [
  { k: 'logs', n: 8, say: 'Firewood for the tavern', skill: 'woodcutting' },
  { k: 'oak_logs', n: 5, say: 'Oak planks for a new bridge', skill: 'woodcutting' },
  { k: 'copper_ore', n: 6, say: 'Copper for the smithy', skill: 'mining' },
  { k: 'iron_ore', n: 4, say: 'Iron for the castle gates', skill: 'mining' },
  { k: 'shrimp', n: 6, say: 'Shrimp for Marta\'s pies', skill: 'fishing' },
  { k: 'trout', n: 4, say: 'Trout for the royal supper', skill: 'fishing' },
  { k: 'kills', n: 10, say: 'Clear skeletons off the roads', skill: 'hero' },
  { k: 'bones', n: 8, say: 'Bones for Fenwick\'s potions', skill: 'hero' },
];
function boardToday() {
  const day = Math.floor(S.gameDays || 0);
  if (!S.board || S.board.day !== day) {
    let h = (day + 7) * 2654435761 >>> 0; const pick = [];
    const pool = [...ORDER_POOL.keys()];
    while (pick.length < 3) { h = (h * 1103515245 + 12345) >>> 0; const i = pool.splice(h % pool.length, 1)[0]; pick.push(i); }
    S.board = { day, orders: pick, done: [], kills: 0, bonus: false };
  }
  return S.board;
}
const orderReward = (o) => ({ coins: 20 * o.n + 40, xp: o.skill === 'hero' ? 300 : 40 * o.n });
const orderHave = (o, b) => (o.k === 'kills' ? b.kills : S.inv[o.k] || 0);
function openBoard(npc) {
  talking = npc;
  const b = boardToday(), d = $('dialog');
  const rows = b.orders.map((i) => {
    const o = ORDER_POOL[i], r = orderReward(o), done = b.done.includes(i), have = Math.min(orderHave(o, b), o.n);
    const what = o.k === 'kills' ? `Defeat ${o.n} monsters` : `${o.n} ${ITEMS[o.k].toLowerCase()}`;
    return `<button class="order ${done ? 'done' : ''}" data-ord="${i}" ${done || have < o.n ? 'disabled' : ''}><b>${o.say}</b><span>${what} · ${done ? 'Done!' : `${have} / ${o.n}`}</span><em>${fmt(r.coins)} coins, ${r.xp} ${o.skill === 'hero' ? 'hero' : SKILL_NAME[o.skill]} XP</em></button>`;
  }).join('');
  d.innerHTML = `<h3>${npc.name}</h3><p>Fresh requests every game day! Finish all three for a spin of the prize wheel.</p>
    <div class="orders">${rows}</div><p class="hint">New requests in ${daysText(Math.ceil(S.gameDays || 0.0001) - (S.gameDays || 0) || 1)}. ${b.bonus ? 'You already won today\'s prize!' : `${b.done.length} of 3 done today.`}</p>
    <div class="row"><button id="bbye">Goodbye</button></div>`;
  d.querySelectorAll('[data-ord]').forEach((btn) => { btn.onclick = () => {
    const i = +btn.dataset.ord, o = ORDER_POOL[i], r = orderReward(o);
    if (b.done.includes(i) || orderHave(o, b) < o.n) return;
    if (o.k !== 'kills') takeItem(o.k, o.n);
    b.done.push(i); S.coins += r.coins;
    if (o.skill === 'hero') giveHeroXp(r.xp); else giveXp(o.skill, r.xp);
    sfx('coin'); toast(`Request done: ${o.say}! +${fmt(r.coins)} coins`, ICONS.coins);
    refreshUI(); save();
    if (b.done.length === 3 && !b.bonus) { b.bonus = true; save(); closeDialog(); later(0.6, () => spinWheel('All three requests done!')); return; }
    openBoard(npc);
  }; });
  $('bbye').onclick = closeDialog;
  showDialog(d);
}

// ---------- letters from the Dark King ----------
// After each big boss, a nervous bat called Flapsworth flaps in with a letter.
const LETTERS = {
  boss_gagron: 'Dear Hero,\n\nYou have beaten my dragon. I was not fond of him anyway. He kept setting my curtains on fire.\n\nEnjoy your little shard. You will need a great many more.',
  boss_crusher: 'Dear Hero,\n\nBonecrusher\'s mother has written to me to complain. She says you were rude. I agree.\n\nStop collecting my shards at once.',
  boss_gloom: 'Dear Hero,\n\nThe Gloomcaster was my finest sorcerer. Well, my only sorcerer. He is now crying in a cupboard.\n\nThis is all your fault.',
  boss_rattle: 'Dear Hero,\n\nSo you have all four shards. How lovely for you.\n\nAsk your King what is missing from the middle of his precious Heartstone. Ask him who was in the throne room that night.',
  st_socket: 'Dear Hero,\n\nLooking for something? It is quite safe with me. Someone very close to your King was kind enough to hand it over.\n\nGo north if you like. It is cold there. I hope you did not pack a scarf.',
  boss_mire: 'Dear Hero,\n\nMother Mire tells me you were very rude to her. She also tells me I owe her one youth potion. I do not.\n\nPlease stop beating my helpers. Good help is so hard to find.',
  boss_gobbler: 'Dear Hero,\n\nYou made my Gobbler cough up its supper. Disgusting. Also, well done.\n\nThe stone has split, has it not? Touch the dark half. I did, long ago. It is ever so nice.',
  boss_pomp: 'Dear Hero,\n\nPompington was supposed to be my shiniest helper. Instead he is polishing POTS.\n\nI am giving his battle-suit to someone more competent. Possibly a goat.',
  boss_colossus: 'Dear Hero,\n\nYou broke my Colossus. It took nine hundred years to build and you broke it in an afternoon.\n\nNo matter. Look up.',
  st_castle: 'Dear Hero,\n\nDo you like my castle? It floats. Yours does not. I win.\n\nI was a hero once, you know. I chose the dark half, just like you might. Come up and visit. I will put the kettle on.',
  path_vamp_recruit: 'Dear Hero,\n\nWelcome to the desert, my dark little friend! Here is my offer: join me, and I will give you a castle of your very own. With a moat.\n\nThink about it. No rush. Actually, a little rush.',
  vision_angel: 'Your halo hums, and for a moment you see a vision: a young man in shining armour, long ago, standing before the Heartstone. He reaches for the dark half. His hand trembles.\n\nA voice like warm bells whispers: "He was not born wicked. Remember that, when you meet him."',
  path_vampire: 'Dear Hero,\n\nI felt you take the dark half. Welcome, welcome! We are going to get along SPLENDIDLY.\n\nWhen you reach the desert, think about whose side you would rather be on. I have biscuits.',
  boss_frost: 'Dear Hero,\n\nYou beat the Queen. Splendid! Without her silly snow in the way, my magic flows north like warm soup.\n\nThank you so much for your help.',
};
function queueLetter(id) {
  S.letters = S.letters || {};
  if (!LETTERS[id] || S.letters[id]) return;
  S.letters[id] = 1; S.letterQueue = [...(S.letterQueue || []), id]; save();
}
let letterAt = 0;
let letterOpen = null, lastBossKill = -99;
// a boss scene that starts while a letter is open puts the letter back in the queue to show afterwards
function requeueLetter() { if (letterOpen && !$('dialog').hidden) { S.letterQueue = [letterOpen, ...(S.letterQueue || [])]; letterAt = now + 3; } letterOpen = null; }
function letterTick() {
  if (!player || now < letterAt || !(S.letterQueue || []).length) return;
  letterAt = now + 1;
  if (uiLock() || !$('dialog').hidden || !$('sheet').hidden || pomp || player.dead || (camMoment && camMoment.t < camMoment.dur)) return;
  if (enemies.some((e) => e.T.boss && e.hp > 0 && (e.state === 'chase' || e.state === 'slam'))) return;
  if (bossIntro || now - lastBossKill < 6) return;
  const id = S.letterQueue.shift(); save();
  // Flapsworth swoops down beside you
  sfx('whoosh'); burst(player.pos.clone().setY(3), '#5a3a7a', 30, 5, 1);
  const d = $('dialog');
  const vision = id.startsWith('vision_');
  d.innerHTML = vision ? '<h3>A vision of light</h3><p class="via">Your halo glows warm and bright.</p><div class="letter"></div><div class="row"><button id="lbye" class="primary" data-e="1">Remember it</button></div>'
    : `<h3>A letter from ${DARK_KING}</h3><p class="via">Delivered by Flapsworth the bat, who is shaking a little.</p><div class="letter"></div><div class="row"><button id="lbye" class="primary" data-e="1">Fold it away</button></div>`;
  d.querySelector('.letter').textContent = vision ? LETTERS[id] : `${LETTERS[id]}\n\nYours menacingly,\n${DARK_KING}`;
  $('lbye').onclick = () => { letterOpen = null; closeDialog(); };
  letterOpen = id; showDialog(d);
}

// ---------- Gagron, reformed ----------
// When his shard pops out, the dark magic leaves with it. Gagron shrinks to a much nicer (still grumpy)
// little dragon and moves to the village, by the well.
let gagronFriend = null;
function makeGagronFriend() {
  if (gagronFriend || !S.gagronFree) return;
  const a = new Actor(G.dragon, { scale: 0.62 });
  a.alias = { Idle: 'Flying_Idle', Cheer: 'Yes', Interact: 'Yes' };
  const x = 12, z = 7;
  a.root.position.set(x, 0, z); a.face(0, 8); a.play('Idle');
  addInk(a.root);
  const m = markerSprite(); m.position.set(x, 3.4, z); scene.add(m);
  colliders.push({ x, z, r: 1.2 });
  gagronFriend = { id: 'gagron_pal', name: 'Gagron (much nicer now)', actor: a, marker: m, reach: 3.6, accent: '#e8743a',
    lines: ['Hmph. Yes, it is me. That shard made me grumpy. Well, grumpier.', 'Fenwick says I am "reformed". I still think I am handsome.', 'If you see the one who threw that shard into my cave, I would like a word. A fiery word.', 'Do not call me hideous. Call me Gagron the Mildly Toasty.'] };
  npcs.push(gagronFriend);
}

window.__jq = { toast, setSlotBox, showSlots, get slotBox() { return slotBox; }, get guide() { return guide; }, bossNet, safeSpot, get PVP_LVL() { return PVP_LVL; }, goldNode, wbInfo, wbTick, get wb() { return wb; }, WB_SPOTS, tradeOpen, tradeNet, offerKey, get trade() { return trade; }, adv(s) { for (let t = 0; t < s; t += 0.05) { for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= 0.05; if (timers[i].t <= 0) { const f = timers[i].f; timers.splice(i, 1); f(); } } bossFxTick(0.05); } }, get party() { return party; }, BOSS_AI, PHASE_SETUP, get gulped() { return gulped; }, wriggle, toggleBigMap, spawnEnemy, openPathChoice, choosePath, startLanternNight, get lanterns() { return lanterns; }, duelOffer, duelPrize, onNet, chatCommand, canFight, openUpgrade, openBoard, boardToday, queueLetter, makeGagronFriend, net, peerActors, runeTick, bossFx, renderer, scene, openMayor, darkOmen, netWorth, liberateTown, spots, spotEffect, setGolden, goldenCaught, pompArrive, get goldenE() { return goldenE; }, spinWheel, dayTick, get bossIntro() { return bossIntro; }, bossSkip, startBossScene, sailTo, regions, closeSheet, renderHotbar, crew, setCrewMode, TOWNS, liberateTown, chests, openChest, stopRoulette, enemies, startBossIntro, closeDialog, advanceDialog, dash, attackPress, craft, CRAFTS, openCreator, closeCreator, creator, rebuildHero, setZoom: (z) => { zoom = zoomGoal = z; }, hurtEnemy, goThrough, get where() { return where; }, INTERIORS, equipGear, spendPoint, giveHeroXp, heroLvl, stat, maxHp, defDiv, openWeaponShop, openKing, jump, eat, eatBest, openShop, swing, swingTarget, hitNode, projectiles, timers, get S() { return S; }, get player() { return player; }, enemies, nodes, npcs, startTask, doAction, giveXp, save, openSheet, openDialog };
window.addEventListener('error', (e) => { const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${e.message}`; });
main().catch((err) => {
  console.error(err);
  const m = $('loadmsg'); if (m) m.textContent = `Something went wrong: ${err && err.message ? err.message : err}. Try reloading the page.`;
});
