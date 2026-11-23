// Hand-drawn style icons, painted onto small canvases and used as images in the UI.
const INK = '#3a2010';
function make(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 5; g.strokeStyle = INK;
  g.translate(48, 48);
  draw(g);
  return c.toDataURL();
}
const shape = (g, fill, path) => { g.beginPath(); path(); g.fillStyle = fill; g.fill(); g.stroke(); };
const shine = (g, x, y, r = 5) => { g.save(); g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(x, y, r, r * 0.6, -0.6, 0, 7); g.fill(); g.restore(); };

function log(g, bark, ring) {
  g.rotate(-0.35);
  shape(g, bark, () => g.roundRect(-30, -13, 56, 26, 8));
  g.save(); g.lineWidth = 3; g.strokeStyle = 'rgba(58,32,16,.5)';
  g.beginPath(); g.moveTo(-18, -6); g.lineTo(8, -6); g.moveTo(-10, 5); g.lineTo(14, 5); g.stroke(); g.restore();
  shape(g, ring, () => g.ellipse(26, 0, 9, 13, 0, 0, 7));
  g.save(); g.lineWidth = 2.5; g.beginPath(); g.ellipse(26, 0, 4, 6.5, 0, 0, 7); g.stroke(); g.restore();
}
function ore(g, crystal) {
  shape(g, '#8d8a86', () => { g.moveTo(-30, 18); g.lineTo(-24, -10); g.lineTo(-4, -24); g.lineTo(20, -18); g.lineTo(32, 6); g.lineTo(18, 24); g.lineTo(-18, 26); g.closePath(); });
  for (const [x, y, s] of [[-8, -4, 9], [12, 4, 7], [-14, 12, 6]]) {
    shape(g, crystal, () => { g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); });
    shine(g, x - 2, y - 3, 2.5);
  }
}
function fish(g, body, belly) {
  shape(g, body, () => { g.moveTo(-28, 0); g.quadraticCurveTo(-4, -24, 22, -4); g.lineTo(34, -14); g.lineTo(32, 0); g.lineTo(34, 14); g.lineTo(22, 4); g.quadraticCurveTo(-4, 24, -28, 0); });
  g.save(); g.fillStyle = belly; g.beginPath(); g.ellipse(-4, 6, 14, 5, 0, 0, 7); g.fill(); g.restore();
  g.fillStyle = INK; g.beginPath(); g.arc(-16, -3, 3.2, 0, 7); g.fill();
}

export const ICONS = {
  logs: make((g) => log(g, '#a0673a', '#f0c88a')),
  oak_logs: make((g) => log(g, '#6e4423', '#d9a560')),
  copper_ore: make((g) => ore(g, '#ff9b3d')),
  iron_ore: make((g) => ore(g, '#a8c8f0')),
  frostsilver_ore: make((g) => ore(g, '#7fe8ff')),
  mireiron_ore: make((g) => ore(g, '#8adf6a')),
  bogwood_logs: make((g) => log(g, '#4a5a32', '#b8c87a')),
  shrimp: make((g) => {
    shape(g, '#ff8f7a', () => { g.arc(0, 4, 22, Math.PI * 1.05, Math.PI * 2.1); g.arc(2, 6, 10, Math.PI * 2.1, Math.PI * 1.05, true); g.closePath(); });
    g.save(); g.lineWidth = 3; for (const a of [3.6, 4.2, 4.8, 5.4]) { g.beginPath(); g.moveTo(Math.cos(a) * 11, 4 + Math.sin(a) * 11); g.lineTo(Math.cos(a) * 21, 4 + Math.sin(a) * 21); g.stroke(); } g.restore();
  }),
  trout: make((g) => fish(g, '#7fb36a', '#f6d9b0')),
  bones: make((g) => {
    g.rotate(0.6);
    shape(g, '#f6efdc', () => { g.roundRect(-22, -6, 44, 12, 6); });
    for (const x of [-24, 24]) for (const y of [-7, 7]) shape(g, '#f6efdc', () => g.arc(x, y, 8, 0, 7));
  }),
  coins: make((g) => {
    for (const [x, y] of [[-10, 8], [10, 4], [0, -10]]) { shape(g, '#ffcc33', () => g.ellipse(x, y, 16, 16, 0, 0, 7)); g.save(); g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, 9, 9, 0, 0, 7); g.stroke(); g.restore(); shine(g, x - 6, y - 7, 3); }
  }),
  bread: make((g) => {
    shape(g, '#d9944a', () => { g.moveTo(-34, 14); g.quadraticCurveTo(-36, -22, 0, -22); g.quadraticCurveTo(36, -22, 34, 14); g.closePath(); });
    g.save(); g.lineWidth = 4; g.strokeStyle = '#f6d39a'; for (const x of [-14, 0, 14]) { g.beginPath(); g.moveTo(x - 6, -12); g.lineTo(x + 6, 2); g.stroke(); } g.restore();
    shine(g, -16, -12, 4);
  }),
  pie: make((g) => {
    shape(g, '#c9773a', () => { g.moveTo(-36, 6); g.lineTo(36, 6); g.lineTo(28, 24); g.lineTo(-28, 24); g.closePath(); });
    shape(g, '#f0b85c', () => g.ellipse(0, 4, 36, 16, 0, Math.PI, 0));
    g.save(); g.lineWidth = 3; for (const x of [-16, 0, 16]) { g.beginPath(); g.moveTo(x - 5, -6); g.lineTo(x + 5, -2); g.stroke(); } g.restore();
    shape(g, '#e0444f', () => g.arc(0, -16, 6, 0, 7));
    shine(g, -18, -4, 4);
  }),
  hammer: make((g) => {
    g.rotate(-0.6);
    shape(g, '#a0673a', () => g.roundRect(-5, -6, 10, 42, 4));
    shape(g, '#9aa6b8', () => g.roundRect(-24, -26, 48, 22, 5));
    shine(g, -12, -20, 4);
  }),
  grilled_shrimp: make((g) => {
    shape(g, '#e0703a', () => { g.arc(0, 4, 22, Math.PI * 1.05, Math.PI * 2.1); g.arc(2, 6, 10, Math.PI * 2.1, Math.PI * 1.05, true); g.closePath(); });
    g.save(); g.lineWidth = 4; g.strokeStyle = '#6b2e12'; for (const a of [3.7, 4.4, 5.1]) { g.beginPath(); g.moveTo(Math.cos(a) * 12, 4 + Math.sin(a) * 12); g.lineTo(Math.cos(a) * 20, 4 + Math.sin(a) * 20); g.stroke(); } g.restore();
    shine(g, -10, -10, 3.5);
  }),
  grilled_trout: make((g) => {
    fish(g, '#c98a4a', '#f6d9b0');
    g.save(); g.lineWidth = 4; g.strokeStyle = '#6b2e12'; for (const x of [-6, 4, 14]) { g.beginPath(); g.moveTo(x - 4, -10); g.lineTo(x + 4, 8); g.stroke(); } g.restore();
  }),
  fish_pie: make((g) => {
    shape(g, '#c9773a', () => { g.moveTo(-36, 6); g.lineTo(36, 6); g.lineTo(28, 24); g.lineTo(-28, 24); g.closePath(); });
    shape(g, '#f3cf86', () => g.ellipse(0, 4, 36, 16, 0, Math.PI, 0));
    g.save(); g.translate(0, -10); g.scale(0.45, 0.45); fish(g, '#7fb36a', '#f6d9b0'); g.restore();
    shine(g, -20, -2, 4);
  }),
  stew: make((g) => {
    shape(g, '#8a5a32', () => { g.moveTo(-36, -4); g.lineTo(36, -4); g.quadraticCurveTo(34, 30, 0, 30); g.quadraticCurveTo(-34, 30, -36, -4); g.closePath(); });
    shape(g, '#e08a3a', () => g.ellipse(0, -4, 36, 9, 0, 0, 7));
    for (const [x, y, c] of [[-14, -5, '#7fc96a'], [10, -3, '#ffcf5a'], [0, -7, '#f6d9b0']]) shape(g, c, () => g.arc(x, y, 4, 0, 7));
    g.save(); g.lineWidth = 3.5; g.strokeStyle = 'rgba(58,32,16,.55)'; for (const x of [-10, 4, 18]) { g.beginPath(); g.moveTo(x, -18); g.quadraticCurveTo(x + 6, -26, x, -34); g.stroke(); } g.restore();
  }),
  lucky_sock: make((g) => {
    shape(g, '#ff8fb8', () => { g.moveTo(-10, -32); g.lineTo(12, -32); g.lineTo(12, 8); g.quadraticCurveTo(30, 10, 30, 22); g.quadraticCurveTo(28, 34, 8, 32); g.lineTo(-6, 30); g.quadraticCurveTo(-12, 20, -10, 8); g.closePath(); });
    g.save(); g.lineWidth = 4; g.strokeStyle = '#fff2a8'; for (const y of [-24, -14]) { g.beginPath(); g.moveTo(-9, y); g.lineTo(11, y); g.stroke(); } g.restore();
    shape(g, '#7fd36a', () => { g.moveTo(14, 16); g.lineTo(20, 22); g.lineTo(14, 28); g.lineTo(8, 22); g.closePath(); });
  }),
  gloom_hat: make((g) => {
    shape(g, '#6a4fb0', () => { g.moveTo(-34, 22); g.quadraticCurveTo(0, 8, 34, 22); g.quadraticCurveTo(0, 34, -34, 22); });
    shape(g, '#7f5fd0', () => { g.moveTo(-18, 18); g.lineTo(6, -34); g.quadraticCurveTo(20, -30, 26, -16); g.quadraticCurveTo(14, -18, 12, -10); g.lineTo(18, 16); g.closePath(); });
    shape(g, '#ffd23f', () => g.arc(-2, 2, 4, 0, 7));
  }),
  rattle_tooth: make((g) => {
    shape(g, '#ffcc33', () => { g.moveTo(-18, -24); g.quadraticCurveTo(0, -34, 18, -24); g.quadraticCurveTo(22, 0, 12, 28); g.quadraticCurveTo(6, 32, 2, 8); g.quadraticCurveTo(0, 2, -2, 8); g.quadraticCurveTo(-6, 32, -12, 28); g.quadraticCurveTo(-22, 0, -18, -24); });
    shine(g, -8, -16, 5);
  }),
  heart: make((g) => { shape(g, '#ff5a6a', () => { g.moveTo(0, 30); g.bezierCurveTo(-40, 4, -30, -30, 0, -14); g.bezierCurveTo(30, -30, 40, 4, 0, 30); }); shine(g, -14, -12, 6); }),
  boot: make((g) => { shape(g, '#6ec8ff', () => { g.moveTo(-16, -30); g.lineTo(8, -30); g.lineTo(8, 4); g.quadraticCurveTo(32, 6, 32, 24); g.lineTo(-16, 24); g.closePath(); }); shine(g, -6, -18, 4); }),
  bag: make((g) => { shape(g, '#c98a4a', () => { g.moveTo(-24, -10); g.quadraticCurveTo(-34, 30, 0, 32); g.quadraticCurveTo(34, 30, 24, -10); g.closePath(); }); shape(g, '#a8703a', () => { g.moveTo(-14, -12); g.lineTo(-8, -28); g.lineTo(8, -28); g.lineTo(14, -12); g.closePath(); }); g.save(); g.lineWidth = 4; g.strokeStyle = '#ffd23f'; g.beginPath(); g.moveTo(-18, -10); g.lineTo(18, -10); g.stroke(); g.restore(); shine(g, -10, 6, 5); }),
  scroll: make((g) => { shape(g, '#fbe6b4', () => g.roundRect(-22, -28, 44, 56, 6)); shape(g, '#d9a560', () => g.roundRect(-28, -34, 56, 12, 6)); shape(g, '#d9a560', () => g.roundRect(-28, 22, 56, 12, 6)); g.save(); g.lineWidth = 3; for (const y of [-12, -2, 8]) { g.beginPath(); g.moveTo(-12, y); g.lineTo(12, y); g.stroke(); } g.restore(); }),
  mirror: make((g) => { shape(g, '#c98a4a', () => g.roundRect(-4, 14, 8, 22, 3)); shape(g, '#ffd23f', () => g.ellipse(0, -6, 24, 26, 0, 0, 7)); shape(g, '#bfe9ff', () => g.ellipse(0, -6, 16, 18, 0, 0, 7)); shine(g, -6, -14, 6); }),
  gear: make((g) => { shape(g, '#b9b2c8', () => { for (let i = 0; i < 16; i++) { const r = i % 2 ? 22 : 32, a = (i / 16) * Math.PI * 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); }); shape(g, '#7a6f8e', () => g.arc(0, 0, 9, 0, 7)); }),
  chest: make((g) => { shape(g, '#c98a4a', () => g.roundRect(-30, -6, 60, 34, 6)); shape(g, '#a8703a', () => { g.moveTo(-30, -6); g.quadraticCurveTo(0, -36, 30, -6); g.closePath(); }); g.save(); g.lineWidth = 5; g.strokeStyle = '#ffd23f'; g.beginPath(); g.moveTo(-30, 6); g.lineTo(30, 6); g.stroke(); g.restore(); shape(g, '#ffd23f', () => g.roundRect(-6, 0, 12, 14, 3)); }),
  bone_dust: make((g) => { shape(g, '#d9c9a8', () => { g.moveTo(-26, 18); g.quadraticCurveTo(-30, -14, -10, -24); g.quadraticCurveTo(14, -30, 26, -4); g.quadraticCurveTo(30, 22, 6, 28); g.quadraticCurveTo(-18, 30, -26, 18); }); g.save(); g.lineWidth = 3; g.strokeStyle = '#8a6a3a'; g.beginPath(); g.moveTo(-20, -6); g.quadraticCurveTo(0, -14, 20, -6); g.stroke(); g.restore(); for (const [x, y] of [[-6, 6], [8, 10], [0, 18], [12, -2]]) shape(g, '#f6efdc', () => g.arc(x, y, 3.5, 0, 7)); }),
  dark_essence: make((g) => { shape(g, '#7a3fd0', () => { g.moveTo(0, -34); g.quadraticCurveTo(26, -6, 18, 16); g.quadraticCurveTo(10, 32, 0, 32); g.quadraticCurveTo(-10, 32, -18, 16); g.quadraticCurveTo(-26, -6, 0, -34); }); shape(g, '#c58bff', () => g.ellipse(-2, 10, 9, 12, 0, 0, 7)); shine(g, -6, 2, 4); }),
  // skills
  melee: make((g) => {
    g.rotate(0.78);
    shape(g, '#e8eef5', () => { g.moveTo(-5, -38); g.lineTo(5, -38); g.lineTo(5, 12); g.lineTo(-5, 12); g.closePath(); });
    shape(g, '#c9902f', () => g.roundRect(-16, 10, 32, 8, 4));
    shape(g, '#7a4a2a', () => g.roundRect(-4, 18, 8, 16, 3));
    shape(g, '#c9902f', () => g.arc(0, 37, 5, 0, 7));
  }),
  magic: make((g) => {
    shape(g, '#b98cff', () => { for (let i = 0; i < 10; i++) { const r = i % 2 ? 14 : 34, a = -Math.PI / 2 + i * Math.PI / 5; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); });
    shine(g, -6, -10, 5);
  }),
  ranged: make((g) => {
    g.rotate(-0.78);
    g.save(); g.lineWidth = 7; g.beginPath(); g.arc(-8, 0, 30, -1.2, 1.2); g.strokeStyle = INK; g.stroke(); g.lineWidth = 3.5; g.strokeStyle = '#a0673a'; g.stroke(); g.restore();
    g.save(); g.lineWidth = 2.5; g.beginPath(); g.moveTo(-8 + Math.cos(-1.2) * 30, Math.sin(-1.2) * 30); g.lineTo(-8 + Math.cos(1.2) * 30, Math.sin(1.2) * 30); g.stroke(); g.restore();
    g.save(); g.lineWidth = 4; g.beginPath(); g.moveTo(-14, 0); g.lineTo(30, 0); g.stroke(); g.restore();
    shape(g, '#e8eef5', () => { g.moveTo(36, 0); g.lineTo(26, -7); g.lineTo(26, 7); g.closePath(); });
  }),
  speed: make((g) => {
    shape(g, '#5aa9e6', () => { g.moveTo(-14, -30); g.lineTo(6, -30); g.lineTo(6, 6); g.quadraticCurveTo(30, 6, 32, 22); g.lineTo(-14, 22); g.closePath(); });
    g.save(); g.lineWidth = 4; for (const y of [-14, -2, 10]) { g.beginPath(); g.moveTo(-34, y); g.lineTo(-22, y); g.stroke(); } g.restore();
    shine(g, -4, -20, 4);
  }),
  woodcutting: make((g) => {
    g.rotate(0.6);
    shape(g, '#8a5a32', () => g.roundRect(-4, -34, 8, 66, 4));
    shape(g, '#d8dee6', () => { g.moveTo(2, -30); g.quadraticCurveTo(30, -36, 28, -10); g.quadraticCurveTo(14, -16, 2, -12); g.closePath(); });
  }),
  mining: make((g) => {
    g.rotate(-0.5);
    shape(g, '#8a5a32', () => g.roundRect(-4, -26, 8, 60, 4));
    shape(g, '#c3cad3', () => { g.moveTo(-34, -14); g.quadraticCurveTo(0, -40, 34, -14); g.quadraticCurveTo(0, -28, -34, -14); });
  }),
  shield: make((g) => {
    shape(g, '#5f9ef0', () => { g.moveTo(0, -32); g.quadraticCurveTo(18, -24, 30, -26); g.quadraticCurveTo(32, 12, 0, 34); g.quadraticCurveTo(-32, 12, -30, -26); g.quadraticCurveTo(-18, -24, 0, -32); });
    shape(g, '#ffd84a', () => { g.moveTo(0, -18); g.lineTo(6, -4); g.lineTo(20, -4); g.lineTo(9, 5); g.lineTo(13, 19); g.lineTo(0, 11); g.lineTo(-13, 19); g.lineTo(-9, 5); g.lineTo(-20, -4); g.lineTo(-6, -4); g.closePath(); });
    shine(g, -16, -16, 5);
  }),
  armour: make((g) => {
    shape(g, '#c8d4e4', () => { g.moveTo(-14, -30); g.lineTo(-30, -20); g.lineTo(-24, 0); g.lineTo(-18, -4); g.lineTo(-18, 30); g.lineTo(18, 30); g.lineTo(18, -4); g.lineTo(24, 0); g.lineTo(30, -20); g.lineTo(14, -30); g.quadraticCurveTo(0, -18, -14, -30); });
    g.save(); g.lineWidth = 3; g.beginPath(); g.moveTo(-18, 8); g.lineTo(18, 8); g.moveTo(0, -20); g.lineTo(0, 30); g.stroke(); g.restore();
    shine(g, -10, -12, 4);
  }),
  star: make((g) => {
    shape(g, '#ffd84a', () => { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 14 : 32; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); });
    shine(g, -6, -10, 5);
  }),
  silver_ring: make((g) => {
    g.save(); g.lineWidth = 14; g.strokeStyle = INK; g.beginPath(); g.ellipse(0, 8, 22, 18, 0, 0, 7); g.stroke();
    g.lineWidth = 8; g.strokeStyle = '#dfe6ee'; g.beginPath(); g.ellipse(0, 8, 22, 18, 0, 0, 7); g.stroke(); g.restore();
    shape(g, '#8fd8ff', () => { g.moveTo(0, -30); g.lineTo(12, -16); g.lineTo(0, -4); g.lineTo(-12, -16); g.closePath(); });
    shine(g, -3, -20, 3);
  }),
  ruby: make((g) => {
    shape(g, '#ff3b5c', () => { g.moveTo(-18, -22); g.lineTo(18, -22); g.lineTo(32, -6); g.lineTo(0, 30); g.lineTo(-32, -6); g.closePath(); });
    g.save(); g.lineWidth = 3; g.beginPath(); g.moveTo(-32, -6); g.lineTo(32, -6); g.moveTo(-8, -22); g.lineTo(-12, -6); g.lineTo(0, 30); g.lineTo(12, -6); g.lineTo(8, -22); g.stroke(); g.restore();
    shine(g, -14, -14, 5);
  }),
  frost_gem: make((g) => {
    shape(g, '#7fd3ff', () => { g.moveTo(-18, -22); g.lineTo(18, -22); g.lineTo(32, -6); g.lineTo(0, 30); g.lineTo(-32, -6); g.closePath(); });
    g.save(); g.lineWidth = 3; g.beginPath(); g.moveTo(-32, -6); g.lineTo(32, -6); g.moveTo(-8, -22); g.lineTo(-12, -6); g.lineTo(0, 30); g.lineTo(12, -6); g.lineTo(8, -22); g.stroke(); g.restore();
    shine(g, -14, -14, 5);
  }),
  golden_crown: make((g) => {
    shape(g, '#ffd84a', () => { g.moveTo(-30, 22); g.lineTo(-32, -18); g.lineTo(-16, 0); g.lineTo(0, -26); g.lineTo(16, 0); g.lineTo(32, -18); g.lineTo(30, 22); g.closePath(); });
    for (const [x, c] of [[-16, '#ff5a6a'], [0, '#5fb3e6'], [16, '#66c46a']]) shape(g, c, () => g.arc(x, 12, 5, 0, 7));
    shine(g, -20, -4, 4);
  }),
  royal_jelly: make((g) => {
    // a wobbly golden jelly with a tiny crown
    shape(g, '#ffcf3a', () => { g.moveTo(-30, 26); g.quadraticCurveTo(-34, -14, 0, -16); g.quadraticCurveTo(34, -14, 30, 26); g.closePath(); });
    shape(g, '#ffe58a', () => g.ellipse(-8, 0, 9, 12, -0.3, 0, 7));
    shape(g, '#ffd84a', () => { g.moveTo(-12, -14); g.lineTo(-14, -30); g.lineTo(-5, -22); g.lineTo(0, -32); g.lineTo(5, -22); g.lineTo(14, -30); g.lineTo(12, -14); g.closePath(); });
    for (const x of [-9, 9]) shape(g, '#3a2010', () => g.arc(x, 6, 3.5, 0, 7));
    shine(g, -16, -4, 4);
  }),
  frost_crown: make((g) => {
    shape(g, '#bfefff', () => { g.moveTo(-30, 22); g.lineTo(-30, -10); g.lineTo(-18, 2); g.lineTo(-10, -26); g.lineTo(0, -2); g.lineTo(10, -26); g.lineTo(18, 2); g.lineTo(30, -10); g.lineTo(30, 22); g.closePath(); });
    for (const x of [-16, 0, 16]) shape(g, '#7fd3ff', () => g.arc(x, 12, 4.5, 0, 7));
    shine(g, -20, -2, 4);
  }),
  dark_omen: make((g) => {
    // a cracked purple orb with a glowing eye inside
    shape(g, '#5a2a8a', () => g.arc(0, 2, 30, 0, 7));
    shape(g, '#9a5ae0', () => g.arc(-4, -2, 20, 0, 7));
    shape(g, '#ffe066', () => g.ellipse(0, 2, 14, 8, 0, 0, 7));
    shape(g, '#2a0a3a', () => g.ellipse(0, 2, 4, 7, 0, 0, 7));
    g.strokeStyle = '#2a0a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(10, -26); g.lineTo(4, -14); g.lineTo(12, -8); g.stroke();
    shine(g, -16, -14, 5);
  }),
  dragon_scale: make((g) => {
    shape(g, '#e0452a', () => { g.moveTo(0, -32); g.quadraticCurveTo(30, -20, 26, 6); g.quadraticCurveTo(18, 26, 0, 34); g.quadraticCurveTo(-18, 26, -26, 6); g.quadraticCurveTo(-30, -20, 0, -32); });
    shape(g, '#ffb347', () => { g.moveTo(0, -18); g.quadraticCurveTo(16, -10, 13, 6); g.quadraticCurveTo(8, 18, 0, 22); g.quadraticCurveTo(-8, 18, -13, 6); g.quadraticCurveTo(-16, -10, 0, -18); });
    shine(g, -12, -14, 5);
  }),
  fishing: make((g) => fish(g, '#5fb3e6', '#e6f6ff')),
};
ICONS.crafting = ICONS.hammer;
// Chapter 3 trophies
ICONS.mire_charm = make((g) => {
  g.save(); g.lineWidth = 3; g.beginPath(); g.moveTo(0, -34); g.lineTo(0, -16); g.stroke(); g.restore();
  shape(g, '#7a4ab0', () => g.arc(0, 4, 22, 0, 7));
  shape(g, '#8aff6a', () => { g.moveTo(0, -10); g.quadraticCurveTo(14, 4, 0, 20); g.quadraticCurveTo(-14, 4, 0, -10); });
  shine(g, -10, -4, 4);
});
ICONS.rusty_helm = make((g) => {
  shape(g, '#a88a5a', () => { g.moveTo(-26, 24); g.lineTo(-26, -4); g.quadraticCurveTo(-24, -30, 0, -32); g.quadraticCurveTo(24, -30, 26, -4); g.lineTo(26, 24); g.closePath(); });
  shape(g, '#3a2a1a', () => { g.rect(-18, -2, 36, 6); });
  shape(g, '#6a9a4a', () => { g.moveTo(-26, 16); g.quadraticCurveTo(-10, 8, 4, 18); g.quadraticCurveTo(-8, 26, -26, 24); g.closePath(); });
  shine(g, -12, -18, 4);
});
ICONS.gobbler_tooth = make((g) => {
  shape(g, '#fff6e0', () => { g.moveTo(-20, -26); g.quadraticCurveTo(0, -34, 20, -26); g.quadraticCurveTo(14, 6, 0, 32); g.quadraticCurveTo(-14, 6, -20, -26); });
  shape(g, '#8adf6a', () => { g.moveTo(-14, -20); g.quadraticCurveTo(0, -26, 14, -20); g.quadraticCurveTo(0, -14, -14, -20); });
  shine(g, -8, -10, 4);
});
ICONS.wardstone = make((g) => {
  shape(g, '#2a2240', () => { g.moveTo(0, -32); g.lineTo(-22, -4); g.lineTo(0, 32); g.closePath(); });
  shape(g, '#fff6d0', () => { g.moveTo(0, -32); g.lineTo(22, -4); g.lineTo(0, 32); g.closePath(); });
  shine(g, 8, -8, 4);
});
ICONS.halo = make((g) => { g.save(); g.lineWidth = 10; g.strokeStyle = '#4a2a17'; g.beginPath(); g.ellipse(0, 0, 28, 12, 0, 0, 7); g.stroke(); g.lineWidth = 6; g.strokeStyle = '#ffe27a'; g.stroke(); g.restore(); });
ICONS.fang = make((g) => {
  shape(g, '#a8243a', () => { g.moveTo(-30, -20); g.quadraticCurveTo(0, -30, 30, -20); g.quadraticCurveTo(0, -6, -30, -20); });
  for (const sx of [-1, 1]) shape(g, '#ffffff', () => { g.moveTo(sx * 16, -16); g.lineTo(sx * 6, -14); g.lineTo(sx * 11, 20); g.closePath(); });
});
ICONS.human = make((g) => { shape(g, '#ffd8b0', () => g.arc(0, -10, 16, 0, 7)); shape(g, '#5fb3e6', () => { g.moveTo(-24, 32); g.quadraticCurveTo(-24, 8, 0, 8); g.quadraticCurveTo(24, 8, 24, 32); g.closePath(); }); shine(g, -6, -16, 4); });
// Chapter 4: Brassbolt Sands
ICONS.sunstone_ore = make((g) => {
  shape(g, '#ffb347', () => { g.moveTo(0, -30); g.lineTo(24, -6); g.lineTo(14, 28); g.lineTo(-14, 28); g.lineTo(-24, -6); g.closePath(); });
  shape(g, '#fff1a0', () => { g.moveTo(0, -18); g.lineTo(12, -2); g.lineTo(6, 16); g.lineTo(-6, 16); g.lineTo(-12, -2); g.closePath(); });
  shine(g, -8, -10, 4);
});
ICONS.palm_logs = make((g) => {
  for (const [y, c] of [[-10, '#c89a5a'], [10, '#b8884a']]) shape(g, c, () => g.rect(-28, y - 8, 56, 16));
  for (const y of [-10, 10]) shape(g, '#f0d8a0', () => g.ellipse(28, y, 5, 8, 0, 0, 7));
});
ICONS.gadget = make((g) => {
  shape(g, '#d8a850', () => { for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 22 : 30; i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(r, 0); } g.closePath(); });
  shape(g, '#6a4a2a', () => g.arc(0, 0, 9, 0, 7));
  shine(g, -12, -12, 4);
});
ICONS.pomp_monocle = make((g) => {
  g.save(); g.lineWidth = 3; g.beginPath(); g.moveTo(14, 10); g.quadraticCurveTo(28, 26, 18, 34); g.stroke(); g.restore();
  shape(g, '#ffd23f', () => g.arc(-2, -6, 22, 0, 7));
  shape(g, '#cfeeff', () => g.arc(-2, -6, 15, 0, 7));
  shine(g, -9, -13, 5);
});
ICONS.colossus_core = make((g) => {
  shape(g, '#b8884a', () => g.arc(0, 0, 30, 0, 7));
  shape(g, '#7fe8ff', () => g.arc(0, 0, 18, 0, 7));
  shape(g, '#ffffff', () => g.arc(0, 0, 8, 0, 7));
  shine(g, -12, -12, 4);
});
ICONS.sphinx_coin = make((g) => {
  shape(g, '#e8c060', () => g.arc(0, 0, 28, 0, 7));
  shape(g, '#b88a30', () => { g.moveTo(-14, 14); g.lineTo(-14, -2); g.quadraticCurveTo(-12, -16, 0, -18); g.quadraticCurveTo(12, -16, 14, -2); g.lineTo(14, 14); g.closePath(); });
  shine(g, -12, -12, 4);
});
ICONS.crate = make((g) => {
  shape(g, '#c8884a', () => g.rect(-26, -22, 52, 44));
  g.save(); g.lineWidth = 4; g.strokeStyle = '#6a3a1a'; g.beginPath(); g.moveTo(-26, -22); g.lineTo(26, 22); g.moveTo(26, -22); g.lineTo(-26, 22); g.stroke(); g.restore();
});
