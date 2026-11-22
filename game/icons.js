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
  fishing: make((g) => fish(g, '#5fb3e6', '#e6f6ff')),
};
