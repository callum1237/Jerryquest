// Rendering engine: renderer, storybook toon materials, ink-outline post-processing, particles, model loading.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export { THREE };

// ---------- renderer / scene ----------
export const PR = Math.min(window.devicePixelRatio || 1, 1.5);
let pr = PR, samples = 4; // change with setQuality
export const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('stage').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 600);
camera.layers.enableAll();

// ---------- lighting presets ----------
export const PRESETS = {
  day: {
    top: '#3f8fe6', horizon: '#e2f1ff', fog: '#eceaee',
    sun: '#ffe9c8', sunI: 2.5, sunDir: [26, 48, 18],
    hemiSky: '#cfe6ff', hemiGround: '#7a9a50', hemiI: 1.25,
    rim: '#fff3c4', rimI: 0.45, motes: 0.55, fire: 0.6,
  },
  golden: {
    top: '#4a62b8', horizon: '#ffc08e', fog: '#f7c39a',
    sun: '#ffc78f', sunI: 2.1, sunDir: [50, 26, 8],
    hemiSky: '#ffe0c4', hemiGround: '#5d6e48', hemiI: 1.05,
    rim: '#ffb36b', rimI: 0.75, motes: 1.0, fire: 1.0, cloud: '#ffe2c8',
  },
  // a storybook night: deep blue but never murky, with a cool moon and lots of fireflies
  night: {
    top: '#1c2a6b', horizon: '#6b6fb8', fog: '#4a5290',
    sun: '#b8ccff', sunI: 1.35, sunDir: [-30, 52, 22],
    hemiSky: '#9aaaf0', hemiGround: '#46506e', hemiI: 1.15,
    rim: '#a8c4ff', rimI: 0.7, motes: 1.4, fire: 1.3, night: 1, cloud: '#7f86c8',
  },
  // v68: Magma Caverns. A smoky red cave lit from below by lava: warm and moody, but never murky
  magma: {
    top: '#1e1418', horizon: '#6a2a20', fog: '#3a2224',
    sun: '#ffe2cc', sunI: 2.1, sunDir: [18, 52, 14],
    hemiSky: '#d8c4c8', hemiGround: '#3a2a2a', hemiI: 1.1,
    rim: '#ff9a5a', rimI: 0.55, motes: 0, fire: 1.4, cloud: '#5a2a26',
  },
};
const rimUniform = { value: new THREE.Color(PRESETS.day.rim) };
const rimStrength = { value: PRESETS.day.rimI };

const hemi = new THREE.HemisphereLight(0xffffff, 0x556633, 1);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.intensity = 0.55; // softer, lighter storybook shadows
sun.shadow.camera.layers.enable(2); // cut-out leaves live on layer 2 (see FOLIAGE below)
scene.add(sun, sun.target);

const skyUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, cloudCol: { value: new THREE.Color('#ffffff') }, time: { value: 0 } };
// v81: a painted storybook sky: soft billowy clouds drift round the horizon, with a warm glow under them
export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(450, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 cloudCol; uniform float time; varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.03 + 7.1; a *= .5; } return v; }
      void main(){ float h = clamp(vP.y*1.6+0.05,0.,1.); vec3 c = mix(horizon, top, pow(h,0.7));
        // clouds live on a band above the horizon; wrap them round the sky using the view angle
        float ang = atan(vP.z, vP.x);
        vec2 q = vec2(ang * 3.2 + time * 0.004, vP.y * 9.);
        float band = smoothstep(0.0, 0.12, vP.y) * (1. - smoothstep(0.32, 0.62, vP.y));
        float n = fbm(q + vec2(fbm(q * 0.7), 0.)) ;
        float cl = smoothstep(0.46, 0.66, n) * band;
        float shade = smoothstep(0.5, 0.85, fbm(q * 1.3 + 3.));
        vec3 cc = mix(mix(cloudCol, horizon, 0.35), cloudCol, shade);
        c = mix(c, cc, cl * 0.85);
        gl_FragColor = vec4(c,1.);
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -10;
scene.add(sky);
scene.fog = new THREE.Fog(0xffffff, 95, 230);

export const env = { preset: 'day', cur: { motes: 0.55, fire: 0.6, night: 0, sunDir: [26, 48, 18] } };
export function applyPreset(name) {
  env.preset = name;
  blendPresets(name, name, 0);
}
// Mix two lighting moods, so day can slide into golden hour and on into night.
const _ca = new THREE.Color(), _cb = new THREE.Color();
const mixC = (target, a, b, k) => target.copy(_ca.set(a)).lerp(_cb.set(b), k);
const mixN = (a, b, k) => a + (b - a) * k;
export function blendPresets(na, nb, k) {
  const a = PRESETS[na], b = PRESETS[nb];
  mixC(skyUniforms.top.value, a.top, b.top, k);
  mixC(skyUniforms.horizon.value, a.horizon, b.horizon, k);
  mixC(scene.fog.color, a.fog, b.fog, k);
  mixC(skyUniforms.cloudCol.value, a.cloud || '#ffffff', b.cloud || '#ffffff', k);
  mixC(sun.color, a.sun, b.sun, k); sun.intensity = mixN(a.sunI, b.sunI, k);
  mixC(hemi.color, a.hemiSky, b.hemiSky, k); mixC(hemi.groundColor, a.hemiGround, b.hemiGround, k); hemi.intensity = mixN(a.hemiI, b.hemiI, k);
  mixC(rimUniform.value, a.rim, b.rim, k); rimStrength.value = mixN(a.rimI, b.rimI, k);
  const n = env.cur;
  n.motes = mixN(a.motes, b.motes, k); n.fire = mixN(a.fire, b.fire, k); n.night = mixN(a.night || 0, b.night || 0, k);
  for (let i = 0; i < 3; i++) n.sunDir[i] = mixN(a.sunDir[i], b.sunDir[i], k);
}
applyPreset('day');

// ---------- toon materials ----------
function makeGradient(stops) {
  const data = new Uint8Array(stops.map((s) => Math.round(s * 255)));
  const t = new THREE.DataTexture(data, stops.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
export const gradient = makeGradient([0.36, 0.64, 0.86, 1.0]);

export const styled = { on: true };
const swapables = [];
const toonCache = new Map();
function addRim(m) {
  m.onBeforeCompile = (s) => {
    s.uniforms.rimColor = rimUniform;
    s.uniforms.rimStrength = rimStrength;
    s.fragmentShader = 'uniform vec3 rimColor;\nuniform float rimStrength;\n' + s.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
       rimF = smoothstep(0.62, 0.9, rimF);
       outgoingLight += rimColor * rimF * rimStrength;
       #include <opaque_fragment>`
    );
  };
  return m;
}
export function toonOf(std) {
  if (toonCache.has(std)) return toonCache.get(std);
  const m = addRim(new THREE.MeshToonMaterial({
    map: std.map || null,
    color: std.color ? std.color.clone() : new THREE.Color(1, 1, 1),
    gradientMap: gradient,
    transparent: std.transparent, opacity: std.opacity, side: std.side, alphaTest: std.alphaTest,
    vertexColors: std.vertexColors,
  }));
  toonCache.set(std, m);
  return m;
}
export function toon(color, extra = {}) {
  const std = new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });
  return { std, toon: addRim(new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra })) };
}
export function registerMesh(o, mats) {
  o.userData.mats = mats; o.material = styled.on ? mats.toon : mats.std; swapables.push(o);
}
export function stylize(obj, { cast = true, receive = true } = {}) {
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.mats) return;
    o.castShadow = cast; o.receiveShadow = receive;
    const std = o.material;
    registerMesh(o, { std, toon: Array.isArray(std) ? std.map(toonOf) : toonOf(std) });
  });
}
export function setStyled(on) {
  styled.on = on;
  for (const m of swapables) m.material = on ? m.userData.mats.toon : m.userData.mats.std;
}

// ---------- v81 foliage: painted leaves, grass and flowers ----------
// Leaves are flat cards with see-through edges (alphaTest). They get "puffy" round normals so a whole
// canopy shades like one soft ball, and a painted colour ramp from a deep shade at the bottom to a sunny
// tip at the top (the leaf texture adds the brush detail). They live on layer 2, so the ink pass draws
// them with their own cut-out shape instead of solid squares.
export const FOLIAGE = { time: { value: 0 }, normalPass: { value: 0 } };
const folCache = new Map();
export function foliageMat(map, { lo = '#1d6b4c', hi = '#b6de52', y0 = 0, y1 = 1, sway = 0, cut = 0.5, mul = 1, paint = true, puff = true } = {}) {
  const key = [map && map.uuid, lo, hi, y0.toFixed(2), y1.toFixed(2), sway, cut, mul, paint, puff].join('|');
  if (folCache.has(key)) return folCache.get(key);
  const mk = (Base, extra) => {
    const m = new Base({ map, alphaTest: cut, alphaToCoverage: !!cut, side: THREE.DoubleSide, ...extra });
    if (!cut) m.alphaTest = 0;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.fTime = FOLIAGE.time; sh.uniforms.fNormalPass = FOLIAGE.normalPass;
      sh.uniforms.fLo = { value: new THREE.Color(lo) }; sh.uniforms.fHi = { value: new THREE.Color(hi) };
      sh.vertexShader = 'uniform float fTime;\nvarying float vFolH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vFolH = clamp((position.y - (${y0.toFixed(3)})) / ${(Math.max(0.001, y1 - y0)).toFixed(3)}, 0., 1.);
        ${sway ? `{ vec4 wp = vec4(position, 1.);
#ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
#endif
          wp = modelMatrix * wp;
          float k = vFolH * vFolH * ${sway.toFixed(3)};
          transformed.x += sin(fTime * 1.7 + wp.x * 0.35 + wp.z * 0.2) * k;
          transformed.z += cos(fTime * 1.3 + wp.z * 0.3) * k * 0.6; }` : ''}`);
      sh.fragmentShader = 'uniform float fNormalPass;\nuniform vec3 fLo, fHi;\nvarying float vFolH;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', paint ? `#include <map_fragment>
          { float l = dot(diffuseColor.rgb, vec3(.3, .59, .11));
            vec3 ramp = mix(fLo, fHi, smoothstep(0.05, 0.95, vFolH));
            diffuseColor.rgb = ramp * (0.3 + 0.75 * l) * ${mul.toFixed(2)}; }` : '#include <map_fragment>')
        // round leaf normals must not flip on the back of a card, or half the leaves shade inside-out
        .replace('#include <normal_fragment_begin>', puff ? `#include <normal_fragment_begin>
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif` : '#include <normal_fragment_begin>')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (fNormalPass > 0.5) gl_FragColor = vec4(normalize(normal) * 0.5 + 0.5, 1.);`);
    };
    m.customProgramCacheKey = () => 'fol' + key;
    return m;
  };
  const toonM = mk(THREE.MeshToonMaterial, { gradientMap: gradient });
  const mats = { std: mk(THREE.MeshStandardMaterial, { roughness: 1 }), toon: toonM };
  folCache.set(key, mats);
  return mats;
}
// Give a cut-out leaf geometry soft round normals, pointing out from the middle of the canopy.
export function puffNormals(geo, lift = 0.15) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, c = new THREE.Vector3(); bb.getCenter(c); c.y -= (bb.max.y - bb.min.y) * lift;
  const p = geo.attributes.position, n = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(c).normalize(); n[i * 3] = v.x; n[i * 3 + 1] = v.y; n[i * 3 + 2] = v.z; }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return geo;
}

// ---------- loading (models packed as base64 GLB, textures as png) ----------
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const texCache = {};
function tex(name) {
  if (!texCache[name]) {
    const t = texLoader.load(`tex/${name}`);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
    texCache[name] = t;
  }
  return texCache[name];
}
export async function loadModel(n) {
  const r = await fetch(`models/${n}.txt`);
  if (!r.ok) throw new Error(`could not load ${n} (${r.status})`);
  const bin = atob((await r.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const g = await loader.parseAsync(bytes.buffer, '');
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m.userData && m.userData.tex && !m.map) { m.map = tex(m.userData.tex); m.needsUpdate = true; }
  });
  return g;
}

// ---------- particles ----------
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DOT = dotTexture();
export const rng = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

const MOTES = 260;
const motePos = new Float32Array(MOTES * 3), moteCol = new Float32Array(MOTES * 3), moteSeed = new Float32Array(MOTES);
const moteColors = ['#ffe07a', '#9ff3ff', '#ffb3e6', '#c7ff9a'].map((c) => new THREE.Color(c));
for (let i = 0; i < MOTES; i++) {
  motePos.set([(rng() - 0.5) * 90, 0.5 + rng() * 6, (rng() - 0.5) * 90], i * 3);
  const c = moteColors[i % 4]; moteCol.set([c.r, c.g, c.b], i * 3); moteSeed[i] = rng() * 100;
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3));
const moteMat = new THREE.PointsMaterial({ size: 0.55, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, fog: false });
const motes = new THREE.Points(moteGeo, moteMat);
motes.layers.set(1); motes.frustumCulled = false;
scene.add(motes);

const BURST = 300;
const bPos = new Float32Array(BURST * 3), bCol = new Float32Array(BURST * 3), bVel = new Float32Array(BURST * 3), bLife = new Float32Array(BURST);
const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
const bursts = new THREE.Points(bGeo, new THREE.PointsMaterial({ size: 0.7, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
bursts.layers.set(1); bursts.frustumCulled = false; scene.add(bursts);
let bNext = 0;
// Sparkle bursts. Counts are trimmed (and capped) so big hits read as a soft puff rather than
// a blizzard of dots, and nothing is allocated per particle, so bursts never cause a hitch.
const _bc = new THREE.Color(), _bv = new THREE.Vector3();
export function burst(p, color, n = 24, spd = 6, up = 0.9) {
  _bc.set(color);
  n = n <= 2 ? n : Math.min(36, Math.round(n * 0.6));
  for (let i = 0; i < n; i++) {
    const j = bNext = (bNext + 1) % BURST, k = j * 3;
    bPos[k] = p.x; bPos[k + 1] = p.y; bPos[k + 2] = p.z;
    _bv.set(rng() - 0.5, rng() * up, rng() - 0.5).normalize().multiplyScalar(spd * (0.4 + rng()));
    bVel[k] = _bv.x; bVel[k + 1] = _bv.y; bVel[k + 2] = _bv.z;
    bCol[k] = _bc.r; bCol[k + 1] = _bc.g; bCol[k + 2] = _bc.b;
    bLife[j] = 0.5 + rng() * 0.5;
  }
}
export function updateParticles(dt, t, center) {
  moteMat.opacity = env.cur.motes * 0.7;
  moteMat.color.setRGB(1 - env.cur.night * 0.1, 1, 1 - env.cur.night * 0.55); // fireflies turn yellow-green at night
  for (let i = 0; i < MOTES; i++) {
    const s = moteSeed[i];
    let x = motePos[i * 3] + Math.sin(t * 0.4 + s) * dt * 0.6;
    let z = motePos[i * 3 + 2] + Math.cos(t * 0.35 + s * 1.3) * dt * 0.6;
    // keep motes around the player
    if (x - center.x > 45) x -= 90; if (x - center.x < -45) x += 90;
    if (z - center.z > 45) z -= 90; if (z - center.z < -45) z += 90;
    motePos[i * 3] = x; motePos[i * 3 + 2] = z;
    motePos[i * 3 + 1] = 0.8 + ((s * 0.37) % 5) + Math.sin(t * 0.9 + s) * 0.6;
  }
  moteGeo.attributes.position.needsUpdate = true;
  const fade = Math.pow(0.985, dt * 60); // same fade at any frame rate
  let live = false;
  for (let j = 0; j < BURST; j++) {
    if (bLife[j] <= 0) { if (bPos[j * 3 + 1] !== -100) { bPos[j * 3 + 1] = -100; live = true; } continue; }
    live = true;
    bLife[j] -= dt;
    bVel[j * 3 + 1] -= 9 * dt;
    bPos[j * 3] += bVel[j * 3] * dt; bPos[j * 3 + 1] = Math.max(0.05, bPos[j * 3 + 1] + bVel[j * 3 + 1] * dt); bPos[j * 3 + 2] += bVel[j * 3 + 2] * dt;
    bCol[j * 3] *= fade; bCol[j * 3 + 1] *= fade; bCol[j * 3 + 2] *= fade;
    if (bLife[j] <= 0) bPos[j * 3 + 1] = -100;
  }
  if (live) { bGeo.attributes.position.needsUpdate = true; bGeo.attributes.color.needsUpdate = true; } // nothing to re-upload when no sparkles are flying
}

// ---------- post-processing: ink outlines + storybook grade ----------
function makeTargets() {
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
  const color = new THREE.WebGLRenderTarget(w, h, { samples: renderer.capabilities.isWebGL2 ? samples : 0, stencilBuffer: true });
  const normal = new THREE.WebGLRenderTarget(w, h);
  normal.depthTexture = new THREE.DepthTexture(w, h);
  // v82 glow: two small quarter-size targets for a soft bloom on bright things (magic, fire, sparkles, sun on leaves)
  const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
  const glowA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType }), glowB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType });
  return { color, normal, glowA, glowB };
}
let RT = makeTargets();
const normalMat = new THREE.MeshNormalMaterial();
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tNormal: { value: null }, tNDepth: { value: null }, tGlow: { value: null }, glow: { value: 0.55 },
    res: { value: new THREE.Vector2() }, near: { value: camera.near }, far: { value: camera.far },
    thick: { value: 1.25 * pr }, ink: { value: new THREE.Color('#5a3626') },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `
    uniform sampler2D tColor, tNormal, tNDepth, tGlow; uniform vec2 res; uniform float near, far, thick, glow; uniform vec3 ink;
    varying vec2 vUv;
    float lin(float d){ float z = d*2.-1.; return 2.*near*far/(far+near-z*(far-near)); }
    vec3 N(vec2 uv){ return texture2D(tNormal, uv).rgb*2.-1.; }
    void main(){
      vec2 px = thick / res;
      vec3 col = texture2D(tColor, vUv).rgb;
      float d0 = lin(texture2D(tNDepth, vUv).r);
      vec3 n0 = N(vUv);
      float de = 0., ne = 0.;
      vec2 o[8];
      o[0]=vec2(1,0); o[1]=vec2(-1,0); o[2]=vec2(0,1); o[3]=vec2(0,-1);
      o[4]=vec2(.7,.7); o[5]=vec2(-.7,.7); o[6]=vec2(.7,-.7); o[7]=vec2(-.7,-.7);
      for(int i=0;i<8;i++){
        vec2 uv = vUv + o[i]*px;
        float d = lin(texture2D(tNDepth, uv).r);
        de = max(de, (d - d0) / max(d0, 0.001));
        ne = max(ne, 1. - dot(N(uv), n0));
      }
      float edge = max(smoothstep(0.045, 0.1, de), smoothstep(0.5, 0.85, ne) * 0.7);
      edge *= 1. - smoothstep(90., 200., d0);
      float l = dot(col, vec3(.299,.587,.114));
      col = mix(vec3(l), col, 1.2); // bright, toy-box colours (v82: a little softer, more painterly)
      col = col * vec3(1.03, 1.0, 0.95) + vec3(0.012, 0.006, 0.0);
      // v82 storybook grade: sunny highlights glow warm, shadows lean a soft cool violet
      col += smoothstep(0.55, 1.0, l) * 0.07 * vec3(1.0, 0.9, 0.62);
      col = mix(col, col * vec3(0.9, 0.93, 1.1), (1. - smoothstep(0.12, 0.5, l)) * 0.55);
      col += texture2D(tGlow, vUv).rgb * glow; // soft storybook glow
      col = clamp(col, 0., 1.);
      col = mix(col, ink, edge * 0.62);
      vec2 q = vUv - .5;
      col *= mix(1., 0.9, smoothstep(0.35, 0.85, length(q*vec2(1.1,1.))));
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
// bright-pass + blur for the glow (each pass is one full-screen triangle pair into a quarter-size target)
const glowMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() }, bright: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 dir; uniform float bright; varying vec2 vUv;
    void main(){
      if (bright > 0.5) {
        vec3 c = vec3(0.); // 4 taps so the small target isn't sparkly
        c += texture2D(tSrc, vUv + dir * vec2(-1., -1.)).rgb; c += texture2D(tSrc, vUv + dir * vec2(1., -1.)).rgb;
        c += texture2D(tSrc, vUv + dir * vec2(-1., 1.)).rgb; c += texture2D(tSrc, vUv + dir * vec2(1., 1.)).rgb; c *= 0.25;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(0.8, 1.0, l), 1.); return;
      }
      vec3 s = texture2D(tSrc, vUv).rgb * 0.227;
      s += (texture2D(tSrc, vUv + dir * 1.385).rgb + texture2D(tSrc, vUv - dir * 1.385).rgb) * 0.316;
      s += (texture2D(tSrc, vUv + dir * 3.23).rgb + texture2D(tSrc, vUv - dir * 3.23).rgb) * 0.07;
      gl_FragColor = vec4(s, 1.);
    }`,
  depthTest: false, depthWrite: false,
});
const glowScene = new THREE.Scene();
glowScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat));
function glowPass(cam) {
  const g = glowMat.uniforms, w = RT.glowA.width, h = RT.glowA.height;
  g.tSrc.value = RT.color.texture; g.bright.value = 1; g.dir.value.set(1 / RT.color.width, 1 / RT.color.height);
  renderer.setRenderTarget(RT.glowA); renderer.render(glowScene, cam);
  g.bright.value = 0;
  for (let i = 0; i < 2; i++) {
    g.tSrc.value = RT.glowA.texture; g.dir.value.set((1 + i) / w, 0); renderer.setRenderTarget(RT.glowB); renderer.render(glowScene, cam);
    g.tSrc.value = RT.glowB.texture; g.dir.value.set(0, (1 + i) / h); renderer.setRenderTarget(RT.glowA); renderer.render(glowScene, cam);
  }
}
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  RT.color.dispose(); RT.normal.dispose(); RT.glowA.dispose(); RT.glowB.dispose(); RT = makeTargets();
});

// ---------- graphics quality ----------
// high: sharp, smooth edges, big soft shadows. medium: normal sharpness, lighter edge smoothing, smaller shadows.
// low: renders at a lower resolution, no edge smoothing, simple shadows that update every other frame.
export const QUALITY = {
  high: { pr: Math.min(window.devicePixelRatio || 1, 1.5), samples: 4, shadow: 2048, soft: true, shadowEvery: 1 },
  medium: { pr: Math.min(window.devicePixelRatio || 1, 1), samples: 2, shadow: 1024, soft: true, shadowEvery: 1 },
  low: { pr: Math.min(window.devicePixelRatio || 1, 1) * 0.75, samples: 0, shadow: 1024, soft: false, shadowEvery: 2, noPlants: true }, // low also hides the little grass tufts and flowers
};
let shadowEvery = 1, frameN = 0, noPlants = false;
// all layers, except the small-plant layer (3) on Low graphics
function showLayers() { camera.layers.enableAll(); if (noPlants) camera.layers.disable(3); }
export function setQuality(name) {
  const q = QUALITY[name] || QUALITY.high;
  pr = q.pr; samples = q.samples; shadowEvery = q.shadowEvery; noPlants = !!q.noPlants; showLayers();
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== type) { renderer.shadowMap.type = type; renderer.shadowMap.needsUpdate = true; }
  if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  postMat.uniforms.thick.value = 1.25 * Math.max(pr, 0.9);
  RT.color.dispose(); RT.normal.dispose(); RT.glowA.dispose(); RT.glowB.dispose(); RT = makeTargets();
}
export function render() {
  FOLIAGE.time.value = performance.now() / 1000; skyUniforms.time.value = FOLIAGE.time.value;
  // on low quality the shadows are redrawn every other frame
  frameN++; renderer.shadowMap.autoUpdate = shadowEvery === 1 || frameN % shadowEvery === 0;
  if (!styled.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); renderer.shadowMap.autoUpdate = true; return; }
  renderer.setRenderTarget(RT.color);
  renderer.render(scene, camera);
  sky.visible = false;
  const fog = scene.fog; scene.fog = null;
  scene.overrideMaterial = normalMat;
  camera.layers.set(0);
  renderer.setRenderTarget(RT.normal);
  renderer.setClearColor(0x8080ff, 1);
  renderer.clear();
  // the shadow map was already drawn for the colour pass, so don't draw it a second time
  renderer.shadowMap.autoUpdate = false;
  renderer.render(scene, camera);
  // cut-out leaves and grass (layer 2) draw their own normals, so the ink follows the leaf shapes
  scene.overrideMaterial = null; camera.layers.set(2); FOLIAGE.normalPass.value = 1;
  renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true;
  FOLIAGE.normalPass.value = 0;
  renderer.shadowMap.autoUpdate = true;
  renderer.setClearColor(0x000000, 1);
  scene.overrideMaterial = null; scene.fog = fog; sky.visible = true;
  showLayers();
  const u = postMat.uniforms;
  if (!noPlants) glowPass(postCam); // (Low graphics skips the glow)
  postMat.uniforms.glow.value = noPlants ? 0 : 0.55;
  u.tColor.value = RT.color.texture; u.tNormal.value = RT.normal.texture; u.tNDepth.value = RT.normal.depthTexture; u.tGlow.value = RT.glowA.texture;
  u.res.value.set(RT.color.width, RT.color.height);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}
