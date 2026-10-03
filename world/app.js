import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  WORLD_SIZES_MM,SNAP_SIZES_MM,PALETTE_64,formatDistance,makeProject,normalizeProject,
  makeCell,makeSolidFill,makeSurfaceFill,primitiveAabb,primitiveCenter,primitiveMaxExtent,
  candidateFromPoint,translatePrimitive,SparseOctree,estimatedJsonBytes,bytesLabel,projectBounds
} from './model.mjs';
import { saveAutosave,loadAutosave,clearAutosave } from './store.mjs';

const $ = id => document.getElementById(id);
const canvas=$('scene-canvas'), viewport=$('viewport'), statusEl=$('status');
const MAX_VISIBLE=120000;
const unitBox=new THREE.BoxGeometry(1,1,1);
let project=normalizeProject((await safeLoad()) || makeProject());
let selectedId=null, tool='select', fillAnchor=null, contextMode='scene';
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
  $('world-size').addEventListener('change',changeWorldSize); $('snap-size').addEventListener('change',e=>{project.snapMm=+e.target.value;changed(false);});
  $('plane-offset').addEventListener('change',()=>{project.planeOffsetMm=Math.round(+$('plane-offset').value||0);changed(false);});
  $('offset-minus').addEventListener('click',()=>shiftPlane(-project.snapMm)); $('offset-plus').addEventListener('click',()=>shiftPlane(project.snapMm));
  $('surface-thickness').addEventListener('change',()=>{project.surfaceThicknessMm=Math.max(1,Math.round(+$('surface-thickness').value||1));changed(false);});
  $('fill-kind').addEventListener('change',()=>{project.fillKind=$('fill-kind').value;changed(false);});
  $('context-mode').addEventListener('change',()=>{contextMode=$('context-mode').value;rebuildGeometry();rebuildHelpers();});
  $('home-view').addEventListener('click',homeView); $('focus-view').addEventListener('click',focusSelection);
  $('save-json').addEventListener('click',exportJson); $('load-json').addEventListener('change',importJson); $('new-project').addEventListener('click',newProject);
  $('delete-selected').addEventListener('click',deleteSelected); $('duplicate-selected').addEventListener('click',duplicateSelected); $('apply-coords').addEventListener('click',applyCoordinates);
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
  updateReadout();
}
function setTool(next){tool=next;fillAnchor=null;$('fill-note').hidden=true;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));updateReadout();rebuildHelpers();}
function setPlane(p){project.plane=p;fillAnchor=null;$('fill-note').hidden=true;syncUiFromProject();changed(false);}
function shiftPlane(d){project.planeOffsetMm+=d;$('plane-offset').value=project.planeOffsetMm;changed(false);}
function updateReadout(){$('tool-readout').textContent=({select:'Select',block:'Block',surface:'Surface',fill:'Fill',paint:'Paint',erase:'Erase'})[tool];$('scale-readout').textContent=`${formatDistance(project.snapMm)} snap`;}

function changed(geometry=true){project.updatedAt=new Date().toISOString();if(geometry){rebuildAll();}else{rebuildGrid();updateStats();}scheduleSave();}
function rebuildAll(){rebuildIndex();rebuildGeometry();rebuildGrid();rebuildHelpers();updateSelectionUi();updateStats();}
function rebuildIndex(){octree=new SparseOctree(project.worldSizeMm);for(const p of project.primitives)octree.insert(p.id,primitiveAabb(p));}

function idsForContext(){
  if(contextMode==='scene'||!selectedId)return project.primitives.map(p=>p.id);
  const p=findPrimitive(selectedId);if(!p)return project.primitives.map(p=>p.id);
  const c=primitiveCenter(p), factor=+contextMode, r=Math.max(primitiveMaxExtent(p),project.snapMm)*factor;
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
  clearGroup(gridRoot,true); const snap=project.snapMm; const center=selectedId?primitiveCenter(findPrimitive(selectedId)||{type:'cell',x:0,y:0,z:0,size:snap}):renderOriginMm; const span=snap*12; const major=[]; const minor=[];
  const a0=Math.round(center[0]/snap)*snap,a1=Math.round(center[1]/snap)*snap,a2=Math.round(center[2]/snap)*snap;
  for(let n=-12;n<=12;n++){
    const arr=n%5===0?major:minor; const d=n*snap;
    if(project.plane==='XY'){line(arr,[a0+d,a1-span,project.planeOffsetMm],[a0+d,a1+span,project.planeOffsetMm]);line(arr,[a0-span,a1+d,project.planeOffsetMm],[a0+span,a1+d,project.planeOffsetMm]);}
    else if(project.plane==='XZ'){line(arr,[a0+d,project.planeOffsetMm,a2-span],[a0+d,project.planeOffsetMm,a2+span]);line(arr,[a0-span,project.planeOffsetMm,a2+d],[a0+span,project.planeOffsetMm,a2+d]);}
    else {line(arr,[project.planeOffsetMm,a1+d,a2-span],[project.planeOffsetMm,a1+d,a2+span]);line(arr,[project.planeOffsetMm,a1-span,a2+d],[project.planeOffsetMm,a1+span,a2+d]);}
  }
  addLines(minor,0x303844,.42);addLines(major,0x5e6c7c,.62);
}
function line(arr,a,b){arr.push(...toRender(a),...toRender(b));}
function addLines(pos,color,opacity){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity});gridRoot.add(new THREE.LineSegments(geo,mat));}
function toRender(p){return [(p[0]-renderOriginMm[0])/1000,(p[1]-renderOriginMm[1])/1000,(p[2]-renderOriginMm[2])/1000];}

function rebuildHelpers(){
  clearGroup(helperRoot,true);
  const p=findPrimitive(selectedId);if(p){helperRoot.add(wireForBounds(primitiveAabb(p),0xffdf69));}
  if(fillAnchor){const [x,y,z]=fillAnchor;helperRoot.add(wireForBounds({min:[x,y,z],max:[x+project.snapMm,y+project.snapMm,z+project.snapMm]},0x7cc4ff));}
  addWorldWire();
}
function wireForBounds(b,color){const min=new THREE.Vector3(...toRender(b.min)),max=new THREE.Vector3(...toRender(b.max));const box=new THREE.Box3(min,max),helper=new THREE.Box3Helper(box,color);helper.material.transparent=true;helper.material.opacity=.95;return helper;}
function addWorldWire(){const h=project.worldSizeMm/2;const box={min:[-h,-h,-h],max:[h,h,h]};const helper=wireForBounds(box,0x313844);helper.material.opacity=.22;helperRoot.add(helper);}

function handleTap(e){
  const hit=pick(e); if(tool==='select'){select(hit?.id||null);return;} if(tool==='erase'){if(hit?.id)removePrimitive(hit.id);return;} if(tool==='paint'){if(hit?.id){const p=findPrimitive(hit.id);p.color=project.selectedColor;changed(true);select(hit.id);}return;}
  if(tool==='block'){const c=placementCandidate(e,false);if(c)addCellAt(c);return;}
  if(tool==='surface'){const c=placementCandidate(e,true);if(c){project.primitives.push(makeSurfaceFill(c,c,project.snapMm,project.plane,project.surfaceThicknessMm,project.selectedColor));changed(true);}return;}
  if(tool==='fill'){const c=placementCandidate(e,true);if(!c)return;if(!fillAnchor){fillAnchor=c;$('fill-note').hidden=false;setStatus('Fill start set · tap the opposite corner on the working plane');rebuildHelpers();return;}const p=project.fillKind==='surface'?makeSurfaceFill(fillAnchor,c,project.snapMm,project.plane,project.surfaceThicknessMm,project.selectedColor):makeSolidFill(fillAnchor,c,project.snapMm,project.selectedColor);project.primitives.push(p);fillAnchor=null;$('fill-note').hidden=true;changed(true);select(p.id);setStatus(`${project.fillKind==='surface'?'Surface patch':'One-snap solid region'} created as one primitive`);}
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

function changeWorldSize(e){const old=project.worldSizeMm,next=+e.target.value,b=projectBounds(project);if(b){const h=next/2;const outside=b.min.some(v=>v<-h)||b.max.some(v=>v>h);if(outside&&!confirm('Some geometry lies outside that smaller world root. Shrink the world anyway?')){e.target.value=old;return;}}project.worldSizeMm=next;changed(true);homeView();}

function updateStats(){const cells=project.primitives.filter(p=>p.type==='cell').length,boxes=project.primitives.length-cells,bytes=estimatedJsonBytes(project);$('stat-cells').textContent=cells.toLocaleString();$('stat-boxes').textContent=boxes.toLocaleString();$('stat-bytes').textContent=bytesLabel(bytes);$('stat-visible').textContent=`${Math.min(visibleIds.length,MAX_VISIBLE).toLocaleString()}${visibleIds.length>MAX_VISIBLE?' +':''}`;$('header-stats').textContent=`${project.primitives.length.toLocaleString()} primitives · ${bytesLabel(bytes)} · saved locally`;
  const w=$('storage-warning');if(bytes>250*1024*1024){w.hidden=false;w.textContent='Project is above 250 MB. Mobile editing may become unreliable; simplify or split the project.';}else if(bytes>100*1024*1024){w.hidden=false;w.textContent='Project is above 100 MB. This is the warning zone for iPhone/iPad use.';}else if(bytes>20*1024*1024){w.hidden=false;w.textContent='Large mobile project: still usable, but keep an eye on visible geometry and export size.';}else w.hidden=true;
}

function scheduleSave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(async()=>{try{await saveAutosave(project);$('header-stats').textContent=$('header-stats').textContent.replace(/saved locally|saving…/,'saved locally');}catch(e){setStatus('Autosave failed · export JSON as a backup');}},350);$('header-stats').textContent=$('header-stats').textContent.replace(/saved locally/,'saving…');}
async function safeLoad(){try{return await loadAutosave();}catch{return null;}}
async function newProject(){if(project.primitives.length&&!confirm('Start a new sparse project? Export JSON first if you want a backup.'))return;await clearAutosave().catch(()=>{});project=makeProject();selectedId=null;renderOriginMm=[0,0,0];syncUiFromProject();syncPalette();setTool('select');rebuildAll();homeView();scheduleSave();}
function exportJson(){const text=JSON.stringify(project,null,2),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`block64-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);setStatus(`Exported ${bytesLabel(new TextEncoder().encode(text).length)}`);}
async function importJson(e){const f=e.target.files?.[0];if(!f)return;try{const raw=JSON.parse(await f.text());project=normalizeProject(raw);selectedId=null;renderOriginMm=[0,0,0];syncUiFromProject();syncPalette();rebuildAll();homeView();scheduleSave();setStatus(`Loaded ${f.name}`);}catch(err){alert('Could not load this project JSON.');}finally{e.target.value='';}}

function setStatus(msg){statusEl.textContent=msg;}
function resize(){const r=viewport.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
function loop(){controls.update();renderer.render(scene,camera);requestAnimationFrame(loop);}
function clearGroup(group,disposeGeo){while(group.children.length){const o=group.children.pop();if(disposeGeo)o.geometry?.dispose?.();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material.dispose?.();}}}
