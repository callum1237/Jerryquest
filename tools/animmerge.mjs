// copy animations from rig-only glbs onto a model glb, matching target nodes by name
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune, dedup, resample} from '@gltf-transform/functions';
const [model,dst,...anims]=process.argv.slice(2);
import {MeshoptDecoder} from 'meshoptimizer'; await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const out=await io.read(model);
const byName=new Map(out.getRoot().listNodes().map(n=>[n.getName(),n]));
const buf=out.getRoot().listBuffers()[0];
for(const f of anims){
  const d=await io.read(f);
  for(const a of d.getRoot().listAnimations()){
    const na=out.createAnimation(a.getName());
    for(const ch of a.listChannels()){
      const tn=byName.get(ch.getTargetNode()?.getName()); if(!tn || ch.getTargetPath()==='scale') continue;
      const s=ch.getSampler();
      const cp=(acc)=>out.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setNormalized(acc.getNormalized()).setBuffer(buf);
      const ns=out.createAnimationSampler().setInput(cp(s.getInput())).setOutput(cp(s.getOutput())).setInterpolation(s.getInterpolation());
      na.addSampler(ns).addChannel(out.createAnimationChannel().setTargetNode(tn).setTargetPath(ch.getTargetPath()).setSampler(ns));
    }
    console.log('anim',a.getName(),na.listChannels().length);
  }
}
for (const e of out.getRoot().listExtensionsUsed()) if (/meshopt/.test(e.extensionName)) e.dispose();
await out.transform(resample(), dedup(), prune());
await io.write(dst,out);
