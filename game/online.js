// JerryQuest online: accounts, cloud saves, seeing friends, shared towns and the global rich list.
// Everything here quietly does nothing when config.js has no Supabase keys (or the page can't reach them),
// so the game always works offline too.
import { ONLINE } from './config.js';

export const net = {
  enabled: !!(ONLINE.url && ONLINE.key),
  configured: !!(ONLINE.url && ONLINE.key),
  on: false, // signed in and connected
  user: null, // { id, name }
  peers: new Map(), // id -> { name, lvl, look, where, x, z, ry, a, t, gx, gz }
  towns: new Map(), // id -> { mayor_id, mayor_name, lvl }
  board: null, // last rich list from the server
  onTowns: null, // called after each towns refresh
  onPeerGone: null,
  onChat: null,
  onNet: null, // called with (event, payload) for party, duel and other player-to-player messages // called with { id, name, text } for each chat message from another player
};
let sb = null, channel = null;

async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
  sb = createClient(ONLINE.url, ONLINE.key, { auth: { persistSession: true, autoRefreshToken: true } });
  return sb;
}

const cleanName = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
const loginOf = (s) => `${cleanName(s)}@${ONLINE.domain}`;
const userOf = (u) => ({ id: u.id, name: (u.user_metadata && u.user_metadata.name) || u.email.split('@')[0] });

// Already signed in on this computer? Then skip the sign-in card.
export async function resume() {
  if (!net.enabled) return null;
  // can this page reach the server at all? (the Claude preview can't, so it just plays offline)
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    await fetch(`${ONLINE.url}/auth/v1/health`, { mode: 'no-cors', signal: ctl.signal });
    clearTimeout(t);
  } catch (e) { console.warn('online: server unreachable, playing offline', e.message); net.enabled = false; return null; }
  try {
    const c = await client();
    const { data } = await c.auth.getSession();
    if (data && data.session) { net.user = userOf(data.session.user); return net.user; }
  } catch (e) { console.warn('online: could not reach the server', e); net.enabled = false; }
  return null;
}

// Returns { ok } or { error } with a friendly message.
export async function signIn(name, pass, create) {
  try {
    const c = await client();
    // Usernames are unique: the login behind each one can only be made once, whatever the capitals.
    const shown = String(name).trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16), email = loginOf(shown);
    if (shown.length < 3) return { error: 'Usernames need 3 to 16 letters, numbers or _.' };
    if (String(pass).length < 6) return { error: 'Passwords need at least 6 characters.' };
    const res = create
      ? await c.auth.signUp({ email, password: pass, options: { data: { name: shown.slice(0, 16) } } })
      : await c.auth.signInWithPassword({ email, password: pass });
    if (res.error) {
      const m = res.error.message || '';
      if (/already registered|already exists|already been registered/i.test(m)) return { error: 'Sorry, that username is taken. Try another one.' };
      if (/invalid login/i.test(m)) return { error: 'Wrong username or password.' };
      if (/fetch|network|timed? ?out/i.test(m)) return { error: 'Could not reach the game server. Check your internet and try again.' };
      if (/confirm/i.test(m)) return { error: 'The game needs "Confirm email" switched off in Supabase first.' };
      return { error: m };
    }
    if (!res.data.session) return { error: 'The game needs "Confirm email" switched off in Supabase first.' };
    net.user = userOf(res.data.session.user);
    return { ok: true };
  } catch (e) { return { error: 'Could not reach the game server. Check your internet and try again.' }; }
}

export async function flushSave() { clearTimeout(saveTimer); await flush(); }
export async function signOut() { try { await (await client()).auth.signOut(); } catch (e) { /* ignore */ } }

// ---------- cloud saves ----------
export async function loadCloud() {
  const { data, error } = await sb.from('saves').select('data').eq('user_id', net.user.id).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
let saveTimer = 0, pending = null, lastSent = 0;
export function cloudSave(S, meta, now = false) {
  if (!net.on) return;
  pending = { S, meta };
  const wait = now ? 0 : Math.max(0, 15000 - (Date.now() - lastSent));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, wait);
}
async function flush() {
  if (!pending) return;
  const { S, meta } = pending; pending = null; lastSent = Date.now();
  const { error } = await sb.from('saves').upsert({ user_id: net.user.id, name: meta.name, level: meta.level, net_worth: Math.round(meta.worth), data: S, updated_at: new Date().toISOString() });
  if (error) console.warn('online: save failed', error.message);
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending) { clearTimeout(saveTimer); flush(); } });

// ---------- rich list ----------
export async function refreshBoard() {
  if (!net.on) return null;
  const { data } = await sb.from('leaderboard').select('name, level, net_worth').limit(50);
  if (data) net.board = data;
  return net.board;
}

// ---------- towns ----------
// Polled every 20 seconds: who is mayor of each town, and how built-up it is.
async function pollTowns() {
  const { data, error } = await sb.from('towns').select('id, mayor_id, mayor_name, lvl');
  if (error) return;
  net.towns = new Map(data.map((r) => [r.id, r]));
  if (net.onTowns) net.onTowns();
}
export async function setTown(id, row) {
  if (!net.on) return;
  const r = { id, updated_at: new Date().toISOString(), ...row };
  net.towns.set(id, { ...(net.towns.get(id) || {}), ...r });
  const { error } = await sb.from('towns').upsert(r);
  if (error) console.warn('online: town update failed', error.message);
}

// ---------- seeing friends ----------
let me = {}, lastPos = null, sendAt = 0;
export async function connect(profile) {
  net.on = true;
  me = profile;
  await pollTowns();
  setInterval(pollTowns, 20000);
  channel = sb.channel('world', { config: { presence: { key: net.user.id }, broadcast: { self: false } } });
  channel.on('broadcast', { event: 'p' }, ({ payload: p }) => {
    const peer = net.peers.get(p.id);
    if (!peer) return;
    Object.assign(peer, { where: p.w, gx: p.x, gz: p.z, ry: p.r, a: p.a, h: p.h, t: performance.now() });
    if (peer.x === undefined) { peer.x = p.x; peer.z = p.z; }
  });
  channel.on('broadcast', { event: 'c' }, ({ payload: m }) => {
    if (!m || typeof m.text !== 'string' || !net.onChat) return;
    const peer = net.peers.get(m.id);
    net.onChat({ id: m.id, name: (peer && peer.name) || String(m.name || 'Someone').slice(0, 16), text: cleanChat(m.text) });
  });
  for (const ev of NET_EVENTS) channel.on('broadcast', { event: ev }, ({ payload }) => { if (payload && net.onNet && (!payload.to || payload.to === net.user.id)) net.onNet(ev, payload); });
  channel.on('presence', { event: 'sync' }, () => {
    const st = channel.presenceState(), seen = new Set();
    for (const [id, metas] of Object.entries(st)) {
      if (id === net.user.id || !metas[0]) continue;
      seen.add(id);
      const m = metas[0], peer = net.peers.get(id) || { x: m.x, z: m.z, gx: m.x, gz: m.z, ry: 0, a: 'Idle', where: m.w };
      Object.assign(peer, { name: m.name, lvl: m.lvl, look: m.look, ver: m.ver });
      net.peers.set(id, peer);
    }
    for (const id of [...net.peers.keys()]) if (!seen.has(id)) { if (net.onPeerGone) net.onPeerGone(id); net.peers.delete(id); }
  });
  channel.subscribe((status) => { if (status === 'SUBSCRIBED') channel.track(me); });
}
// ---------- player-to-player messages ----------
// Parties (invite, accept, state, leave), duels (hit, knock-out, the winner's prize) and shared party XP.
const NET_EVENTS = ['pi', 'pa', 'ps', 'pl', 'hit', 'ko', 'loot', 'px', 'ti', 'ta', 'to', 'tx', 'wb', 'qb'];
export function sendNet(ev, payload = {}) {
  if (!channel || !net.on || !NET_EVENTS.includes(ev)) return;
  channel.send({ type: 'broadcast', event: ev, payload: { ...payload, id: net.user.id } });
}
// ---------- chat ----------
// Short messages to everyone on the server. No more than 3 messages in 8 seconds from one player.
export const CHAT_MAX = 120;
export const cleanChat = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
const chatTimes = [];
export function sendChat(text) {
  const t = cleanChat(text);
  if (!t) return { error: 'empty' };
  const nowMs = performance.now();
  while (chatTimes.length && nowMs - chatTimes[0] > 8000) chatTimes.shift();
  if (chatTimes.length >= 3) return { error: 'Slow down a little! Wait a few seconds.' };
  chatTimes.push(nowMs);
  if (channel && net.on) channel.send({ type: 'broadcast', event: 'c', payload: { id: net.user.id, name: net.user.name, text: t } });
  return { text: t };
}
// name, level or looks changed
export function updateProfile(profile) {
  me = { ...me, ...profile };
  if (channel) channel.track(me);
}
// Position updates: about 6 a second while moving, once a second while standing still.
export function sendPos(x, z, ry, a, w, h = '') {
  if (!channel || !net.on) return;
  const t = performance.now(), moved = !lastPos || Math.hypot(x - lastPos[0], z - lastPos[1]) > 0.05 || a !== lastPos[2] || w !== lastPos[3] || h !== lastPos[4];
  if (t < sendAt || (!moved && t < sendAt + 840)) return;
  sendAt = t + 160; lastPos = [x, z, a, w, h];
  me.x = x; me.z = z; me.w = w;
  channel.send({ type: 'broadcast', event: 'p', payload: { id: net.user.id, x: +x.toFixed(2), z: +z.toFixed(2), r: +ry.toFixed(2), a, w, h } });
}
