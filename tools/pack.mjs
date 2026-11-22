import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {quantize, prune} from '@gltf-transform/functions';
import fs from 'fs';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const texNames=new Set();
for (const f of process.argv.slice(2)){
  const d=await io.read(f);
  for (const m of d.getRoot().listMaterials()){
    const t=m.getBaseColorTexture();
    if (t){ const nm=(t.getURI()||t.getName()||'tex').split('/').pop().replace(/\.png$/,'')+'.png'; texNames.add(nm+'|'+t.getSize()); m.setExtras({...m.getExtras(), tex:nm}); if(!fs.existsSync('site/tex/'+nm)) fs.writeFileSync('site/tex/'+nm, Buffer.from(t.getImage())); m.setBaseColorTexture(null);}
  }
  await d.transform(prune({keepAttributes:true}), quantize());
  const glb=await io.writeBinary(d);
  const out=f.replace(/\.glb$/,'.txt'); fs.writeFileSync(out, Buffer.from(glb).toString('base64')); console.log(out,(fs.statSync(out).size/1e6).toFixed(2)+'MB');
}
console.log([...texNames]);
