// /human: the admin-only realistic human (Callum's own character).
// Body, rig and animations: Mesh2Motion human (CC0, github.com/Mesh2Motion/mesh2motion-app), painted with Callum's
// turnaround picture (front, back and side views projected onto it by tools/human_bake.py). The shoulder-length hair is built
// here from simple shapes and rides on the head bone. Build script: tools/human.mjs.
import * as THREE from 'three';

// hero animation name -> human clip name
export const HUMAN_ALIAS = {
  Idle: 'idle-a', Idle_Combat: 'idle-sword', '2H_Melee_Idle': 'idle-sword', '1H_Ranged_Aiming': 'bow-pull-hold',
  Walking_A: 'walk', Running_A: 'jog', Running_B: 'sprint',
  '1H_Melee_Attack_Chop': 'sword-regular-a', '1H_Melee_Attack_Slice_Diagonal': 'sword-regular-b',
  '1H_Melee_Attack_Slice_Horizontal': 'sword-regular-c', '1H_Melee_Attack_Stab': 'dagger-stab',
  '2H_Melee_Attack_Chop': 'two-handed-overhead-slam', '2H_Melee_Attack_Slice': 'two-handed-horizontal-swing',
  '2H_Melee_Attack_Spin': 'two-handed-horizontal-swing', '2H_Melee_Attack_Stab': 'spear-thrust',
  Spellcast_Shoot: 'spell-simple-shoot', Spellcasting: 'power-up', '1H_Ranged_Shoot': 'bow-release',
  Hit_A: 'hit-chest', Hit_B: 'hit-chest', Death_A: 'death-a', Death_B: 'death-a',
  Jump_Full_Short: 'jump-2', Jump_Full_Long: 'jump-2', Jump_Idle: 'jump-air', Dodge_Forward: 'roll', Dodge_Left: 'roll', Dodge_Right: 'roll', Dodge_Backward: 'roll',
  Unarmed_Melee_Attack_Kick: 'kick-front', Use_Item: 'consume', Interact: 'interact', PickUp: 'pick-up',
  Cheer: 'victory', Wave: 'greeting', Sit_Floor_Idle: 'sit-ground-idle', Lie_Idle: 'sleeping',
};
// clips that loop (everything else plays once, timed to the hero's own move)
export const HUMAN_LOOPS = new Set(['idle-a', 'idle-sword', 'walk', 'jog', 'sprint', 'bow-pull-hold', 'sit-ground-idle', 'sleeping', 'jump-air']);

// shoulder-length, slightly wavy blond hair in head-bone space (metres, +Y up, +Z forward; this rig's head
// bone sits at the shoulders, so the skull is centred about 0.2 above it)
export function makeHumanHair() {
  const g = new THREE.Group(); g.name = 'humanHair';
  // ash-blond, picked from the picture: darker roots and underside, lighter sun-streaks on top
  const PAL = ['#33240f', '#4b371f', '#664c30', '#836646', '#a3845a'].map((c) => new THREE.Color(c));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // streaks run along the hair: colour by angle around the head (plus a little noise), darker underneath
  const paint = (geo, light = 0) => {
    const p = geo.attributes.position, c = new Float32Array(p.count * 3), v = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.x, v.z), streak = Math.sin(a * 13) * 0.5 + Math.sin(a * 31 + 1.3) * 0.3 + Math.sin(a * 5) * 0.2;
      let t = 0.45 + streak * 0.5 + light + (rnd() - 0.5) * 0.15 + Math.max(-0.35, Math.min(0.25, v.y * 2.2));
      t = Math.max(0, Math.min(0.999, t)) * (PAL.length - 1);
      col.copy(PAL[Math.floor(t)]).lerp(PAL[Math.min(PAL.length - 1, Math.floor(t) + 1)], t % 1);
      c.set([col.r, col.g, col.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  };
  const add = (geo, x, y, z, light) => { const m = new THREE.Mesh(paint(geo, light), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  // crown: a full, slightly messy cap over the skull, swept back from a centre-ish part
  const capG = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  { const p = capG.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.x, v.z); const k = 1 + Math.sin(a * 11) * 0.03 * (1 - v.y) + (v.y > 0.92 ? 0 : Math.sin(a * 6 + 0.4) * 0.02); v.x *= k; v.z *= k; p.setXYZ(i, v.x, v.y, v.z); }
    capG.computeVertexNormals(); }
  const cap = add(capG, 0, 0.19, -0.004, 0.12);
  cap.scale.set(0.088, 0.074, 0.094); cap.rotation.x = -0.28;
  // the back and sides fall in shaggy layers to the jaw and the top of the neck
  const H = 0.16, shell = new THREE.CylinderGeometry(0.078, 0.094, H, 36, 6, true, Math.PI * 0.3, Math.PI * 1.4);
  const p = shell.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ang = Math.atan2(v.x, v.z), low = 0.5 - v.y / H; // 0 at the top, 1 at the tips
    const wave = 1 + Math.sin(ang * 9) * 0.06 * low + Math.sin(ang * 23) * 0.02 * low + Math.sin(ang * 4) * 0.02;
    v.x *= wave; v.z *= wave * 1.12;
    v.y -= (Math.cos(ang * 7) * 0.5 + 0.5) * 0.022 * low + (Math.sin(ang * 17) * 0.5 + 0.5) * 0.012 * low; // ragged tips
    if (v.z > 0) v.y += low * 0.03 * Math.min(1, v.z / 0.06); // a touch shorter where it frames the face
    p.setXYZ(i, v.x, v.y, v.z);
  }
  shell.computeVertexNormals();
  add(shell, 0, 0.145, -0.012, -0.05);
  // loose flicked locks over the shell so it reads as layered hair, not a helmet
  for (let i = 0; i < 26; i++) {
    const a = Math.PI + (i / 25 - 0.5) * Math.PI * 1.3; // around the back, side to side
    const len = 0.07 + ((i * 37) % 7) * 0.008;
    const lock = add(new THREE.ConeGeometry(0.026, len * 1.5, 6, 1).rotateX(Math.PI), Math.sin(a) * 0.088, 0.16 - len * 0.42, Math.cos(a) * 0.094 - 0.012, ((i * 13) % 5) * 0.06 - 0.1);
    lock.scale.set(1, 1, 0.4); lock.rotation.set(Math.cos(a) * -0.2, a, Math.sin(a) * 0.16 + (i % 2 ? 0.12 : -0.12));
  }
  // a shaggy fringe swept to both sides over the forehead
  for (const [x, y, rz, s] of [[-0.034, 0.224, 1.15, 1.1], [-0.01, 0.229, 1.3, 1], [0.016, 0.228, -1.3, 1], [0.04, 0.222, -1.1, 0.95], [-0.056, 0.212, 0.75, 0.85], [0.06, 0.208, -0.7, 0.85]]) {
    const b = add(new THREE.ConeGeometry(0.02, 0.075 * s, 6, 1).rotateX(Math.PI), x, y, 0.07 - Math.abs(x) * 0.32, 0.15);
    b.scale.set(1, 1, 0.4); b.rotation.set(-0.35, x * 4, rz);
  }
  // side pieces that hang past the cheeks, like the picture
  for (const sx of [-1, 1]) {
    const sp = add(new THREE.ConeGeometry(0.022, 0.12, 6, 1).rotateX(Math.PI), sx * 0.074, 0.15, 0.045, 0);
    sp.scale.set(0.8, 1, 0.45); sp.rotation.set(0.1, sx * 0.3, sx * 0.08);
  }
  return g;
}
