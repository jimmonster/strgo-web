"""Original geometric display lettering. Pure Python TrueType builder; no font dependency."""
import struct, math, pathlib
P=pathlib.Path(__file__).resolve().parents[1]/'public/assets'
u16=lambda *v:struct.pack('>'+len(v)*'H',*v)
i16=lambda *v:struct.pack('>'+len(v)*'h',*v)
u32=lambda *v:struct.pack('>'+len(v)*'I',*v)
# A chamfered, wide monoline alphabet, drawn on a 700 x 700 grid.
G={
'A':[[(40,0),(40,510),(160,680),(520,680),(640,510),(640,0)],[(40,290),(640,290)]],
'B':[[(40,0),(40,680),(500,680),(620,590),(620,440),(520,350),(40,350)],[(520,350),(640,260),(640,90),(530,0),(40,0)]],
'C':[[(640,560),(530,680),(160,680),(40,560),(40,120),(160,0),(530,0),(640,110)]],
'D':[[(40,0),(40,680),(460,680),(640,510),(640,170),(470,0),(40,0)]],
'E':[[(640,680),(40,680),(40,0),(640,0)],[(40,350),(530,350)]],
'F':[[(640,680),(40,680),(40,0)],[(40,350),(530,350)]],
'G':[[(640,560),(530,680),(160,680),(40,560),(40,120),(160,0),(530,0),(640,110),(640,330),(360,330)]],
'H':[[(40,0),(40,680)],[(640,0),(640,680)],[(40,340),(640,340)]],
'I':[[(120,680),(560,680)],[(340,680),(340,0)],[(120,0),(560,0)]],
'J':[[(120,680),(640,680),(640,130),(510,0),(160,0),(40,120)]],
'K':[[(40,0),(40,680)],[(640,680),(40,290)],[(290,450),(640,0)]],
'L':[[(40,680),(40,0),(640,0)]],
'M':[[(40,0),(40,680),(340,350),(640,680),(640,0)]],
'N':[[(40,0),(40,680),(640,0),(640,680)]],
'O':[[(160,680),(520,680),(640,560),(640,120),(520,0),(160,0),(40,120),(40,560),(160,680)]],
'P':[[(40,0),(40,680),(520,680),(640,560),(640,420),(520,300),(40,300)]],
'Q':[[(160,680),(520,680),(640,560),(640,120),(520,0),(160,0),(40,120),(40,560),(160,680)],[(400,200),(680,-40)]],
'R':[[(40,0),(40,680),(520,680),(640,560),(640,420),(520,300),(40,300)],[(370,300),(650,0)]],
'S':[[(640,560),(530,680),(150,680),(40,570),(40,440),(150,340),(530,340),(640,230),(640,110),(530,0),(150,0),(40,110)]],
'T':[[(20,680),(660,680)],[(340,680),(340,0)]],
'U':[[(40,680),(40,130),(170,0),(510,0),(640,130),(640,680)]],
'V':[[(20,680),(280,0),(400,0),(660,680)]],
'W':[[(20,680),(160,0),(240,0),(340,420),(440,0),(520,0),(660,680)]],
'X':[[(20,680),(660,0)],[(20,0),(660,680)]],
'Y':[[(20,680),(340,350),(660,680)],[(340,350),(340,0)]],
'Z':[[(20,680),(660,680),(20,0),(660,0)]],
'0':[[(160,680),(520,680),(640,560),(640,120),(520,0),(160,0),(40,120),(40,560),(160,680)],[(180,100),(500,580)]],
'1':[[(170,550),(340,680),(340,0)],[(150,0),(540,0)]],
'2':[[(40,560),(160,680),(520,680),(640,560),(640,450),(40,0),(640,0)]],
'3':[[(40,680),(530,680),(640,570),(640,450),(530,340),(230,340)],[(530,340),(640,230),(640,110),(530,0),(40,0)]],
'4':[[(520,0),(520,680),(40,210),(660,210)]],
'5':[[(640,680),(40,680),(40,350),(520,350),(640,230),(640,120),(520,0),(40,0)]],
'6':[[(640,680),(170,680),(40,550),(40,120),(170,0),(520,0),(640,120),(640,240),(520,360),(40,360)]],
'7':[[(40,680),(640,680),(220,0)]],
'8':[[(160,680),(520,680),(640,560),(640,460),(520,340),(160,340),(40,220),(40,120),(160,0),(520,0),(640,120),(640,220),(520,340),(160,340),(40,460),(40,560),(160,680)]],
'9':[[(640,320),(160,320),(40,440),(40,560),(160,680),(520,680),(640,560),(640,120),(520,0),(40,0)]],
'-':[[(100,340),(580,340)]],'/':[[(80,-50),(600,730)]],'.':[[(310,10),(350,10)]],':':[[(310,160),(350,160)],[(310,510),(350,510)]],'+':[[(100,340),(580,340)],[(340,100),(340,580)]],
}
chars=[' ']+list(G)+list('abcdefghijklmnopqrstuvwxyz')
contours=[[]]
for ch in chars:
 cs=[]
 for stroke in G.get(ch.upper(),[]):
  for a,b in zip(stroke,stroke[1:]):
   dx,dy=b[0]-a[0],b[1]-a[1];l=math.hypot(dx,dy);nx,ny=-dy/l*22,dx/l*22
   cs.append([(round(a[0]+nx+55),round(a[1]+ny)),(round(b[0]+nx+55),round(b[1]+ny)),(round(b[0]-nx+55),round(b[1]-ny)),(round(a[0]-nx+55),round(a[1]-ny))])
 contours.append(cs)
glyf=b'';loca=[];maxpoints=maxcontours=0
for cs in contours:
 loca.append(len(glyf));pts=[p for c in cs for p in c]
 if not pts:g=u16(0)+i16(0,0,0,0)
 else:
  maxpoints=max(maxpoints,len(pts));maxcontours=max(maxcontours,len(cs));xs,ys=zip(*pts)
  g=i16(len(cs),min(xs),min(ys),max(xs),max(ys))+u16(*[i*4+3 for i in range(len(cs))])+u16(0)+bytes([1])*len(pts)
  for axis in [0,1]:
   prev=0
   for pt in pts:g+=i16(pt[axis]-prev);prev=pt[axis]
 g+=b'\0'*((-len(g))%4);glyf+=g
loca.append(len(glyf));n=len(contours)
tables={}
tables['glyf']=glyf;tables['loca']=u32(*loca)
tables['head']=u32(0x10000,0x10000,0,0x5f0f3cf5)+u16(3,1000)+struct.pack('>qq',0,0)+i16(0,-90,800,760)+u16(0,8)+i16(2,1,0)
tables['hhea']=u32(0x10000)+i16(800,-200,0)+u16(800)+i16(0,0,800,1,0,0,0,0,0,0)+i16(0)+u16(n)
tables['maxp']=u32(0x10000)+u16(n,maxpoints,maxcontours,0,0,2,0,0,0,0,0,0,0,0)
tables['hmtx']=b''.join(u16(420 if i==1 else 800)+i16(0) for i in range(n))
# Format 4 cmap with one segment per mapped character and a sentinel.
mapping=sorted((ord(ch),i+1) for i,ch in enumerate(chars));ends=[c for c,_ in mapping]+[65535];starts=ends;deltas=[(i-c)&65535 for c,i in mapping]+[1];seg=len(ends);power=2**int(math.log2(seg));sub=u16(4,16+8*seg,0,seg*2,power*2,int(math.log2(power)),seg*2-power*2)+u16(*ends)+u16(0)+u16(*starts)+u16(*deltas)+u16(*([0]*seg));tables['cmap']=u16(0,1,3,1)+u32(12)+sub
names={1:'Polyverse Display',2:'Regular',3:'PolyverseDisplay-1.0',4:'Polyverse Display',5:'Version 1.0',6:'PolyverseDisplay',0:'Original procedural lettering. CC0 1.0.'};records=b'';strings=b''
for key,v in names.items():b=v.encode('utf-16-be');records+=u16(3,1,0x409,key,len(b),len(strings));strings+=b
tables['name']=u16(0,len(names),6+12*len(names))+records+strings
tables['post']=u32(0x30000,0)+i16(-100,50)+u32(1,0,0,0,0)
# OS/2 v0.
tables['OS/2']=u16(0)+i16(700)+u16(400,5,0)+i16(650,600,0,75,650,600,0,350,50,300,0)+bytes(10)+u32(1,0,0,0)+b'PLYV'+u16(64,32,122)+i16(800,-200,0)+u16(850,250)
checksum=lambda b:sum(struct.unpack('>'+str((len(b)+3)//4)+'I',b+b'\0'*((-len(b))%4)))&0xffffffff
num=len(tables);power=2**int(math.log2(num));header=u32(0x10000)+u16(num,power*16,int(math.log2(power)),num*16-power*16);directory=b'';data=b'';offset=12+16*num;head_offset=0
for tag,v in sorted(tables.items()):
 directory+=tag.encode()+u32(checksum(v),offset,len(v))
 if tag=='head':head_offset=offset
 v+=b'\0'*((-len(v))%4);data+=v;offset+=len(v)
font=bytearray(header+directory+data);adjustment=(0xb1b0afba-checksum(font))&0xffffffff;font[head_offset+8:head_offset+12]=u32(adjustment)
P.mkdir(exist_ok=True,parents=True);(P/'polyverse-display.ttf').write_bytes(font)
print('Generated original display font:',len(font),'bytes')
