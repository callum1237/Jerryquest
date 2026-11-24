from PIL import Image; import numpy as np, colorsys
im=np.asarray(Image.open('psx10.png').convert('RGBA')).astype(float)/255
rgb=im[...,:3]; a=im[...,3:]
r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
mx=rgb.max(-1); mn=rgb.min(-1); sat=(mx-mn)/np.maximum(mx,1e-4); lum=rgb@[0.299,0.587,0.114]
H,W=lum.shape; yy,xx=np.mgrid[0:H,0:W]
def rect(x0,y0,x1,y1): return (xx>=x0/2)&(xx<x1/2)&(yy>=y0/2)&(yy<y1/2)
head=rect(820,150,1024,390)|rect(0,385,210,620)
out=rgb.copy()
# shirt: grey, low saturation, mid value, outside head
shoes=rect(320,80,700,190)|rect(895,480,995,615)|rect(890,815,990,955)|rect(195,625,325,695)|rect(0,765,65,895)
shirt=(sat<0.14)&(lum>0.25)&(lum<0.8)&~head&~shoes
out[shirt]=(rgb[shirt]*0.22+0.015)
# jeans: blue → deeper darker indigo
jeans=(b>r+0.06)&~head
j=rgb[jeans]; jl=j@[0.299,0.587,0.114]
out[jeans]=np.stack([0.07+jl*0.30,0.09+jl*0.36,0.16+jl*0.62],-1)*0.85
# hair: dark pixels in head → blond gradient
hair=head&(lum<0.36)&(mx>0.06)&(a[...,0]>0.5)
hl=np.clip(lum[hair]/0.36,0,1)[:,None]
dark=np.array([0.42,0.29,0.13]); light=np.array([0.93,0.78,0.48])
out[hair]=dark+(light-dark)*hl**0.8
# soften the transition pixels (mid lum hair edge) slightly toward blond
edge=head&(mx>0.06)&(lum>=0.36)&(lum<0.46)&(sat<0.35)
out[edge]=out[edge]*0.5+np.array([0.85,0.70,0.45])*0.5
o=np.concatenate([np.clip(out,0,1),a],-1)
Image.fromarray((o*255).astype(np.uint8)).save('human_tex.png')
Image.fromarray((o*255).astype(np.uint8)).convert('RGB').resize((1024,1024),Image.NEAREST).save('human_tex_big.png')
