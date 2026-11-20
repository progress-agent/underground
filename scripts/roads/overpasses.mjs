// OSM layer supplies ordering, not elevation. Only a source-mapped road crossing
// needs the highway clearance fallback; canal/rail chords and curated decks stay as before.
export function roadOverpassConstraints(roads, ground) {
  const cells=new Map(), cell=200, out=new Map();
  for(const r of roads)if(!r.bridge&&!r.tunnel)for(let i=1;i<r.p.length;i++){
    const a=r.p[i-1],b=r.p[i];
    for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
      for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({r,a,b});
      }
  }
  for(const r of roads)if(r.bridge&&!r.tunnel){
    const lengths=[0];for(let i=1;i<r.p.length;i++)lengths.push(lengths.at(-1)+Math.hypot(r.p[i][0]-r.p[i-1][0],r.p[i][1]-r.p[i-1][1]));
    const total=lengths.at(-1),hits=[];
    if(!total)continue;
    for(let i=1;i<r.p.length;i++){
      const a=r.p[i-1],b=r.p[i],dx=b[0]-a[0],dz=b[1]-a[1],seen=new Set();
      for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
        for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++)
          for(const s of cells.get(x+','+z)??[]){
            if(seen.has(s)||s.r.layer>=r.layer)continue;seen.add(s);
            const ex=s.b[0]-s.a[0],ez=s.b[1]-s.a[1],den=dx*ez-dz*ex;
            if(Math.abs(den)<1e-8)continue;
            const ax=s.a[0]-a[0],az=s.a[1]-a[1],t=(ax*ez-az*ex)/den,u=(ax*dz-az*dx)/den;
            if(t<0||t>1||u<0||u>1)continue;
            const along=(lengths[i-1]+t*(lengths[i]-lengths[i-1]))/total;
            // Shared endpoints are a landing/junction, not a grade-separated crossing.
            if(along*total<3||(1-along)*total<3)continue;
            const px=a[0]+dx*t,pz=a[1]+dz*t;
            // Informed estimate: DMRB's 5.30m headroom + 0.70m deck depth.
            hits.push({t:along,y:ground(px,pz)+6*5,lowerWay:s.r.id});
          }
    }
    if(hits.length)out.set(r,hits);
  }
  return out;
}

export function overpassDatum(t,a,b,constraints=[]) {
  const chord=a+(b-a)*t;
  const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
  let y=chord;
  for(const c of constraints){
    const extra=Math.max(0,c.y-(a+(b-a)*c.t));
    const ramp=Math.min(smooth(t/c.t),smooth((1-t)/(1-c.t)));
    y=Math.max(y,chord+extra*ramp);
  }
  return y;
}
