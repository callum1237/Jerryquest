# Paints game/tex/human.png by projecting Callum's turnaround picture (ref.jpg: front, side, back) onto the Mesh2Motion
# psx-10 body. rest.json comes from tools/human_pose.html (rest pose: vertex positions, UVs, skin weights, joints).
# Front/back use per-bone 2D landmark transforms; the side view is used for the head only.
import json, numpy as np
from PIL import Image, ImageFilter
d=json.load(open('rest.json')); J={k:np.array(v) for k,v in d['J'].items()}; bones=d['bones']
P=np.array(d['pos']).reshape(-1,3); UV=np.array(d['uv']).reshape(-1,2); T=np.array(d['idx']).reshape(-1,3)
SK=np.array(d['sk']).reshape(-1,4,2); BI=SK[...,0].astype(int); BW=SK[...,1]
ref=np.asarray(Image.open('ref.jpg').convert('RGB')).astype(np.float32)
H,W=ref.shape[:2]
from scipy import ndimage
fg=~((np.abs(ref-128).max(-1)<16)|(np.abs(ref-66).max(-1)<12)); fg[700:]=False
fg=ndimage.binary_opening(fg,iterations=1); fgE=ndimage.binary_erosion(fg,iterations=2)
_,(iy,ix)=ndimage.distance_transform_edt(~fgE,return_indices=True)
ref=ref[iy,ix]  # every pixel now holds the nearest figure colour, so edges never pick up the grey background
def isbg(c): return (np.abs(c-128).max(-1)<14)|(np.abs(c-66).max(-1)<10)
old=np.asarray(Image.open('human_tex.png').convert('RGB').resize((1024,1024),Image.BICUBIC)).astype(np.float32)
# ---- front mapping: per bone 2D similarity (complex), torso axis-affine ----
def cz(p): return complex(p[0], -p[1])
def sim(a,b,A,B):
    a,b=cz(a),cz(b); A,B=complex(*A),complex(*B); k=(B-A)/(b-a)
    return lambda z: A+k*(z-a)
headv=[i for i in range(len(P)) if bones[BI[i,np.argmax(BW[i])]] in ('head','head_leaf')]
hp=P[headv]; print('head verts',len(hp),'x',hp[:,0].min(),hp[:,0].max(),'y',hp[:,1].min(),hp[:,1].max(),'z',hp[:,2].min(),hp[:,2].max())
EYE,CHIN=1.752,1.628
fhead=sim((0,EYE),(0,CHIN),(240,88),(240,130))
def ftorso(z): x,y=z.real,-z.imag; return complex(240+x*425.5, 185-(y-1.446)*365)
seg={}
for s,(sh,el,wr,ft) in {'r':((180,185),(125,265),(90,345),(85,395)),'l':((300,185),(357,265),(392,345),(397,395))}.items():
    seg['upperarm_'+s]=sim(J['upperarm_'+s],J['lowerarm_'+s],sh,el)
    seg['lowerarm_'+s]=sim(J['lowerarm_'+s],J['hand_'+s],el,wr)
    seg['hand_'+s]=sim(J['hand_'+s],J['middle_04_leaf_'+s],wr,ft)
for s,(hip,kn,an) in {'r':((205,365),(208,490),(200,640)),'l':((275,365),(272,490),(283,640))}.items():
    seg['thigh_'+s]=sim(J['thigh_'+s],J['calf_'+s],hip,kn)
    seg['calf_'+s]=sim(J['calf_'+s],J['foot_'+s],kn,an)
def bonefun(n):
    if n in ('head','head_leaf'): return fhead
    if n in seg: return seg[n]
    for pre in ('index','middle','pinky','ring','thumb'):
        if n.startswith(pre): return seg['hand_'+n[-1]]
    if n.startswith(('foot','ball')): return seg['calf_'+n[-1]]
    return ftorso
BF=[bonefun(n) for n in bones]
def front_uv(i, p):
    z=cz(p); acc=0j
    for k in range(4):
        w=BW[i,k]
        if w>0: acc+=w*BF[BI[i,k]](z)
    return acc/max(BW[i].sum(),1e-6)
FU=np.array([front_uv(i,P[i]) for i in range(len(P))])
# side mapping, head only: nose forward
zf,zb=hp[:,2].max(),hp[:,2].min()
def side_uv(p):  # character faces image right; we see his right side
    u=670+(p[2]-zb)/(zf-zb)*(745-670); v=88+(p[1]-EYE)*(-(130-88)/(EYE-CHIN)); return complex(u,v)
SU=np.array([side_uv(p) for p in P])
group=np.array([('head' if bones[BI[i,np.argmax(BW[i])]] in ('head','head_leaf') else 'torso' if BF[BI[i,np.argmax(BW[i])]] is ftorso else 'limb') for i in range(len(P))])
# ---- rasterize in UV space ----
N=1024; out=old.copy(); filled=np.zeros((N,N),bool)
def sample(u,v):
    u=np.clip(u,0,W-2); v=np.clip(v,0,H-2); x0=np.floor(u).astype(int); y0=np.floor(v).astype(int); fx=(u-x0)[:,None]; fy=(v-y0)[:,None]
    return ref[y0,x0]*(1-fx)*(1-fy)+ref[y0,x0+1]*fx*(1-fy)+ref[y0+1,x0]*(1-fx)*fy+ref[y0+1,x0+1]*fx*fy
for t in T:
    a,b,c=P[t]; n=np.cross(b-a,c-a); nn=np.linalg.norm(n)
    if nn<1e-12: continue
    n/=nn
    uv=UV[t]*N; mn=np.floor(uv.min(0)).astype(int); mx=np.ceil(uv.max(0)).astype(int)
    xs,ys=np.meshgrid(np.arange(mn[0],mx[0]+1),np.arange(mn[1],mx[1]+1)); px=np.stack([xs.ravel()+0.5,ys.ravel()+0.5],-1)
    M=np.array([uv[1]-uv[0],uv[2]-uv[0]]).T
    if abs(np.linalg.det(M))<1e-9: continue
    l=np.linalg.solve(M,(px-uv[0]).T).T; w=np.stack([1-l[:,0]-l[:,1],l[:,0],l[:,1]],-1)
    ins=(w>=-0.02).all(1); w=w[ins]; px=px[ins].astype(int)-0 
    px=np.floor(px).astype(int); ok=(px[:,0]>=0)&(px[:,0]<N)&(px[:,1]>=0)&(px[:,1]<N); w=w[ok]; px=px[ok]
    if not len(px): continue
    fu=w@FU[t]; su=w@SU[t]
    if group[t[0]]=='torso': fu=np.clip(fu.real,186,294)+1j*fu.imag
    bu=1145+1.05*(240-fu.real); bv=40+(fu.imag-40)*0.985
    g=group[t[0]]
    wf=max(n[2],0)**1.5; wb=max(-n[2],0)**1.5; ws=(abs(n[0])**1.5 if g=='head' else 0)
    if wf+wb+ws<0.05: wf,wb=(0.05,0) if n[2]>=0 else (0,0.05)
    cols=np.zeros((len(px),3)); wsum=np.zeros(len(px))
    for wt,(uu,vv) in ((wf,(fu.real,fu.imag)),(wb,(bu,bv)),(ws,(su.real if n[0]<0 else su.real, su.imag))):
        if wt<=0: continue
        cc=sample(uu,vv); good=np.ones(len(cc),bool); cols[good]+=wt*cc[good]; wsum[good]+=wt
    has=wsum>0
    out[px[has,1],px[has,0]]=cols[has]/wsum[has,None]; filled[px[has,1],px[has,0]]=True
print('filled',filled.mean())
# grow each painted island a few texels so seams don't show the old texture
_,(iy,ix)=ndimage.distance_transform_edt(~filled,return_indices=True)
dist=ndimage.distance_transform_edt(~filled)
grow=(dist>0)&(dist<6); out[grow]=out[iy[grow],ix[grow]]
img=Image.fromarray(np.clip(out,0,255).astype(np.uint8))
img.save('human_proj.png'); img.save('human_proj_big.png')
