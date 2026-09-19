import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {ROOT,clip,edit,move,validate,copyCell,pasteCell,fillRegion,eraseRegion,recolorRegion,cellFromCoordinates,adjacentCell,hasDetailedOccupancy,validatePatterns} from "./space.mjs";
const $=s=>document.querySelector(s);
const colors=["#ff5349","#ff7a2f","#f5a623","#f5d547","#a8db4b","#48b85b","#1ba784","#16a6a1","#35bce3","#4a9df1","#4263d8","#5c52c9","#8756d9","#ae54cf","#dd4eab","#f06292","#9f304d","#a74435","#82563a","#c79b63","#ead9a5","#91d4b1","#b5e2e8","#b8ccec","#c3b5e7","#f1f2ed","#b7bdc7","#7f8793","#535c68","#343941","#17191e","#c46f44"];
const KEY="block32-spatial-v2",PATTERN_KEY="block32-patterns-v1";
let world={version:2,unit:"mm",objects:[{id:"initial",name:"Room structure",kind:"fixed"}],boxes:[]};
let path=[],selected=null,tool="select",color=colors[0],owner="initial",layer=0,classified=false,isolated=false,protectDetail=true;
let patterns=[];
let down=null,multi=false,noticeTimer;
function say(s){$("#toast").textContent=s;$("#toast").classList.add("visible");clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$("#toast").classList.remove("visible"),4500);}
const run=fn=>{try{fn();}catch(e){say(e.message);}};
const region=()=>path.at(-1)||ROOT;
const step=()=> (region().max[0]-region().min[0])/10;
const length=v=>v>=1000?(v/1000)+" m":v>=10?(v/10)+" cm":v+" mm";
function confirmDetailedChange(cell,verb){
  return !protectDetail||!hasDetailedOccupancy(world.boxes,cell,owner)||confirm(`${verb} this cell will replace detailed ${world.objects.find(o=>o.id===owner)?.name||"object"} modeling inside it. Continue?`);
}
function backToParent(){
  if(!path.length)return;
  selected=path.pop();
  layer=Math.round((selected.min[1]-region().min[1])/step());
  $("#layer").value=layer;
  mode("select");
  refresh();
  home();
}
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!e.defaultPrevented&&!e.target.closest?.("input,select,textarea,[contenteditable]")){
    e.preventDefault();
    backToParent();
  }
});
const panel=document.createElement("section");panel.className="panel-section navigation";
panel.innerHTML='<div id="scale"></div><div id="crumbs"></div><p id="selection">Select a cell to inspect its contents.</p><button id="select-tool" class="button">Select cell</button> <button id="enter" class="button">Enter cell</button><label>Editing layer <input id="layer" type="range" min="0" max="9" value="0"><span id="layer-value">0</span></label><p class="storage-note">The grid is always 10 × 10 × 10. Select empty space on the editing layer, or select an occupied cell. Entering does not change the model.</p>';
$(".tool-panel").prepend(panel);
const picker=document.createElement("div");picker.className="cell-picker";
picker.innerHTML='<label>X <input id="cell-x" type="number" min="0" max="9" value="0"></label><label>Y <input id="cell-y" type="number" min="0" max="9" value="0"></label><label>Z <input id="cell-z" type="number" min="0" max="9" value="0"></label><button id="pick-cell" class="button">Select coordinates</button>';
panel.append(picker);
const safety=document.createElement("label");safety.className="detail-protection";safety.innerHTML='<input id="protect-detail" type="checkbox" checked> Warn before replacing detailed contents';panel.append(safety);
const adjacent=document.createElement("div");adjacent.className="adjacent-panel";
adjacent.innerHTML='<div class="adjacent-heading">Select adjacent cell</div><div class="adjacent-actions"><button class="button" data-axis="0" data-delta="-1">X− Left</button><button class="button" data-axis="0" data-delta="1">X+ Right</button><button class="button" data-axis="1" data-delta="-1">Y− Down</button><button class="button" data-axis="1" data-delta="1">Y+ Up</button><button class="button" data-axis="2" data-delta="-1">Z− Back</button><button class="button" data-axis="2" data-delta="1">Z+ Front</button></div>';
panel.append(adjacent);
adjacent.querySelectorAll("button").forEach(button=>button.onclick=()=>run(()=>{if(!selected)throw Error("Select a cell first.");selected=adjacentCell(selected,Number(button.dataset.axis),Number(button.dataset.delta),region());layer=Math.round((selected.min[1]-region().min[1])/step());$("#layer").value=layer;mode("select");refresh();}));
$("#pick-cell").onclick=()=>run(()=>{const xyz=["#cell-x","#cell-y","#cell-z"].map(s=>Number($(s).value));if(xyz.some(n=>!Number.isInteger(n)||n<0||n>9))throw Error("Choose cell coordinates from 0 to 9.");const min=xyz.map((n,i)=>region().min[i]+n*step());selected={min,max:min.map(n=>n+step())};mode("select");refresh();});
let clipboard=null;
const bulk=document.createElement("section");bulk.className="panel-section bulk-panel";
bulk.innerHTML=`<div class="section-label">Repeat & fill</div>
<div class="bulk-actions"><button id="copy-cell" class="button">Copy cell</button></div>
<fieldset class="paste-destination"><legend>Paste destination · cell 0–9</legend>
<div class="cell-picker">${["x","y","z"].map(axis=>`<label>${axis.toUpperCase()}${axis==="y"?" (height)":""}<input id="paste-${axis}" type="number" min="0" max="9" step="1" value="0" inputmode="numeric"></label>`).join("")}</div>
<p id="paste-preview" class="storage-note" aria-live="polite">Copy a cell, then set X, Y and Z to preview its destination.</p>
<button id="paste-cell" class="button">Paste cell here</button></fieldset>
<p id="clipboard-status" class="storage-note" aria-live="polite">Copies the active object's contents. Select a destination at the same scale, then paste into the active object.</p>
<p class="storage-note">Paste replaces the active object's contents in that cell, including empty space. Copies can be edited independently. Choose New object before pasting if it should move separately.</p>
<details><summary>Rectangular fill</summary>
<p class="storage-note">Starts at the selected cell's lower corner and extends along +X, +Y and +Z, even across cells.</p>
<div class="fill-fields">${[["x","Width (X)","1"],["y","Height (Y)","0.03"],["z","Depth (Z)","1"]].map(([id,label,value])=>`<label>${label}<input id="fill-${id}" type="number" min="0.001" max="10" step="0.001" value="${value}"></label>`).join("")}</div>
<label>Units <select id="fill-unit"><option value="1000">Meters</option><option value="10">Centimeters</option><option value="1">Millimeters</option></select></label>
<p id="fill-origin" class="storage-note"></p>
<div class="rectangle-actions"><button id="fill-region" class="button">Fill rectangle</button><button id="erase-region" class="button rectangle-erase">Erase rectangle</button></div>
<p class="storage-note">Fill uses the active object and selected color. Erase removes only the active object. Other objects block filling but are never erased.</p></details>`;
panel.after(bulk);
const patternPanel=document.createElement("section");patternPanel.className="panel-section pattern-panel";
patternPanel.innerHTML=`<div class="section-label">Patterns</div>
<label>Pattern <select id="pattern-select"></select></label>
<div class="pattern-actions"><button id="apply-pattern" class="button">Apply to selected cell</button><button id="save-pattern" class="button">Save selected cell</button><button id="delete-pattern" class="text-button danger">Delete saved pattern</button></div>
<p id="pattern-note" class="storage-note">Built-in surfaces are one-tenth of the current cell thick, so they work at every scale.</p>`;
bulk.after(patternPanel);
function requireSelection(){if(!selected)throw Error("Select a starting cell first.");if(isolated)throw Error("Turn off the isolated view before bulk editing.");}
$("#copy-cell").onclick=()=>run(()=>{if(!selected)throw Error("Select a cell first.");clipboard=copyCell(world.boxes,selected,owner);mode("select");refresh();say("Cell copied. Set destination X, Y and Z, then Paste cell here.");});
function previewPasteDestination(){
 const inputs=["x","y","z"].map(axis=>$("#paste-"+axis));
 try {
  selected=cellFromCoordinates(region(),inputs.map(el=>el.value.trim()===""?NaN:Number(el.value)));
  layer=Number($("#paste-y").value);$("#layer").value=layer;
  mode("select");refresh();
 } catch(e) {selected=null;refresh();$("#paste-preview").textContent=e.message;}
}
for(const axis of ["x","y","z"])$("#paste-"+axis).oninput=previewPasteDestination;
$("#paste-cell").onclick=()=>run(()=>{requireSelection();if(!confirmDetailedChange(selected,"Paste into"))return;world.boxes=pasteCell(world.boxes,selected,owner,clipboard);save();say("Cell pasted. Select another destination to repeat.");});
$("#fill-unit").onchange=()=>{const unit=Number($("#fill-unit").value);for(const axis of ["x","y","z"]){const el=$("#fill-"+axis);el.value=String(Number(el.value)*Number(el.dataset.unit||1000)/unit);el.dataset.unit=String(unit);el.min=String(1/unit);el.max=String(10000/unit);el.step=String(1/unit);}};
function rectangleFromFields(){
 const unit=Number($("#fill-unit").value);
 const dims=["x","y","z"].map(axis=>{const raw=Number($("#fill-"+axis).value)*unit;const mm=Math.round(raw);if(!Number.isFinite(raw)||mm<=0||Math.abs(raw-mm)>0.000001)throw Error("Enter positive dimensions with at least 1 mm precision.");return mm;});
 const cell={min:[...selected.min],max:selected.min.map((v,i)=>v+dims[i])};
 return {cell,dims};
}
$("#fill-region").onclick=()=>run(()=>{
 requireSelection();const {cell,dims}=rectangleFromFields();
 if(!confirmDetailedChange(cell,"Fill"))return;
 world.boxes=fillRegion(world.boxes,cell,owner,color);save();say("Rectangle filled: "+dims.map(length).join(" × "));
});
$("#erase-region").onclick=()=>run(()=>{
 requireSelection();const {cell,dims}=rectangleFromFields();
 if(!confirmDetailedChange(cell,"Erase"))return;
 world.boxes=eraseRegion(world.boxes,cell,owner);save();say("Rectangle erased: "+dims.map(length).join(" × "));
});
const builtins=[
 ["floor","Floor · bottom 10%",1,0],["ceiling","Ceiling · top 10%",1,9],
 ["left","Wall · left 10%",0,0],["right","Wall · right 10%",0,9],
 ["front","Wall · front 10%",2,9],["back","Wall · back 10%",2,0]
];
function savePatterns(){localStorage.setItem(PATTERN_KEY,JSON.stringify(patterns));renderPatterns();}
function renderPatterns(){
 const select=$("#pattern-select"),current=select.value;
 select.replaceChildren(...builtins.map(([id,name])=>new Option(name,"builtin:"+id)),...patterns.map((p,i)=>new Option(p.name,"saved:"+i)));
 if([...select.options].some(o=>o.value===current))select.value=current;
 $("#delete-pattern").hidden=!select.value.startsWith("saved:");
}
function builtinCopy(axis,index){
 const size=step(),min=[0,0,0],max=[size,size,size];min[axis]=index*size/10;max[axis]=(index+1)*size/10;
 return {size:[size,size,size],parts:[{min,max,color}]};
}
$("#pattern-select").onchange=renderPatterns;
$("#save-pattern").onclick=()=>run(()=>{
 if(!selected)throw Error("Select a modeled cell first.");
 const copied=copyCell(world.boxes,selected,owner),name=prompt("Pattern name");if(!name?.trim())return;
 patterns.push({name:name.trim().slice(0,60),copied});savePatterns();$("#pattern-select").value="saved:"+(patterns.length-1);renderPatterns();say("Pattern saved on this device.");
});
$("#apply-pattern").onclick=()=>run(()=>{
 requireSelection();const value=$("#pattern-select").value;
 let copied;
 if(value.startsWith("builtin:")){if(step()<10)throw Error("The minimum thickness is 1 mm. Apply this pattern from a view with 1 cm cells or larger.");const item=builtins.find(p=>p[0]===value.slice(8));copied=builtinCopy(item[2],item[3]);}
 else copied=patterns[Number(value.slice(6))]?.copied;
 if(!copied)throw Error("Choose a pattern first.");
 if(copied.size[0]!==step())throw Error("This saved pattern uses "+length(copied.size[0])+" cells. Return to that scale to apply it.");
 if(!confirmDetailedChange(selected,"Apply the pattern to"))return;
 world.boxes=pasteCell(world.boxes,selected,owner,copied);save();say("Pattern applied.");
});
$("#delete-pattern").onclick=()=>{const i=Number($("#pattern-select").value.slice(6));if(Number.isInteger(i)&&patterns[i]&&confirm(`Delete saved pattern “${patterns[i].name}”?`)){patterns.splice(i,1);savePatterns();say("Pattern deleted.");}};
const objects=document.createElement("section");objects.className="panel-section object-panel";
objects.innerHTML='<label>Active object <select id="objects"></select></label><label>Name <input id="object-name" maxlength="100"></label><label>Type <select id="kind"><option value="fixed">Fixed</option><option value="movable">Movable</option></select></label><button id="new-object" class="button">New object</button><label><input id="classification" type="checkbox"> Show types: fixed gray / movable blue</label><label><input id="isolate" type="checkbox"> View active object only</label><p id="dimensions"></p><div id="movement"></div><p class="storage-note">Move by one cell at the current scale. Collisions and room boundaries block movement. Dimensions measure the whole object.</p>';
$(".tool-panel").insertBefore(objects,$(".palette-section"));
$("#clear-button").textContent="Clear room";
$("#viewport-hint").textContent="Click to edit · Drag to orbit · Scroll to zoom";
$("#selected-color-name").textContent=color;
const customColor=document.createElement("div");customColor.className="custom-color";
customColor.innerHTML='<label for="custom-color-picker">Custom color</label><input id="custom-color-picker" type="color" value="#ff5349" aria-label="Choose custom color"><input id="custom-color-hex" type="text" value="#ff5349" maxlength="7" spellcheck="false" aria-label="Custom color hex value">';
$("#palette").after(customColor);
const recolorButton=document.createElement("button");recolorButton.id="recolor-cell";recolorButton.className="button recolor-button";recolorButton.textContent="Apply color to selected cell";customColor.after(recolorButton);
function chooseColor(next,swatch){
 if(!/^#[0-9a-f]{6}$/i.test(next))throw Error("Enter a six-digit color such as #2f80ed.");
 color=next.toLowerCase();$("#selected-color-name").textContent=color;$("#custom-color-picker").value=color;$("#custom-color-hex").value=color;
 $("#palette").querySelectorAll("button").forEach(s=>{s.classList.toggle("selected",s===swatch);s.setAttribute("aria-selected",s===swatch);});mode("place");
}
$("#custom-color-picker").oninput=e=>chooseColor(e.target.value,null);
$("#custom-color-hex").onchange=e=>run(()=>chooseColor(e.target.value.trim(),null));
recolorButton.onclick=()=>run(()=>{if(!selected)throw Error("Select a cell first.");world.boxes=recolorRegion(world.boxes,selected,owner,color);mode("select");save();say("Selected occupied contents recolored without changing their shape.");});
const modeBadge=document.createElement("div");modeBadge.id="mode-badge";modeBadge.setAttribute("aria-live","polite");$(".viewport-wrap").append(modeBadge);
const viewShortcuts=document.createElement("div");viewShortcuts.className="view-shortcuts";viewShortcuts.setAttribute("aria-label","Standard views");viewShortcuts.innerHTML='<button type="button" data-view="front">Front</button><button type="button" data-view="back">Back</button><button type="button" data-view="left">Left</button><button type="button" data-view="right">Right</button><button type="button" data-view="top">Top</button><button type="button" data-view="bottom">Bottom</button>';$(".viewport-wrap").append(viewShortcuts);
const scene=new THREE.Scene();scene.background=new THREE.Color("#0d0f13");
const camera=new THREE.PerspectiveCamera(42,1,0.01,150);
const renderer=new THREE.WebGLRenderer({canvas:$("#viewport"),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const controls=new OrbitControls(camera,$("#viewport"));controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=40;controls.maxPolarAngle=Math.PI;
scene.add(new THREE.HemisphereLight(0xffffff,0x59616e,2.5));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(4,12,8);scene.add(light);
const grid=new THREE.GridHelper(10,10,0xd6e7ff,0x71849b);grid.material.transparent=true;grid.material.opacity=.78;scene.add(grid);
const latticePoints=[];
for(let a=0;a<=10;a++)for(let b=0;b<=10;b++){
  latticePoints.push(-5,a,b-5,5,a,b-5);
  latticePoints.push(a-5,0,b-5,a-5,10,b-5);
  latticePoints.push(a-5,b,-5,a-5,b,5);
}
const latticeGeometry=new THREE.BufferGeometry();latticeGeometry.setAttribute("position",new THREE.Float32BufferAttribute(latticePoints,3));
const lattice=new THREE.LineSegments(latticeGeometry,new THREE.LineBasicMaterial({color:0x7890aa,transparent:true,opacity:.24,depthWrite:false}));lattice.renderOrder=2;scene.add(lattice);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const bounds=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(10,10,10)),new THREE.LineBasicMaterial({color:0x657486,transparent:true,opacity:.35}));bounds.position.y=5;scene.add(bounds);
const highlight=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color:0xffe16a,depthTest:false}));highlight.visible=false;highlight.renderOrder=10;scene.add(highlight);
const geometry=new THREE.BoxGeometry(1,1,1), group=new THREE.Group();scene.add(group);
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),matrix=new THREE.Matrix4();
let meshes=[];
function home(){camera.up.set(0,1,0);camera.position.set(13,12,15);controls.target.set(0,4,0);controls.update();}
function standardView(name){
 camera.up.set(0,1,0);controls.target.set(0,5,0);
 if(name==="front")camera.position.set(0,5,18);
 if(name==="back")camera.position.set(0,5,-18);
 if(name==="right")camera.position.set(18,5,0);
 if(name==="left")camera.position.set(-18,5,0);
 if(name==="top"){camera.up.set(0,0,-1);camera.position.set(0,21,.001);}
 if(name==="bottom"){camera.up.set(0,0,1);camera.position.set(0,-11,.001);}
 controls.update();
}
viewShortcuts.querySelectorAll("button").forEach(b=>b.onclick=()=>standardView(b.dataset.view));
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
  for(let d=0;d<=path.length;d++){const b=document.createElement("button");b.className="text-button";b.textContent=d===0?"Room":length(10000/10**d)+" ["+path[d-1].min.join(",")+"]";b.onclick=()=>{path=path.slice(0,d);layer=0;$("#layer").value=0;selected=null;mode("select");refresh();home();};$("#crumbs").append(b);}
  $("#enter").disabled=!selected||step()<=1;
  $("#copy-cell").disabled=!selected;
  $("#paste-cell").disabled=!selected||!clipboard||clipboard.size[0]!==step()||isolated;
  $("#fill-region").disabled=!selected||isolated;
  $("#erase-region").disabled=!selected||isolated;
  $("#recolor-cell").disabled=!selected;
  adjacent.querySelectorAll("button").forEach(button=>{try{if(!selected)throw Error();adjacentCell(selected,Number(button.dataset.axis),Number(button.dataset.delta),region());button.disabled=false;}catch{button.disabled=true;}});
  $("#fill-origin").textContent=selected?"Start X / Y / Z: "+selected.min.map(length).join(" / "):"Select a starting cell with Select cell or coordinates.";
  if(clipboard)$("#clipboard-status").textContent="Copied: "+length(clipboard.size[0])+" cell · "+clipboard.parts.length+" occupied regions. Paste into the active object at this scale.";
  if(selected){
    const xyz=selected.min.map((v,i)=>Math.round((v-region().min[i])/step()));
    ["x","y","z"].forEach((axis,i)=>{$("#paste-"+axis).value=xyz[i];});
    $("#paste-preview").textContent=clipboard&&clipboard.size[0]!==step()?"Return to "+length(clipboard.size[0])+" cells to paste.":"Yellow outline: cell "+xyz.join(" / ")+" · origin "+selected.min.map(length).join(" / ");
  } else $("#paste-preview").textContent="Set X, Y and Z to preview a destination at this scale.";
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
function mode(t){tool=t;$("#place-tool").classList.toggle("active",t==="place");$("#erase-tool").classList.toggle("active",t==="erase");$("#place-tool").setAttribute("aria-pressed",t==="place");$("#erase-tool").setAttribute("aria-pressed",t==="erase");$("#select-tool").setAttribute("aria-pressed",t==="select");modeBadge.textContent=t.toUpperCase()+" MODE";modeBadge.dataset.mode=t;}
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
renderer.domElement.addEventListener("pointerup",e=>{const click=down&&!down.moved&&!multi&&down.id===e.pointerId&&e.button===0;pointers.delete(e.pointerId);if(!pointers.size)multi=false;down=null;if(!click)return;run(()=>{const cell=cellAt(e);if(!cell)return;selected=cell;if(tool==="select"){refresh();return;}if(tool==="place"&&isolated)throw Error("Turn off the isolated view before placing, so other objects remain visible.");if(tool==="place"&&world.boxes.some(b=>b.owner!==owner&&clip(b,cell)))throw Error("Another object occupies this cell. Enter the cell for finer placement.");if(!confirmDetailedChange(cell,tool==="erase"?"Erase":"Place over")){mode("select");refresh();return;}if(tool==="erase"){world.boxes=world.boxes.flatMap(b=>b.owner===owner?edit([b],cell,null,color):[b]);}else world.boxes=edit(world.boxes,cell,owner,color);save();});});
renderer.domElement.addEventListener("pointercancel",()=>{pointers.clear();down=null;multi=false;});
$("#select-tool").onclick=()=>mode("select");$("#place-tool").onclick=()=>mode("place");$("#erase-tool").onclick=()=>mode("erase");
$("#enter").onclick=()=>{if(!selected||step()<=1)return;path.push(selected);selected=null;layer=0;$("#layer").value=0;mode("select");refresh();home();};
$("#layer").oninput=e=>{layer=Number(e.target.value);refresh();};
$("#objects").onchange=e=>{owner=e.target.value;refresh();};
$("#object-name").onchange=e=>{world.objects.find(o=>o.id===owner).name=e.target.value.trim()||"Untitled object";save();};
$("#kind").onchange=e=>{world.objects.find(o=>o.id===owner).kind=e.target.value;save();};
$("#new-object").onclick=()=>{if(world.objects.length>=1000)return say("Object limit reached.");const id=crypto.randomUUID();world.objects.push({id,name:"Object "+(world.objects.length+1),kind:"movable"});owner=id;save();$("#object-name").focus();$("#object-name").select();};
$("#classification").onchange=e=>{classified=e.target.checked;refresh();};
$("#isolate").onchange=e=>{isolated=e.target.checked;refresh();};
$("#protect-detail").onchange=e=>{protectDetail=e.target.checked;say(protectDetail?"Detailed-cell warnings on.":"Detailed-cell warnings off.");};
for(let i=0;i<3;i++)for(const sign of [-1,1]){const b=document.createElement("button");b.className="button";b.textContent=["X","Y","Z"][i]+(sign<0?" −":" +");b.onclick=()=>run(()=>{const delta=[0,0,0];delta[i]=sign*step();world.boxes=move(world.boxes,world.objects,owner,delta);save();});$("#movement").append(b);}
colors.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="swatch";b.style.setProperty("--swatch",c);b.setAttribute("aria-label",c);b.setAttribute("role","option");b.setAttribute("aria-selected",c===color);b.onclick=()=>chooseColor(c,b);$("#palette").append(b);});
$("#load-button").onclick=()=>$("#file-input").click();
$("#save-button").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({...world,patterns},null,2)],{type:"application/json"}));const a=document.createElement("a"),d=new Date(),pad=n=>String(n).padStart(2,"0");a.href=url;a.download=`block32-spatial-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$("#file-input").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;if(f.size>15000000)return say("Please use a JSON file under 15 MB.");try{const raw=JSON.parse(await f.text()),next=validate(raw),nextPatterns=raw.patterns===undefined?patterns:validatePatterns(raw.patterns);if(world.boxes.length&&!confirm("Replace this room with the imported file? Save JSON first if you need a backup."))return;world=next;patterns=nextPatterns;savePatterns();if(!world.objects.length)world.objects.push({id:"initial",name:"Room structure",kind:"fixed"});owner=world.objects[0].id;path=[];selected=null;layer=0;$("#layer").value=0;save();}catch(err){say(err.message);}};
$("#clear-button").onclick=()=>{if(confirm("Clear all occupied space in this room?")){world.boxes=[];path=[];selected=null;save();}};
$("#reset-view").onclick=home;
for(const [id,factor] of [["#zoom-in",.82],["#zoom-out",1.22]])$(id).onclick=()=>{const v=camera.position.clone().sub(controls.target);v.setLength(THREE.MathUtils.clamp(v.length()*factor,2,40));camera.position.copy(controls.target).add(v);controls.update();};
try{const saved=localStorage.getItem(KEY);if(saved){world=validate(JSON.parse(saved));owner=world.objects[0]?.id||"initial";}else if(localStorage.getItem("block32-world-v1"))say("Your original world is preserved separately. This decimal workspace starts a new room.");}catch{say("Local save could not be opened. It has been left untouched; import a JSON backup.");}
try{patterns=validatePatterns(JSON.parse(localStorage.getItem(PATTERN_KEY)||"[]"));}catch{patterns=[];say("Saved patterns could not be opened; the room itself is unaffected.");}
function resize(){const r=$(".viewport-wrap");renderer.setSize(r.clientWidth,r.clientHeight,false);camera.aspect=r.clientWidth/r.clientHeight;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($(".viewport-wrap"));
renderPatterns();home();mode("select");refresh();resize();$("#loading-note").remove();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
