// Builds game/models/human.txt + game/tex/human.png for /human. Run from a folder holding three, @gltf-transform/* and meshoptimizer,
// with assets/ -> a Mesh2Motion checkout's static/assets/human (CC0) and human_tex.png made by tools/human_tex.py.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune, dedup, resample, quantize} from '@gltf-transform/functions';
import {MeshoptDecoder} from 'meshoptimizer'; import fs from 'fs';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const A='assets/animations/';
const ANIMS=['idle-a','idle-sword','walk','jog','sprint','sword-regular-a','sword-regular-b','sword-regular-c','dagger-stab','two-handed-overhead-slam','two-handed-horizontal-swing','spear-thrust','spell-simple-shoot','power-up','bow-release','bow-pull-hold','hit-chest','death-a','jump-2','roll','kick-front','consume','interact','pick-up','victory','greeting','sit-ground-idle','sleeping','chop-tree','mining','one-hand-slash-combo','jump-air'];
const out=await io.read('assets/variations/psx-10.glb');
const R=out.getRoot();
const byName=new Map(R.listNodes().map(n=>[n.getName(),n]));
const buf=R.listBuffers()[0];
const t=R.listTextures()[0]; t.setImage(fs.readFileSync('human_tex.png')).setMimeType('image/png').setName('human');
for(const nm of ANIMS){
  const d=await io.read(A+nm+'.glb'); const as=d.getRoot().listAnimations();
  for(const a of as){
    const na=out.createAnimation(nm);
    for(const ch of a.listChannels()){
      const node=ch.getTargetNode(); const tn=byName.get(node?.getName()); if(!tn||ch.getTargetPath()==='scale') continue;
      if(tn.getName()==='root' && ch.getTargetPath()==='translation') continue;
      const s=ch.getSampler();
      const cp=(acc)=>out.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setNormalized(acc.getNormalized()).setBuffer(buf);
      const outA=cp(s.getOutput());
      if(tn.getName()==='pelvis' && ch.getTargetPath()==='translation'){ // keep the hips in place horizontally (no drifting away from the hit box)
        const arr=outA.getArray(); const x0=arr[0], z0=arr[2]; for(let i=0;i<arr.length;i+=3){arr[i]=x0; arr[i+2]=z0;} outA.setArray(arr);
      }
      const ns=out.createAnimationSampler().setInput(cp(s.getInput())).setOutput(outA).setInterpolation(s.getInterpolation());
      na.addSampler(ns).addChannel(out.createAnimationChannel().setTargetNode(tn).setTargetPath(ch.getTargetPath()).setSampler(ns));
    }
    console.log(nm, a.getName(), na.listChannels().length, as.length);
    break;
  }
}
for (const e of R.listExtensionsUsed()) if (/meshopt/.test(e.extensionName)) e.dispose();
await out.transform(resample(), dedup(), prune({keepAttributes:true}));
await io.write('human_full.glb', out);
// game copy: texture as separate png, quantized, base64 txt
for (const m of R.listMaterials()){ m.setExtras({...m.getExtras(), tex:'human.png'}); m.setBaseColorTexture(null); }
await out.transform(prune({keepAttributes:true}), quantize());
fs.writeFileSync('human.txt', Buffer.from(await io.writeBinary(out)).toString('base64'));
console.log('txt', (fs.statSync('human.txt').size/1e6).toFixed(2)+'MB');
