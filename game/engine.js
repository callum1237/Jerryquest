// Rendering engine: renderer, storybook toon materials, ink-outline post-processing, particles, model loading.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export { THREE };

// ---------- renderer / scene ----------
export const PR = Math.min(window.devicePixelRatio || 1, 1.75);
export const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('stage').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 1, 600);
camera.layers.enableAll();

// ---------- lighting presets ----------
export const PRESETS = {
  day: {
    top: '#3f8fe6', horizon: '#ffe6bd', fog: '#f6e2c0',
    sun: '#fff0d2', sunI: 2.5, sunDir: [26, 48, 18],
    hemiSky: '#cfe6ff', hemiGround: '#7a9a50', hemiI: 1.25,
    rim: '#fff3c4', rimI: 0.45, motes: 0.55, fire: 0.6,
  },
  golden: {
    top: '#4a62b8', horizon: '#ffc08e', fog: '#f7c39a',
    sun: '#ffc78f', sunI: 2.1, sunDir: [50, 26, 8],
    hemiSky: '#ffe0c4', hemiGround: '#5d6e48', hemiI: 1.05,
    rim: '#ffb36b', rimI: 0.75, motes: 1.0, fire: 1.0,
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
scene.add(sun, sun.target);

const skyUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(450, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = clamp(vP.y*1.6+0.05,0.,1.); vec3 c = mix(horizon, top, pow(h,0.7));
      gl_FragColor = vec4(c,1.);
      #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -10;
scene.add(sky);
scene.fog = new THREE.Fog(0xffffff, 95, 230);

export const env = { preset: 'day' };
export function applyPreset(name) {
  env.preset = name;
  const p = PRESETS[name];
  skyUniforms.top.value.set(p.top);
  skyUniforms.horizon.value.set(p.horizon);
  scene.fog.color.set(p.fog);
  sun.color.set(p.sun); sun.intensity = p.sunI;
  hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemiI;
  rimUniform.value.set(p.rim); rimStrength.value = p.rimI;
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
export function burst(p, color, n = 24, spd = 6, up = 0.9) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const j = bNext = (bNext + 1) % BURST;
    bPos.set([p.x, p.y, p.z], j * 3);
    const v = new THREE.Vector3(rng() - 0.5, rng() * up, rng() - 0.5).normalize().multiplyScalar(spd * (0.4 + rng()));
    bVel.set([v.x, v.y, v.z], j * 3);
    bCol.set([c.r, c.g, c.b], j * 3);
    bLife[j] = 0.5 + rng() * 0.5;
  }
}
export function updateParticles(dt, t, center) {
  moteMat.opacity = PRESETS[env.preset].motes * 0.7;
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
  for (let j = 0; j < BURST; j++) {
    if (bLife[j] <= 0) { bPos[j * 3 + 1] = -100; continue; }
    bLife[j] -= dt;
    bVel[j * 3 + 1] -= 9 * dt;
    bPos[j * 3] += bVel[j * 3] * dt; bPos[j * 3 + 1] = Math.max(0.05, bPos[j * 3 + 1] + bVel[j * 3 + 1] * dt); bPos[j * 3 + 2] += bVel[j * 3 + 2] * dt;
    bCol[j * 3] *= 0.985; bCol[j * 3 + 1] *= 0.985; bCol[j * 3 + 2] *= 0.985;
    if (bLife[j] <= 0) bPos[j * 3 + 1] = -100;
  }
  bGeo.attributes.position.needsUpdate = true; bGeo.attributes.color.needsUpdate = true;
}

// ---------- post-processing: ink outlines + storybook grade ----------
function makeTargets() {
  const w = Math.floor(innerWidth * PR), h = Math.floor(innerHeight * PR);
  const color = new THREE.WebGLRenderTarget(w, h, { samples: renderer.capabilities.isWebGL2 ? 4 : 0, stencilBuffer: true });
  const normal = new THREE.WebGLRenderTarget(w, h);
  normal.depthTexture = new THREE.DepthTexture(w, h);
  return { color, normal };
}
let RT = makeTargets();
const normalMat = new THREE.MeshNormalMaterial();
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tNormal: { value: null }, tNDepth: { value: null },
    res: { value: new THREE.Vector2() }, near: { value: camera.near }, far: { value: camera.far },
    thick: { value: 1.7 * PR }, ink: { value: new THREE.Color('#2a160c') },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `
    uniform sampler2D tColor, tNormal, tNDepth; uniform vec2 res; uniform float near, far, thick; uniform vec3 ink;
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
      float edge = max(smoothstep(0.035, 0.08, de), smoothstep(0.3, 0.6, ne));
      edge *= 1. - smoothstep(90., 200., d0);
      float l = dot(col, vec3(.299,.587,.114));
      col = mix(vec3(l), col, 1.12);
      col = col * vec3(1.03, 1.0, 0.95) + vec3(0.012, 0.006, 0.0);
      col = clamp(col, 0., 1.);
      col = mix(col, ink, edge * 0.88);
      vec2 q = vUv - .5;
      col *= mix(1., 0.82, smoothstep(0.35, 0.85, length(q*vec2(1.1,1.))));
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  RT.color.dispose(); RT.normal.dispose(); RT = makeTargets();
});

export function render() {
  if (!styled.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
  renderer.setRenderTarget(RT.color);
  renderer.render(scene, camera);
  sky.visible = false;
  const fog = scene.fog; scene.fog = null;
  scene.overrideMaterial = normalMat;
  camera.layers.set(0);
  renderer.setRenderTarget(RT.normal);
  renderer.setClearColor(0x8080ff, 1);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setClearColor(0x000000, 1);
  scene.overrideMaterial = null; scene.fog = fog; sky.visible = true;
  camera.layers.enableAll();
  const u = postMat.uniforms;
  u.tColor.value = RT.color.texture; u.tNormal.value = RT.normal.texture; u.tNDepth.value = RT.normal.depthTexture;
  u.res.value.set(RT.color.width, RT.color.height);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}
