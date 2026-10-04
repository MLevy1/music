import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  WORLD_SIZES_MM,SNAP_SIZES_MM,PALETTE_64,formatDistance,snapFloor,snapRound,makeProject,normalizeProject,
  makeCell,makeSolidFill,makeSurfaceFill,primitiveAabb,primitiveCenter,primitiveMaxExtent,primitiveDimensions,
  candidateFromPoint,translatePrimitive,subtractPrimitive,aabbIntersects,SparseOctree,estimatedJsonBytes,bytesLabel,projectBounds
} from './model.mjs';
import { saveAutosave,loadAutosave,clearAutosave } from './store.mjs';

const $ = id => document.getElementById(id);
const canvas=$('scene-canvas'), viewport=$('viewport'), statusEl=$('status');
const MAX_VISIBLE=120000;
const GRID_CELLS=16;
const unitBox=new THREE.BoxGeometry(1,1,1);
let project=normalizeProject((await safeLoad()) || makeProject());
let selectedId=null, tool='select', fillAnchor=null, rectAnchor=null, contextMode='scene';
let renderOriginMm=[0,0,0], octree=null, visibleIds=[];
let autosaveTimer=null, pointerStart=null;

const scene=new THREE.Scene(); scene.background=new THREE.Color('#0b0e12');
const camera=new THREE.PerspectiveCamera(50,1,0.00005,100000);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
const controls=new OrbitControls(camera,canvas); controls.enableDamping=true; controls.dampingFactor=.08; controls.screenSpacePanning=true; controls.zoomToCursor=true;
controls.touches.ONE=THREE.TOUCH.ROTATE; controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
const ambient=new THREE.HemisphereLight(0xdde7ff,0x333843,2.1); scene.add(ambient);
const sun=new THREE.DirectionalLight(0xffffff,2.5); sun.position.set(5,8,10); scene.add(sun);
const geometryRoot=new THREE.Group(), gridRoot=new THREE.Group(), helperRoot=new THREE.Group(); scene.add(geometryRoot,gridRoot,helperRoot);
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();

initUi();
rebuildAll();
homeView();
resize();
new ResizeObserver(resize).observe(viewport);
requestAnimationFrame(loop);
setStatus('Ready · sparse geometry autosaves on this device');

function initUi(){
  for(const mm of WORLD_SIZES_MM){const o=document.createElement('option');o.value=mm;o.textContent=formatDistance(mm);$('world-size').append(o);}
  for(const mm of SNAP_SIZES_MM){const o=document.createElement('option');o.value=mm;o.textContent=formatDistance(mm);$('snap-size').append(o);}
  syncUiFromProject(); buildPalette();
  document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  document.querySelectorAll('[data-plane]').forEach(b=>b.addEventListener('click',()=>setPlane(b.dataset.plane)));
  $('world-size').addEventListener('change',changeWorldSize); $('snap-size').addEventListener('change',e=>{project.snapMm=+e.target.value;syncNavigator();changed(false);});
  $('plane-offset').addEventListener('change',()=>{project.planeOffsetMm=clampPlaneOffset(Math.round(+$('plane-offset').value||0));$('plane-offset').value=project.planeOffsetMm;changed(false);});
  $('offset-minus').addEventListener('click',()=>shiftPlane(-project.snapMm)); $('offset-plus').addEventListener('click',()=>shiftPlane(project.snapMm));
  $('surface-thickness').addEventListener('change',()=>{project.surfaceThicknessMm=Math.max(1,Math.round(+$('surface-thickness').value||1));changed(false);});
  $('fill-kind').addEventListener('change',()=>{project.fillKind=$('fill-kind').value;changed(false);});
  $('context-mode').addEventListener('change',()=>{contextMode=$('context-mode').value;rebuildGeometry();rebuildHelpers();});
  $('home-view').addEventListener('click',homeView); $('focus-view').addEventListener('click',focusSelection);
  $('save-json').addEventListener('click',exportJson); $('load-json').addEventListener('change',importJson); $('new-project').addEventListener('click',newProject);
  $('delete-selected').addEventListener('click',deleteSelected); $('duplicate-selected').addEventListener('click',duplicateSelected); $('apply-coords').addEventListener('click',applyCoordinates);
  $('coord-unit').addEventListener('change',syncNavigator);
  $('go-to-point').addEventListener('click',goToPoint);
  $('plane-to-cursor').addEventListener('click',planeToCursor);
  $('rectangle-start').addEventListener('click',setRectangleStart);
  $('rectangle-create').addEventListener('click',createRectangleToCursor);
  canvas.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};});
  canvas.addEventListener('pointerup',e=>{if(pointerStart&&pointerStart.id===e.pointerId&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<8)handleTap(e);pointerStart=null;});
  canvas.addEventListener('pointercancel',()=>pointerStart=null);
  for(const evt of ['gesturestart','gesturechange','gestureend']) canvas.addEventListener(evt,e=>e.preventDefault(),{passive:false});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('dblclick',e=>{e.preventDefault();if(selectedId)focusSelection();});
}

function buildPalette(){
  const root=$('palette'); root.innerHTML='';
  PALETTE_64.forEach((hex,i)=>{const b=document.createElement('button');b.className='swatch';b.style.background=hex;b.title=`Color ${i+1} · ${hex}`;b.setAttribute('aria-label',`Color ${i+1}`);b.addEventListener('click',()=>{project.selectedColor=i;syncPalette();changed(false);});root.append(b);}); syncPalette();
}
function syncPalette(){document.querySelectorAll('.swatch').forEach((b,i)=>b.classList.toggle('active',i===project.selectedColor));$('color-number').textContent=`${project.selectedColor+1} / 64`;}
function syncUiFromProject(){
  $('world-size').value=project.worldSizeMm; $('snap-size').value=project.snapMm; $('plane-offset').value=project.planeOffsetMm; $('surface-thickness').value=project.surfaceThicknessMm; $('fill-kind').value=project.fillKind;
  document.querySelectorAll('[data-plane]').forEach(b=>b.classList.toggle('active',b.dataset.plane===project.plane));
  syncNavigator(); updateReadout();
}
function setTool(next){tool=next;fillAnchor=null;$('fill-note').hidden=true;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));updateReadout();rebuildHelpers();}
function setPlane(p){project.plane=p;fillAnchor=null;$('fill-note').hidden=true;syncUiFromProject();changed(false);}
function clampPlaneOffset(v){const h=project.worldSizeMm/2;return Math.max(-h,Math.min(h,Math.round(v)));}
function shiftPlane(d){project.planeOffsetMm=clampPlaneOffset(project.planeOffsetMm+d);$('plane-offset').value=project.planeOffsetMm;changed(false);}
function updateReadout(){
  $('tool-readout').textContent=({select:'Select',block:'Block',surface:'Surface',fill:'Fill',paint:'Paint',erase:'Erase'})[tool];
  $('scale-readout').textContent=`Cell / edit step: ${formatDistance(project.snapMm)}`;
  const gridSpan=Math.min(project.worldSizeMm,project.snapMm*GRID_CELLS);
  const gridCells=Math.max(1,Math.min(GRID_CELLS,Math.floor(project.worldSizeMm/project.snapMm)));
  $('grid-readout').textContent=`Edit grid: ${gridCells} × ${gridCells} · ${formatDistance(project.snapMm)} cells · ${formatDistance(gridSpan)} across`;
  const h=project.worldSizeMm/2;
  $('world-readout').textContent=`World: −${formatDistance(h)} → +${formatDistance(h)} on X/Y/Z`;
  const p=findPrimitive(selectedId);
  const size=$('selection-size-readout');
  if(p){const d=primitiveDimensions(p);size.hidden=false;size.textContent=`Selected: ${d.map(formatDistance).join(' × ')}`;}else size.hidden=true;
}

function changed(geometry=true){project.updatedAt=new Date().toISOString();if(geometry){rebuildAll();}else{rebuildGrid();rebuildHelpers();updateStats();}scheduleSave();}
function rebuildAll(){rebuildIndex();rebuildGeometry();rebuildGrid();rebuildHelpers();updateSelectionUi();updateStats();}
function rebuildIndex(){octree=new SparseOctree(project.worldSizeMm);for(const p of project.primitives)octree.insert(p.id,primitiveAabb(p));}

function idsForContext(){
  if(contextMode==='scene')return project.primitives.map(p=>p.id);
  const p=findPrimitive(selectedId), c=p?primitiveCenter(p):(project.cursorMm||[0,0,0]);
  const factor=+contextMode, r=Math.max(p?primitiveMaxExtent(p):project.snapMm,project.snapMm)*factor;
  return octree.query({min:[c[0]-r,c[1]-r,c[2]-r],max:[c[0]+r,c[1]+r,c[2]+r]});
}

function rebuildGeometry(){
  clearGroup(geometryRoot,false); visibleIds=idsForContext().slice(0,MAX_VISIBLE); const wanted=new Set(visibleIds); const groups=new Map();
  for(const p of project.primitives){if(!wanted.has(p.id))continue;const dims=p.type==='cell'?[p.size,p.size,p.size]:[p.sx,p.sy,p.sz];const key=`${dims.join(',')}|${p.color}|${p.type==='box'?p.kind:'cell'}`;if(!groups.has(key))groups.set(key,{dims,color:p.color,kind:p.kind||'cell',items:[]});groups.get(key).items.push(p);}
  for(const g of groups.values()){
    const mat=new THREE.MeshStandardMaterial({color:PALETTE_64[g.color],roughness:.82,metalness:0,transparent:g.kind==='surface',opacity:g.kind==='surface'?.94:1});
    const mesh=new THREE.InstancedMesh(unitBox,mat,g.items.length);mesh.userData.ids=[];const m=new THREE.Matrix4(),pos=new THREE.Vector3(),scale=new THREE.Vector3(g.dims[0]/1000,g.dims[1]/1000,g.dims[2]/1000),q=new THREE.Quaternion();
    g.items.forEach((p,i)=>{const c=primitiveCenter(p);pos.set((c[0]-renderOriginMm[0])/1000,(c[1]-renderOriginMm[1])/1000,(c[2]-renderOriginMm[2])/1000);m.compose(pos,q,scale);mesh.setMatrixAt(i,m);mesh.userData.ids[i]=p.id;});mesh.instanceMatrix.needsUpdate=true;geometryRoot.add(mesh);
  }
}

function rebuildGrid(){
  clearGroup(gridRoot,true);
  const snap=project.snapMm, h=project.worldSizeMm/2;
  const center=project.cursorMm || [0,0,0];
  const span=Math.min(project.worldSizeMm,snap*GRID_CELLS);
  const axisWindow=(value)=>{
    if(span>=project.worldSizeMm)return [-h,h];
    let start=snapFloor(value,snap)-Math.floor(GRID_CELLS/2)*snap;
    let finish=start+GRID_CELLS*snap;
    if(start<-h){finish+=(-h-start);start=-h;}
    if(finish>h){start-=(finish-h);finish=h;}
    return [Math.max(-h,start),Math.min(h,finish)];
  };
  const wx=axisWindow(center[0]), wy=axisWindow(center[1]), wz=axisWindow(center[2]);
  const major=[], minor=[], border=[];
  const pushGrid=(axisA,axisB,fixed,rangeA,rangeB,makePoint)=>{
    let idx=0;
    for(let v=rangeA[0];v<=rangeA[1]+0.1;v+=snap,idx++){
      const arr=idx%4===0?major:minor;
      line(arr,makePoint(v,rangeB[0],fixed),makePoint(v,rangeB[1],fixed));
    }
    idx=0;
    for(let v=rangeB[0];v<=rangeB[1]+0.1;v+=snap,idx++){
      const arr=idx%4===0?major:minor;
      line(arr,makePoint(rangeA[0],v,fixed),makePoint(rangeA[1],v,fixed));
    }
    line(border,makePoint(rangeA[0],rangeB[0],fixed),makePoint(rangeA[1],rangeB[0],fixed));
    line(border,makePoint(rangeA[1],rangeB[0],fixed),makePoint(rangeA[1],rangeB[1],fixed));
    line(border,makePoint(rangeA[1],rangeB[1],fixed),makePoint(rangeA[0],rangeB[1],fixed));
    line(border,makePoint(rangeA[0],rangeB[1],fixed),makePoint(rangeA[0],rangeB[0],fixed));
  };
  if(project.plane==='XY')pushGrid(0,1,project.planeOffsetMm,wx,wy,(a,b,f)=>[a,b,f]);
  else if(project.plane==='XZ')pushGrid(0,2,project.planeOffsetMm,wx,wz,(a,b,f)=>[a,f,b]);
  else pushGrid(1,2,project.planeOffsetMm,wy,wz,(a,b,f)=>[f,a,b]);
  addLines(minor,0x303844,.34); addLines(major,0x708399,.58); addLines(border,0x9fc6e8,.9);
  updateReadout();
}
function line(arr,a,b){arr.push(...toRender(a),...toRender(b));}
function addLines(pos,color,opacity){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity});gridRoot.add(new THREE.LineSegments(geo,mat));}
function toRender(p){return [(p[0]-renderOriginMm[0])/1000,(p[1]-renderOriginMm[1])/1000,(p[2]-renderOriginMm[2])/1000];}

function rebuildHelpers(){
  clearGroup(helperRoot,true);
  const p=findPrimitive(selectedId); if(p) helperRoot.add(wireForBounds(primitiveAabb(p),0xffdf69));
  const c=project.cursorMm||[0,0,0], s=project.snapMm;
  const cursorBox={min:[c[0],c[1],c[2]],max:[c[0]+s,c[1]+s,c[2]+s]};
  const cursorWire=wireForBounds(cursorBox,0x7cc4ff); cursorWire.material.opacity=.78; helperRoot.add(cursorWire);
  if(fillAnchor){const [x,y,z]=fillAnchor;helperRoot.add(wireForBounds({min:[x,y,z],max:[x+s,y+s,z+s]},0x66e0b4));}
  if(rectAnchor){const [x,y,z]=rectAnchor;helperRoot.add(wireForBounds({min:[x,y,z],max:[x+s,y+s,z+s]},0xc89cff));}
  addWorldWire();
}
function wireForBounds(b,color){const min=new THREE.Vector3(...toRender(b.min)),max=new THREE.Vector3(...toRender(b.max));const box=new THREE.Box3(min,max),helper=new THREE.Box3Helper(box,color);helper.material.transparent=true;helper.material.opacity=.95;return helper;}
function addWorldWire(){
  const h=project.worldSizeMm/2, box={min:[-h,-h,-h],max:[h,h,h]};
  const helper=wireForBounds(box,0x8aa0b7); helper.material.opacity=.72; helperRoot.add(helper);
  const axes=[];
  line(axes,[-h,0,0],[h,0,0]); line(axes,[0,-h,0],[0,h,0]); line(axes,[0,0,-h],[0,0,h]);
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(axes,3));
  const mat=new THREE.LineBasicMaterial({color:0x566575,transparent:true,opacity:.34}); helperRoot.add(new THREE.LineSegments(geo,mat));
}

function syncNavigator(){
  const unit=+$('coord-unit').value||1000, c=project.cursorMm||[0,0,0];
  const display=v=>Number((v/unit).toFixed(6));
  $('nav-x').value=display(c[0]); $('nav-y').value=display(c[1]); $('nav-z').value=display(c[2]);
  $('nav-snap-display').value=`${formatDistance(project.snapMm)} · ${project.snapMm.toLocaleString()} mm`;
}
function clampPointToWorld(point){const h=project.worldSizeMm/2;return point.map(v=>Math.max(-h,Math.min(h,Math.round(v))));}
function setCursor(point,{save=true}={}){
  project.cursorMm=clampPointToWorld(point); syncNavigator(); rebuildGrid(); rebuildHelpers(); updateReadout();
  if(save){project.updatedAt=new Date().toISOString();scheduleSave();}
}
function readNavigatorPoint(){
  const unit=+$('coord-unit').value||1000;
  return ['nav-x','nav-y','nav-z'].map(id=>snapRound((Number($(id).value)||0)*unit,project.snapMm));
}
function goToPoint(){setCursor(readNavigatorPoint());focusCursor();setStatus(`Cursor moved to the nearest ${formatDistance(project.snapMm)} grid point`);}
function focusCursor(){
  const c=project.cursorMm||[0,0,0];
  if($('origin-mode').value==='selection')renderOriginMm=c.map(Math.round);
  rebuildGeometry();rebuildGrid();rebuildHelpers();
  const target=new THREE.Vector3(...toRender(c));
  const span=Math.min(project.worldSizeMm,project.snapMm*GRID_CELLS)/1000;
  const d=Math.max(span*1.25,.04);
  controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(d,d*.8,d));updateCameraPlanes(d);controls.update();
}
function planeToCursor(){
  const c=project.cursorMm||[0,0,0];
  project.planeOffsetMm=clampPlaneOffset(project.plane==='XY'?c[2]:project.plane==='XZ'?c[1]:c[0]);
  $('plane-offset').value=project.planeOffsetMm;changed(false);setStatus(`Working plane moved to ${formatDistance(project.planeOffsetMm)}`);
}
function cursorOnPlane(){
  const c=(project.cursorMm||[0,0,0]).map(v=>snapFloor(v,project.snapMm));
  if(project.plane==='XY')c[2]=project.planeOffsetMm;
  else if(project.plane==='XZ')c[1]=project.planeOffsetMm;
  else c[0]=project.planeOffsetMm;
  return c;
}
function setRectangleStart(){
  const c=boundedCandidate(cursorOnPlane());if(!c)return;rectAnchor=[...c];$('rectangle-create').disabled=false;
  $('rectangle-note').textContent=`Start set at ${c.map(formatDistance).join(', ')} · move the cursor, then create to cursor.`;
  rebuildHelpers();setStatus('Rectangle start set');
}
function createRectangleToCursor(){
  if(!rectAnchor)return;const c=boundedCandidate(cursorOnPlane());if(!c)return;
  const p=project.fillKind==='surface'?makeSurfaceFill(rectAnchor,c,project.snapMm,project.plane,project.surfaceThicknessMm,project.selectedColor):makeSolidFill(rectAnchor,c,project.snapMm,project.selectedColor);
  project.primitives.push(p);rectAnchor=null;$('rectangle-create').disabled=true;$('rectangle-note').textContent='The edit grid stays centered on this cursor. Rectangle uses the current working plane, fill type, thickness, color, and snap.';
  changed(true);select(p.id);setStatus('Rectangle created as one sparse primitive');
}
function hitPointMm(hit){return [hit.hit.point.x*1000+renderOriginMm[0],hit.hit.point.y*1000+renderOriginMm[1],hit.hit.point.z*1000+renderOriginMm[2]];}
function setCursorFromHit(hit){if(!hit)return;const p=hitPointMm(hit).map(v=>snapRound(v,project.snapMm));setCursor(p);}
function eraseAtHit(hit){
  const target=findPrimitive(hit?.id);if(!target)return;
  const point=hitPointMm(hit), n=hit.hit.face?.normal?axisNormal(hit.hit.face.normal):[0,0,1];
  const inside=point.map((v,k)=>v-n[k]*project.snapMm*.51);
  const c=candidateFromPoint(inside,project.snapMm), cut={min:c,max:c.map(v=>v+project.snapMm)};
  let affected=0, generated=0;const next=[];
  for(const p of project.primitives){
    if(!aabbIntersects(primitiveAabb(p),cut)){next.push(p);continue;}
    const parts=subtractPrimitive(p,cut);
    if(parts.length===1&&parts[0]===p){next.push(p);continue;}
    affected++;generated+=parts.length;next.push(...parts);
  }
  if(!affected){setStatus('No material at that edit cell');return;}
  project.primitives=next;selectedId=null;project.cursorMm=clampPointToWorld(c);syncNavigator();changed(true);
  setStatus(`Erased ${formatDistance(project.snapMm)} edit cell · ${affected} primitive${affected===1?'':'s'} changed${generated?` · ${generated} sparse pieces remain there`:''}`);
}


function handleTap(e){
  const hit=pick(e);
  if(tool==='select'){if(hit)setCursorFromHit(hit);select(hit?.id||null);return;}
  if(tool==='erase'){if(hit?.id)eraseAtHit(hit);return;}
  if(tool==='paint'){if(hit?.id){setCursorFromHit(hit);const p=findPrimitive(hit.id);p.color=project.selectedColor;changed(true);select(hit.id);}return;}
  if(tool==='block'){const c=placementCandidate(e,false);if(c){setCursor(c);addCellAt(c);}return;}
  if(tool==='surface'){const c=placementCandidate(e,true);if(c){setCursor(c);project.primitives.push(makeSurfaceFill(c,c,project.snapMm,project.plane,project.surfaceThicknessMm,project.selectedColor));changed(true);}return;}
  if(tool==='fill'){
    const c=placementCandidate(e,true);if(!c)return;setCursor(c);
    if(!fillAnchor){fillAnchor=c;$('fill-note').hidden=false;setStatus('Fill start set · tap the opposite corner on the working plane');rebuildHelpers();return;}
    const p=project.fillKind==='surface'?makeSurfaceFill(fillAnchor,c,project.snapMm,project.plane,project.surfaceThicknessMm,project.selectedColor):makeSolidFill(fillAnchor,c,project.snapMm,project.selectedColor);
    project.primitives.push(p);fillAnchor=null;$('fill-note').hidden=true;changed(true);select(p.id);setStatus(`${project.fillKind==='surface'?'Surface patch':'One-snap solid region'} created as one primitive`);
  }
}

function pick(e){
  setPointer(e);const hits=raycaster.intersectObjects(geometryRoot.children,false);if(!hits.length)return null;const h=hits[0],id=h.object.userData.ids?.[h.instanceId];return id?{id,hit:h}:null;
}
function placementCandidate(e,planeOnly){
  setPointer(e);
  if(!planeOnly){const hits=raycaster.intersectObjects(geometryRoot.children,false);if(hits.length){const h=hits[0], n=h.face?.normal?axisNormal(h.face.normal):null;const p=[h.point.x*1000+renderOriginMm[0],h.point.y*1000+renderOriginMm[1],h.point.z*1000+renderOriginMm[2]];return boundedCandidate(candidateFromPoint(p,project.snapMm,n));}}
  const normal=project.plane==='XY'?new THREE.Vector3(0,0,1):project.plane==='XZ'?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
  const point=project.plane==='XY'?new THREE.Vector3(0,0,(project.planeOffsetMm-renderOriginMm[2])/1000):project.plane==='XZ'?new THREE.Vector3(0,(project.planeOffsetMm-renderOriginMm[1])/1000,0):new THREE.Vector3((project.planeOffsetMm-renderOriginMm[0])/1000,0,0);
  const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point), out=new THREE.Vector3();if(!raycaster.ray.intersectPlane(plane,out))return null;
  const mm=[out.x*1000+renderOriginMm[0],out.y*1000+renderOriginMm[1],out.z*1000+renderOriginMm[2]];const c=candidateFromPoint(mm,project.snapMm);if(project.plane==='XY')c[2]=project.planeOffsetMm;if(project.plane==='XZ')c[1]=project.planeOffsetMm;if(project.plane==='YZ')c[0]=project.planeOffsetMm;return boundedCandidate(c);
}
function axisNormal(n){const a=[n.x,n.y,n.z].map(v=>Math.abs(v));const k=a.indexOf(Math.max(...a));const out=[0,0,0];out[k]=Math.sign([n.x,n.y,n.z][k])||1;return out;}
function boundedCandidate(c){const h=project.worldSizeMm/2,s=project.snapMm;if(c.some((v,k)=>v<-h||v+s>h)){setStatus('That cell is outside the current world root');return null;}return c;}
function setPointer(e){const r=canvas.getBoundingClientRect();pointer.x=((e.clientX-r.left)/r.width)*2-1;pointer.y=-((e.clientY-r.top)/r.height)*2+1;raycaster.setFromCamera(pointer,camera);}
function addCellAt(c){if(project.primitives.some(p=>p.type==='cell'&&p.x===c[0]&&p.y===c[1]&&p.z===c[2]&&p.size===project.snapMm)){setStatus('A block already occupies that exact sparse cell');return;}const p=makeCell(c[0],c[1],c[2],project.snapMm,project.selectedColor);project.primitives.push(p);changed(true);select(p.id);}

function select(id){selectedId=id;$('focus-view').disabled=!id;updateSelectionUi();rebuildGeometry();rebuildGrid();rebuildHelpers();updateStats();}
function findPrimitive(id){return id?project.primitives.find(p=>p.id===id):null;}
function removePrimitive(id){project.primitives=project.primitives.filter(p=>p.id!==id);if(selectedId===id)selectedId=null;changed(true);setStatus('Deleted');}
function deleteSelected(){if(selectedId)removePrimitive(selectedId);}
function duplicateSelected(){const p=findPrimitive(selectedId);if(!p)return;const q=translatePrimitive(p,project.snapMm,0,0);project.primitives.push(q);changed(true);select(q.id);setStatus(`Duplicated +${formatDistance(project.snapMm)} on X`);}
function applyCoordinates(){const p=findPrimitive(selectedId);if(!p)return;p.x=Math.round(+$('sel-x').value||0);p.y=Math.round(+$('sel-y').value||0);p.z=Math.round(+$('sel-z').value||0);changed(true);select(p.id);}
function updateSelectionUi(){const p=findPrimitive(selectedId);$('selection-empty').hidden=!!p;$('selection-controls').hidden=!p;$('selection-kind').textContent=p?(p.type==='cell'?'cell':p.kind):'none';if(p){$('sel-x').value=p.x;$('sel-y').value=p.y;$('sel-z').value=p.z;$('focus-view').disabled=false;}else $('focus-view').disabled=true;}

function focusSelection(){
  const p=findPrimitive(selectedId);if(!p)return;const c=primitiveCenter(p),extent=Math.max(primitiveMaxExtent(p),project.snapMm);if($('origin-mode').value==='selection')renderOriginMm=c.map(v=>Math.round(v));rebuildGeometry();rebuildGrid();rebuildHelpers();const target=new THREE.Vector3(...toRender(c));const d=Math.max(extent/1000*3.2,.15);controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(d,d*.8,d));updateCameraPlanes(d);controls.update();setStatus('Focused · renderer recentered for local precision');}
function homeView(){renderOriginMm=[0,0,0];rebuildGeometry();rebuildGrid();rebuildHelpers();const size=project.worldSizeMm/1000,d=Math.max(size*.8,2);controls.target.set(0,0,0);camera.position.set(d,d*.65,d);updateCameraPlanes(d);controls.update();}
function updateCameraPlanes(d){camera.near=Math.max(.00002,d/100000);camera.far=Math.max(100,project.worldSizeMm/1000*6,d*20);camera.updateProjectionMatrix();}

function changeWorldSize(e){const old=project.worldSizeMm,next=+e.target.value,b=projectBounds(project);if(b){const h=next/2;const outside=b.min.some(v=>v<-h)||b.max.some(v=>v>h);if(outside&&!confirm('Some geometry lies outside that smaller world root. Shrink the world anyway?')){e.target.value=old;return;}}project.worldSizeMm=next;project.cursorMm=clampPointToWorld(project.cursorMm||[0,0,0]);project.planeOffsetMm=clampPlaneOffset(project.planeOffsetMm);$('plane-offset').value=project.planeOffsetMm;syncNavigator();changed(true);homeView();}

function updateStats(){const cells=project.primitives.filter(p=>p.type==='cell').length,boxes=project.primitives.length-cells,bytes=estimatedJsonBytes(project);$('stat-cells').textContent=cells.toLocaleString();$('stat-boxes').textContent=boxes.toLocaleString();$('stat-bytes').textContent=bytesLabel(bytes);$('stat-visible').textContent=`${Math.min(visibleIds.length,MAX_VISIBLE).toLocaleString()}${visibleIds.length>MAX_VISIBLE?' +':''}`;$('header-stats').textContent=`${project.primitives.length.toLocaleString()} primitives · ${bytesLabel(bytes)} · saved locally`;
  const w=$('storage-warning');if(bytes>250*1024*1024){w.hidden=false;w.textContent='Project is above 250 MB. Mobile editing may become unreliable; simplify or split the project.';}else if(bytes>100*1024*1024){w.hidden=false;w.textContent='Project is above 100 MB. This is the warning zone for iPhone/iPad use.';}else if(bytes>20*1024*1024){w.hidden=false;w.textContent='Large mobile project: still usable, but keep an eye on visible geometry and export size.';}else w.hidden=true;
}

function scheduleSave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(async()=>{try{await saveAutosave(project);$('header-stats').textContent=$('header-stats').textContent.replace(/saved locally|saving…/,'saved locally');}catch(e){setStatus('Autosave failed · export JSON as a backup');}},350);$('header-stats').textContent=$('header-stats').textContent.replace(/saved locally/,'saving…');}
async function safeLoad(){try{return await loadAutosave();}catch{return null;}}
async function newProject(){if(project.primitives.length&&!confirm('Start a new sparse project? Export JSON first if you want a backup.'))return;await clearAutosave().catch(()=>{});project=makeProject();selectedId=null;fillAnchor=null;rectAnchor=null;renderOriginMm=[0,0,0];syncUiFromProject();syncPalette();setTool('select');rebuildAll();homeView();scheduleSave();}
function exportJson(){const text=JSON.stringify(project,null,2),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`block64-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);setStatus(`Exported ${bytesLabel(new TextEncoder().encode(text).length)}`);}
async function importJson(e){const f=e.target.files?.[0];if(!f)return;try{const raw=JSON.parse(await f.text());project=normalizeProject(raw);selectedId=null;fillAnchor=null;rectAnchor=null;renderOriginMm=[0,0,0];syncUiFromProject();syncPalette();rebuildAll();homeView();scheduleSave();setStatus(`Loaded ${f.name}`);}catch(err){alert('Could not load this project JSON.');}finally{e.target.value='';}}

function setStatus(msg){statusEl.textContent=msg;}
function resize(){const r=viewport.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
function loop(){controls.update();renderer.render(scene,camera);requestAnimationFrame(loop);}
function clearGroup(group,disposeGeo){while(group.children.length){const o=group.children.pop();if(disposeGeo)o.geometry?.dispose?.();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material.dispose?.();}}}
