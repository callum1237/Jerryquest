import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {quantize, prune, weld, normals, resample} from '@gltf-transform/functions';
import fs from 'fs';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const d=await io.read(process.argv[2]);
for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
await d.transform(prune({keepAttributes:true}), weld({tolerance:0.0005}), normals({overwrite:true}), resample(), quantize());
const glb=await io.writeBinary(d); fs.writeFileSync(process.argv[3], Buffer.from(glb).toString('base64')); console.log((fs.statSync(process.argv[3]).size/1e6).toFixed(2)+'MB');
