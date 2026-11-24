// Build game/models/nature.txt from the Quaternius Stylized Nature MegaKit (free version, CC0).
// usage: node tools/nature.mjs <folder with the kit's glTF files> <game folder>
// Every model becomes a named top-level node. Textures are shrunk and written to game/tex/nat_*.png,
// and the normal maps are dropped (the toon shading doesn't use them).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition, dedup, prune, quantize, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [src, game] = process.argv.slice(2);
const MODELS = {
  // name: simplify ratio (1 = keep every triangle)
  CommonTree_1: 0.4, CommonTree_2: 0.4, CommonTree_3: 0.45, CommonTree_5: 0.45,
  TwistedTree_1: 0.3, Pine_1: 0.45, Pine_2: 0.45, Pine_5: 0.6,
  DeadTree_1: 0.3, DeadTree_2: 0.3,
  Bush_Common: 1, Bush_Common_Flowers: 1, Flower_3_Group: 1, Flower_4_Group: 1, Flower_3_Single: 1, Flower_4_Single: 1,
  Grass_Common_Short: 1, Grass_Common_Tall: 1, Grass_Wispy_Short: 1, Grass_Wispy_Tall: 1, Clover_1: 1, Clover_2: 1,
  Fern_1: 1, Plant_1: 1, Plant_1_Big: 1, Plant_7: 1, Plant_7_Big: 1,
  Rock_Medium_1: 1, Rock_Medium_2: 1, Rock_Medium_3: 1,
  Pebble_Round_1: 1, Pebble_Round_2: 1, Pebble_Round_3: 1, Pebble_Round_4: 1, Pebble_Round_5: 1,
  RockPath_Round_Small_1: 0.6, RockPath_Round_Small_2: 0.6, RockPath_Round_Small_3: 0.6,
  Mushroom_Common: 1, Mushroom_Laetiporus: 0.5,
};
const BARK = { CommonTree_1: 700, CommonTree_2: 700, CommonTree_3: 600, CommonTree_5: 600, TwistedTree_1: 1300, Pine_1: 450, Pine_2: 450, Pine_5: 300, DeadTree_1: 1400, DeadTree_2: 1400 };
const TEX = { // source texture -> [game name, size]
  'Bark_NormalTree.png': ['nat_bark.png', 256], 'Bark_TwistedTree.png': ['nat_bark_twist.png', 256], 'Bark_DeadTree.png': ['nat_bark_dead.png', 256],
  'Leaves_NormalTree_C.png': ['nat_leaves.png', 512], 'Leaves_TwistedTree_C.png': ['nat_leaves_twist.png', 512], 'Leaf_Pine_C.png': ['nat_pine.png', 512],
  'Leaves.png': ['nat_plants.png', 512], 'Flowers.png': ['nat_flowers.png', 512], 'Grass.png': ['nat_grass.png', 256],
  'Rocks_Diffuse.png': ['nat_rocks.png', 512], 'PathRocks_Diffuse.png': ['nat_pathrocks.png', 256], 'Mushrooms.png': ['nat_mushrooms.png', 256],
};
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let out = null, outScene = null;
for (const [name, ratio] of Object.entries(MODELS)) {
  const d = await io.read(`${src}/${name}.gltf`);
  for (const m of d.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture(), uri = t && t.getURI().split('/').pop();
    if (t) {
      const [nm, size] = TEX[uri] || (() => { throw new Error('no texture rule for ' + uri); })();
      if (!fs.existsSync(`${game}/tex/${nm}`)) {
        await sharp(Buffer.from(t.getImage())).resize(size, size).png({ palette: true, quality: 90, effort: 10 }).toFile(`${game}/tex/${nm}`);
      }
      m.setExtras({ ...m.getExtras(), tex: nm, cut: m.getAlphaMode() === 'MASK' ? 1 : 0 });
      m.setBaseColorTexture(null);
    }
    m.setNormalTexture(null);
  }
  for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial(); if (mat && mat.getAlphaMode() === 'MASK' && /Leaves|Leaf/.test(mat.getName()) && p.getAttribute('NORMAL')) p.setAttribute('NORMAL', null);
  }
  // trunks and branches are mostly hidden by leaves, so they can lose most of their triangles
  for (const mesh of d.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial(), nm = mat ? mat.getName() : '';
    const target = BARK[name] && /Bark/.test(nm) ? BARK[name] : 0;
    if (!target) continue;
    const idx = p.getIndices().getArray(), pos = p.getAttribute('POSITION').getArray();
    const out = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), new Float32Array(pos), 3, null, target * 3, 0.5)[0];
    p.getIndices().setArray(new Uint32Array(out));
  }
  const sc = d.getRoot().listScenes()[0];
  const g = d.createNode(name);
  for (const c of sc.listChildren()) { sc.removeChild(c); g.addChild(c); }
  sc.addChild(g);
  if (!out) { out = d; outScene = sc; continue; }
  const map = mergeDocuments(out, d);
  const s2 = map.get(sc); const g2 = map.get(g);
  s2.removeChild(g2); outScene.addChild(g2); s2.dispose();
}
for (const t of out.getRoot().listTextures()) t.dispose();
await out.transform(unpartition(), dedup(), prune({ keepAttributes: true }), quantize());
let tris = 0;
for (const n of outScene.listChildren()) {
  let t = 0; n.traverse((c) => { const m = c.getMesh(); if (m) for (const p of m.listPrimitives()) t += p.getIndices().getCount() / 3; });
  tris += t; console.log(n.getName(), t);
}
const glb = await io.writeBinary(out);
fs.writeFileSync(`${game}/models/nature.txt`, Buffer.from(glb).toString('base64'));
console.log('nature.txt', (fs.statSync(`${game}/models/nature.txt`).size / 1e6).toFixed(2) + 'MB', 'tris', tris);
