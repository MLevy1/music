// Integer millimeters; disjoint boxes compress uniform occupied space.
export const ROOT = { min:[0,0,0], max:[10000,10000,10000] };
export const intersects=(a,b)=>a.min.every((v,i)=>v<b.max[i]&&a.max[i]>b.min[i]);
export function clip(a,b) {
  if(!intersects(a,b)) return null;
  return {...a,min:a.min.map((v,i)=>Math.max(v,b.min[i])),max:a.max.map((v,i)=>Math.min(v,b.max[i]))};
}
export function subtract(a,b) {
  const c=clip(a,b); if(!c)return [a];
  const out=[], rest={...a,min:[...a.min],max:[...a.max]};
  for(let i=0;i<3;i++){
    if(rest.min[i]<c.min[i]) {const p={...rest,min:[...rest.min],max:[...rest.max]};p.max[i]=c.min[i];out.push(p);rest.min[i]=c.min[i];}
    if(rest.max[i]>c.max[i]) {const p={...rest,min:[...rest.min],max:[...rest.max]};p.min[i]=c.max[i];out.push(p);rest.max[i]=c.max[i];}
  }
  return out;
}
export function edit(boxes,cell,owner,color) {
  const next=boxes.flatMap(b=>subtract(b,cell));
  if(owner)next.push({...cell,owner,color});
  if(next.length>30000)throw Error("This prototype supports 30,000 occupied regions. Export a backup before adding more detail.");
  return next;
}
export function move(boxes,objects,id,delta) {
  if(objects.find(o=>o.id===id)?.kind!=="movable")throw Error("Fixed objects cannot move. Change the classification first.");
  const moved=boxes.filter(b=>b.owner===id).map(b=>({...b,min:b.min.map((v,i)=>v+delta[i]),max:b.max.map((v,i)=>v+delta[i])}));
  if(moved.some(b=>b.min.some((v,i)=>v<0||b.max[i]>10000)))throw Error("The object would leave the room.");
  const others=boxes.filter(b=>b.owner!==id);
  if(moved.some(b=>others.some(o=>intersects(b,o))))throw Error("Movement blocked by occupied space.");
  return [...others,...moved];
}
export function validate(data) {
  if(data?.version!==2||data.unit!=="mm"||!Array.isArray(data.objects)||!Array.isArray(data.boxes)||data.boxes.length>30000||data.objects.length>1000)throw Error("Invalid spatial world JSON.");
  const ids=new Set();
  const objects=data.objects.map(o=>{
    if(!o||typeof o.id!=="string"||!o.id||ids.has(o.id)||typeof o.name!=="string"||o.name.length>100||!["fixed","movable"].includes(o.kind))throw Error("Invalid object.");
    ids.add(o.id);return {id:o.id,name:o.name,kind:o.kind};
  });
  const boxes=data.boxes.map(b=>{
    if(!b||!ids.has(b.owner)||!/^#[0-9a-f]{6}$/i.test(b.color)||!Array.isArray(b.min)||!Array.isArray(b.max)||b.min.length!==3||b.max.length!==3||!b.min.every((v,i)=>Number.isInteger(v)&&Number.isInteger(b.max[i])&&v>=0&&b.max[i]<=10000&&v<b.max[i]))throw Error("Invalid occupied region.");
    return {min:[...b.min],max:[...b.max],owner:b.owner,color:b.color};
  });
  // Sweep by X; reject overlapping imported occupancy before changing the current world.
  const sorted=[...boxes].sort((a,b)=>a.min[0]-b.min[0]);
  let active=[];
  for(const b of sorted){active=active.filter(a=>a.max[0]>b.min[0]);if(active.some(a=>intersects(a,b)))throw Error("Imported objects overlap.");active.push(b);}
  return {version:2,unit:"mm",objects,boxes};
}

// Bulk operations are computed completely before the caller replaces world state.
export function checkRegion(cell) {
  if(!cell || !Array.isArray(cell.min) || !Array.isArray(cell.max) || cell.min.length!==3 || cell.max.length!==3 || !cell.min.every((v,i)=>Number.isInteger(v)&&Number.isInteger(cell.max[i])&&v>=0&&cell.max[i]<=10000&&v<cell.max[i])) throw Error("Use positive dimensions in whole millimeters, within the room.");
}
export function fillRegion(boxes,cell,owner,color) {
  checkRegion(cell);
  if(boxes.some(b=>b.owner!==owner&&intersects(b,cell)))throw Error("Fill blocked by another object.");
  return edit(boxes,cell,owner,color);
}
export function eraseRegion(boxes,cell,owner) {
  checkRegion(cell);
  return boxes.flatMap(box=>box.owner===owner?subtract(box,cell):[box]);
}
export function recolorRegion(boxes,cell,owner,color) {
  checkRegion(cell);
  if(!/^#[0-9a-f]{6}$/i.test(color))throw Error("Choose a valid six-digit color first.");
  let found=false;
  const next=[];
  for(const box of boxes){
    if(box.owner!==owner||!intersects(box,cell)){next.push(box);continue;}
    found=true;
    const inside=clip(box,cell);
    next.push(...subtract(box,cell),{...inside,color:color.toLowerCase()});
  }
  if(!found)throw Error("The active object has no occupied space in this cell.");
  if(next.length>30000)throw Error("This recolor exceeds the 30,000 region limit.");
  return next;
}
export function copyCell(boxes,cell,owner) {
  checkRegion(cell);
  const parts=boxes.filter(b=>b.owner===owner).map(b=>clip(b,cell)).filter(Boolean).map(b=>({min:b.min.map((v,i)=>v-cell.min[i]),max:b.max.map((v,i)=>v-cell.min[i]),color:b.color}));
  if(!parts.length)throw Error("The active object has no occupied space in this cell.");
  return {size:cell.max.map((v,i)=>v-cell.min[i]),parts};
}
export function pasteCell(boxes,cell,owner,copied) {
  checkRegion(cell);
  if(!copied||copied.size.some((v,i)=>v!==cell.max[i]-cell.min[i]))throw Error("Select a destination cell at the copied scale.");
  const placed=copied.parts.map(b=>({...b,owner,min:b.min.map((v,i)=>v+cell.min[i]),max:b.max.map((v,i)=>v+cell.min[i])}));
  // Different objects may share a coarse cell (for example, furniture above a
  // thin floor). Only their actual occupied geometry is collision-relevant.
  if(placed.some(part=>boxes.some(b=>b.owner!==owner&&intersects(b,part))))throw Error("Paste blocked where another object overlaps the copied contents.");
  const next=boxes.flatMap(b=>b.owner===owner?subtract(b,cell):[b]);
  next.push(...placed);
  if(next.length>30000)throw Error("This paste exceeds the 30,000 region limit.");
  return next;
}

export function cellFromCoordinates(region,xyz) {
  if(!Array.isArray(xyz)||xyz.length!==3||xyz.some(n=>!Number.isInteger(n)||n<0||n>9))throw Error("Enter X, Y and Z as whole numbers from 0 to 9.");
  const size=(region.max[0]-region.min[0])/10;
  const min=xyz.map((n,i)=>region.min[i]+n*size);
  const cell={min,max:min.map(n=>n+size)};checkRegion(cell);return cell;
}

export function adjacentCell(cell,axis,delta,within=ROOT) {
  checkRegion(cell);checkRegion(within);
  if(!Number.isInteger(axis)||axis<0||axis>2||![-1,1].includes(delta))throw Error("Choose a valid adjacent direction.");
  const distance=cell.max[axis]-cell.min[axis];
  const next={min:[...cell.min],max:[...cell.max]};
  next.min[axis]+=delta*distance;next.max[axis]+=delta*distance;
  if(next.min.some((v,i)=>v<within.min[i]||next.max[i]>within.max[i]))throw Error("There is no cell in that direction in this view.");
  return next;
}

export function hasDetailedOccupancy(boxes,cell,owner) {
  checkRegion(cell);
  const parts=boxes.filter(b=>(owner===undefined||b.owner===owner)&&intersects(b,cell)).map(b=>clip(b,cell));
  if(!parts.length)return false;
  return parts.length!==1||!parts[0].min.every((v,i)=>v===cell.min[i]&&parts[0].max[i]===cell.max[i]);
}

export function validatePatterns(value) {
  if(!Array.isArray(value)||value.length>500)throw Error("Invalid saved pattern data.");
  return value.map(pattern=>{
    const size=pattern?.copied?.size,parts=pattern?.copied?.parts;
    if(typeof pattern?.name!=="string"||!pattern.name.trim()||pattern.name.length>60||!Array.isArray(size)||size.length!==3||!size.every(n=>Number.isInteger(n)&&n>0&&n<=1000)||!Array.isArray(parts)||!parts.length||parts.length>30000)throw Error("Invalid saved pattern data.");
    const safeParts=parts.map(part=>{
      if(!part||!/^#[0-9a-f]{6}$/i.test(part.color)||!Array.isArray(part.min)||!Array.isArray(part.max)||part.min.length!==3||part.max.length!==3||!part.min.every((n,i)=>Number.isInteger(n)&&Number.isInteger(part.max[i])&&n>=0&&part.max[i]<=size[i]&&n<part.max[i]))throw Error("Invalid saved pattern data.");
      return {min:[...part.min],max:[...part.max],color:part.color};
    });
    for(let i=0;i<safeParts.length;i++)for(let j=i+1;j<safeParts.length;j++)if(intersects(safeParts[i],safeParts[j]))throw Error("Invalid saved pattern data.");
    return {name:pattern.name.trim(),copied:{size:[...size],parts:safeParts}};
  });
}
