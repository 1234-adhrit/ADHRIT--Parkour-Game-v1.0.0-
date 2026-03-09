import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const STORAGE_KEYS = {
  bestTime: "skylineParkour.bestTime",
  playerName: "skylineParkour.playerName"
};

const CONFIG = {
  airAcceleration: 26,
  coyoteTime: 0.12,
  doubleJumpVelocity: 11.2,
  friction: 38,
  gravity: 32,
  jumpVelocity: 12.2,
  jumpVelocityWall: 11.6,
  maxFallSpeed: 36,
  playerHalfHeight: 0.9,
  playerRadius: 0.42,
  runSpeed: 12.5,
  sendIntervalMs: 50,
  sprintMultiplier: 1.32,
  wallJumpPush: 11.4,
  wallSlideSpeed: 5.4
};

const ui = {
  copyRoom: document.getElementById("copy-room"),
  createRoom: document.getElementById("create-room"),
  hud: document.getElementById("hud"),
  hudBest: document.getElementById("hud-best"),
  hudCheckpoint: document.getElementById("hud-checkpoint"),
  hudPlayers: document.getElementById("hud-players"),
  hudRoom: document.getElementById("hud-room"),
  hudTimer: document.getElementById("hud-timer"),
  hudTip: document.getElementById("hud-tip"),
  joinRoom: document.getElementById("join-room"),
  menu: document.getElementById("menu"),
  pausePanel: document.getElementById("pause-panel"),
  pauseRoomCode: document.getElementById("pause-room-code"),
  pauseRoomName: document.getElementById("pause-room-name"),
  playerName: document.getElementById("player-name"),
  refreshRooms: document.getElementById("refresh-rooms"),
  rendererCanvas: document.getElementById("game"),
  reticle: document.getElementById("reticle"),
  roomCode: document.getElementById("room-code"),
  roomList: document.getElementById("room-list"),
  roomName: document.getElementById("room-name"),
  resumeButton: document.getElementById("resume-button"),
  statusLine: document.getElementById("status-line"),
  toast: document.getElementById("toast")
};

const state = {
  bestTimeMs: Number(localStorage.getItem(STORAGE_KEYS.bestTime) || 0),
  checkpointIndex: 0,
  connected: false,
  connecting: false,
  elapsedMs: 0,
  finishedAt: 0,
  lastNetSend: 0,
  pitch: 0,
  playerColor: "#59f3c1",
  playerCount: 1,
  playerId: "",
  pointerLocked: false,
  remotePlayers: new Map(),
  roomCode: "",
  roomName: "",
  runStartedAt: 0,
  socket: null,
  toastTimer: null,
  yaw: 0
};

const input = {
  backward: false,
  jumpQueued: false,
  left: false,
  right: false,
  sprint: false,
  forward: false
};

const player = {
  coyoteTimer: 0,
  doubleJumpUsed: false,
  grounded: false,
  headBobClock: 0,
  position: new THREE.Vector3(0, 2.35, 0),
  spawn: new THREE.Vector3(0, 2.35, 0),
  velocity: new THREE.Vector3(),
  wallNormal: new THREE.Vector3(),
  wallSliding: false
};

const world = {
  animatedMaterials: [],
  boostPads: [],
  checkpoints: [],
  colliders: [],
  courseRoot: new THREE.Group(),
  finishBounds: null,
  remoteRoot: new THREE.Group()
};

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: ui.rendererCanvas
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07131b");
scene.fog = new THREE.Fog("#07131b", 80, 360);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const yawPivot = new THREE.Group();
const pitchPivot = new THREE.Group();
yawPivot.add(pitchPivot);
pitchPivot.add(camera);
scene.add(yawPivot);
scene.add(world.courseRoot);
scene.add(world.remoteRoot);

const clock = new THREE.Clock();
const scratch = {
  desiredDirection: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  tempColor: new THREE.Color()
};

camera.position.set(0, 0, 0);

ui.playerName.value = localStorage.getItem(STORAGE_KEYS.playerName) || "NeonRunner";
ui.hudBest.textContent = state.bestTimeMs ? formatTime(state.bestTimeMs) : "--";
ui.roomName.value = "Skyline Lobby";
updatePlayerColor();
setStatus("Create a room or join an existing server.");
updateHud();

buildScene();
refreshRooms();
setInterval(refreshRooms, 8000);
renderer.setAnimationLoop(frame);

ui.createRoom.addEventListener("click", createRoom);
ui.joinRoom.addEventListener("click", () => connectToRoom(ui.roomCode.value));
ui.refreshRooms.addEventListener("click", refreshRooms);
ui.resumeButton.addEventListener("click", lockPointer);
ui.copyRoom.addEventListener("click", copyRoomCode);
ui.rendererCanvas.addEventListener("click", () => {
  if (state.connected && !state.pointerLocked) {
    lockPointer();
  }
});
ui.playerName.addEventListener("change", () => {
  const name = ui.playerName.value.trim().slice(0, 18) || "NeonRunner";
  ui.playerName.value = name;
  localStorage.setItem(STORAGE_KEYS.playerName, name);
  updatePlayerColor();
});
ui.roomCode.addEventListener("input", () => {
  ui.roomCode.value = ui.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});
ui.roomCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    connectToRoom(ui.roomCode.value);
  }
});
ui.roomName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    createRoom();
  }
});

window.addEventListener("resize", onResize);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", clearInputState);
document.addEventListener("mousemove", onMouseMove);
document.addEventListener("pointerlockchange", onPointerLockChange);

function buildScene() {
  const hemiLight = new THREE.HemisphereLight(0xbceeff, 0x051018, 1.55);
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.85);
  sun.position.set(-60, 80, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -140;
  sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 140;
  sun.shadow.camera.bottom = -140;
  scene.add(sun);

  const fillLight = new THREE.PointLight(0x52d8ff, 65, 180, 2.1);
  fillLight.position.set(80, 40, -70);
  scene.add(fillLight);

  const skySun = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd4a1 })
  );
  skySun.position.set(-130, 120, -220);
  scene.add(skySun);

  const groundTexture = makePatternTexture(drawGroundPattern, 120, 120);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({
      color: "#091116",
      emissive: "#07101a",
      emissiveIntensity: 0.25,
      map: groundTexture,
      metalness: 0.15,
      roughness: 0.95
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -26;
  ground.receiveShadow = true;
  scene.add(ground);

  buildSkyline();
  buildCourse();
  resetRun();
}

function buildSkyline() {
  const glassTexture = makePatternTexture(drawWindowPattern, 4, 10);
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: "#8ecbff",
    emissive: "#12314e",
    emissiveIntensity: 0.42,
    map: glassTexture,
    metalness: 0.42,
    roughness: 0.28
  });

  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const radius = 160 + (index % 9) * 24 + Math.sin(index * 2.3) * 8;
    const width = 10 + (index % 5) * 4;
    const depth = 10 + (index % 7) * 3;
    const height = 30 + (index % 8) * 10 + Math.abs(Math.sin(index * 1.7)) * 24;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glassMaterial);
    mesh.position.set(Math.cos(angle) * radius, height / 2 - 24, Math.sin(angle) * radius - 20);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildCourse() {
  const textures = {
    concrete: makePatternTexture(drawConcretePattern, 2, 2),
    grass: makePatternTexture(drawGrassPattern, 4, 4),
    metal: makePatternTexture(drawMetalPattern, 3, 3)
  };

  const materials = {
    checkpointBeam: new THREE.MeshStandardMaterial({
      color: "#73f9ff",
      emissive: "#4be8ff",
      emissiveIntensity: 1.3,
      transparent: true,
      opacity: 0.35
    }),
    checkpointRing: new THREE.MeshStandardMaterial({
      color: "#8ef3ff",
      emissive: "#8ef3ff",
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.2
    }),
    concrete: new THREE.MeshStandardMaterial({
      color: "#aeb8c5",
      map: textures.concrete,
      metalness: 0.12,
      roughness: 0.84
    }),
    finish: new THREE.MeshStandardMaterial({
      color: "#ffd38d",
      emissive: "#f59e0b",
      emissiveIntensity: 1.1,
      metalness: 0.18,
      roughness: 0.28
    }),
    grass: new THREE.MeshStandardMaterial({
      color: "#7edd8f",
      map: textures.grass,
      metalness: 0.05,
      roughness: 0.94
    }),
    metal: new THREE.MeshStandardMaterial({
      color: "#4e6378",
      map: textures.metal,
      metalness: 0.48,
      roughness: 0.52
    }),
    neonRail: new THREE.MeshStandardMaterial({
      color: "#141d2b",
      emissive: "#57d8ff",
      emissiveIntensity: 0.9,
      metalness: 0.8,
      roughness: 0.25
    }),
    pad: new THREE.MeshStandardMaterial({
      color: "#ff956d",
      emissive: "#fb7185",
      emissiveIntensity: 1.2,
      metalness: 0.3,
      roughness: 0.3
    })
  };

  addPlatform({ size: [18, 2, 18], position: [0, 0, 0], material: materials.grass });
  addPlatform({ size: [10, 2, 10], position: [16, 3, -8], material: materials.concrete });
  addPlatform({ size: [10, 2, 10], position: [34, 6, -13], material: materials.concrete });
  addPlatform({ size: [10, 2, 10], position: [52, 10, -18], material: materials.concrete });
  addPlatform({ size: [20, 2, 10], position: [68, 14, -22], material: materials.metal });
  addPlatform({ size: [2, 12, 10], position: [58, 19, -22], material: materials.metal });
  addPlatform({ size: [2, 16, 10], position: [78, 21, -22], material: materials.metal });
  addPlatform({ size: [12, 2, 8], position: [68, 18, -34], material: materials.concrete });
  addPlatform({ size: [18, 2, 6], position: [86, 18, -34], material: materials.metal });
  addPlatform({ size: [12, 2, 12], position: [110, 24, -34], material: materials.concrete });
  addPlatform({ size: [10, 2, 2], position: [124, 26, -22], material: materials.metal });
  addPlatform({ size: [10, 2, 2], position: [138, 28, -14], material: materials.metal });
  addPlatform({ size: [10, 2, 2], position: [152, 30, -6], material: materials.metal });
  addPlatform({ size: [12, 2, 12], position: [166, 33, 4], material: materials.concrete });
  addPlatform({ size: [8, 2, 8], position: [176, 37, 10], material: materials.concrete });
  addPlatform({ size: [16, 2, 16], position: [188, 41, 16], material: materials.grass });

  addRail({ position: [68, 15.35, -16.2], size: [20, 0.25, 0.35], material: materials.neonRail });
  addRail({ position: [68, 15.35, -27.8], size: [20, 0.25, 0.35], material: materials.neonRail });
  addRail({ position: [86, 19.3, -31.4], size: [18, 0.22, 0.28], material: materials.neonRail });
  addRail({ position: [86, 19.3, -36.6], size: [18, 0.22, 0.28], material: materials.neonRail });

  addBoostPad({
    direction: [1, 0, 0],
    force: 46,
    material: materials.pad,
    position: [92, 19.1, -34],
    size: [6, 0.2, 5]
  });

  addStartBanner(materials.finish);
  addFinishArch(materials.finish);

  addCheckpoint({
    beamMaterial: materials.checkpointBeam,
    label: "Sky Garden",
    ringMaterial: materials.checkpointRing,
    ringPosition: [16, 6.25, -8],
    spawnPosition: [16, 4.95, -8]
  });
  addCheckpoint({
    beamMaterial: materials.checkpointBeam,
    label: "Rooftop Edge",
    ringMaterial: materials.checkpointRing,
    ringPosition: [52, 13.25, -18],
    spawnPosition: [52, 11.95, -18]
  });
  addCheckpoint({
    beamMaterial: materials.checkpointBeam,
    label: "Neon Lane",
    ringMaterial: materials.checkpointRing,
    ringPosition: [68, 21.25, -34],
    spawnPosition: [68, 19.95, -34]
  });
  addCheckpoint({
    beamMaterial: materials.checkpointBeam,
    label: "Boost Tower",
    ringMaterial: materials.checkpointRing,
    ringPosition: [110, 27.3, -34],
    spawnPosition: [110, 25.95, -34]
  });
  addCheckpoint({
    beamMaterial: materials.checkpointBeam,
    label: "Needle Run",
    ringMaterial: materials.checkpointRing,
    ringPosition: [166, 36.2, 4],
    spawnPosition: [166, 34.95, 4]
  });

  const finishLabel = makeTextSprite("FINISH", "#ffefad", "#291507");
  finishLabel.position.set(188, 48, 16);
  finishLabel.scale.set(8.6, 2.3, 1);
  world.courseRoot.add(finishLabel);
}

function addPlatform({ position, size, material }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  world.courseRoot.add(mesh);

  world.colliders.push({
    halfSize: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
    position: mesh.position.clone()
  });
}

function addRail({ position, size, material }) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  rail.position.set(position[0], position[1], position[2]);
  world.courseRoot.add(rail);
  world.animatedMaterials.push({ material, base: material.emissiveIntensity, speed: 1.3 });
}

function addBoostPad({ direction, force, material, position, size }) {
  const pad = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  pad.position.set(position[0], position[1], position[2]);
  pad.castShadow = true;
  pad.receiveShadow = true;
  pad.userData.boost = {
    direction: new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
    force,
    halfSize: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
    homeIntensity: material.emissiveIntensity
  };
  world.courseRoot.add(pad);
  world.animatedMaterials.push({ material, base: material.emissiveIntensity, speed: 2.5 });
  world.boostPads.push(pad);
}

function addStartBanner(material) {
  const postGeometry = new THREE.BoxGeometry(0.6, 7, 0.6);
  const leftPost = new THREE.Mesh(postGeometry, material);
  const rightPost = new THREE.Mesh(postGeometry, material);
  leftPost.position.set(-5.2, 4, -5.2);
  rightPost.position.set(5.2, 4, -5.2);

  const topBar = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.45, 0.6), material);
  topBar.position.set(0, 7.2, -5.2);

  const label = makeTextSprite("SKYLINE", "#fff6d0", "#1b0f05");
  label.position.set(0, 7.2, -4.6);
  label.scale.set(6.4, 1.7, 1);

  world.courseRoot.add(leftPost, rightPost, topBar, label);
}

function addFinishArch(material) {
  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.5, 0.7), material);
  const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.5, 0.7), material);
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.55, 0.7), material);
  leftPost.position.set(182.7, 46.2, 16);
  rightPost.position.set(193.3, 46.2, 16);
  topBar.position.set(188, 50.25, 16);
  world.courseRoot.add(leftPost, rightPost, topBar);

  world.finishBounds = {
    halfSize: new THREE.Vector3(5.6, 3.8, 5.6),
    position: new THREE.Vector3(188, 45.8, 16)
  };
}

function addCheckpoint({ beamMaterial, label, ringMaterial, ringPosition, spawnPosition }) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.16, 16, 48), ringMaterial.clone());
  ring.rotation.x = Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 5, 12), beamMaterial.clone());
  const labelSprite = makeTextSprite(label, "#e6fbff", "#0a1117");
  labelSprite.position.set(0, 2.8, 0);
  labelSprite.scale.set(5.8, 1.45, 1);
  group.position.set(ringPosition[0], ringPosition[1], ringPosition[2]);
  group.add(beam, ring, labelSprite);
  world.courseRoot.add(group);

  world.checkpoints.push({
    beam,
    group,
    homeY: ringPosition[1],
    label,
    radius: 2.6,
    ring,
    spawnPosition: new THREE.Vector3(spawnPosition[0], spawnPosition[1], spawnPosition[2])
  });
}

function makePatternTexture(drawFn, repeatX, repeatY) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  drawFn(context, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function drawConcretePattern(context, width, height) {
  context.fillStyle = "#9ea7b4";
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < 1800; index += 1) {
    const shade = 132 + Math.floor(Math.random() * 70);
    context.fillStyle = `rgb(${shade}, ${shade}, ${shade + 8})`;
    context.fillRect(Math.random() * width, Math.random() * height, Math.random() * 3 + 1, Math.random() * 3 + 1);
  }
  context.strokeStyle = "rgba(50, 61, 72, 0.2)";
  context.lineWidth = 2;
  for (let index = 0; index < 7; index += 1) {
    context.beginPath();
    context.moveTo(Math.random() * width, Math.random() * height);
    context.lineTo(Math.random() * width, Math.random() * height);
    context.stroke();
  }
}

function drawGrassPattern(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#7fe08d");
  gradient.addColorStop(1, "#2d6b42");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < 2200; index += 1) {
    context.fillStyle = index % 3 === 0 ? "rgba(168, 255, 165, 0.35)" : "rgba(25, 68, 31, 0.22)";
    context.fillRect(Math.random() * width, Math.random() * height, 2, 7);
  }
}

function drawMetalPattern(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#71839a");
  gradient.addColorStop(1, "#374757");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(217, 237, 255, 0.18)";
  context.lineWidth = 3;
  for (let index = 0; index < 9; index += 1) {
    const y = (index / 8) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawWindowPattern(context, width, height) {
  context.fillStyle = "#112437";
  context.fillRect(0, 0, width, height);
  for (let column = 0; column < 7; column += 1) {
    for (let row = 0; row < 12; row += 1) {
      const active = Math.random() > 0.35;
      context.fillStyle = active ? "rgba(172, 235, 255, 0.95)" : "rgba(42, 70, 96, 0.55)";
      context.fillRect(12 + column * 34, 10 + row * 20, 18, 10);
    }
  }
}

function drawGroundPattern(context, width, height) {
  context.fillStyle = "#081018";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(114, 217, 255, 0.12)";
  context.lineWidth = 2;
  for (let index = 0; index <= 16; index += 1) {
    const t = (index / 16) * width;
    context.beginPath();
    context.moveTo(t, 0);
    context.lineTo(t, height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, t);
    context.lineTo(width, t);
    context.stroke();
  }
}

function makeTextSprite(text, foreground, background) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background;
  roundRect(context, 8, 12, canvas.width - 16, canvas.height - 24, 28);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = foreground;
  context.font = '700 54px "Space Grotesk", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    depthWrite: false,
    map: texture,
    transparent: true
  });
  return new THREE.Sprite(material);
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function shouldIgnoreKeyEvent(event) {
  const isTextInput =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement;

  return isTextInput && !ui.menu.classList.contains("hidden");
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
  if (shouldIgnoreKeyEvent(event)) {
    return;
  }

  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === "KeyW") {
    input.forward = true;
  } else if (event.code === "KeyS") {
    input.backward = true;
  } else if (event.code === "KeyA") {
    input.left = true;
  } else if (event.code === "KeyD") {
    input.right = true;
  } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    input.sprint = true;
  } else if (event.code === "Space") {
    input.jumpQueued = true;
  } else if (event.code === "KeyR") {
    if (state.finishedAt) {
      resetRun();
      showToast("Run reset.");
    } else {
      respawn("Checkpoint reset.");
    }
  }
}

function onKeyUp(event) {
  if (shouldIgnoreKeyEvent(event)) {
    return;
  }

  if (event.code === "KeyW") {
    input.forward = false;
  } else if (event.code === "KeyS") {
    input.backward = false;
  } else if (event.code === "KeyA") {
    input.left = false;
  } else if (event.code === "KeyD") {
    input.right = false;
  } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    input.sprint = false;
  }
}

function onMouseMove(event) {
  if (!state.pointerLocked) {
    return;
  }

  state.yaw -= event.movementX * 0.0023;
  state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.0018, -1.45, 1.45);
}

function onPointerLockChange() {
  state.pointerLocked = document.pointerLockElement === ui.rendererCanvas;
  ui.pausePanel.classList.toggle("hidden", !state.connected || state.pointerLocked);
  ui.reticle.classList.toggle("hidden", !state.connected || !state.pointerLocked);
}

function clearInputState() {
  input.backward = false;
  input.forward = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.jumpQueued = false;
}

function lockPointer() {
  if (state.connected) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ui.rendererCanvas.requestPointerLock();
  }
}

async function copyRoomCode() {
  if (!state.roomCode) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.roomCode);
    showToast(`Copied ${state.roomCode}`);
  } catch {
    showToast(`Room code: ${state.roomCode}`);
  }
}

async function createRoom() {
  const name = sanitizeName(ui.roomName.value, 24) || "Skyline Lobby";
  savePlayerName();
  setStatus("Creating server...");

  try {
    const response = await fetch("/api/rooms", {
      body: JSON.stringify({ name }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Room creation failed.");
    }

    const payload = await response.json();
    ui.roomCode.value = payload.code;
    connectToRoom(payload.code);
  } catch (error) {
    setStatus(error.message || "Unable to create a room.", true);
  }
}

async function refreshRooms() {
  try {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load rooms.");
    }
    const payload = await response.json();
    renderRooms(payload.rooms || []);
  } catch {
    renderRooms([]);
  }
}

function renderRooms(rooms) {
  ui.roomList.innerHTML = "";

  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-empty";
    empty.textContent = "No live rooms yet. Create a server to start a lobby.";
    ui.roomList.append(empty);
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card";

    const title = document.createElement("h3");
    title.textContent = room.name;

    const code = document.createElement("span");
    code.className = "room-code";
    code.textContent = room.code;

    const meta = document.createElement("div");
    meta.className = "room-meta";
    meta.innerHTML = `<span>${room.playerCount} player${room.playerCount === 1 ? "" : "s"}</span><span>${formatAge(room.lastActive)}</span>`;

    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Join";
    button.addEventListener("click", () => {
      ui.roomCode.value = room.code;
      connectToRoom(room.code);
    });

    card.append(title, code, meta, button);
    ui.roomList.append(card);
  });
}

function connectToRoom(roomCode) {
  const code = sanitizeName(roomCode, 5).toUpperCase();
  const playerName = savePlayerName();

  if (!code || code.length < 5) {
    setStatus("Enter a valid 5-character room code.", true);
    return;
  }

  if (state.connecting) {
    return;
  }

  teardownSocket();
  state.connecting = true;
  ui.roomCode.value = code;
  setStatus(`Connecting to ${code}...`);

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/socket`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        color: state.playerColor,
        playerName,
        roomCode: code,
        type: "join"
      })
    );
  });

  socket.addEventListener("message", (event) => {
    let payload;

    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    handleServerMessage(payload);
  });

  socket.addEventListener("close", () => {
    const hadSession = state.connected || state.connecting;
    state.connecting = false;
    state.connected = false;
    state.socket = null;
    state.playerId = "";
    state.playerCount = 1;
    removeAllRemotePlayers();
    updateHud();
    ui.pausePanel.classList.add("hidden");
    ui.reticle.classList.add("hidden");
    if (hadSession) {
      ui.menu.classList.remove("hidden");
      showToast("Disconnected from room.");
      setStatus("Connection closed.", true);
    }
  });

  socket.addEventListener("error", () => {
    setStatus("Connection failed.", true);
  });
}

function handleServerMessage(payload) {
  if (payload.type === "error") {
    setStatus(payload.message || "Server error.", true);
    showToast(payload.message || "Server error.");
    return;
  }

  if (payload.type === "welcome") {
    state.connecting = false;
    state.connected = true;
    state.playerId = payload.playerId;
    state.roomCode = payload.roomCode;
    state.roomName = payload.roomName;
    removeAllRemotePlayers();
    (payload.players || []).forEach(syncRemotePlayer);
    state.playerCount = (payload.players || []).length || 1;
    ui.menu.classList.add("hidden");
    ui.pausePanel.classList.remove("hidden");
    ui.pauseRoomCode.textContent = state.roomCode;
    ui.pauseRoomName.textContent = state.roomName;
    resetRun();
    setStatus(`Joined ${payload.roomName} (${payload.roomCode})`);
    showToast(`Joined ${payload.roomCode}. Click resume to lock mouse.`);
    updateHud();
    return;
  }

  if (payload.type === "player_joined") {
    syncRemotePlayer(payload.player);
    state.playerCount = state.remotePlayers.size + 1;
    updateHud();
    return;
  }

  if (payload.type === "player_left") {
    removeRemotePlayer(payload.playerId);
    state.playerCount = state.remotePlayers.size + 1;
    updateHud();
    return;
  }

  if (payload.type === "snapshot") {
    const activeIds = new Set();
    (payload.players || []).forEach((remote) => {
      activeIds.add(remote.id);
      syncRemotePlayer(remote);
    });

    for (const remoteId of Array.from(state.remotePlayers.keys())) {
      if (!activeIds.has(remoteId)) {
        removeRemotePlayer(remoteId);
      }
    }

    state.playerCount = activeIds.size || 1;
    updateHud();
  }
}

function syncRemotePlayer(data) {
  if (!data || data.id === state.playerId) {
    return;
  }

  let remote = state.remotePlayers.get(data.id);
  if (!remote) {
    remote = createRemoteAvatar(data);
    state.remotePlayers.set(data.id, remote);
    world.remoteRoot.add(remote.group);
  }

  remote.targetPosition.set(data.position.x, data.position.y, data.position.z);
  remote.targetYaw = data.yaw || 0;
  remote.lastSeen = performance.now();
}

function createRemoteAvatar(data) {
  const group = new THREE.Group();
  const bodyColor = new THREE.Color(data.color || "#59f3c1");
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: bodyColor.clone().multiplyScalar(0.22),
    metalness: 0.28,
    roughness: 0.38
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.42), bodyMaterial);
  torso.castShadow = true;
  torso.position.y = -0.05;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 18),
    new THREE.MeshStandardMaterial({ color: "#fff4dc", roughness: 0.78 })
  );
  head.castShadow = true;
  head.position.y = 0.78;

  const tag = makeTextSprite(data.name || "Runner", "#e9fcff", "#0b1116");
  tag.position.set(0, 1.55, 0);
  tag.scale.set(3.3, 0.85, 1);

  group.add(torso, head, tag);
  group.position.set(data.position.x, data.position.y, data.position.z);
  group.rotation.y = data.yaw || 0;

  return {
    group,
    targetPosition: group.position.clone(),
    targetYaw: group.rotation.y
  };
}

function removeRemotePlayer(playerId) {
  const remote = state.remotePlayers.get(playerId);
  if (!remote) {
    return;
  }

  world.remoteRoot.remove(remote.group);
  state.remotePlayers.delete(playerId);
}

function removeAllRemotePlayers() {
  for (const remoteId of Array.from(state.remotePlayers.keys())) {
    removeRemotePlayer(remoteId);
  }
}

function teardownSocket() {
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    socket.close();
  }
}

function savePlayerName() {
  const name = sanitizeName(ui.playerName.value, 18) || "NeonRunner";
  ui.playerName.value = name;
  localStorage.setItem(STORAGE_KEYS.playerName, name);
  updatePlayerColor();
  return name;
}

function sanitizeName(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function updatePlayerColor() {
  const name = sanitizeName(ui.playerName.value, 18) || "NeonRunner";
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  scratch.tempColor.setHSL(hue / 360, 0.78, 0.62);
  state.playerColor = `#${scratch.tempColor.getHexString()}`;
}

function resetRun() {
  player.position.copy(player.spawn.set(0, 2.35, 0));
  player.velocity.set(0, 0, 0);
  player.grounded = false;
  player.coyoteTimer = 0;
  player.doubleJumpUsed = false;
  player.wallNormal.set(0, 0, 0);
  player.wallSliding = false;
  state.checkpointIndex = 0;
  state.runStartedAt = 0;
  state.finishedAt = 0;
  state.elapsedMs = 0;
  state.yaw = 0;
  state.pitch = 0;
  updateCheckpointVisuals();
  updateHud();
}

function respawn(message) {
  player.position.copy(player.spawn);
  player.velocity.set(0, 0, 0);
  player.grounded = false;
  player.coyoteTimer = 0;
  player.doubleJumpUsed = false;
  player.wallNormal.set(0, 0, 0);
  player.wallSliding = false;
  if (message) {
    showToast(message);
  }
}

function updateCheckpointVisuals() {
  world.checkpoints.forEach((checkpoint, index) => {
    const reached = index < state.checkpointIndex;
    const next = index === state.checkpointIndex;
    checkpoint.beam.material.opacity = next ? 0.5 : reached ? 0.24 : 0.18;
    checkpoint.beam.material.emissiveIntensity = next ? 1.6 : reached ? 0.85 : 0.55;
    checkpoint.ring.material.emissiveIntensity = next ? 1.8 : reached ? 1.05 : 0.65;
    checkpoint.ring.material.color.set(next ? "#ffffff" : reached ? "#8ef3ff" : "#5ba9bc");
  });
}

function beginRunIfNeeded() {
  if (!state.connected || state.runStartedAt || state.finishedAt) {
    return;
  }

  state.runStartedAt = performance.now();
}

function frame() {
  const delta = Math.min(clock.getDelta(), 0.033);
  const now = performance.now();
  updateAnimatedMaterials(now);
  updateRemoteAvatars(delta);
  updatePlayer(delta, now);
  updateCamera(delta);
  sendNetworkState(now);
  renderer.render(scene, camera);
}

function updateAnimatedMaterials(now) {
  world.animatedMaterials.forEach((entry, index) => {
    const wave = Math.sin(now * 0.001 * entry.speed + index * 0.7) * 0.22;
    entry.material.emissiveIntensity = entry.base + wave;
  });

  world.checkpoints.forEach((checkpoint, index) => {
    checkpoint.group.rotation.y += 0.008;
    checkpoint.group.position.y = checkpoint.homeY + Math.sin(now * 0.0018 + index * 0.6) * 0.22;
  });
}

function updateRemoteAvatars(delta) {
  state.remotePlayers.forEach((remote) => {
    remote.group.position.lerp(remote.targetPosition, 1 - Math.exp(-delta * 10));
    remote.group.rotation.y = lerpAngle(remote.group.rotation.y, remote.targetYaw, 1 - Math.exp(-delta * 10));
  });
}

function updatePlayer(delta, now) {
  if (state.runStartedAt && !state.finishedAt) {
    state.elapsedMs = now - state.runStartedAt;
  } else if (!state.runStartedAt) {
    state.elapsedMs = 0;
  }

  player.coyoteTimer = Math.max(0, player.coyoteTimer - delta);
  player.wallNormal.set(0, 0, 0);
  player.wallSliding = false;

  const desiredDirection = getDesiredDirection();
  const speedMultiplier = input.sprint ? CONFIG.sprintMultiplier : 1;
  const moveSpeed = CONFIG.runSpeed * speedMultiplier;
  const targetVelocityX = desiredDirection.x * moveSpeed;
  const targetVelocityZ = desiredDirection.z * moveSpeed;
  const acceleration = player.grounded ? 62 : CONFIG.airAcceleration;
  const change = acceleration * delta;

  player.velocity.x = approach(player.velocity.x, targetVelocityX, change);
  player.velocity.z = approach(player.velocity.z, targetVelocityZ, change);

  if (!player.grounded && desiredDirection.lengthSq() < 0.01) {
    player.velocity.x = approach(player.velocity.x, 0, delta * 1.2);
    player.velocity.z = approach(player.velocity.z, 0, delta * 1.2);
  }

  if (player.grounded && desiredDirection.lengthSq() < 0.01) {
    const frictionStep = CONFIG.friction * delta;
    player.velocity.x = approach(player.velocity.x, 0, frictionStep);
    player.velocity.z = approach(player.velocity.z, 0, frictionStep);
  }

  if (input.jumpQueued) {
    beginRunIfNeeded();
    if (player.grounded || player.coyoteTimer > 0) {
      player.velocity.y = CONFIG.jumpVelocity;
      player.grounded = false;
      player.coyoteTimer = 0;
      player.doubleJumpUsed = false;
    } else if (player.wallNormal.lengthSq() > 0.1) {
      player.velocity.y = CONFIG.jumpVelocityWall;
      player.velocity.x += player.wallNormal.x * CONFIG.wallJumpPush;
      player.velocity.z += player.wallNormal.z * CONFIG.wallJumpPush;
      player.doubleJumpUsed = false;
    } else if (!player.doubleJumpUsed) {
      player.velocity.y = CONFIG.doubleJumpVelocity;
      player.doubleJumpUsed = true;
      showToast("Double jump");
    }
    input.jumpQueued = false;
  }

  if (desiredDirection.lengthSq() > 0.01) {
    beginRunIfNeeded();
  }

  player.velocity.y -= CONFIG.gravity * delta;
  player.velocity.y = Math.max(player.velocity.y, -CONFIG.maxFallSpeed);

  player.grounded = false;
  moveAndCollide("x", player.velocity.x * delta);
  moveAndCollide("y", player.velocity.y * delta);
  moveAndCollide("z", player.velocity.z * delta);

  if (!player.grounded && player.wallNormal.lengthSq() > 0.01 && player.velocity.y < 0 && desiredDirection.dot(player.wallNormal) < -0.15) {
    player.wallSliding = true;
    player.velocity.y = Math.max(player.velocity.y, -CONFIG.wallSlideSpeed);
  }

  applyBoostPads(delta);
  handleCheckpoints();
  handleFinish(now);

  if (player.position.y < -30) {
    respawn("Back to checkpoint.");
  }

  player.headBobClock += delta * (player.grounded ? 10 + Math.min(1.2, desiredDirection.length()) * 3 : 2.5);
  updateHud();
}

function getDesiredDirection() {
  scratch.forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)).normalize();
  scratch.right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw)).normalize();
  scratch.desiredDirection.set(0, 0, 0);

  if (input.forward) {
    scratch.desiredDirection.add(scratch.forward);
  }
  if (input.backward) {
    scratch.desiredDirection.sub(scratch.forward);
  }
  if (input.right) {
    scratch.desiredDirection.add(scratch.right);
  }
  if (input.left) {
    scratch.desiredDirection.sub(scratch.right);
  }

  if (scratch.desiredDirection.lengthSq() > 1) {
    scratch.desiredDirection.normalize();
  }

  return scratch.desiredDirection;
}

function moveAndCollide(axis, amount) {
  player.position[axis] += amount;

  for (const collider of world.colliders) {
    if (
      Math.abs(player.position.x - collider.position.x) >= CONFIG.playerRadius + collider.halfSize.x ||
      Math.abs(player.position.y - collider.position.y) >= CONFIG.playerHalfHeight + collider.halfSize.y ||
      Math.abs(player.position.z - collider.position.z) >= CONFIG.playerRadius + collider.halfSize.z
    ) {
      continue;
    }

    if (axis === "x") {
      if (amount > 0) {
        player.position.x = collider.position.x - collider.halfSize.x - CONFIG.playerRadius;
        player.wallNormal.set(-1, 0, 0);
      } else if (amount < 0) {
        player.position.x = collider.position.x + collider.halfSize.x + CONFIG.playerRadius;
        player.wallNormal.set(1, 0, 0);
      }
      player.velocity.x = 0;
    } else if (axis === "y") {
      if (amount > 0) {
        player.position.y = collider.position.y - collider.halfSize.y - CONFIG.playerHalfHeight;
        player.velocity.y = Math.min(player.velocity.y, 0);
      } else if (amount < 0) {
        player.position.y = collider.position.y + collider.halfSize.y + CONFIG.playerHalfHeight;
        player.velocity.y = 0;
        player.grounded = true;
        player.coyoteTimer = CONFIG.coyoteTime;
        player.doubleJumpUsed = false;
      }
    } else if (axis === "z") {
      if (amount > 0) {
        player.position.z = collider.position.z - collider.halfSize.z - CONFIG.playerRadius;
        player.wallNormal.set(0, 0, -1);
      } else if (amount < 0) {
        player.position.z = collider.position.z + collider.halfSize.z + CONFIG.playerRadius;
        player.wallNormal.set(0, 0, 1);
      }
      player.velocity.z = 0;
    }
  }
}

function applyBoostPads(delta) {
  for (const pad of world.boostPads) {
    const boost = pad.userData.boost;
    const feetY = player.position.y - CONFIG.playerHalfHeight;
    const onTop = Math.abs(feetY - (pad.position.y + boost.halfSize.y)) < 0.35;
    const inside =
      Math.abs(player.position.x - pad.position.x) <= CONFIG.playerRadius + boost.halfSize.x &&
      Math.abs(player.position.z - pad.position.z) <= CONFIG.playerRadius + boost.halfSize.z;

    if (onTop && inside) {
      beginRunIfNeeded();
      player.velocity.addScaledVector(boost.direction, boost.force * delta);
      pad.material.emissiveIntensity = boost.homeIntensity + 0.6;
      ui.hudTip.textContent = "Boost pad engaged. Keep sprinting through the gap.";
    } else {
      pad.material.emissiveIntensity = THREE.MathUtils.lerp(pad.material.emissiveIntensity, boost.homeIntensity, 0.18);
    }
  }
}

function handleCheckpoints() {
  const checkpoint = world.checkpoints[state.checkpointIndex];
  if (!checkpoint) {
    return;
  }

  if (player.position.distanceTo(checkpoint.group.position) <= checkpoint.radius) {
    player.spawn.copy(checkpoint.spawnPosition);
    state.checkpointIndex += 1;
    updateCheckpointVisuals();
    showToast(`Checkpoint: ${checkpoint.label}`);
    ui.hudTip.textContent = state.checkpointIndex === world.checkpoints.length ? "Final stretch. Hit the finish arch." : "Checkpoint saved.";
  }
}

function handleFinish(now) {
  if (!world.finishBounds || state.finishedAt || state.checkpointIndex < world.checkpoints.length) {
    return;
  }

  const inside =
    Math.abs(player.position.x - world.finishBounds.position.x) <= world.finishBounds.halfSize.x &&
    Math.abs(player.position.y - world.finishBounds.position.y) <= world.finishBounds.halfSize.y &&
    Math.abs(player.position.z - world.finishBounds.position.z) <= world.finishBounds.halfSize.z;

  if (!inside) {
    return;
  }

  state.finishedAt = now;
  state.elapsedMs = state.runStartedAt ? now - state.runStartedAt : state.elapsedMs;
  const timeLabel = formatTime(state.elapsedMs);
  ui.hudTip.textContent = `Finish time ${timeLabel}. Press R to run it again.`;
  showToast(`Finished in ${timeLabel}`);

  if (!state.bestTimeMs || state.elapsedMs < state.bestTimeMs) {
    state.bestTimeMs = state.elapsedMs;
    localStorage.setItem(STORAGE_KEYS.bestTime, String(Math.round(state.bestTimeMs)));
    ui.hudBest.textContent = formatTime(state.bestTimeMs);
    showToast(`New best: ${formatTime(state.bestTimeMs)}`);
  }
}

function updateCamera(delta) {
  const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  const bob =
    state.pointerLocked && player.grounded && horizontalSpeed > 0.6
      ? Math.sin(player.headBobClock) * 0.055 * Math.min(1, horizontalSpeed / (CONFIG.runSpeed * CONFIG.sprintMultiplier))
      : 0;

  yawPivot.position.copy(player.position);
  yawPivot.position.y += 0.55 + bob;
  yawPivot.rotation.y = state.yaw;
  pitchPivot.rotation.x = state.pitch;

  const targetFov = 75 + Math.min(7, Math.max(0, horizontalSpeed - 10) * 0.65);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-delta * 7));
  camera.updateProjectionMatrix();
}

function sendNetworkState(now) {
  if (!state.connected || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (now - state.lastNetSend < CONFIG.sendIntervalMs) {
    return;
  }

  state.lastNetSend = now;
  state.socket.send(
    JSON.stringify({
      checkpoint: state.checkpointIndex,
      pitch: Number(state.pitch.toFixed(4)),
      position: compactVector(player.position),
      type: "state",
      velocity: compactVector(player.velocity),
      yaw: Number(state.yaw.toFixed(4))
    })
  );
}

function compactVector(vector) {
  return {
    x: Number(vector.x.toFixed(3)),
    y: Number(vector.y.toFixed(3)),
    z: Number(vector.z.toFixed(3))
  };
}

function updateHud() {
  ui.hud.classList.toggle("hidden", !state.connected);
  ui.hudRoom.textContent = state.connected ? `${state.roomName} (${state.roomCode})` : "Offline";
  ui.hudPlayers.textContent = String(state.playerCount || 1);
  ui.hudCheckpoint.textContent = `${state.checkpointIndex} / ${world.checkpoints.length}`;
  ui.hudTimer.textContent = formatTime(state.elapsedMs);
  ui.hudBest.textContent = state.bestTimeMs ? formatTime(state.bestTimeMs) : "--";
}

function setStatus(message, isError = false) {
  ui.statusLine.textContent = message;
  ui.statusLine.style.color = isError ? "#ffb4a5" : "";
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => ui.toast.classList.add("hidden"), 2200);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milliseconds = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatAge(timestamp) {
  const deltaMs = Math.max(0, Date.now() - Number(timestamp || Date.now()));
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function approach(current, target, amount) {
  if (current < target) {
    return Math.min(current + amount, target);
  }
  return Math.max(current - amount, target);
}

function lerpAngle(current, target, alpha) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * alpha;
}

