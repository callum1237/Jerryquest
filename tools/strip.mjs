import {NodeIO} from '@gltf-transform/core';
import {prune, resample, dedup} from '@gltf-transform/functions';
const [src,dst,keepCsv,hideCsv]=process.argv.slice(2);
const keep=new Set(keepCsv.split(',')); const hide=new Set((hideCsv||'').split(',').filter(Boolean));
const io=new NodeIO(); const d=await io.read(src);
for(const a of d.getRoot().listAnimations()) if(!keep.has(a.getName())) a.dispose();
for(const n of d.getRoot().listNodes()) if(hide.has(n.getName())) { n.getParentNode()?.removeChild(n); for(const s of d.getRoot().listScenes()) s.removeChild(n); n.dispose(); }
await d.transform(resample(), dedup(), prune());
await io.write(dst,d);
