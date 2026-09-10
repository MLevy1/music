import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {ROOT,clip,edit,move,validate} from "./space.mjs";
const $=s=>document.querySelector(s);
const colors=["#ff5349","#ff7a2f","#f5a623","#f5d547","#a8db4b","#48b85b","#1ba784","#16a6a1","#35bce3","#4a9df1","#4263d8","#5c52c9","#8756d9","#ae54cf","#dd4eab","#f06292","#9f304d","#a74435","#82563a","#c79b63","#ead9a5","#91d4b1","#b5e2e8","#b8ccec","#c3b5e7","#f1f2ed","#b7bdc7","#7f8793","#535c68","#343941","#17191e","#c46f44"];
const KEY="block32-spatial-v2";
let world={version:2,unit:"mm",objects:[{id:"initial",name:"Room structure",kind:"fixed"}],boxes:[]};
let path=[],selected=null,tool="place",color=colors[0],owner="initial",layer=0,classified=false,isolated=false;
let down=null,multi=false,noticeTimer;
function say(s){$("#toast").textContent=s;$("#toast").classList.add("visible");clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$("#toast").classList.remove("visible"),4500);}
const run=fn=>{try{fn();}catch(e){say(e.message);}};
const region=()=>path.at(-1)||ROOT;
const step=()=> (region().max[0]-region().min[0])/10;
const length=v=>v>=1000?(v/1000)+" m":v>=10?(v/10)+" cm":v+" mm";
const panel=document.createElement("section");panel.className="panel-section navigation";
panel.innerHTML='<div id="scale"></div><div id="crumbs"></div><p id="selection">Select a cell to inspect its contents.</p><button id="select-tool" class="button">Select cell</button> <button id="enter" class="button">Enter cell</button><label>Editing layer <input id="layer" type="range" min="0" max="9" value="0"><span id="layer-value">0</span></label><p class="storage-note">The grid is always 10 × 10 × 10. Select empty space on the editing layer, or select an occupied cell. Entering does not change the model.</p>';
$(".tool-panel").prepend(panel);
const picker=document.createElement("div");picker.className="cell-picker";
picker.innerHTML='<label>X <input id="cell-x" type="number" min="0" max="9" value="0"></label><label>Y <input id="cell-y" type="number" min="0" max="9" value="0"></label><label>Z <input id="cell-z" type="number" min="0" max="9" value="0"></label><button id="pick-cell" class="button">Select coordinates</button>';
panel.append(picker);
$("#pick-cell").onclick=()=>run(()=>{const xyz=["#cell-x","#cell-y","#cell-z"].map(s=>Number($(s).value));if(xyz.some(n=>!Number.isInteger(n)||n<0||n>9))throw Error("Choose cell coordinates from 0 to 9.");const min=xyz.map((n,i)=>region().min[i]+n*step());selected={min,max:min.map(n=>n+step())};mode("select");refresh();});
const objects=document.createElement("section");objects.className="panel-section object-panel";
objects.innerHTML='<label>Active object <select id="objects"></select></label><label>Name <input id="object-name" maxlength="100"></label><label>Type <select id="kind"><option value="fixed">Fixed</option><option value="movable">Movable</option></select></label><button id="new-object" class="button">New object</button><label><input id="classification" type="checkbox"> Show types: fixed gray / movable blue</label><label><input id="isolate" type="checkbox"> View active object only</label><p id="dimensions"></p><div id="movement"></div><p class="storage-note">Move by one cell at the current scale. Collisions and room boundaries block movement. Dimensions measure the whole object.</p>';
$(".tool-panel").insertBefore(objects,$(".palette-section"));
$("#clear-button").textContent="Clear room";
$("#viewport-hint").textContent="Click to edit · Drag to orbit · Scroll to zoom";
$("#selected-color-name").textContent=color;
const scene=new THREE.Scene();scene.background=new THREE.Color("#0d0f13");
const camera=new THREE.PerspectiveCamera(42,1,0.01,150);
const renderer=new THREE.WebGLRenderer({canvas:$("#viewport"),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const controls=new OrbitControls(camera,$("#viewport"));controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight(0xffffff,0x59616e,2.5));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(4,12,8);scene.add(light);
const grid=new THREE.GridHelper(10,10,0x8796aa,0x455064);scene.add(grid);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const bounds=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(10,10,10)),new THREE.LineBasicMaterial({color:0x657486,transparent:true,opacity:.35}));bounds.position.y=5;scene.add(bounds);
const highlight=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color:0xffe16a,depthTest:false}));highlight.visible=false;highlight.renderOrder=10;scene.add(highlight);
const geometry=new THREE.BoxGeometry(1,1,1), group=new THREE.Group();scene.add(group);
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),matrix=new THREE.Matrix4();
let meshes=[];
function home(){camera.position.set(13,12,15);controls.target.set(0,4,0);controls.update();}
function local(v,i){return (v-region().min[i])/step()-(i===1?0:5);}
function refresh(){
  for(const m of meshes){group.remove(m);m.material.dispose();m.dispose();}
  meshes=[];
  const batches=new Map();
  for(const box of world.boxes){
    if(isolated&&box.owner!==owner)continue;
    const b=clip(box,region());if(!b)continue;
    const c=classified?(world.objects.find(o=>o.id===box.owner)?.kind==="fixed"?"#a4abb5":"#4a9df1"):box.color;
    if(!batches.has(c))batches.set(c,[]);batches.get(c).push(b);
  }
  for(const [c,boxes] of batches){
    const m=new THREE.InstancedMesh(geometry,new THREE.MeshLambertMaterial({color:c}),boxes.length);
    boxes.forEach((b,i)=>{const pos=new THREE.Vector3(...b.min.map((v,j)=>local((v+b.max[j])/2,j)));const scale=new THREE.Vector3(...b.min.map((v,j)=>(b.max[j]-v)/step()));matrix.compose(pos,new THREE.Quaternion(),scale);m.setMatrixAt(i,matrix);});
    m.userData.boxes=boxes;group.add(m);meshes.push(m);
  }
  grid.position.y=layer+.001;floor.position.y=layer;
  $("#scale").textContent="Cell: "+length(step())+" · View: "+length(step()*10)+" cube";
  $("#layer-value").textContent=layer+" · "+length(layer*step())+" above view floor";
  $("#crumbs").replaceChildren();
  for(let d=0;d<=path.length;d++){const b=document.createElement("button");b.className="text-button";b.textContent=d===0?"Room":length(10000/10**d)+" ["+path[d-1].min.join(",")+"]";b.onclick=()=>{path=path.slice(0,d);layer=0;$("#layer").value=0;selected=null;refresh();home();};$("#crumbs").append(b);}
  $("#enter").disabled=!selected||step()<=1;
  highlight.visible=!!selected;
  if(selected){highlight.position.set(...selected.min.map((v,i)=>local(v+step()/2,i)));$("#selection").textContent="Cell origin: "+selected.min.map(length).join(" / ");}
  else $("#selection").textContent="Select a cell to inspect its contents.";
  $("#cube-count").textContent=world.boxes.length+" occupied regions";
  const ob=world.objects.find(o=>o.id===owner);
  $("#objects").replaceChildren(...world.objects.map(o=>{const opt=document.createElement("option");opt.value=o.id;opt.textContent=o.name;opt.selected=o.id===owner;return opt;}));
  $("#object-name").value=ob?.name||"";$("#kind").value=ob?.kind||"fixed";
  const bs=world.boxes.filter(b=>b.owner===owner);
  $("#dimensions").textContent=bs.length?"Size: "+[0,1,2].map(i=>length(Math.max(...bs.map(b=>b.max[i]))-Math.min(...bs.map(b=>b.min[i])))).join(" × "):"No occupied space yet.";
  $("#movement").querySelectorAll("button").forEach(b=>b.disabled=ob?.kind!=="movable"||!bs.length);
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(world));$("#save-state").textContent="Saved locally";}catch{$("#save-state").textContent="Export JSON to save";say("Browser storage unavailable. Save JSON to keep your work.");}refresh();}
function mode(t){tool=t;$("#place-tool").classList.toggle("active",t==="place");$("#erase-tool").classList.toggle("active",t==="erase");$("#place-tool").setAttribute("aria-pressed",t==="place");$("#erase-tool").setAttribute("aria-pressed",t==="erase");$("#select-tool").setAttribute("aria-pressed",t==="select");}
function cellAt(e){
 const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
 const hit=ray.intersectObjects(meshes,false)[0];
 let p;
 if(hit){p=hit.point.clone().addScaledVector(hit.face.normal,tool==="place"?0.00001:-0.00001);}
 else {const h=ray.intersectObject(floor)[0];if(!h)return null;p=h.point.clone();p.y=layer+.00001;}
 const xyz=[p.x+5,p.y,p.z+5].map(Math.floor);if(xyz.some(v=>v<0||v>9))return null;
 const min=xyz.map((v,i)=>region().min[i]+v*step());return {min,max:min.map(v=>v+step())};
}
const pointers=new Set();
renderer.domElement.addEventListener("pointerdown",e=>{pointers.add(e.pointerId);if(pointers.size>1)multi=true;down={x:e.clientX,y:e.clientY,id:e.pointerId,moved:false};});
renderer.domElement.addEventListener("pointermove",e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)down.moved=true;});
renderer.domElement.addEventListener("pointerup",e=>{const click=down&&!down.moved&&!multi&&down.id===e.pointerId&&e.button===0;pointers.delete(e.pointerId);if(!pointers.size)multi=false;down=null;if(!click)return;run(()=>{const cell=cellAt(e);if(!cell)return;selected=cell;if(tool==="select"){refresh();return;}if(tool==="place"&&isolated)throw Error("Turn off the isolated view before placing, so other objects remain visible.");if(tool==="place"&&world.boxes.some(b=>b.owner!==owner&&clip(b,cell)))throw Error("Another object occupies this cell. Enter the cell for finer placement.");if(tool==="erase"){world.boxes=world.boxes.flatMap(b=>b.owner===owner?edit([b],cell,null,color):[b]);}else world.boxes=edit(world.boxes,cell,owner,color);save();});});
renderer.domElement.addEventListener("pointercancel",()=>{pointers.clear();down=null;multi=false;});
$("#select-tool").onclick=()=>mode("select");$("#place-tool").onclick=()=>mode("place");$("#erase-tool").onclick=()=>mode("erase");
$("#enter").onclick=()=>{if(!selected||step()<=1)return;path.push(selected);selected=null;layer=0;$("#layer").value=0;refresh();home();};
$("#layer").oninput=e=>{layer=Number(e.target.value);refresh();};
$("#objects").onchange=e=>{owner=e.target.value;refresh();};
$("#object-name").onchange=e=>{world.objects.find(o=>o.id===owner).name=e.target.value.trim()||"Untitled object";save();};
$("#kind").onchange=e=>{world.objects.find(o=>o.id===owner).kind=e.target.value;save();};
$("#new-object").onclick=()=>{if(world.objects.length>=1000)return say("Object limit reached.");const id=crypto.randomUUID();world.objects.push({id,name:"Object "+(world.objects.length+1),kind:"movable"});owner=id;save();$("#object-name").focus();$("#object-name").select();};
$("#classification").onchange=e=>{classified=e.target.checked;refresh();};
$("#isolate").onchange=e=>{isolated=e.target.checked;refresh();};
for(let i=0;i<3;i++)for(const sign of [-1,1]){const b=document.createElement("button");b.className="button";b.textContent=["X","Y","Z"][i]+(sign<0?" −":" +");b.onclick=()=>run(()=>{const delta=[0,0,0];delta[i]=sign*step();world.boxes=move(world.boxes,world.objects,owner,delta);save();});$("#movement").append(b);}
colors.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="swatch";b.style.setProperty("--swatch",c);b.setAttribute("aria-label",c);b.setAttribute("role","option");b.setAttribute("aria-selected",c===color);b.onclick=()=>{color=c;$("#selected-color-name").textContent=c;$("#palette").querySelectorAll("button").forEach(s=>{s.classList.toggle("selected",s===b);s.setAttribute("aria-selected",s===b);});mode("place");};$("#palette").append(b);});
$("#load-button").onclick=()=>$("#file-input").click();
$("#save-button").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(world,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="block32-spatial.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$("#file-input").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;if(f.size>15000000)return say("Please use a JSON file under 15 MB.");try{const next=validate(JSON.parse(await f.text()));if(world.boxes.length&&!confirm("Replace this room with the imported file? Save JSON first if you need a backup."))return;world=next;if(!world.objects.length)world.objects.push({id:"initial",name:"Room structure",kind:"fixed"});owner=world.objects[0].id;path=[];selected=null;layer=0;$("#layer").value=0;save();}catch(err){say(err.message);}};
$("#clear-button").onclick=()=>{if(confirm("Clear all occupied space in this room?")){world.boxes=[];path=[];selected=null;save();}};
$("#reset-view").onclick=home;
for(const [id,factor] of [["#zoom-in",.82],["#zoom-out",1.22]])$(id).onclick=()=>{const v=camera.position.clone().sub(controls.target);v.setLength(THREE.MathUtils.clamp(v.length()*factor,2,40));camera.position.copy(controls.target).add(v);controls.update();};
try{const saved=localStorage.getItem(KEY);if(saved){world=validate(JSON.parse(saved));owner=world.objects[0]?.id||"initial";}else if(localStorage.getItem("block32-world-v1"))say("Your original world is preserved separately. This decimal workspace starts a new room.");}catch{say("Local save could not be opened. It has been left untouched; import a JSON backup.");}
function resize(){const r=$(".viewport-wrap");renderer.setSize(r.clientWidth,r.clientHeight,false);camera.aspect=r.clientWidth/r.clientHeight;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($(".viewport-wrap"));
home();refresh();resize();$("#loading-note").remove();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
