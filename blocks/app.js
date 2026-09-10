import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const WORLD_SIZE = 20;
const WORLD_MIN = -10;
const WORLD_MAX = 9;
const WORLD_HEIGHT = 20;
const STORAGE_KEY = "block32-world-v1";
const CUBE_LIMIT = 5000;

const colors = [
  ["Signal red", "#ff5349"],
  ["Tangerine", "#ff7a2f"],
  ["Amber", "#f5a623"],
  ["Sun", "#f5d547"],
  ["Lime", "#a8db4b"],
  ["Leaf", "#48b85b"],
  ["Emerald", "#1ba784"],
  ["Teal", "#16a6a1"],
  ["Cyan", "#35bce3"],
  ["Sky", "#4a9df1"],
  ["Cobalt", "#4263d8"],
  ["Indigo", "#5c52c9"],
  ["Violet", "#8756d9"],
  ["Purple", "#ae54cf"],
  ["Magenta", "#dd4eab"],
  ["Pink", "#f06292"],
  ["Wine", "#9f304d"],
  ["Brick", "#a74435"],
  ["Brown", "#82563a"],
  ["Sand", "#c79b63"],
  ["Cream", "#ead9a5"],
  ["Mint", "#91d4b1"],
  ["Ice", "#b5e2e8"],
  ["Powder", "#b8ccec"],
  ["Lilac", "#c3b5e7"],
  ["White", "#f1f2ed"],
  ["Silver", "#b7bdc7"],
  ["Gray", "#7f8793"],
  ["Slate", "#535c68"],
  ["Charcoal", "#343941"],
  ["Black", "#17191e"],
  ["Copper", "#c46f44"]
];

const canvas = document.querySelector("#viewport");
const viewportWrap = document.querySelector(".viewport-wrap");
const cubeCount = document.querySelector("#cube-count");
const saveState = document.querySelector("#save-state");
const selectedColorName = document.querySelector("#selected-color-name");
const palette = document.querySelector("#palette");
const placeButton = document.querySelector("#place-tool");
const eraseButton = document.querySelector("#erase-tool");
const fileInput = document.querySelector("#file-input");
const toast = document.querySelector("#toast");
const loadingNote = document.querySelector("#loading-note");

let activeColor = colors[0][1];
let activeTool = "place";
let toastTimer;
let pointerStart = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f13);
scene.fog = new THREE.Fog(0x0d0f13, 24, 54);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(14, 13, 17);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 7;
controls.maxDistance = 42;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 1.5, 0);

scene.add(new THREE.HemisphereLight(0xc7d9ff, 0x16100d, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(-7, 15, 9);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -16;
keyLight.shadow.camera.right = 16;
keyLight.shadow.camera.top = 16;
keyLight.shadow.camera.bottom = -16;
scene.add(keyLight);

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x171a20,
  roughness: 0.92,
  metalness: 0.02
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.025;
ground.receiveShadow = true;
ground.userData.isGround = true;
scene.add(ground);

const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE, 0x59616e, 0x343a44);
grid.material.transparent = true;
grid.material.opacity = 0.78;
scene.add(grid);

const boundary = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(WORLD_SIZE, 0.04, WORLD_SIZE)),
  new THREE.LineBasicMaterial({ color: 0x747d8b, transparent: true, opacity: 0.8 })
);
boundary.position.y = -0.02;
scene.add(boundary);

const cubeGeometry = new THREE.BoxGeometry(0.96, 0.96, 0.96);
const materialCache = new Map();
const cubes = new Map();
const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

const hoverMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.13,
  depthWrite: false
});
const hover = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), hoverMaterial);
hover.visible = false;
scene.add(hover);

const hoverEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
);
hover.add(hoverEdges);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function cubeKey(x, y, z) {
  return `${x},${y},${z}`;
}

function materialFor(color) {
  if (!materialCache.has(color)) {
    materialCache.set(
      color,
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 })
    );
  }
  return materialCache.get(color);
}

function inBounds(x, y, z) {
  return x >= WORLD_MIN && x <= WORLD_MAX && z >= WORLD_MIN && z <= WORLD_MAX && y >= 0 && y < WORLD_HEIGHT;
}

function addCube(x, y, z, color, persist = true) {
  if (!inBounds(x, y, z) || cubes.has(cubeKey(x, y, z)) || cubes.size >= CUBE_LIMIT) return false;
  const mesh = new THREE.Mesh(cubeGeometry, materialFor(color));
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { x, y, z, color };
  cubes.set(cubeKey(x, y, z), mesh);
  cubeGroup.add(mesh);
  if (persist) persistWorld();
  return true;
}

function removeCube(mesh, persist = true) {
  const { x, y, z } = mesh.userData;
  cubes.delete(cubeKey(x, y, z));
  cubeGroup.remove(mesh);
  if (persist) persistWorld();
}

function clearWorld(persist = true) {
  for (const mesh of cubes.values()) cubeGroup.remove(mesh);
  cubes.clear();
  hover.visible = false;
  if (persist) persistWorld();
  updateMeta();
}

function serializeWorld() {
  return {
    version: 1,
    size: WORLD_SIZE,
    cubes: Array.from(cubes.values())
      .map(({ userData }) => ({
        x: userData.x,
        y: userData.y,
        z: userData.z,
        color: userData.color
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
  };
}

function persistWorld() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWorld()));
    saveState.textContent = "Saved locally";
  } catch {
    saveState.textContent = "Local save unavailable";
  }
  updateMeta();
}

function updateMeta() {
  cubeCount.textContent = `${cubes.size} ${cubes.size === 1 ? "cube" : "cubes"}`;
}

function validateWorld(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.cubes)) {
    throw new Error("This is not a Block/32 world file.");
  }
  if (data.cubes.length > CUBE_LIMIT) throw new Error(`Worlds may contain up to ${CUBE_LIMIT} cubes.`);
  const seen = new Set();
  return data.cubes.map((cube) => {
    const validNumbers = [cube.x, cube.y, cube.z].every(Number.isInteger);
    const validColor = typeof cube.color === "string" && /^#[0-9a-f]{6}$/i.test(cube.color);
    if (!validNumbers || !validColor || !inBounds(cube.x, cube.y, cube.z)) {
      throw new Error("The world contains an invalid cube.");
    }
    const key = cubeKey(cube.x, cube.y, cube.z);
    if (seen.has(key)) throw new Error("The world contains duplicate cubes.");
    seen.add(key);
    return { x: cube.x, y: cube.y, z: cube.z, color: cube.color.toLowerCase() };
  });
}

function loadWorld(data, announce = true) {
  const validated = validateWorld(data);
  clearWorld(false);
  for (const cube of validated) addCube(cube.x, cube.y, cube.z, cube.color, false);
  persistWorld();
  if (announce) showToast(`Loaded ${validated.length} ${validated.length === 1 ? "cube" : "cubes"}.`);
}

function restoreLocalWorld() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return;
  try {
    loadWorld(JSON.parse(stored), false);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    showToast("The local save could not be read, so a new world was opened.");
  }
}

function setTool(tool) {
  activeTool = tool;
  const placing = tool === "place";
  placeButton.classList.toggle("active", placing);
  eraseButton.classList.toggle("active", !placing);
  placeButton.setAttribute("aria-pressed", String(placing));
  eraseButton.setAttribute("aria-pressed", String(!placing));
  canvas.style.cursor = placing ? "crosshair" : "not-allowed";
  hover.visible = false;
}

function createPalette() {
  colors.forEach(([name, value], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `swatch${index === 0 ? " selected" : ""}`;
    button.style.setProperty("--swatch", value);
    button.dataset.color = value;
    button.dataset.name = name;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === 0));
    button.setAttribute("aria-label", name);
    button.title = name;
    button.addEventListener("click", () => {
      activeColor = value;
      selectedColorName.textContent = name;
      palette.querySelectorAll(".swatch").forEach((swatch) => {
        const selected = swatch === button;
        swatch.classList.toggle("selected", selected);
        swatch.setAttribute("aria-selected", String(selected));
      });
      setTool("place");
    });
    palette.append(button);
  });
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pickTarget(event) {
  updatePointer(event);
  const cubeHits = raycaster.intersectObjects(Array.from(cubes.values()), false);
  if (cubeHits.length) {
    const hit = cubeHits[0];
    if (activeTool === "erase") return { type: "cube", mesh: hit.object };
    const source = hit.object.userData;
    const normal = hit.face.normal;
    return {
      type: "cell",
      x: source.x + Math.round(normal.x),
      y: source.y + Math.round(normal.y),
      z: source.z + Math.round(normal.z)
    };
  }
  if (activeTool === "erase") return null;
  const groundHit = raycaster.intersectObject(ground, false)[0];
  if (!groundHit) return null;
  return {
    type: "cell",
    x: Math.floor(groundHit.point.x),
    y: 0,
    z: Math.floor(groundHit.point.z)
  };
}

function updateHover(event) {
  const target = pickTarget(event);
  if (!target) {
    hover.visible = false;
    return;
  }
  const data = target.type === "cube" ? target.mesh.userData : target;
  if (!inBounds(data.x, data.y, data.z)) {
    hover.visible = false;
    return;
  }
  hover.position.set(data.x + 0.5, data.y + 0.5, data.z + 0.5);
  hoverMaterial.color.set(activeTool === "erase" ? 0xff5349 : activeColor);
  hoverEdges.material.color.set(activeTool === "erase" ? 0xff8c86 : 0xffffff);
  hover.visible = true;
}

function editAt(event) {
  const target = pickTarget(event);
  if (!target) return;
  if (target.type === "cube") {
    removeCube(target.mesh);
    return;
  }
  if (addCube(target.x, target.y, target.z, activeColor)) {
    hover.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function exportWorld() {
  const json = JSON.stringify(serializeWorld(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `block32-world-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("World saved as JSON.");
}

function resetView() {
  camera.position.set(14, 13, 17);
  controls.target.set(0, 1.5, 0);
  controls.update();
}

function zoomView(factor) {
  const offset = camera.position.clone().sub(controls.target);
  const distance = THREE.MathUtils.clamp(
    offset.length() * factor,
    controls.minDistance,
    controls.maxDistance
  );
  camera.position.copy(controls.target).add(offset.setLength(distance));
  controls.update();
}

function resize() {
  const { clientWidth, clientHeight } = viewportWrap;
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

placeButton.addEventListener("click", () => setTool("place"));
eraseButton.addEventListener("click", () => setTool("erase"));
document.querySelector("#save-button").addEventListener("click", exportWorld);
document.querySelector("#load-button").addEventListener("click", () => fileInput.click());
document.querySelector("#clear-button").addEventListener("click", () => {
  if (cubes.size && window.confirm("Clear every cube in this world?")) {
    clearWorld();
    showToast("World cleared.");
  }
});
document.querySelector("#reset-view").addEventListener("click", resetView);
document.querySelector("#zoom-in").addEventListener("click", () => zoomView(0.82));
document.querySelector("#zoom-out").addEventListener("click", () => zoomView(1.22));

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  fileInput.value = "";
  if (!file) return;
  try {
    loadWorld(JSON.parse(await file.text()));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "The JSON file could not be loaded.");
  }
});

canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointermove", updateHover);
canvas.addEventListener("pointerleave", () => {
  hover.visible = false;
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  if (moved < 5 && event.button === 0) editAt(event);
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "p") setTool("place");
  if (event.key.toLowerCase() === "e") setTool("erase");
});
window.addEventListener("resize", resize);

createPalette();
restoreLocalWorld();
updateMeta();
resize();
loadingNote.remove();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
