const DB='block64-sparse-studio';
const STORE='projects';
const KEY='autosave';

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
export async function saveAutosave(project){ const db=await openDb(); return tx(db,'readwrite',s=>s.put(project,KEY)); }
export async function loadAutosave(){ const db=await openDb(); return tx(db,'readonly',s=>s.get(KEY)); }
export async function clearAutosave(){ const db=await openDb(); return tx(db,'readwrite',s=>s.delete(KEY)); }
function tx(db,mode,action){return new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode);const s=t.objectStore(STORE);const r=action(s);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close();});}
