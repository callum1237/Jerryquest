// merge many gltf files into one glb, each as a named top-level node
import {NodeIO} from '@gltf-transform/core';
import {mergeDocuments, unpartition, dedup, prune, flatten} from '@gltf-transform/functions';
const [dst,...srcs]=process.argv.slice(2);
const io=new NodeIO(); const out=await io.read(srcs[0]);
const name0=srcs[0].split('/').pop().replace('.gltf','');
const outScene=out.getRoot().listScenes()[0];
const wrap=(doc,scene,name)=>{const g=doc.createNode(name); for(const c of scene.listChildren()){scene.removeChild(c); g.addChild(c);} scene.addChild(g); return g;};
wrap(out,outScene,name0);
for(const s of srcs.slice(1)){ const d=await io.read(s); const map=mergeDocuments(out,d); const sc=map.get(d.getRoot().listScenes()[0]); const name=s.split('/').pop().replace('.gltf',''); const g=wrap(out,sc,name); sc.removeChild(g); outScene.addChild(g); sc.dispose(); }
await out.transform(unpartition(), dedup(), prune());
await io.write(dst,out);
