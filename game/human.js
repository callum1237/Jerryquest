// /human: the admin-only realistic human (Callum's own character).
// Body, rig and animations: Mesh2Motion human (CC0, github.com/Mesh2Motion/mesh2motion-app), re-coloured to a
// black tee, dark jeans and blond hair to match Callum's turnaround picture. The shoulder-length hair is built
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
  const shades = ['#d6b066', '#c39a50', '#e6c67f', '#b38842'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide }));
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  // crown: a cap just over the skull, fuller on top and swept back
  const cap = add(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), shades[0], 0, 0.19, -0.006);
  cap.scale.set(0.08, 0.072, 0.086); cap.rotation.x = -0.3;
  // the back and sides fall to the jaw and neck: an open shell that flares and waves at the tips
  const H = 0.17, shell = new THREE.CylinderGeometry(0.073, 0.088, H, 28, 6, true, Math.PI * 0.3, Math.PI * 1.4);
  const p = shell.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ang = Math.atan2(v.x, v.z), low = 0.5 - v.y / H; // 0 at the top, 1 at the tips
    const wave = 1 + Math.sin(ang * 9) * 0.05 * low + Math.sin(ang * 23) * 0.015;
    v.x *= wave; v.z *= wave * 1.14;
    v.y -= (Math.cos(ang * 7) * 0.5 + 0.5) * 0.018 * low; // uneven tips
    if (v.z > 0) v.y += low * 0.035 * Math.min(1, v.z / 0.06); // shorter where it frames the face
    p.setXYZ(i, v.x, v.y, v.z);
  }
  shell.computeVertexNormals();
  add(shell, shades[0], 0, 0.14, -0.014);
  // loose locks layered over the shell so it reads as hair, not a helmet
  for (let i = 0; i < 22; i++) {
    const a = Math.PI + (i / 21 - 0.5) * Math.PI * 1.25; // around the back, side to side
    const len = 0.085 + ((i * 37) % 7) * 0.007;
    const lock = add(new THREE.CapsuleGeometry(0.021, len, 3, 8), shades[i % 4], Math.sin(a) * 0.081, 0.15 - len * 0.45, Math.cos(a) * 0.088 - 0.014);
    lock.scale.set(1, 1, 0.42); lock.rotation.set(Math.cos(a) * -0.15, a, Math.sin(a) * 0.12);
  }
  // swept bangs lying over the forehead, parted a little off centre
  for (const [x, y, rz, s] of [[-0.03, 0.222, 1.25, 1.1], [-0.006, 0.226, 1.35, 1], [0.022, 0.223, -1.3, 1], [0.047, 0.214, -1.05, 0.85], [-0.053, 0.21, 0.8, 0.8]]) {
    const b = add(new THREE.CapsuleGeometry(0.015, 0.05 * s, 3, 8), shades[Math.round(x * 100) & 3], x, y, 0.066 - Math.abs(x) * 0.3);
    b.scale.set(1, 1, 0.4); b.rotation.set(-0.35, x * 4, rz);
  }
  return g;
}
