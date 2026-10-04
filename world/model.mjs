export const VERSION = 2;
export const MM = 1;
export const M = 1000;

export const WORLD_SIZES_MM = [
  1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000,
  512000, 1024000, 2048000, 4096000, 8192000, 16384000
];

export const SNAP_SIZES_MM = [
  1, 5, 10, 25, 50, 100, 250, 500,
  1000, 2000, 4000, 8000, 16000, 32000, 64000,
  128000, 256000, 512000, 1024000
];

export const PALETTE_64 = [
  '#111318','#252830','#3b3f49','#555b67','#737b88','#959eaa','#bcc4cd','#eef1f4',
  '#4a1818','#712323','#982f2f','#bd3d3d','#dc5555','#ed7777','#f2a0a0','#f6c9c9',
  '#4a2a12','#71411a','#995922','#bd722c','#dc8e3c','#eda75d','#f2c184','#f6dab0',
  '#4a4110','#716319','#988522','#bda62c','#dcc53c','#edda60','#f2e787','#f6f0b2',
  '#173d24','#225d35','#2f7d49','#3d9d5d','#53ba73','#75cf8f','#9bdfad','#c5edd0',
  '#15364a','#205272','#2b709a','#378ebe','#4ba9dc','#6fc0ed','#98d3f2','#c3e5f6',
  '#25204b','#393171','#4f4498','#6456bd','#7b6cdc','#998ced','#b8aff2','#d8d3f6',
  '#451b44','#682967','#8c378a','#ae46ac','#ca5fc8','#dc80da','#e8a5e6','#f1cbed'
];

export function formatDistance(mm) {
  const a = Math.abs(mm);
  if (a >= 1_000_000) return `${trim(mm / 1_000_000)} km`;
  if (a >= 1000) return `${trim(mm / 1000)} m`;
  if (a >= 10) return `${trim(mm / 10)} cm`;
  return `${trim(mm)} mm`;
}

function trim(n) {
  return Number(n.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function snapFloor(valueMm, snapMm) {
  return Math.floor(valueMm / snapMm) * snapMm;
}

export function snapRound(valueMm, snapMm) {
  return Math.round(valueMm / snapMm) * snapMm;
}

export function makeId(prefix = 'g') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function makeCell(x, y, z, size, color = 0) {
  return { id: makeId('c'), type: 'cell', x: i(x), y: i(y), z: i(z), size: pos(size), color: colorIndex(color) };
}

export function makeBox(x, y, z, sx, sy, sz, color = 0, kind = 'solid') {
  return {
    id: makeId('b'), type: 'box', kind,
    x: i(x), y: i(y), z: i(z), sx: pos(sx), sy: pos(sy), sz: pos(sz), color: colorIndex(color)
  };
}

export function primitiveDimensions(p) {
  if (p.type === 'cell') return [p.size,p.size,p.size];
  return [p.sx,p.sy,p.sz];
}

export function primitiveVolume(p) {
  const [sx,sy,sz]=primitiveDimensions(p);
  return sx*sy*sz;
}

export function subtractPrimitive(p, cutBounds) {
  const source=primitiveAabb(p);
  const cut={
    min:[0,1,2].map(k=>Math.max(source.min[k],Math.round(cutBounds.min[k]))),
    max:[0,1,2].map(k=>Math.min(source.max[k],Math.round(cutBounds.max[k])))
  };
  if (cut.min.some((v,k)=>v>=cut.max[k])) return [p];
  if (cut.min.every((v,k)=>v<=source.min[k]) && cut.max.every((v,k)=>v>=source.max[k])) return [];

  const out=[];
  const color=p.color, kind=p.type==='box'?p.kind:'solid';
  const add=(x0,y0,z0,x1,y1,z1)=>{
    if(x1>x0&&y1>y0&&z1>z0) out.push(makeBox(x0,y0,z0,x1-x0,y1-y0,z1-z0,color,kind));
  };
  // Six non-overlapping slabs around the intersection. This keeps subtraction sparse:
  // one small cut turns one large box into at most six boxes, never millions of cells.
  add(source.min[0],source.min[1],source.min[2],cut.min[0],source.max[1],source.max[2]);
  add(cut.max[0],source.min[1],source.min[2],source.max[0],source.max[1],source.max[2]);
  const x0=Math.max(source.min[0],cut.min[0]), x1=Math.min(source.max[0],cut.max[0]);
  add(x0,source.min[1],source.min[2],x1,cut.min[1],source.max[2]);
  add(x0,cut.max[1],source.min[2],x1,source.max[1],source.max[2]);
  const y0=Math.max(source.min[1],cut.min[1]), y1=Math.min(source.max[1],cut.max[1]);
  add(x0,y0,source.min[2],x1,y1,cut.min[2]);
  add(x0,y0,cut.max[2],x1,y1,source.max[2]);
  return out;
}

export function primitiveAabb(p) {
  if (p.type === 'cell') return { min: [p.x,p.y,p.z], max: [p.x+p.size,p.y+p.size,p.z+p.size] };
  return { min: [p.x,p.y,p.z], max: [p.x+p.sx,p.y+p.sy,p.z+p.sz] };
}

export function primitiveCenter(p) {
  const b = primitiveAabb(p);
  return [(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];
}

export function primitiveMaxExtent(p) {
  if (p.type === 'cell') return p.size;
  return Math.max(p.sx,p.sy,p.sz);
}

export function candidateFromPoint(pointMm, snapMm, normal = null) {
  const p = [...pointMm];
  if (normal) {
    const eps = snapMm * 0.51;
    p[0] += normal[0] * eps;
    p[1] += normal[1] * eps;
    p[2] += normal[2] * eps;
  }
  return [snapFloor(p[0], snapMm), snapFloor(p[1], snapMm), snapFloor(p[2], snapMm)];
}

export function makeSolidFill(a, b, snapMm, color) {
  const min = [0,1,2].map(k => Math.min(a[k], b[k]));
  const max = [0,1,2].map(k => Math.max(a[k], b[k]) + snapMm);
  return makeBox(min[0], min[1], min[2], max[0]-min[0], max[1]-min[1], max[2]-min[2], color, 'solid');
}

export function makeSurfaceFill(a, b, snapMm, plane, thicknessMm, color) {
  const t = pos(thicknessMm);
  if (plane === 'XY') {
    const x0=Math.min(a[0],b[0]), x1=Math.max(a[0],b[0])+snapMm;
    const y0=Math.min(a[1],b[1]), y1=Math.max(a[1],b[1])+snapMm;
    const z=snapRound((a[2]+b[2])/2, 1);
    return makeBox(x0,y0,z,x1-x0,y1-y0,t,color,'surface');
  }
  if (plane === 'XZ') {
    const x0=Math.min(a[0],b[0]), x1=Math.max(a[0],b[0])+snapMm;
    const z0=Math.min(a[2],b[2]), z1=Math.max(a[2],b[2])+snapMm;
    const y=snapRound((a[1]+b[1])/2, 1);
    return makeBox(x0,y,z0,x1-x0,t,z1-z0,color,'surface');
  }
  const y0=Math.min(a[1],b[1]), y1=Math.max(a[1],b[1])+snapMm;
  const z0=Math.min(a[2],b[2]), z1=Math.max(a[2],b[2])+snapMm;
  const x=snapRound((a[0]+b[0])/2, 1);
  return makeBox(x,y0,z0,t,y1-y0,z1-z0,color,'surface');
}

export function translatePrimitive(p, dx, dy, dz) {
  return { ...p, id: makeId(p.type === 'cell' ? 'c' : 'b'), x:i(p.x+dx), y:i(p.y+dy), z:i(p.z+dz) };
}

export function projectBounds(project) {
  if (!project.primitives.length) return null;
  const first = primitiveAabb(project.primitives[0]);
  const out = { min:[...first.min], max:[...first.max] };
  for (let n=1;n<project.primitives.length;n++) {
    const b=primitiveAabb(project.primitives[n]);
    for (let k=0;k<3;k++) { out.min[k]=Math.min(out.min[k],b.min[k]); out.max[k]=Math.max(out.max[k],b.max[k]); }
  }
  return out;
}

export function makeProject(name='Untitled sparse world') {
  return {
    version: VERSION,
    name,
    worldSizeMm: 16000,
    snapMm: 100,
    plane: 'XY',
    planeOffsetMm: 0,
    surfaceThicknessMm: 1,
    fillKind: 'surface',
    selectedColor: 37,
    cursorMm: [0,0,0],
    primitives: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function normalizeProject(raw) {
  const p = { ...makeProject(), ...(raw || {}) };
  p.version = VERSION;
  p.worldSizeMm = nearestAllowed(p.worldSizeMm, WORLD_SIZES_MM, 16000);
  p.snapMm = nearestAllowed(p.snapMm, SNAP_SIZES_MM, 100);
  p.plane = ['XY','XZ','YZ'].includes(p.plane) ? p.plane : 'XY';
  p.planeOffsetMm = i(p.planeOffsetMm || 0);
  p.surfaceThicknessMm = pos(p.surfaceThicknessMm || 1);
  p.fillKind = p.fillKind === 'solid' ? 'solid' : 'surface';
  p.selectedColor = colorIndex(p.selectedColor);
  p.cursorMm = Array.isArray(p.cursorMm) && p.cursorMm.length===3 ? p.cursorMm.map(i) : [0,0,0];
  p.primitives = Array.isArray(p.primitives) ? p.primitives.map(normalizePrimitive).filter(Boolean) : [];
  return p;
}

function normalizePrimitive(p) {
  if (!p || !p.id || !['cell','box'].includes(p.type)) return null;
  if (p.type === 'cell') return { id:String(p.id), type:'cell', x:i(p.x),y:i(p.y),z:i(p.z),size:pos(p.size),color:colorIndex(p.color) };
  return { id:String(p.id), type:'box', kind:p.kind==='surface'?'surface':'solid', x:i(p.x),y:i(p.y),z:i(p.z),sx:pos(p.sx),sy:pos(p.sy),sz:pos(p.sz),color:colorIndex(p.color) };
}

export function estimatedJsonBytes(project) {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

export function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024**2) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024**2).toFixed(1)} MB`;
}

export function aabbIntersects(a,b) {
  return !(a.max[0] < b.min[0] || a.min[0] > b.max[0] || a.max[1] < b.min[1] || a.min[1] > b.max[1] || a.max[2] < b.min[2] || a.min[2] > b.max[2]);
}

export class SparseOctree {
  constructor(worldSizeMm, capacity=20, maxDepth=24) {
    const h=worldSizeMm/2;
    this.capacity=capacity; this.maxDepth=maxDepth;
    this.root = node([-h,-h,-h],[h,h,h],0);
  }
  insert(id, bounds) { return insertNode(this.root,{id,bounds},this.capacity,this.maxDepth); }
  query(bounds) { const out=[]; queryNode(this.root,bounds,out); return out; }
}

function node(min,max,depth) { return {min,max,depth,items:[],children:null}; }
function nodeBounds(n){return {min:n.min,max:n.max};}
function contains(outer,inner){return inner.min.every((v,k)=>v>=outer.min[k]) && inner.max.every((v,k)=>v<=outer.max[k]);}
function insertNode(n,item,cap,maxDepth){
  if (!aabbIntersects(nodeBounds(n),item.bounds)) return false;
  if (n.children) {
    for (const c of n.children) if (contains(nodeBounds(c),item.bounds)) return insertNode(c,item,cap,maxDepth);
  }
  n.items.push(item);
  if (!n.children && n.items.length>cap && n.depth<maxDepth) subdivide(n,cap,maxDepth);
  return true;
}
function subdivide(n,cap,maxDepth){
  const mid=[0,1,2].map(k=>(n.min[k]+n.max[k])/2); n.children=[];
  for(let ix=0;ix<2;ix++)for(let iy=0;iy<2;iy++)for(let iz=0;iz<2;iz++){
    const min=[ix?mid[0]:n.min[0],iy?mid[1]:n.min[1],iz?mid[2]:n.min[2]];
    const max=[ix?n.max[0]:mid[0],iy?n.max[1]:mid[1],iz?n.max[2]:mid[2]];
    n.children.push(node(min,max,n.depth+1));
  }
  const old=n.items; n.items=[];
  for(const item of old){let placed=false; for(const c of n.children){if(contains(nodeBounds(c),item.bounds)){insertNode(c,item,cap,maxDepth);placed=true;break;}} if(!placed)n.items.push(item);}
}
function queryNode(n,bounds,out){
  if(!aabbIntersects(nodeBounds(n),bounds))return;
  for(const item of n.items)if(aabbIntersects(item.bounds,bounds))out.push(item.id);
  if(n.children)for(const c of n.children)queryNode(c,bounds,out);
}

function nearestAllowed(v, arr, fallback){
  v=Number(v); if(!Number.isFinite(v))return fallback;
  return arr.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a,arr[0]);
}
function i(v){ v=Math.round(Number(v)||0); return Number.isSafeInteger(v)?v:0; }
function pos(v){ v=Math.round(Number(v)||0); return Math.max(1,v); }
function colorIndex(v){ return Math.max(0,Math.min(63,Math.round(Number(v)||0))); }
