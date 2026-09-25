// Integer millimeters. Geometry is local to each object; transforms place it in the room.
export const ROOT={min:[0,0,0],max:[10000,10000,10000]};
export const ROOM_SIZE=[10000,10000,10000];
export const intersects=(a,b)=>a.min.every((v,i)=>v<b.max[i]&&a.max[i]>b.min[i]);

export function clip(a,b){
  if(!intersects(a,b))return null;
  return {...a,min:a.min.map((v,i)=>Math.max(v,b.min[i])),max:a.max.map((v,i)=>Math.min(v,b.max[i]))};
}

export function subtract(a,b){
  const c=clip(a,b);if(!c)return [a];
  const out=[],rest={...a,min:[...a.min],max:[...a.max]};
  for(let i=0;i<3;i++){
    if(rest.min[i]<c.min[i]){const p={...rest,min:[...rest.min],max:[...rest.max]};p.max[i]=c.min[i];out.push(p);rest.min[i]=c.min[i];}
    if(rest.max[i]>c.max[i]){const p={...rest,min:[...rest.min],max:[...rest.max]};p.min[i]=c.max[i];out.push(p);rest.max[i]=c.max[i];}
  }
  return out;
}

export function checkRegion(cell){
  if(!cell||!Array.isArray(cell.min)||!Array.isArray(cell.max)||cell.min.length!==3||cell.max.length!==3||!cell.min.every((v,i)=>Number.isInteger(v)&&Number.isInteger(cell.max[i])&&v>=0&&cell.max[i]<=10000&&v<cell.max[i]))throw Error("Use positive dimensions in whole millimeters, within the object's 10 m workspace.");
}

export function edit(boxes,cell,color){
  checkRegion(cell);
  const next=boxes.flatMap(b=>subtract(b,cell));
  if(color)next.push({...cell,color:color.toLowerCase()});
  if(next.length>30000)throw Error("This prototype supports 30,000 occupied regions per object.");
  return next;
}

export function fillRegion(boxes,cell,color){return edit(boxes,cell,color);}
export function eraseRegion(boxes,cell){checkRegion(cell);return boxes.flatMap(b=>subtract(b,cell));}

export function recolorRegion(boxes,cell,color){
  checkRegion(cell);
  if(!/^#[0-9a-f]{6}$/i.test(color))throw Error("Choose a valid six-digit color first.");
  let found=false;const next=[];
  for(const box of boxes){
    if(!intersects(box,cell)){next.push(box);continue;}
    found=true;const inside=clip(box,cell);
    next.push(...subtract(box,cell),{...inside,color:color.toLowerCase()});
  }
  if(!found)throw Error("This object has no occupied space in the selected cell.");
  if(next.length>30000)throw Error("This recolor exceeds the 30,000 region limit.");
  return next;
}

export function copyCell(boxes,cell){
  checkRegion(cell);
  const parts=boxes.map(b=>clip(b,cell)).filter(Boolean).map(b=>({min:b.min.map((v,i)=>v-cell.min[i]),max:b.max.map((v,i)=>v-cell.min[i]),color:b.color}));
  if(!parts.length)throw Error("This object has no occupied space in the selected cell.");
  return {size:cell.max.map((v,i)=>v-cell.min[i]),parts};
}

export function pasteCell(boxes,cell,copied){
  checkRegion(cell);
  if(!copied||copied.size.some((v,i)=>v!==cell.max[i]-cell.min[i]))throw Error("Select a destination cell at the copied scale.");
  const next=boxes.flatMap(b=>subtract(b,cell));
  next.push(...copied.parts.map(b=>({...b,min:b.min.map((v,i)=>v+cell.min[i]),max:b.max.map((v,i)=>v+cell.min[i])})));
  if(next.length>30000)throw Error("This paste exceeds the 30,000 region limit.");
  return next;
}

const rotatePoint=(point,rotation)=>{
  let [x,y,z]=point;const turns=rotation.map(v=>((Math.round(v/90)%4)+4)%4);
  for(let n=0;n<turns[0];n++)[y,z]=[-z,y];
  for(let n=0;n<turns[1];n++)[x,z]=[z,-x];
  for(let n=0;n<turns[2];n++)[x,y]=[-y,x];
  return [x,y,z];
};

export function transformBox(box,transform){
  const corners=[];
  for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])corners.push(rotatePoint([x,y,z],transform.rotation));
  return {min:[0,1,2].map(i=>Math.min(...corners.map(p=>p[i]))+transform.position[i]),max:[0,1,2].map(i=>Math.max(...corners.map(p=>p[i]))+transform.position[i]),color:box.color};
}

export function worldBoxes(object){return object.boxes.map(b=>({...transformBox(b,object.transform),objectId:object.id}));}

export function placementStatus(world,id,transform=world.objects.find(o=>o.id===id)?.transform){
  const object=world.objects.find(o=>o.id===id);if(!object||!transform)return {valid:false,reason:"Object not found."};
  const moved=object.boxes.map(b=>transformBox(b,transform));
  if(moved.some(b=>b.min.some((v,i)=>v<0||b.max[i]>world.room.size[i])))return {valid:false,reason:"Outside room"};
  if(moved.length){
    const movedBounds={min:[0,1,2].map(i=>Math.min(...moved.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...moved.map(b=>b.max[i])))};
    for(const other of world.objects){
      if(other.id===id||!other.boxes.length)continue;
      const otherBoxes=worldBoxes(other),otherBounds={min:[0,1,2].map(i=>Math.min(...otherBoxes.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...otherBoxes.map(b=>b.max[i])))};
      if(intersects(movedBounds,otherBounds)&&moved.some(b=>otherBoxes.some(o=>intersects(b,o))))return {valid:false,reason:"Collision"};
    }
  }
  return {valid:true,reason:"Clear"};
}

export function setTransform(world,id,transform,{allowInvalid=false,allowCollision=false}={}){
  const object=world.objects.find(o=>o.id===id);if(!object)throw Error("Object not found.");
  const next={position:transform.position.map(Math.round),rotation:transform.rotation.map(v=>((Math.round(v/90)*90)%360+360)%360)};
  if(next.position.some(v=>!Number.isFinite(v))||next.rotation.some(v=>!Number.isFinite(v)))throw Error("Use valid positions and rotations.");
  const status=placementStatus(world,id,next);
  if(!allowInvalid&&!status.valid&&!(allowCollision&&status.reason==="Collision"))throw Error(status.reason==="Collision"?"Movement blocked by another object.":"The object would leave the room.");
  object.transform=next;return status;
}

export function moveObject(world,id,delta,options){
  const object=world.objects.find(o=>o.id===id);if(object?.kind!=="movable")throw Error("Fixed objects cannot move. Change the type first.");
  return setTransform(world,id,{position:object.transform.position.map((v,i)=>v+delta[i]),rotation:[...object.transform.rotation]},options);
}

export function rotateObject(world,id,axis,degrees,options){
  const object=world.objects.find(o=>o.id===id);if(object?.kind!=="movable")throw Error("Fixed objects cannot rotate. Change the type first.");
  const rotation=[...object.transform.rotation];rotation[axis]+=degrees;
  return setTransform(world,id,{position:[...object.transform.position],rotation},options);
}

export function dropObject(world,id){
  const object=world.objects.find(o=>o.id===id);if(object?.kind!=="movable")throw Error("Fixed objects cannot move. Change the type first.");
  if(!object.boxes.length)throw Error("Build some geometry before dropping this object.");
  const moving=worldBoxes(object),others=world.objects.filter(o=>o.id!==id).flatMap(worldBoxes);
  let clearance=Math.min(...moving.map(b=>b.min[1]));
  for(const b of moving)for(const o of others){
    const overlapsXZ=b.min[0]<o.max[0]&&b.max[0]>o.min[0]&&b.min[2]<o.max[2]&&b.max[2]>o.min[2];
    if(overlapsXZ&&o.max[1]<=b.min[1])clearance=Math.min(clearance,b.min[1]-o.max[1]);
  }
  if(clearance<=0)throw Error("This object is already resting on a surface or intersects something below it.");
  return moveObject(world,id,[0,-clearance,0]);
}

export function objectBounds(object,space="local"){
  const boxes=space==="world"?worldBoxes(object):object.boxes;if(!boxes.length)return null;
  return {min:[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i])))};
}

export function normalizeObject(world,id){
  const object=world.objects.find(o=>o.id===id);if(!object?.boxes.length)return [0,0,0];
  const origin=[0,1,2].map(i=>Math.min(...object.boxes.map(b=>b.min[i])));
  if(origin.every(v=>v===0))return origin;
  const worldShift=rotatePoint(origin,object.transform.rotation);
  object.boxes=object.boxes.map(b=>({...b,min:b.min.map((v,i)=>v-origin[i]),max:b.max.map((v,i)=>v-origin[i])}));
  object.transform.position=object.transform.position.map((v,i)=>v+worldShift[i]);
  return origin;
}

const FACE_SPECS={
  left:[0,0],right:[0,1],
  bottom:[1,0],top:[1,1],
  back:[2,0],front:[2,1]
};

export function makeFacePattern(size,faces,thickness,color){
  if(!Number.isInteger(size)||size<1||size>10000||!Number.isInteger(thickness)||thickness<1||thickness>size||!Array.isArray(faces)||!faces.length||faces.some(face=>!FACE_SPECS[face])||!/^#[0-9a-f]{6}$/i.test(color))throw Error("Invalid built-in pattern.");
  // Partition the cell at every requested face boundary, then keep each
  // partition that touches a requested face. This produces one canonical,
  // non-overlapping result independent of face order.
  const wanted=new Set(faces),cuts=[[0,size],[0,size],[0,size]];
  for(const face of wanted){const [axis,side]=FACE_SPECS[face];cuts[axis].push(side===0?thickness:size-thickness);}
  cuts.forEach(axis=>axis.sort((a,b)=>a-b));
  const intervals=cuts.map(axis=>[...new Set(axis)].slice(0,-1).map((min,i)=>[min,[...new Set(axis)][i+1]]));
  const parts=[];
  for(const x of intervals[0])for(const y of intervals[1])for(const z of intervals[2]){
    const ranges=[x,y,z],included=[...wanted].some(face=>{const [axis,side]=FACE_SPECS[face],range=ranges[axis];return side===0?range[0]<thickness:range[1]>size-thickness;});
    if(included)parts.push({min:ranges.map(r=>r[0]),max:ranges.map(r=>r[1]),color:color.toLowerCase()});
  }
  return {size:[size,size,size],parts};
}

export function scaleCopiedPattern(copied,targetSize){
  if(!copied||!Array.isArray(copied.size)||copied.size.length!==3||!Number.isInteger(targetSize)||targetSize<1||targetSize>10000)throw Error("Invalid saved pattern.");
  let parts=[];
  for(const part of copied.parts||[]){
    const min=part.min.map((v,i)=>Math.round(v*targetSize/copied.size[i]));
    const max=part.max.map((v,i)=>Math.round(v*targetSize/copied.size[i]));
    if(min.some((v,i)=>v>=max[i]))continue;
    parts=edit(parts,{min,max},part.color);
  }
  if(!parts.length)throw Error("This pattern is too thin to scale to the selected cell.");
  return {size:[targetSize,targetSize,targetSize],parts};
}

export function migrateV2(data){
  if(data?.version!==2)return data;
  const objects=data.objects.map(old=>{
    const source=data.boxes.filter(b=>b.owner===old.id),origin=source.length?[0,1,2].map(i=>Math.min(...source.map(b=>b.min[i]))):[0,0,0];
    return {id:old.id,name:old.name,kind:old.kind,transform:{position:origin,rotation:[0,0,0]},boxes:source.map(b=>({min:b.min.map((v,i)=>v-origin[i]),max:b.max.map((v,i)=>v-origin[i]),color:b.color}))};
  });
  return {version:3,unit:"mm",room:{size:[10000,10000,10000]},objects};
}

export function validate(data){
  data=migrateV2(data);
  if(data?.version!==3||data.unit!=="mm"||!data.room||!Array.isArray(data.room.size)||data.room.size.length!==3||data.room.size.some(v=>v!==10000)||!Array.isArray(data.objects)||data.objects.length>1000)throw Error("Invalid spatial world JSON.");
  const ids=new Set();
  const objects=data.objects.map(o=>{
    if(!o||typeof o.id!=="string"||!o.id||ids.has(o.id)||typeof o.name!=="string"||o.name.length>100||!["fixed","movable"].includes(o.kind)||!o.transform||!Array.isArray(o.transform.position)||!Array.isArray(o.transform.rotation)||o.transform.position.length!==3||o.transform.rotation.length!==3||o.transform.position.some(v=>!Number.isInteger(v))||o.transform.rotation.some(v=>!Number.isInteger(v)||v%90!==0)||!Array.isArray(o.boxes)||o.boxes.length>30000)throw Error("Invalid object.");
    ids.add(o.id);
    const boxes=o.boxes.map(b=>{checkRegion(b);if(!/^#[0-9a-f]{6}$/i.test(b.color))throw Error("Invalid object color.");return {min:[...b.min],max:[...b.max],color:b.color.toLowerCase()};});
    const sorted=[...boxes].sort((a,b)=>a.min[0]-b.min[0]);let active=[];
    for(const box of sorted){active=active.filter(a=>a.max[0]>box.min[0]);if(active.some(a=>intersects(a,box)))throw Error("An object's local geometry overlaps itself.");active.push(box);}
    return {id:o.id,name:o.name,kind:o.kind,transform:{position:[...o.transform.position],rotation:o.transform.rotation.map(v=>((v%360)+360)%360)},boxes};
  });
  return {version:3,unit:"mm",room:{size:[...data.room.size]},objects};
}

export function cellFromCoordinates(region,xyz){
  if(!Array.isArray(xyz)||xyz.length!==3||xyz.some(n=>!Number.isInteger(n)||n<0||n>9))throw Error("Enter X, Y and Z as whole numbers from 0 to 9.");
  const size=(region.max[0]-region.min[0])/10,min=xyz.map((n,i)=>region.min[i]+n*size),cell={min,max:min.map(n=>n+size)};checkRegion(cell);return cell;
}

export function adjacentCell(cell,axis,delta,within=ROOT){
  checkRegion(cell);checkRegion(within);
  if(!Number.isInteger(axis)||axis<0||axis>2||![-1,1].includes(delta))throw Error("Choose a valid adjacent direction.");
  const distance=cell.max[axis]-cell.min[axis],next={min:[...cell.min],max:[...cell.max]};next.min[axis]+=delta*distance;next.max[axis]+=delta*distance;
  if(next.min.some((v,i)=>v<within.min[i]||next.max[i]>within.max[i]))throw Error("There is no cell in that direction in this view.");return next;
}

export function hasDetailedOccupancy(boxes,cell){
  checkRegion(cell);const parts=boxes.filter(b=>intersects(b,cell)).map(b=>clip(b,cell));if(!parts.length)return false;
  return parts.length!==1||!parts[0].min.every((v,i)=>v===cell.min[i]&&parts[0].max[i]===cell.max[i]);
}

export function validatePatterns(value){
  if(!Array.isArray(value)||value.length>500)throw Error("Invalid saved pattern data.");
  return value.map(pattern=>{
    const size=pattern?.copied?.size,parts=pattern?.copied?.parts;
    if(typeof pattern?.name!=="string"||!pattern.name.trim()||pattern.name.length>60||!Array.isArray(size)||size.length!==3||!size.every(n=>Number.isInteger(n)&&n>0&&n<=1000)||!Array.isArray(parts)||!parts.length||parts.length>30000)throw Error("Invalid saved pattern data.");
    const safeParts=parts.map(part=>{if(!part||!/^#[0-9a-f]{6}$/i.test(part.color)||!Array.isArray(part.min)||!Array.isArray(part.max)||part.min.length!==3||part.max.length!==3||!part.min.every((n,i)=>Number.isInteger(n)&&Number.isInteger(part.max[i])&&n>=0&&part.max[i]<=size[i]&&n<part.max[i]))throw Error("Invalid saved pattern data.");return {min:[...part.min],max:[...part.max],color:part.color};});
    for(let i=0;i<safeParts.length;i++)for(let j=i+1;j<safeParts.length;j++)if(intersects(safeParts[i],safeParts[j]))throw Error("Invalid saved pattern data.");
    return {name:pattern.name.trim(),copied:{size:[...size],parts:safeParts}};
  });
}
