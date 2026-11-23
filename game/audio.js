// Music and sound effects, all made live with Web Audio: no sound files, nothing to license.
// The tunes are original, written for JerryQuest: a bouncy village theme, an adventure theme for
// the wilds, a spooky cave theme and a fast boss theme.

let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
const vol = { music: 0.55, sfx: 0.8 };
export function setVolumes(m, s) {
  vol.music = m; vol.sfx = s;
  if (musicBus) musicBus.gain.setTargetAtTime(m * 0.32, ctx.currentTime, 0.05);
  if (sfxBus) sfxBus.gain.setTargetAtTime(s * 0.7, ctx.currentTime, 0.05);
}
export function audioReady() { return !!ctx && ctx.state === 'running'; }
// Browsers only allow sound after the player presses something.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    setVolumes(vol.music, vol.sfx);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    setInterval(schedule, 40);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// ---------- little synth voices ----------
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
function tone(bus, t, freq, dur, { type = 'square', gain = 0.2, attack = 0.005, release = 0.08, slide = 0, filter = 0, detune = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  let out = g;
  if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; g.connect(f); out = f; }
  o.connect(g); out.connect(bus);
  o.start(t); o.stop(t + dur + release + 0.02);
}
function noise(bus, t, dur, { gain = 0.2, type = 'bandpass', freq = 1200, q = 1, sweep = 0 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
const kick = (t, g = 0.5) => tone(musicBus, t, 120, 0.12, { type: 'sine', gain: g, slide: 0.35, release: 0.05 });
const snare = (t, g = 0.18) => { noise(musicBus, t, 0.12, { gain: g, freq: 1800, q: 0.7 }); tone(musicBus, t, 220, 0.05, { type: 'triangle', gain: g * 0.6 }); };
const hat = (t, g = 0.05) => noise(musicBus, t, 0.03, { gain: g, type: 'highpass', freq: 7000 });

// ---------- songs ----------
// Each track is 32 sixteenth-note steps per bar. Notes are MIDI numbers, '.' holds, '-' rests.
const N = (s) => s.trim().split(/\s+/).map((x) => (x === '-' ? null : x === '.' ? '.' : parseInt(x, 10)));
const SONGS = {
  village: {
    bpm: 128, leadWave: 'square', leadGain: 0.09, swing: 0.1,
    // a skipping, cheerful tune in C major
    lead: N(`72 . 76 . 79 . 76 . 77 . 76 . 74 . - . 72 . 74 . 76 . 72 . 74 . 71 . 67 . - .
             72 . 76 . 79 . 81 . 79 . 77 . 76 . - . 74 . 76 . 77 . 74 . 72 . . . - . - .
             81 . 79 . 77 . 76 . 77 . 79 . 81 . - . 79 . 77 . 76 . 74 . 76 . 72 . - . - .
             72 . 74 . 76 . 77 . 79 . . . 84 . - . 83 . 81 . 79 . 74 . 76 . 72 . . . - .`),
    bass: N(`48 - 55 - 48 - 55 - 53 - 60 - 53 - 60 - 55 - 62 - 55 - 62 - 55 - 59 - 55 - 59 -
             48 - 55 - 48 - 55 - 53 - 60 - 53 - 60 - 55 - 62 - 55 - 62 - 48 - 55 - 48 - 52 -
             53 - 60 - 53 - 60 - 52 - 59 - 52 - 59 - 50 - 57 - 50 - 57 - 55 - 62 - 55 - 59 -
             48 - 55 - 48 - 55 - 53 - 60 - 57 - 60 - 55 - 62 - 55 - 59 - 48 - 55 - 48 - - -`),
    drums: 'k-h-s-h-k-h-s-hkkh-s-h-k-h-s-h-h',
  },
  field: {
    bpm: 138, leadWave: 'triangle', leadGain: 0.14, swing: 0,
    // a brisk adventuring tune in G
    lead: N(`67 . . . 71 . 74 . 79 . . . 78 . 76 . 74 . . . 71 . 72 . 74 . . . - . - .
             76 . . . 74 . 72 . 71 . 72 . 74 . 67 . 69 . . . 71 . 69 . 67 . . . - . - .
             67 . . . 71 . 74 . 79 . . . 81 . 83 . 81 . 79 . 78 . 76 . 78 . . . - . 74 .
             76 . 78 . 79 . 81 . 83 . . . 81 . 79 . 78 . 74 . 76 . 78 . 79 . . . - . - .`),
    bass: N(`43 - 50 - 43 - 50 - 43 - 50 - 47 - 50 - 48 - 55 - 48 - 55 - 50 - 57 - 50 - 57 -
             48 - 55 - 48 - 55 - 47 - 54 - 47 - 54 - 45 - 52 - 45 - 52 - 50 - 57 - 50 - 54 -
             43 - 50 - 43 - 50 - 40 - 47 - 40 - 47 - 48 - 55 - 48 - 55 - 50 - 57 - 50 - 57 -
             48 - 55 - 48 - 55 - 52 - 59 - 52 - 59 - 50 - 57 - 50 - 54 - 43 - 50 - 43 - - -`),
    drums: 'k-h-s-hkk-h-s-h-k-h-s-hkk-h-shss',
  },
  frost: {
    bpm: 120, leadWave: 'triangle', leadGain: 0.15, swing: 0.08,
    // a twinkly snow-day tune in D, with jingly hats
    lead: N(`74 . 78 . 81 . 86 . 85 . 81 . 78 . - . 76 . 79 . 83 . 81 . 79 . 76 . 78 . - .
             74 . 78 . 81 . 83 . 85 . 86 . 88 . - . 86 . 85 . 83 . 81 . 79 . . . - . - .
             83 . 81 . 79 . 78 . 79 . 81 . 83 . - . 81 . 79 . 78 . 76 . 78 . 74 . - . - .
             74 . 76 . 78 . 79 . 81 . . . 86 . - . 85 . 83 . 81 . 76 . 78 . 74 . . . - .`),
    bass: N(`50 - 57 - 50 - 57 - 54 - 61 - 54 - 61 - 52 - 59 - 52 - 59 - 50 - 57 - 50 - 57 -
             50 - 57 - 50 - 57 - 45 - 52 - 45 - 52 - 47 - 54 - 47 - 54 - 45 - 52 - 45 - 52 -
             47 - 54 - 47 - 54 - 43 - 50 - 43 - 50 - 45 - 52 - 45 - 52 - 50 - 57 - 50 - 54 -
             50 - 57 - 50 - 57 - 43 - 50 - 45 - 52 - 45 - 52 - 45 - 49 - 50 - 57 - 50 - - -`),
    drums: 'k-hhs-hhk-hhs-hhk-hhs-hhk-hhs-hh',
  },
  marsh: {
    bpm: 112, leadWave: 'square', leadGain: 0.08, swing: 0.18,
    // a bouncy, froggy swamp shuffle in D dorian
    lead: N(`62 . - 65 . - 69 . 67 . 65 . 64 . 62 . - . 60 . 62 . 64 . 65 . 64 . - .
             62 . - 65 . - 69 . 71 . 72 . 71 . 69 . - . 67 . 65 . 67 . 69 . . . - .
             74 . 72 . 71 . 69 . 71 . 69 . 67 . - . 65 . 67 . 69 . 64 . 62 . - . - .
             62 . 64 . 65 . 67 . 69 . . . 74 . - . 72 . 71 . 69 . 64 . 65 . 62 . . . - .`),
    bass: N(`38 - - 45 - - 38 - 43 - - 50 - - 43 - 41 - - 48 - - 41 - 45 - - 52 - - 45 -
             38 - - 45 - - 38 - 43 - - 50 - - 43 - 36 - - 43 - - 36 - 45 - - 52 - - 45 -
             43 - - 50 - - 43 - 41 - - 48 - - 41 - 40 - - 47 - - 40 - 45 - - 52 - - 45 -
             38 - - 45 - - 38 - 43 - - 50 - - 43 - 45 - - 52 - - 45 - 38 - - 45 - - - -`),
    drums: 'k--hs-h-k-khs-h-k--hs-h-k-khs-hh',
  },
  cave: {
    bpm: 104, leadWave: 'triangle', leadGain: 0.12, swing: 0,
    // creepy-cute: plodding minor steps
    lead: N(`69 . . . - . 72 . 71 . . . 68 . - . 69 . . . - . 64 . 65 . . . 64 . - .
             69 . . . - . 72 . 74 . . . 76 . - . 77 . 76 . 74 . 72 . 71 . . . - . - .
             76 . . . 77 . 76 . 74 . . . 72 . - . 71 . 72 . 74 . 71 . 68 . . . - . - .
             69 . 71 . 72 . 74 . 76 . . . 72 . - . 71 . . . 68 . . . 69 . . . - . - .`),
    bass: N(`45 - - - 45 - - - 44 - - - 44 - - - 45 - - - 45 - - - 40 - - - 40 - - -
             45 - - - 45 - - - 50 - - - 50 - - - 41 - - - 41 - - - 40 - - - 40 - - -
             48 - - - 48 - - - 45 - - - 45 - - - 50 - - - 50 - - - 40 - - - 40 - - -
             45 - - - 47 - - - 48 - - - 50 - - - 52 - - - 40 - - - 45 - - - - - - -`),
    drums: 'k-------s-------k---k---s-------',
  },
  boss: {
    bpm: 168, leadWave: 'sawtooth', leadGain: 0.07, swing: 0,
    // fast and dramatic, in D minor
    lead: N(`74 . 74 . 77 . 74 . 81 . . . 79 . 77 . 76 . 76 . 79 . 76 . 82 . . . 81 . 79 .
             77 . 77 . 81 . 77 . 86 . . . 84 . 82 . 81 . 79 . 77 . 76 . 74 . . . 73 . . .
             74 . 74 . 77 . 74 . 81 . . . 79 . 77 . 82 . 81 . 79 . 77 . 79 . 81 . 82 . 84 .
             86 . . . 84 . 82 . 81 . . . 77 . 76 . 74 . 76 . 77 . 73 . 74 . . . - . - .`),
    bass: N(`38 38 50 38 38 50 38 50 38 38 50 38 38 50 38 50 34 34 46 34 34 46 34 46 36 36 48 36 36 48 36 48
             41 41 53 41 41 53 41 53 36 36 48 36 36 48 36 48 34 34 46 34 33 33 45 33 33 45 33 45 33 45 33 45
             38 38 50 38 38 50 38 50 38 38 50 38 38 50 38 50 34 34 46 34 34 46 34 46 36 36 48 36 36 48 36 48
             34 34 46 34 34 46 34 46 36 36 48 36 36 48 36 48 33 33 45 33 33 45 33 45 38 38 50 38 50 38 50 38`),
    drums: 'k-hsk-hsk-hskkhsk-hsk-hsk-hskshs',
  },
};
let song = null, next = null, step = 0, nextTime = 0, fadeT = 0;
export function playMusic(name) {
  if (next === name || (!next && song === name)) return;
  next = name;
  if (!ctx) return;
  if (!song) { song = name; next = null; step = 0; nextTime = ctx.currentTime + 0.1; return; }
  // fade the old tune out quickly, then start the new one on the beat
  musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
  fadeT = ctx.currentTime + 0.55;
}
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  if (next && (!song || ctx.currentTime >= fadeT)) {
    song = next; next = null; step = 0; nextTime = ctx.currentTime + 0.05;
    musicBus.gain.setTargetAtTime(vol.music * 0.32, ctx.currentTime, 0.05);
  }
  const S = SONGS[song]; if (!S) return;
  const st = 60 / S.bpm / 4;
  while (nextTime < ctx.currentTime + 0.25) {
    const i = step % S.lead.length, t = nextTime + (step % 2 ? S.swing * st : 0);
    const n = S.lead[i];
    if (typeof n === 'number') {
      let len = 1; while (S.lead[(i + len) % S.lead.length] === '.' && len < 16) len++;
      tone(musicBus, t, midi(n), st * len * 0.92, { type: S.leadWave || 'square', gain: S.leadGain, release: 0.06, filter: 3200 });
      tone(musicBus, t, midi(n + 12), st * len * 0.5, { type: 'sine', gain: S.leadGain * 0.25, release: 0.08 });
    }
    const b = S.bass[i];
    if (typeof b === 'number') tone(musicBus, t, midi(b), st * 1.6, { type: 'triangle', gain: 0.22, release: 0.05 });
    const d = S.drums[step % S.drums.length];
    if (d === 'k') kick(t); else if (d === 's') snare(t); else if (d === 'h') hat(t);
    nextTime += st; step++;
  }
}

// ---------- sound effects ----------
const FX = {
  swing: (t) => noise(sfxBus, t, 0.14, { gain: 0.25, freq: 900, q: 1.2, sweep: 3 }),
  hit: (t) => { tone(sfxBus, t, 180, 0.08, { type: 'square', gain: 0.25, slide: 0.4, filter: 1600 }); noise(sfxBus, t, 0.07, { gain: 0.3, freq: 2500, q: 0.8 }); },
  bighit: (t) => { tone(sfxBus, t, 140, 0.14, { type: 'square', gain: 0.32, slide: 0.3, filter: 1400 }); noise(sfxBus, t, 0.12, { gain: 0.35, freq: 1800, q: 0.6 }); tone(sfxBus, t + 0.02, 60, 0.18, { type: 'sine', gain: 0.4, slide: 0.5 }); },
  kill: (t) => { [0, 4, 7, 12].forEach((n, i) => tone(sfxBus, t + i * 0.05, midi(76 + n), 0.08, { type: 'square', gain: 0.12, filter: 4000 })); noise(sfxBus, t, 0.2, { gain: 0.2, freq: 600, sweep: 0.3 }); },
  hurt: (t) => { tone(sfxBus, t, 330, 0.16, { type: 'sawtooth', gain: 0.16, slide: 0.5, filter: 1800 }); },
  coin: (t) => { tone(sfxBus, t, midi(88), 0.05, { type: 'square', gain: 0.1 }); tone(sfxBus, t + 0.06, midi(95), 0.14, { type: 'square', gain: 0.1 }); },
  chop: (t) => { tone(sfxBus, t, 260, 0.06, { type: 'triangle', gain: 0.35, slide: 0.6 }); noise(sfxBus, t, 0.06, { gain: 0.2, freq: 900, q: 2 }); },
  mine: (t) => { tone(sfxBus, t, 1400, 0.12, { type: 'square', gain: 0.12, filter: 5000 }); tone(sfxBus, t, 2100, 0.2, { type: 'sine', gain: 0.1 }); noise(sfxBus, t, 0.05, { gain: 0.25, freq: 4000 }); },
  splash: (t) => noise(sfxBus, t, 0.35, { gain: 0.25, freq: 1400, q: 0.5, sweep: 0.4 }),
  jump: (t) => tone(sfxBus, t, 300, 0.14, { type: 'square', gain: 0.1, slide: 2.2, filter: 3000 }),
  land: (t) => noise(sfxBus, t, 0.08, { gain: 0.18, freq: 400, q: 0.8 }),
  dash: (t) => noise(sfxBus, t, 0.2, { gain: 0.3, freq: 600, q: 0.9, sweep: 4 }),
  special: (t) => { noise(sfxBus, t, 0.5, { gain: 0.3, freq: 300, sweep: 8 }); [0, 7, 12, 19].forEach((n, i) => tone(sfxBus, t + i * 0.04, midi(67 + n), 0.2, { type: 'sawtooth', gain: 0.07, filter: 3000 })); },
  levelup: (t) => { [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => tone(sfxBus, t + i * 0.07, midi(72 + n), i === 7 ? 0.5 : 0.09, { type: 'square', gain: 0.11, filter: 4500 })); },
  eat: (t) => { tone(sfxBus, t, 500, 0.05, { type: 'triangle', gain: 0.2 }); tone(sfxBus, t + 0.12, 440, 0.05, { type: 'triangle', gain: 0.2 }); tone(sfxBus, t + 0.3, midi(84), 0.18, { type: 'sine', gain: 0.15, slide: 1.5 }); },
  click: (t) => tone(sfxBus, t, 900, 0.03, { type: 'square', gain: 0.06, filter: 3000 }),
  talk: (t) => tone(sfxBus, t, 520 + Math.random() * 160, 0.035, { type: 'square', gain: 0.045, filter: 2400 }),
  tick: (t) => { tone(sfxBus, t, 1600, 0.02, { type: 'square', gain: 0.06 }); noise(sfxBus, t, 0.02, { gain: 0.08, type: 'highpass', freq: 5000 }); },
  win: (t) => { [0, 4, 7, 12].forEach((n, i) => tone(sfxBus, t + i * 0.09, midi(72 + n), i === 3 ? 0.6 : 0.1, { type: 'square', gain: 0.12, filter: 5000 })); [0, 4, 7].forEach((n) => tone(sfxBus, t + 0.27, midi(60 + n), 0.6, { type: 'sawtooth', gain: 0.05, filter: 2000 })); },
  jackpot: (t) => { for (let i = 0; i < 12; i++) tone(sfxBus, t + i * 0.05, midi(79 + [0, 4, 7, 12][i % 4] + Math.floor(i / 4) * 2), 0.07, { type: 'square', gain: 0.1 }); FX.win(t + 0.6); },
  boing: (t) => tone(sfxBus, t, 160, 0.5, { type: 'sine', gain: 0.35, slide: 3, release: 0.1 }),
  bossintro: (t) => { kick(t, 0.8); tone(sfxBus, t, 55, 1.2, { type: 'sawtooth', gain: 0.12, filter: 600 }); [0, 3, 7].forEach((n) => tone(sfxBus, t + 0.35, midi(50 + n), 0.9, { type: 'sawtooth', gain: 0.07, filter: 1800 })); noise(sfxBus, t + 0.35, 0.8, { gain: 0.25, freq: 300, sweep: 0.3 }); },
  slam: (t) => { tone(sfxBus, t, 70, 0.4, { type: 'sine', gain: 0.6, slide: 0.4 }); noise(sfxBus, t, 0.35, { gain: 0.4, freq: 300, q: 0.5 }); },
  door: (t) => { tone(sfxBus, t, 220, 0.12, { type: 'triangle', gain: 0.2, slide: 0.7 }); noise(sfxBus, t, 0.2, { gain: 0.1, freq: 600 }); },
};
const lastFx = {};
export function sfx(name) {
  if (!ctx || ctx.state !== 'running' || !FX[name]) return;
  const t = ctx.currentTime;
  if (lastFx[name] && t - lastFx[name] < 0.03) return; // don't stack the same sound in one frame
  lastFx[name] = t;
  FX[name](t + 0.005);
}
