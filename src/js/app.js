const $ = (sel) => document.querySelector(sel);

const AFRAME = window.AFRAME;
const THREE = window.THREE;

if (!AFRAME || !THREE) {
  console.error(
    "VirtuMuseum: A-Frame/THREE not available. Ensure aframe.min.js loads before src/js/app.js.",
  );
}

function isDebugOn() {
  return localStorage.getItem("virtumuseum.debug") === "1";
}

function dlog(...args) {
  if (!isDebugOn()) return;
}

window.VirtuMuseumDebug = {
  enable() {
    localStorage.setItem("virtumuseum.debug", "1");
  },
  disable() {
    localStorage.setItem("virtumuseum.debug", "0");
  },
  status() {
    return isDebugOn();
  },
};

(function installGltfUrlBackslashFix() {
  try {
    const mgr = window.THREE?.DefaultLoadingManager;
    if (!mgr || mgr.__virtumuseumUrlFix) return;
    mgr.__virtumuseumUrlFix = true;
    mgr.setURLModifier((url) =>
      typeof url === "string" ? url.replace(/\\/g, "/") : url,
    );
  } catch {}
})();

let suppressTeleportUntilMs = 0;

let experienceMode = "welcome";

function isTouchDevice() {
  try {
    if (navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia?.("(pointer: coarse)")?.matches) return true;
    return "ontouchstart" in window;
  } catch {
    return false;
  }
}

function syncBodyModeClasses() {
  try {
    document.body.classList.toggle("is-tour", experienceMode === "tour");
    document.body.classList.toggle("is-explore", experienceMode === "explore");
    document.body.classList.toggle("is-welcome", experienceMode === "welcome");
    document.body.classList.toggle("is-touch", isTouchDevice());
    syncMobileJoystickVisibility();
  } catch {}
}

const joystickState = {
  active: false,
  pointerId: null,
  x: 0,
  y: 0,
  radiusPx: 0,
  centerX: 0,
  centerY: 0,
};

function setJoystickVector(nx, ny) {
  joystickState.x = clamp(nx, -1, 1);
  joystickState.y = clamp(ny, -1, 1);
}

function resetJoystick() {
  joystickState.active = false;
  joystickState.pointerId = null;
  setJoystickVector(0, 0);
  const stick = $("#mobileJoystickStick");
  if (stick) stick.style.transform = "translate(-50%, -50%)";
}

function syncMobileJoystickVisibility() {
  const el = $("#mobileJoystick");
  if (!el) return;
  const menuOpen = $("#menuPanel")?.classList.contains("is-open");
  const welcomeVisible = !$("#welcome")?.classList.contains("is-hidden");
  const tourC = $("#tour")?.components?.["tour-guide"];
  const inTour = experienceMode === "tour" || !!tourC?.running;

  const shouldShow =
    isTouchDevice() &&
    experienceMode === "explore" &&
    !welcomeVisible &&
    !menuOpen &&
    !inTour;

  el.classList.toggle("is-hidden", !shouldShow);
  el.setAttribute("aria-hidden", String(!shouldShow));
}

function getMoveSpeedUi() {
  return clamp(
    Number(localStorage.getItem("virtumuseum.moveSpeed") || "2") || 2,
    1,
    6,
  );
}

function getMoveSpeedUnitsPerSec() {
  return getMoveSpeedUi() * 1.54;
}

function getKeyboardMoveVector() {
  let x = 0;
  let y = 0;

  const has = (k) => movementKeysDown.has(k);

  if (has("w")) y += 1;
  if (has("s")) y -= 1;
  if (has("d")) x += 1;
  if (has("a")) x -= 1;

  if (has("ArrowUp") || has("arrowup")) y += 1;
  if (has("ArrowDown") || has("arrowdown")) y -= 1;
  if (has("ArrowRight") || has("arrowright")) x += 1;
  if (has("ArrowLeft") || has("arrowleft")) x -= 1;

  const m = Math.hypot(x, y);
  if (m > 1e-6 && m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y };
}

function applyManualMove(dtMs, x, y) {
  if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) return;

  const rig = $("#rig");
  const cam = $("#cam");
  if (!rig || !cam) return;

  const menuOpen = $("#menuPanel")?.classList.contains("is-open");
  const welcomeVisible = !$("#welcome")?.classList.contains("is-hidden");
  const tourC = $("#tour")?.components?.["tour-guide"];
  const inTour = experienceMode === "tour" || !!tourC?.running;
  if (experienceMode !== "explore" || welcomeVisible || menuOpen || inTour)
    return;

  const THREE = window.THREE;
  if (!THREE) return;

  const speed = getMoveSpeedUnitsPerSec();
  const dt = Math.max(0, Number(dtMs) || 0) / 1000;

  const forward = new THREE.Vector3();
  const camObj = cam.getObject3D?.("camera") || cam.object3D;
  camObj.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) return;
  forward.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  const delta = new THREE.Vector3();
  delta.addScaledVector(forward, y);
  delta.addScaledVector(right, x);

  const mag = delta.length();
  if (mag > 1) delta.multiplyScalar(1 / mag);
  delta.multiplyScalar(speed * dt);

  const pObj = rig.object3D?.position;
  const pAttr = rig.getAttribute("position");
  const px = Number.isFinite(Number(pObj?.x)) ? Number(pObj.x) : pAttr?.x || 0;
  const py = Number.isFinite(Number(pObj?.y)) ? Number(pObj.y) : pAttr?.y || 0;
  const pz = Number.isFinite(Number(pObj?.z)) ? Number(pObj.z) : pAttr?.z || 0;
  const next = {
    x: px + delta.x,
    y: py,
    z: pz + delta.z,
  };

  const bounds = getBoundsForRig(rig);
  const clamped = clampPosToBounds(next, bounds);
  if (
    Math.abs(clamped.x - next.x) > 1e-4 ||
    Math.abs(clamped.z - next.z) > 1e-4
  ) {
    notifyWallHit();
    debugWalls("manualMove_clamped", rig, {
      nextPos: next,
      clampedPos: clamped,
    });
  } else {
    debugWalls("manualMove", rig, { nextPos: next, clampedPos: clamped });
  }

  if (rig.object3D?.position) {
    rig.object3D.position.set(clamped.x, clamped.y, clamped.z);
  }
  rig.setAttribute("position", vec3ToString(clamped));
}

function startManualMovementLoop() {
  let last = performance.now();
  const frame = (now) => {
    const dt = now - last;
    last = now;

    const k = getKeyboardMoveVector();

    const jx = joystickState.active ? joystickState.x : 0;
    const jy = joystickState.active ? joystickState.y : 0;

    applyManualMove(dt, k.x + jx, k.y + jy);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function moveRigFromJoystick(dtMs) {
  applyManualMove(dtMs, joystickState.x, joystickState.y);
}

function initMobileJoystick() {
  const wrap = $("#mobileJoystick");
  const base = $("#mobileJoystickBase");
  const stick = $("#mobileJoystickStick");
  if (!wrap || !base || !stick) return;

  const supportsPointerEvents = "PointerEvent" in window;

  const refreshCenter = () => {
    const r = base.getBoundingClientRect();
    joystickState.radiusPx = Math.max(1, Math.min(r.width, r.height) * 0.42);
    joystickState.centerX = r.left + r.width / 2;
    joystickState.centerY = r.top + r.height / 2;
  };

  const updateStick = (clientX, clientY) => {
    const dx = clientX - joystickState.centerX;
    const dy = clientY - joystickState.centerY;

    const maxR = joystickState.radiusPx;
    const d = Math.hypot(dx, dy) || 0;
    const k = d > maxR ? maxR / d : 1;
    const clampedX = dx * k;
    const clampedY = dy * k;

    setJoystickVector(clampedX / maxR, -clampedY / maxR);

    stick.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
  };

  const onDown = (e) => {
    if (!isTouchDevice()) return;
    if (experienceMode !== "explore") return;
    if (wrap.classList.contains("is-hidden")) return;

    e.preventDefault?.();
    refreshCenter();
    joystickState.active = true;
    joystickState.pointerId = e.pointerId ?? null;
    try {
      base.setPointerCapture?.(e.pointerId);
    } catch {}
    updateStick(e.clientX, e.clientY);
  };

  const onMove = (e) => {
    if (!joystickState.active) return;
    if (
      joystickState.pointerId != null &&
      e.pointerId !== joystickState.pointerId
    )
      return;
    e.preventDefault?.();
    updateStick(e.clientX, e.clientY);
  };

  const onUp = (e) => {
    if (
      joystickState.pointerId != null &&
      e.pointerId !== joystickState.pointerId
    )
      return;
    resetJoystick();
  };

  base.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });

  if (!supportsPointerEvents) {
    const getTouch = (ev) => {
      const t = ev?.changedTouches?.[0] || ev?.touches?.[0];
      if (!t) return null;
      return { id: t.identifier, x: t.clientX, y: t.clientY };
    };

    base.addEventListener(
      "touchstart",
      (ev) => {
        const t = getTouch(ev);
        if (!t) return;
        if (!isTouchDevice()) return;
        if (experienceMode !== "explore") return;
        if (wrap.classList.contains("is-hidden")) return;

        ev.preventDefault?.();
        refreshCenter();
        joystickState.active = true;
        joystickState.pointerId = t.id;
        updateStick(t.x, t.y);
      },
      { passive: false },
    );

    window.addEventListener(
      "touchmove",
      (ev) => {
        if (!joystickState.active) return;
        const t = getTouch(ev);
        if (!t) return;
        if (joystickState.pointerId != null && t.id !== joystickState.pointerId)
          return;
        ev.preventDefault?.();
        updateStick(t.x, t.y);
      },
      { passive: false },
    );

    const endTouch = (ev) => {
      const t = getTouch(ev);
      if (!t) {
        resetJoystick();
        return;
      }
      if (joystickState.pointerId != null && t.id !== joystickState.pointerId)
        return;
      resetJoystick();
    };
    window.addEventListener("touchend", endTouch, { passive: true });
    window.addEventListener("touchcancel", endTouch, { passive: true });
  }

  window.addEventListener("resize", () => {
    resetJoystick();
    syncBodyModeClasses();
  });
}

const AMBIENT_URL = "src/assets/audio/jazz.mp3";

let infoCardCollapsed = false;
let infoCardImageHidden = false;

const movementKeysDown = new Set();

function isInfoCardOpen() {
  return !$("#infoCard")?.classList.contains("is-hidden");
}

function setInfoCardCollapsed(collapsed) {
  infoCardCollapsed = !!collapsed;
  $("#infoCard")?.classList.toggle("is-collapsed", infoCardCollapsed);
  const btn = $("#btnInfoToggle");
  if (btn) btn.textContent = infoCardCollapsed ? "Show" : "Hide";
}

function setInfoCardImageHidden(hidden) {
  infoCardImageHidden = !!hidden;

  const img = $("#infoCardImg");
  if (!img) return;
  const hasSrc = !!img.getAttribute("src");
  img.classList.toggle("is-hidden", !hasSrc || infoCardImageHidden);
  const btn = $("#btnInfoImgToggle");
  if (btn) btn.textContent = infoCardImageHidden ? "Image: OFF" : "Image: ON";
}

const PAINTINGS_URL = "src/data/paintings.json";
let paintingsByCodePromise = null;

function pad3(n) {
  const s = String(n);
  return s.padStart(3, "0");
}

async function loadPaintingsByCode() {
  if (paintingsByCodePromise) return paintingsByCodePromise;
  paintingsByCodePromise = (async () => {
    const r = await fetch(PAINTINGS_URL, { cache: "no-store" });
    const json = await r.json();
    const arr = Array.isArray(json?.paintings) ? json.paintings : [];
    const map = {};
    for (const p of arr) {
      const code = typeof p?.code === "string" ? p.code.trim() : "";
      if (!code) continue;
      map[code] = p;
    }
    return map;
  })().catch(() => ({}));
  return paintingsByCodePromise;
}

function inferPaintingCodeFromStop(stop, idx) {
  if (stop?.code != null) {
    const c = String(stop.code).trim();
    return c ? c : null;
  }

  const t = String(stop?.title || "").trim();
  const m = t.match(/^(quadro|painting)\s*(\d+)$/i);
  if (m) return pad3(Number(m[2]));

  if (Number.isInteger(idx) && idx > 0) {
    const n = idx;
    if (n >= 1 && n <= 999) return pad3(n);
  }

  return null;
}

async function openPaintingInfoByCode(code) {
  const c = String(code || "").trim();
  if (!c) return;

  const byCode = await loadPaintingsByCode();
  const p = byCode?.[c];

  if (!p) {
    showToast(`No information available for painting ${c}.`);
    return;
  }

  const { title, desc } = formatPaintingDesc(p);
  const imgUrl = imageUrlForPainting(p);

  setInfoCardImage(imgUrl || "", title || "");
  showInfoCard(
    title || `Painting ${c}`,
    desc || "",
    experienceMode === "tour"
      ? "Use ← / → to navigate. (Esc ends the tour)"
      : "",
  );

  const ttsOn = localStorage.getItem("virtumuseum.tts") === "1";
  if (ttsOn) {
    const t = `${title}. ${String(desc || "").replace(/\n+/g, " ")}`;
    speak(t);
  }
}

window.VirtuMuseum = window.VirtuMuseum || {};
window.VirtuMuseum.openPaintingInfoByCode = openPaintingInfoByCode;

function imageUrlForPainting(p) {
  const type = String(p?.type || "")
    .trim()
    .toLowerCase();
  const code = String(p?.code || "").trim();
  if (!code) return "";

  const folderByType = {
    room1: "room1",
    room2: "room2",
    room3: "room3",
    room4: "room4",
  };

  const folder = folderByType[type];
  if (!folder) return "";
  const ext = code === "038" ? "jpeg" : "jpg";
  return `src/assets/images/${folder}/${code}.${ext}`;
}

function formatPaintingDesc(p) {
  const title = String(p?.title || "").trim();
  const author = String(p?.author || "").trim();
  const year = String(p?.year || "").trim();
  const materials = String(p?.materials || "").trim();
  const description = String(p?.description || "").trim();
  const history = String(p?.history || "").trim();
  const symbolism = String(p?.symbolism || "").trim();
  const type = String(p?.type || "").trim();

  const head = [author, year].filter(Boolean).join(" • ");
  const meta = [materials, type].filter(Boolean).join(" • ");

  const lines = [];
  if (head) lines.push(head);
  if (meta) lines.push(meta);
  if (head || meta) lines.push("");

  if (description) lines.push(description);

  if (history) {
    lines.push("");
    lines.push("History");
    lines.push(history);
  }

  if (symbolism) {
    lines.push("");
    lines.push("Symbolism");
    lines.push(symbolism);
  }

  return { title, desc: lines.join("\n") };
}

async function enrichStopsWithPaintings(stops) {
  if (!Array.isArray(stops) || !stops.length) return;
  const byCode = await loadPaintingsByCode();
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const code = inferPaintingCodeFromStop(stop, i);
    if (!code) continue;
    const p = byCode?.[code];
    if (!p) continue;

    const formatted = formatPaintingDesc(p);
    if (formatted.title) stop.title = formatted.title;
    if (formatted.desc) stop.desc = formatted.desc;
    stop.paintingCode = code;
    stop.imageUrl = imageUrlForPainting(p);
  }
}

function isFullscreen() {
  return !!document.fullscreenElement;
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    showToast("Fullscreen is not available in this browser.");
  }
}

function syncFullscreenButtons() {
  const label = isFullscreen() ? "Exit fullscreen" : "Fullscreen";
  $("#btnFullscreen") && ($("#btnFullscreen").textContent = label);
  $("#btnFullscreenWelcome") &&
    ($("#btnFullscreenWelcome").textContent = label);
}

function setTeleportEnabled(enabled) {
  const floor = $("#teleportFloor");
  if (!floor) return;

  if (enabled) return;

  if (floor.hasAttribute("teleport-surface")) {
    floor.removeAttribute("teleport-surface");
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseVec3String(v) {
  if (typeof v !== "string") return null;
  const parts = v
    .trim()
    .split(/\s+/)
    .map((n) => Number(n));
  if (parts.length < 3) return null;
  const [x, y, z] = parts;
  if (![x, y, z].every((n) => Number.isFinite(n))) return null;
  return { x, y, z };
}

function vec3ToString(p) {
  return `${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`;
}

function getBoundsForRig(rigEl) {
  if (activeGalleryBounds) return activeGalleryBounds;

  if (activeGalleryWallCenters) {
    try {
      return collisionBoundsFromWallCenters(activeGalleryWallCenters);
    } catch {}
  }
  const bk = rigEl?.components?.["bounds-keeper"];
  const d = bk?.data;
  if (!d) return { minX: -60, maxX: 60, minZ: -80, maxZ: 80, y: 0 };
  return {
    minX: Number(d.minX),
    maxX: Number(d.maxX),
    minZ: Number(d.minZ),
    maxZ: Number(d.maxZ),
    y: Number(d.y),
  };
}

function clampPosToBounds(pos, bounds) {
  return {
    x: clamp(pos.x, bounds.minX, bounds.maxX),
    y: bounds.y,
    z: clamp(pos.z, bounds.minZ, bounds.maxZ),
  };
}

const WALL_BOX_THICKNESS = 0.12;

const PLAYER_RADIUS = 0.28;

const DEFAULT_GALLERY_BOUNDS = {
  minX: -22.0,
  maxX: 14.0,
  minZ: -13.0,
  maxZ: 14.0,
  y: 0,
};

let activeGalleryBounds = null;
let activeGalleryWallCenters = null;

const WALL_TWEAK = {
  north: -0.1,
  south: -1.2,
  east: 0.25,
  west: 0.85,
};

function applyWallTweak(bounds) {
  const b = { ...bounds };

  b.maxZ = Number(b.maxZ) - Number(WALL_TWEAK.north || 0);
  b.minZ = Number(b.minZ) + Number(WALL_TWEAK.south || 0);

  b.maxX = Number(b.maxX) - Number(WALL_TWEAK.east || 0);
  b.minX = Number(b.minX) + Number(WALL_TWEAK.west || 0);

  if (b.maxX <= b.minX) {
    const mid = (b.maxX + b.minX) / 2;
    b.minX = mid - 0.1;
    b.maxX = mid + 0.1;
  }
  if (b.maxZ <= b.minZ) {
    const mid = (b.maxZ + b.minZ) / 2;
    b.minZ = mid - 0.1;
    b.maxZ = mid + 0.1;
  }
  return b;
}

let lastWallHitAt = 0;
function notifyWallHit() {
  const now = performance.now();
  if (now - lastWallHitAt < 900) return;
  lastWallHitAt = now;
  showToast("Wall.");
}

function isDebugWallsEnabled() {
  try {
    if (window.__DEBUG_WALLS === true) return true;
    return localStorage.getItem("virtumuseum.debugWalls") === "1";
  } catch {
    return false;
  }
}

let lastWallDebugAt = 0;
function debugWalls(reason, rigEl, { nextPos = null, clampedPos = null } = {}) {
  if (!isDebugWallsEnabled()) return;
  const now = performance.now();
  if (now - lastWallDebugAt < 250) return;
  lastWallDebugAt = now;

  const rig = rigEl || $("#rig");
  if (!rig) return;

  const bounds = getBoundsForRig(rig);
  const pAttr = rig.getAttribute("position");
  const pObj = rig.object3D?.position;
  const pos = {
    x: Number.isFinite(Number(pObj?.x)) ? Number(pObj.x) : Number(pAttr?.x),
    y: Number.isFinite(Number(pObj?.y)) ? Number(pObj.y) : Number(pAttr?.y),
    z: Number.isFinite(Number(pObj?.z)) ? Number(pObj.z) : Number(pAttr?.z),
  };
  if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return;
  const inside =
    pos.x >= bounds.minX &&
    pos.x <= bounds.maxX &&
    pos.z >= bounds.minZ &&
    pos.z <= bounds.maxZ;

  const dist = {
    west: pos.x - bounds.minX,
    east: bounds.maxX - pos.x,
    south: pos.z - bounds.minZ,
    north: bounds.maxZ - pos.z,
  };

  const eps = 0.06;
  const touching = {
    west: dist.west <= eps,
    east: dist.east <= eps,
    south: dist.south <= eps,
    north: dist.north <= eps,
  };

  const clamped =
    !!clampedPos &&
    (Math.abs(Number(clampedPos.x) - Number(nextPos?.x)) > 1e-4 ||
      Math.abs(Number(clampedPos.z) - Number(nextPos?.z)) > 1e-4);
}

window.VirtuMuseum = window.VirtuMuseum || {};
window.VirtuMuseum.setDebugWalls = (on) => {
  try {
    const v = on ? "1" : "0";
    localStorage.setItem("virtumuseum.debugWalls", v);
    window.__DEBUG_WALLS = !!on;
  } catch {
    window.__DEBUG_WALLS = !!on;
  }
};

function computeBoundsFromStops(stops, pad = 2.25) {
  if (!Array.isArray(stops) || !stops.length) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  let found = 0;

  for (const s of stops) {
    const p = parseVec3String(String(s?.pos || ""));
    if (!p) continue;
    found++;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  if (!found) return null;
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minZ: minZ - pad,
    maxZ: maxZ + pad,
    y: 0,
  };
}

function ensureVisualWalls(bounds) {
  const scene = document.querySelector("a-scene");
  if (!scene) return;

  const ensure = (id) => {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement("a-box");
    el.setAttribute("id", id);
    el.setAttribute(
      "material",
      "color: rgb(255, 255, 255); opacity: 0.18; transparent: true; side: double",
    );
    el.setAttribute("shadow", "cast: false; receive: false");
    scene.appendChild(el);
    return el;
  };

  const wallH = 3;
  const thick = WALL_BOX_THICKNESS;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const w = Math.max(0.1, bounds.maxX - bounds.minX);
  const d = Math.max(0.1, bounds.maxZ - bounds.minZ);

  const n = ensure("wallNorth");
  n.setAttribute("width", w);
  n.setAttribute("height", wallH);
  n.setAttribute("depth", thick);
  n.setAttribute("position", `${cx} ${wallH / 2} ${bounds.maxZ}`);

  const s = ensure("wallSouth");
  s.setAttribute("width", w);
  s.setAttribute("height", wallH);
  s.setAttribute("depth", thick);
  s.setAttribute("position", `${cx} ${wallH / 2} ${bounds.minZ}`);

  const e = ensure("wallEast");
  e.setAttribute("width", thick);
  e.setAttribute("height", wallH);
  e.setAttribute("depth", d);
  e.setAttribute("position", `${bounds.maxX} ${wallH / 2} ${cz}`);

  const o = ensure("wallWest");
  o.setAttribute("width", thick);
  o.setAttribute("height", wallH);
  o.setAttribute("depth", d);
  o.setAttribute("position", `${bounds.minX} ${wallH / 2} ${cz}`);
}

function collisionBoundsFromWallCenters(wallCenters) {
  const inset = WALL_BOX_THICKNESS / 2 + PLAYER_RADIUS;
  return {
    minX: Number(wallCenters.minX) + inset,
    maxX: Number(wallCenters.maxX) - inset,
    minZ: Number(wallCenters.minZ) + inset,
    maxZ: Number(wallCenters.maxZ) - inset,
    y: Number(wallCenters.y ?? 0),
  };
}

function applyFourWalls(bounds, { visual = true } = {}) {
  const rig = $("#rig");
  if (!rig || !bounds) return;
  const raw = {
    minX: Number(bounds.minX),
    maxX: Number(bounds.maxX),
    minZ: Number(bounds.minZ),
    maxZ: Number(bounds.maxZ),
    y: Number(bounds.y ?? 0),
  };
  if (![raw.minX, raw.maxX, raw.minZ, raw.maxZ, raw.y].every(Number.isFinite))
    return;

  const wallCenters = applyWallTweak(raw);
  activeGalleryWallCenters = wallCenters;

  const collision = collisionBoundsFromWallCenters(wallCenters);

  activeGalleryBounds = collision;

  rig.setAttribute(
    "bounds-keeper",
    `minX: ${collision.minX}; maxX: ${collision.maxX}; minZ: ${collision.minZ}; maxZ: ${collision.maxZ}; y: ${collision.y}`,
  );

  if (visual) ensureVisualWalls(wallCenters);

  debugWalls("applyFourWalls", rig, { nextPos: null, clampedPos: null });
}

function setZoomFov(fov) {
  const cam = $("#cam");
  if (!cam) return;
  const v = clamp(Number(fov) || 80, 30, 90);
  cam.setAttribute("camera", "fov", v);
  localStorage.setItem("virtumuseum.fov", String(v));

  const sliderV = clamp(120 - v, 30, 90);
  $("#rngZoom") && ($("#rngZoom").value = String(sliderV));
}

function setZoomFromSlider(sliderValue) {
  const sv = clamp(Number(sliderValue) || 60, 30, 90);
  const fov = clamp(120 - sv, 30, 90);
  setZoomFov(fov);
}

function resetWASDVelocity() {
  const rig = $("#rig");
  const wasd = rig?.components?.["wasd-controls"];
  const v = wasd?.velocity;
  if (!v) return;
  v.x = 0;
  v.y = 0;
  v.z = 0;
}

const FALLBACK_SPAWN_RIG_POS = "0 0 4";
const FALLBACK_SPAWN_RIG_ROT = "0 0 0";
const FALLBACK_SPAWN_CAM_ROT = "0 0 0";

let SPAWN_RIG_POS = FALLBACK_SPAWN_RIG_POS;
let SPAWN_RIG_ROT = FALLBACK_SPAWN_RIG_ROT;
let SPAWN_CAM_ROT = FALLBACK_SPAWN_CAM_ROT;
let spawnInitialized = false;

function vec3AttrToString(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const parsed = parseVec3String(v);
    return parsed ? vec3ToString(parsed) : v.trim();
  }
  if (
    typeof v === "object" &&
    [v.x, v.y, v.z].every((n) => Number.isFinite(Number(n)))
  ) {
    return `${Number(v.x)} ${Number(v.y)} ${Number(v.z)}`;
  }
  return null;
}

function initSpawnPoseOnce() {
  if (spawnInitialized) return;
  const rig = $("#rig");
  const cam = $("#cam");
  if (!rig || !cam) return;

  const rp = vec3AttrToString(rig.getAttribute("position"));
  const rr = vec3AttrToString(rig.getAttribute("rotation"));
  const cr = vec3AttrToString(cam.getAttribute("rotation"));

  if (rp) SPAWN_RIG_POS = rp;
  if (rr) SPAWN_RIG_ROT = rr;
  if (cr) SPAWN_CAM_ROT = cr;

  spawnInitialized = true;
  dlog("spawn initialized", { SPAWN_RIG_POS, SPAWN_RIG_ROT, SPAWN_CAM_ROT });
}

function hardResetUserPose() {
  initSpawnPoseOnce();

  const rig = $("#rig");
  const before = rig?.getAttribute?.("position");
  if (rig) {
    rig.removeAttribute("animation__pos");
    rig.removeAttribute("animation__rot");
    rig.setAttribute("position", SPAWN_RIG_POS);
    rig.setAttribute("rotation", SPAWN_RIG_ROT);

    try {
      const p = parseVec3String(SPAWN_RIG_POS);
      if (p) rig.object3D.position.set(p.x, p.y, p.z);
    } catch {}
    try {
      const r = parseVec3String(SPAWN_RIG_ROT);
      if (r) {
        rig.object3D.rotation.set(
          THREE.MathUtils.degToRad(r.x),
          THREE.MathUtils.degToRad(r.y),
          THREE.MathUtils.degToRad(r.z),
        );
      }
    } catch {}
  }

  const cam = $("#cam");
  cam?.setAttribute("rotation", SPAWN_CAM_ROT);

  try {
    const lc = cam?.components?.["look-controls"];
    if (lc?.yawObject?.rotation) lc.yawObject.rotation.y = 0;
    if (lc?.pitchObject?.rotation) lc.pitchObject.rotation.x = 0;
    if (cam?.object3D?.rotation) cam.object3D.rotation.set(0, 0, 0);
  } catch {}

  movementKeysDown.clear();
  resetWASDVelocity();

  dlog("hardResetUserPose", {
    from: vec3AttrToString(before),
    to: SPAWN_RIG_POS,
    rigObj3D: rig ? vec3ToString(rig.object3D.position) : null,
  });
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.ambientBuffer = null;
    this.volume = 0.6;
    this._ambientStartPromise = null;
    this._ambientStopRequested = false;
  }

  async ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("WebAudio not supported");
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v01) {
    this.volume = clamp(v01, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  async _loadAmbientBuffer() {
    await this.ensure();
    if (this.ambientBuffer) return this.ambientBuffer;
    const r = await fetch(AMBIENT_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const ab = await r.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    this.ambientBuffer = buf;
    return buf;
  }

  async startAmbient() {
    if (this.ambient?.src) return;
    if (this._ambientStartPromise) return this._ambientStartPromise;

    this._ambientStopRequested = false;

    this._ambientStartPromise = (async () => {
      await this.ensure();

      try {
        if (this.ctx?.state === "suspended") await this.ctx.resume();
      } catch {}

      if (this.ambient?.src) return;

      const buf = await this._loadAmbientBuffer();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      const now = this.ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0.0, now);
        g.gain.linearRampToValueAtTime(0.22, now + 0.8);
      } catch {
        g.gain.value = 0.22;
      }

      src.connect(g);
      g.connect(this.master);
      src.start();

      this.ambient = { src, g };
      src.onended = () => {
        if (this.ambient?.src === src) this.ambient = null;
      };

      if (this._ambientStopRequested) {
        this.stopAmbient();
      }
    })().finally(() => {
      this._ambientStartPromise = null;
    });

    return this._ambientStartPromise;
  }

  stopAmbient() {
    this._ambientStopRequested = true;
    if (!this.ambient || !this.ctx) return;
    const { src, g } = this.ambient;
    const now = this.ctx.currentTime;

    try {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0, now + 0.25);
    } catch {}
    try {
      src.stop(now + 0.26);
    } catch {
      try {
        src.stop();
      } catch {}
    }
  }

  async chime() {
    await this.ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 880;
    g.gain.value = 0.0;
    o.connect(g);
    g.connect(this.master);
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    o.start(now);
    o.stop(now + 1.0);
  }
}

const audio = new AudioEngine();

class VoiceController {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.SR = SR;
    this.rec = null;
    this.running = false;
    this.onCommand = null;
  }

  start() {
    if (!this.supported || this.running) return;
    this.rec = new this.SR();
    this.rec.lang = "en-US";
    this.rec.interimResults = false;
    this.rec.continuous = false;
    this.running = true;

    this.rec.onresult = (e) => {
      const last = e.results?.[e.results.length - 1];
      const text = (last?.[0]?.transcript || "").trim().toLowerCase();
      if (text && this.onCommand) this.onCommand(text);
    };
    this.rec.onerror = () => {};
    this.rec.onend = () => {
      if (this.running) {
        try {
          this.rec.start();
        } catch {}
      }
    };

    try {
      this.rec.start();
    } catch {
      this.running = false;
    }
  }

  stop() {
    this.running = false;
    try {
      this.rec?.stop();
    } catch {}
    this.rec = null;
  }
}

const voice = new VoiceController();

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  } catch {}
}

AFRAME.registerComponent("gltf-material-fix", {
  schema: {
    doubleSided: { type: "boolean", default: true },
    baseColor: { type: "color", default: "#d9d9df" },
    roughness: { type: "number", default: 1.0 },
    metalness: { type: "number", default: 0.0 },
  },
  init: function () {
    this.el.addEventListener("model-loaded", () => {
      const obj = this.el.getObject3D("mesh");
      if (!obj) return;
      obj.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;

        const mats = Array.isArray(node.material)
          ? node.material
          : [node.material];
        mats.forEach((m) => {
          if (!m) return;
          if (this.data.doubleSided) m.side = THREE.DoubleSide;

          const hasMap = !!m.map;
          if (!hasMap && m.color) {
            m.color.set(this.data.baseColor);
          }

          if ("opacity" in m) m.opacity = 1.0;
          m.transparent = false;
          m.depthWrite = true;
          m.depthTest = true;
          if ("alphaTest" in m) m.alphaTest = 0.0;
          if ("roughness" in m) m.roughness = this.data.roughness;
          if ("metalness" in m) m.metalness = this.data.metalness;

          m.needsUpdate = true;
        });
      });
    });
    window.addEventListener("keydown", (e) => {
      const pressed = String(e?.key || "").toLowerCase();
      const wanted = String(this.data?.key || "").toLowerCase();
      if (!pressed || !wanted || pressed !== wanted) return;

      const rig = $("#rig");
      const cam = $("#cam");
      if (!rig || !cam) return;

      const rp = rig.getAttribute("position");
      const cr = cam.getAttribute("rotation");

      const dir = new THREE.Vector3();
      cam.object3D.getWorldDirection(dir);

      const yawDeg = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
    });
  },
});

AFRAME.registerComponent("hotspot", {
  schema: {
    title: { type: "string" },
    desc: { type: "string" },
    audio: { type: "selector" },
  },
  init: function () {
    const el = this.el;

    if (!el.hasAttribute("animation__pulse")) {
      el.setAttribute("animation__pulse", {
        property: "scale",
        dir: "alternate",
        dur: 900,
        easing: "easeInOutSine",
        loop: true,
        to: "1.25 1.25 1.25",
      });
    }

    el.addEventListener("click", async () => {
      suppressTeleportUntilMs = performance.now() + 250;
      const tourC = $("#tour")?.components?.["tour-guide"];
      const stops = tourC?.stops;
      const match = Array.isArray(stops)
        ? stops.find((s) => s?.target === `#${el.id}`)
        : null;

      const title = this.data.title || match?.title || el.id || "Hotspot";
      const desc = this.data.desc || match?.desc || "";

      dlog("hotspot click", {
        id: el.id,
        title,
        pos: el.getAttribute("position"),
      });

      const tourRunning = !!tourC?.running;
      setInfoCardImage(match?.imageUrl || "", title);
      showInfoCard(
        title,
        desc,
        tourRunning ? "Usa Q/E ou ←/→ para navegar." : "",
      );

      try {
        await audio.chime();
      } catch {}

      const narratorEl = document.querySelector("#narrator");
      if (narratorEl) narratorEl.removeAttribute("sound");
      if (this.data.audio && narratorEl) {
        narratorEl.setAttribute("sound", {
          src: this.data.audio,
          autoplay: true,
          positional: false,
          volume: 1.0,
        });
      }
    });

    el.addEventListener("mouseenter", () => {
      el.setAttribute("material", "transparent", true);
      el.setAttribute("material", "opacity", 0.75);
    });
    el.addEventListener("mouseleave", () => {
      el.setAttribute("material", "transparent", false);
      el.setAttribute("material", "opacity", 1.0);
    });
  },
});

AFRAME.registerComponent("tour-guide", {
  schema: {
    rig: { type: "selector" },
    panel: { type: "selector" },
    text: { type: "selector" },
    narrator: { type: "selector" },
    stopsUrl: { type: "string", default: "src/data/tourStops.json" },
    stopsEl: { type: "selector" },
    autoAdvance: { type: "boolean", default: false },
    speed: { type: "number", default: 1.0 },
  },

  init: function () {
    this.idx = 0;
    this.running = false;
    this.paused = false;
    this.timers = [];
    this.stops = [];
    this.reducedMotion = false;
    this.tts = false;
    this.stopsLoaded = false;
    this._stopsReady = this._loadStops();
    $("#btnStop")?.addEventListener("click", () => this.stop());
  },

  setOptions: function ({ speed, reducedMotion, tts } = {}) {
    if (typeof speed === "number") this.data.speed = speed;
    if (typeof reducedMotion === "boolean") this.reducedMotion = reducedMotion;
    if (typeof tts === "boolean") this.tts = tts;
  },

  _readStopsFromDom: function () {
    const json = (this.data.stopsEl?.textContent || "").trim();
    return json ? safeJsonParse(json, []) : [];
  },
  _loadStops: async function () {
    try {
      const url = this.data.stopsUrl || "src/data/tourStops.json";
      const r = await fetch(url, { cache: "no-store" });
      const stops = await r.json();
      this.stops = Array.isArray(stops) ? stops : [];
    } catch (err) {
      this.stops = this._readStopsFromDom();
    }

    await enrichStopsWithPaintings(this.stops);

    this.stopsLoaded = true;

    window.dispatchEvent(
      new CustomEvent("tour:stopsLoaded", { detail: { stops: this.stops } }),
    );
  },

  start: async function () {
    if (this.running) return;
    experienceMode = "tour";
    syncBodyModeClasses();
    this.running = true;
    this.paused = false;
    this.idx = 0;
    this.data.rig?.setAttribute("wasd-controls", "enabled", false);

    this.data.rig?.setAttribute("rotation", "0 0 0");
    $("#cam")?.setAttribute("rotation", "0 0 0");
    resetWASDVelocity();

    try {
      await this._stopsReady;
    } catch {}

    if (!this.stops?.length) {
      showToast("Tour: couldn't load stops.");
      this.stop();
      return;
    }

    const prevRM = this.reducedMotion;
    this.reducedMotion = true;
    this._goToStop(this.idx);
    this.reducedMotion = prevRM;
  },

  pause: function () {
    if (!this.running || this.paused) return;
    this.paused = true;
    this._clearTimers();
    this.data.rig?.removeAttribute("animation__pos");
    this.data.rig?.removeAttribute("animation__rot");
  },

  resume: function () {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._goToStop(this.idx);
  },

  stop: function () {
    this.running = false;
    this.paused = false;
    const leavingTour = experienceMode === "tour";
    if (leavingTour) experienceMode = "explore";
    syncBodyModeClasses();
    this._clearTimers();

    if (leavingTour)
      this.data.rig?.setAttribute("wasd-controls", "enabled", false);
    setTeleportEnabled(false);
    this.data.panel?.setAttribute("visible", false);
    this.data.narrator?.removeAttribute("sound");
    hideInfoCard();
    updateTourNav(false);
  },

  next: function () {
    if (!this.running) return;
    if (this.idx >= this.stops.length - 1) {
      showToast("You're already at the last stop.");
      updateTourNav(true, this.idx, this.stops.length);
      return;
    }
    this._clearTimers();
    this.idx = this.idx + 1;
    this._goToStop(this.idx);
  },

  prev: function () {
    if (!this.running) return;
    if (this.idx <= 0) {
      showToast("You're already at the first stop.");
      updateTourNav(true, this.idx, this.stops.length);
      return;
    }
    this._clearTimers();
    this.idx = Math.max(0, this.idx - 1);
    this._goToStop(this.idx);
  },

  teleportTo: function (i) {
    if (!this.stopsLoaded) {
      this._stopsReady?.then(() => this.teleportTo(i));
      return;
    }
    if (!this.stops[i]) return;
    localStorage.setItem("virtumuseum.lastStopIdx", String(i));
    this._clearTimers();
    this.idx = i;

    const prev = this.reducedMotion;
    this.reducedMotion = true;
    if (!this.running) this.running = true;
    this.paused = false;
    this.data.rig?.setAttribute("wasd-controls", "enabled", false);
    this._goToStop(this.idx);
    this.reducedMotion = prev;
  },

  jumpTo: function (i) {
    if (!this.stopsLoaded) {
      this._stopsReady?.then(() => this.jumpTo(i));
      return;
    }
    const stop = this.stops?.[i];
    const rig = this.data.rig;
    if (!stop || !rig) return;

    const bounds = getBoundsForRig(rig);
    const parsed = parseVec3String(stop.pos || "");
    if (parsed) {
      const clamped = clampPosToBounds(parsed, bounds);
      rig.setAttribute("position", vec3ToString(clamped));
    }

    if (stop.target) {
      const targetEl = document.querySelector(stop.target);
      if (targetEl) {
        rig.setAttribute("rotation", this._yawToTarget(rig, targetEl));
      }
    } else if (stop.rot) {
      const r = parseVec3String(stop.rot);
      if (r) rig.setAttribute("rotation", `0 ${r.y} 0`);
    }

    rig.removeAttribute("animation__pos");
    showToast(`Teleport: ${stop.title || "stop"}`);
  },

  _clearTimers: function () {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  },

  _yawToTarget: function (rigEl, targetEl) {
    const rigPos = new THREE.Vector3();
    const tgtPos = new THREE.Vector3();
    rigEl.object3D.getWorldPosition(rigPos);
    targetEl.object3D.getWorldPosition(tgtPos);
    const dx = tgtPos.x - rigPos.x;
    const dz = tgtPos.z - rigPos.z;
    const yawRad = Math.atan2(dx, dz);
    const yawDeg = THREE.MathUtils.radToDeg(yawRad);
    return `0 ${yawDeg} 0`;
  },

  _pitchToTarget: function (rigEl, targetEl) {
    const camEl = document.querySelector("#cam");
    const camObj = camEl?.getObject3D?.("camera") || camEl?.object3D;
    if (!camObj) return 0;

    const camPos = new THREE.Vector3();
    const tgtPos = new THREE.Vector3();
    camObj.getWorldPosition(camPos);
    targetEl.object3D.getWorldPosition(tgtPos);

    const dx = tgtPos.x - camPos.x;
    const dy = tgtPos.y - camPos.y;
    const dz = tgtPos.z - camPos.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-6) return 0;

    const pitchRad = Math.atan2(dy, horiz);

    return -THREE.MathUtils.radToDeg(pitchRad);
  },

  _applyPanel: function (stop) {
    setInfoCardImage(stop?.imageUrl || "", stop?.title || "");
    showInfoCard(
      stop.title,
      stop.desc,
      "Use ← / → to navigate. (Esc ends the tour)",
    );
    if (this.tts) speak(`${stop.title}. ${stop.desc}`);
  },

  _goToStop: function (i) {
    if (!this.running || this.paused) return;
    const stop = this.stops[i];
    if (!stop) {
      showToast("Invalid stop.");
      updateTourNav(true, this.idx, this.stops.length);
      return;
    }

    const speed = this.data.speed || 1.0;
    const moveDur = (stop.moveDur ?? 1500) / speed;
    const lookDur = (stop.lookDur ?? 600) / speed;
    const wait = (stop.wait ?? 1200) / speed;

    const rig = this.data.rig;
    if (!rig) return;
    const bounds = getBoundsForRig(rig);

    const destTitle = stop.title
      ? `Heading to: ${stop.title}`
      : "Changing stops…";
    setInfoCardTransition(true, destTitle);
    $("#btnTourPrev")?.setAttribute("disabled", "true");
    $("#btnTourNext")?.setAttribute("disabled", "true");

    if (stop.pos) {
      const parsed = parseVec3String(stop.pos);
      if (!parsed) {
        showToast("Stop has an invalid position.");
      } else {
        const clamped = clampPosToBounds(parsed, bounds);
        const toPos = vec3ToString(clamped);

        if (this.reducedMotion) {
          rig.setAttribute("position", toPos);
          rig.removeAttribute("animation__pos");
        } else {
          rig.setAttribute("animation__pos", {
            property: "position",
            to: toPos,
            dur: moveDur,
            easing: "easeInOutQuad",
          });
        }
      }
    }

    let yawStr = null;
    let pitchDeg = 0;

    if (stop.target) {
      const targetEl = document.querySelector(stop.target);
      if (targetEl) {
        yawStr = this._yawToTarget(rig, targetEl);
        pitchDeg = this._pitchToTarget(rig, targetEl);
      }
    } else if (stop.rot) {
      const r = parseVec3String(stop.rot);
      if (r) {
        yawStr = `0 ${r.y} 0`;
        pitchDeg = Number(r.x) || 0;
      }
    }

    if (yawStr) {
      if (this.reducedMotion) {
        rig.setAttribute("rotation", yawStr);
        rig.removeAttribute("animation__rot");
      } else {
        rig.setAttribute("animation__rot", {
          property: "rotation",
          to: yawStr,
          dur: lookDur,
          easing: "easeInOutQuad",
        });
      }
    }

    const camEl = document.querySelector("#cam");
    const lc = camEl?.components?.["look-controls"];
    const applyPitch = (deg) => {
      if (!lc?.pitchObject) return;
      lc.pitchObject.rotation.x = THREE.MathUtils.degToRad(Number(deg) || 0);

      lc.pitchObject.rotation.z = 0;
    };

    if (!stop.target && !stop.rot) pitchDeg = 0;

    if (this.reducedMotion || lookDur <= 0) {
      applyPitch(pitchDeg);
    } else {
      const startPitch = lc?.pitchObject
        ? THREE.MathUtils.radToDeg(lc.pitchObject.rotation.x)
        : 0;
      const start = performance.now();
      const dur = Math.max(0, Number(lookDur) || 0);
      const step = (now) => {
        const t = clamp((now - start) / dur, 0, 1);

        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const v = startPitch + (pitchDeg - startPitch) * eased;
        applyPitch(v);
        if (t < 1 && this.running && !this.paused) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    const afterMove = this.reducedMotion ? 0 : moveDur;
    const minInterDelay = afterMove === 0 ? 80 : 0;

    const t1 = setTimeout(() => {
      if (!this.running || this.paused) return;

      setInfoCardTransition(false);

      setInfoCardImage("", "");
      showInfoCard(
        stop.title || "Stop",
        "",
        "Click the painting to view information.",
      );

      if (stop.audio && this.data.narrator) {
        this.data.narrator.removeAttribute("sound");
        this.data.narrator.setAttribute("sound", {
          src: stop.audio,
          autoplay: true,
          positional: false,
          volume: 1.0,
        });
      } else {
        this.data.narrator?.removeAttribute("sound");
      }

      updateTourNav(true, i, this.stops.length);
      this._applyPanel(stop);

      if (stop.audio && this.data.narrator) {
        this.data.narrator.removeAttribute("sound");
        this.data.narrator.setAttribute("sound", {
          src: stop.audio,
          autoplay: true,
          positional: false,
          volume: 1.0,
        });
      } else {
        this.data.narrator?.removeAttribute("sound");
      }

      updateTourNav(true, i, this.stops.length);
    }, afterMove + minInterDelay);

    if (this.data.autoAdvance) {
      const t2 = setTimeout(
        () => {
          if (!this.running || this.paused) return;
          this.idx = i + 1;
          this._goToStop(this.idx);
        },
        afterMove + (this.reducedMotion ? 0 : lookDur) + wait,
      );
      this.timers.push(t1, t2);
    } else {
      this.timers.push(t1);
    }
  },
});

AFRAME.registerComponent("teleport-surface", {
  schema: {
    rig: { type: "selector" },
    enabled: { type: "boolean", default: false },
  },
  init: function () {
    this.el.addEventListener("click", (e) => {
      if (!this.data.enabled) {
        dlog("teleport ignored (disabled)");
        return;
      }

      const rig = this.data.rig;
      const p = e.detail?.intersection?.point;
      if (!rig || !p) return;

      const now = performance.now();
      if (now < suppressTeleportUntilMs) {
        dlog("teleport ignored (suppressed)", {
          untilMs: suppressTeleportUntilMs,
          now,
        });
        return;
      }

      const cursor =
        document.querySelector("#cam a-cursor") ||
        document.querySelector("a-cursor");
      const ray = cursor?.components?.raycaster;
      const intersections = ray?.intersections;
      if (Array.isArray(intersections) && intersections.length) {
        let nearestHotspot = Infinity;
        let nearestFloor = Infinity;

        for (const it of intersections) {
          const el = it?.object?.el;
          const dist = Number(it?.distance);
          if (!el || !Number.isFinite(dist)) continue;
          if (el === this.el) nearestFloor = Math.min(nearestFloor, dist);
          if (el.classList?.contains("hotspot"))
            nearestHotspot = Math.min(nearestHotspot, dist);
        }

        dlog("teleport click intersections", {
          nearestHotspot,
          nearestFloor,
          point: { x: p.x, y: p.y, z: p.z },
        });

        if (nearestHotspot + 0.01 < nearestFloor) {
          dlog("teleport ignored (hotspot closer)");
          return;
        }
      }

      const bounds = getBoundsForRig(rig);
      const clamped = clampPosToBounds({ x: p.x, y: bounds.y, z: p.z }, bounds);
      rig.setAttribute("position", vec3ToString(clamped));
      dlog("teleported", { to: clamped, bounds });
    });
  },
});

AFRAME.registerComponent("bounds-keeper", {
  schema: {
    minX: { type: "number", default: -60 },
    maxX: { type: "number", default: 60 },
    minZ: { type: "number", default: -80 },
    maxZ: { type: "number", default: 80 },
    y: { type: "number", default: 0 },
  },
  init: function () {
    this.lastSafe = null;
    this.lastWarn = 0;

    const pObj = this.el.object3D?.position;
    if (!pObj) return;
    const b = getBoundsForRig(this.el);
    const inside =
      pObj.x >= b.minX &&
      pObj.x <= b.maxX &&
      pObj.z >= b.minZ &&
      pObj.z <= b.maxZ;
    if (inside) this.lastSafe = { x: pObj.x, y: b.y, z: pObj.z };
  },
  tick: function () {
    const el = this.el;
    const pObj = el.object3D?.position;
    if (!pObj) return;

    const b = getBoundsForRig(el);

    if (typeof b.y === "number" && Math.abs(pObj.y - b.y) > 0.01) {
      pObj.y = b.y;
    }

    const inside =
      pObj.x >= b.minX &&
      pObj.x <= b.maxX &&
      pObj.z >= b.minZ &&
      pObj.z <= b.maxZ;

    if (inside) {
      this.lastSafe = { x: pObj.x, y: b.y, z: pObj.z };
      return;
    }

    debugWalls("boundsKeeper_outside", el, {
      nextPos: { x: pObj.x, y: pObj.y, z: pObj.z },
      clampedPos: this.lastSafe,
    });

    const now = performance.now();
    const clamped = clampPosToBounds({ x: pObj.x, y: b.y, z: pObj.z }, b);
    pObj.set(clamped.x, clamped.y, clamped.z);
    el.setAttribute("position", vec3ToString(clamped));

    if (now - this.lastWarn > 1500) {
      this.lastWarn = now;
      showToast("You're back inside the museum (to avoid the void).");
    }
  },
});

function waitForTourComponent() {
  return new Promise((resolve) => {
    const el = $("#tour");
    const existing = el?.components?.["tour-guide"];
    if (existing) return resolve(existing);
    if (!el) return resolve(null);
    const onInit = (e) => {
      if (e.detail?.name === "tour-guide") {
        el.removeEventListener("componentinitialized", onInit);
        resolve(el.components?.["tour-guide"] || null);
      }
    };
    el.addEventListener("componentinitialized", onInit);
  });
}
function syncMovementLock() {
  const rig = $("#rig");
  const cam = $("#cam");
  const tourC = $("#tour")?.components?.["tour-guide"];

  const menuOpen = $("#menuPanel")?.classList.contains("is-open");
  const welcomeVisible = !$("#welcome")?.classList.contains("is-hidden");
  const inTour = experienceMode === "tour" || !!tourC?.running;

  if (!rig) return;

  const mustLock =
    welcomeVisible || experienceMode === "welcome" || menuOpen || inTour;

  rig.setAttribute("wasd-controls", "enabled", false);

  if (cam) cam.setAttribute("wasd-controls", "enabled", false);

  if (cam) {
    const lockLook = welcomeVisible || menuOpen;
    cam.setAttribute("look-controls", "enabled", !lockLook);
  }

  const wc = rig.components?.["wasd-controls"];
  if (mustLock && wc?.velocity) {
    wc.velocity.set(0, 0, 0);
  }

  if (mustLock) {
    movementKeysDown.clear();
    resetJoystick();
  }

  syncMobileJoystickVisibility();
}

function setMenuOpen(open) {
  const panel = $("#menuPanel");
  if (!panel) return;

  $("#menuBackdrop")?.setAttribute("aria-hidden", "true");

  if (!open) {
    const ae = document.activeElement;
    if (ae && panel.contains(ae)) {
      try {
        ae.blur?.();
      } catch {}
      try {
        $("#btnMenu")?.focus?.();
      } catch {}
    }
  }

  panel.classList.toggle("is-open", open);
  panel.setAttribute("aria-hidden", String(!open));
  try {
    document.body.classList.toggle("is-menu-open", !!open);
  } catch {}
  syncMovementLock();
}

function toggleMenu() {
  const panel = $("#menuPanel");
  if (!panel) return;
  setMenuOpen(!panel.classList.contains("is-open"));
  syncMovementLock();
}

function setUIVisible(visible) {
  const ui = $("#uiRoot");
  if (!ui) return;
  ui.classList.toggle("is-hidden", !visible);
}

function setWelcomeVisible(visible) {
  const w = $("#welcome");
  if (!w) return;
  w.classList.toggle("is-hidden", !visible);
}

function backToWelcome() {
  try {
    speechSynthesis?.cancel?.();
  } catch {}

  $("#video360")?.pause?.();
  $("#narrator")?.removeAttribute("sound");

  const tour = $("#tour")?.components?.["tour-guide"];
  try {
    tour?.stop?.();
  } catch {}

  const rig = $("#rig");
  try {
    rig?.setAttribute?.("wasd-controls", "enabled", false);
  } catch {}
  resetWASDVelocity();

  hardResetUserPose();

  requestAnimationFrame(() => hardResetUserPose());

  setTeleportEnabled(false);
  hideInfoCard();
  setMenuOpen(false);
  setUIVisible(false);
  setWelcomeVisible(true);
  experienceMode = "welcome";
  syncBodyModeClasses();
  updateTourNav(false);
  syncMovementLock();

  const ambOn = localStorage.getItem("virtumuseum.ambient") === "1";
  $("#chkWelcomeAmbient") && ($("#chkWelcomeAmbient").checked = ambOn);
  $("#chkAmbient") && ($("#chkAmbient").checked = ambOn);
  try {
    if (ambOn) audio.startAmbient();
    else audio.stopAmbient();
  } catch {}
}

function setMinimalHUD(hudOff) {
  const ui = $("#uiRoot");
  if (!ui) return;
  ui.classList.toggle("is-hud-off", !!hudOff);

  localStorage.setItem("virtumuseum.hudMinimal", hudOff ? "1" : "0");

  const btn = $("#btnHUD");
  if (btn) {
    const visible = !hudOff;
    btn.textContent = visible ? "HUD: ON" : "HUD: OFF";
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
  }
  if (hudOff) {
    setMenuOpen(false);
    hideInfoCard();
  }
  dlog("hud", { visible: !hudOff });
}

function updateTourNav(active, idx = 0, total = 0) {
  if (experienceMode !== "tour") active = false;
  $("#btnTourPrev")?.toggleAttribute("disabled", !active || idx <= 0);
  $("#btnTourNext")?.toggleAttribute("disabled", !active || idx >= total - 1);
  $("#btnStop")?.classList.toggle("is-hidden", !active);
  $("#btnTourPrev")?.classList.toggle("is-hidden", !active);
  $("#btnTourNext")?.classList.toggle("is-hidden", !active);
  $("#tourNav")?.classList.toggle("is-hidden", !active);
  $("#tourNav")?.setAttribute("aria-hidden", String(!active));
}

function showInfoCard(title, desc, hint) {
  const card = $("#infoCard");
  if (!card) return;

  const closeBtn = $("#btnInfoClose");
  const hideClose = experienceMode === "tour";
  closeBtn?.classList.toggle("is-hidden", hideClose);
  closeBtn?.setAttribute("aria-hidden", String(hideClose));

  $("#infoCardTitle").textContent = title || "—";
  $("#infoCardDesc").textContent = desc || "";
  $("#infoCardHint").textContent = hint || "";
  card.classList.remove("is-hidden");
}

function setInfoCardImage(url, alt) {
  const img = $("#infoCardImg");
  if (!img) return;
  const u = String(url || "").trim();
  if (!u) {
    img.classList.add("is-hidden");
    img.removeAttribute("src");
    img.alt = "";
    return;
  }
  img.src = u;
  img.alt = alt || "";

  setInfoCardImageHidden(infoCardImageHidden);
}

function setInfoCardTransition(active, title = "A mudar…") {
  if (experienceMode !== "tour") return;
  const card = $("#infoCard");
  if (!card) return;
  card.setAttribute("aria-busy", active ? "true" : "false");
  if (!active) return;
  setInfoCardImage("", "");
  showInfoCard(title, "", "");
}

function hideInfoCard() {
  $("#infoCard")?.classList.add("is-hidden");
  setInfoCardImage("", "");
  setInfoCardCollapsed(false);
  setInfoCardImageHidden(false);
}

function showToast(text) {
  if (!$("#infoCard")?.classList.contains("is-hidden")) {
    $("#infoCardHint").textContent = text;
    return;
  }
  setInfoCardImage("", "");
  showInfoCard("Info", text, experienceMode === "tour" ? "" : "");
  setTimeout(() => hideInfoCard(), 1400);
}

function setMode(mode) {
  const museu = $("#museuModel");
  const sky = $("#sky360");
  const vs = $("#videoSphere");

  if (mode === "museum") {
    museu?.setAttribute("visible", true);
    sky?.setAttribute("visible", false);
    vs?.setAttribute("visible", false);
    try {
      $("#video360")?.pause?.();
    } catch {}
  }

  if (mode === "pano") {
    museu?.setAttribute("visible", false);
    sky?.setAttribute("visible", true);
    vs?.setAttribute("visible", false);
    try {
      $("#video360")?.pause?.();
    } catch {}
  }

  if (mode === "video") {
    museu?.setAttribute("visible", false);
    sky?.setAttribute("visible", false);
    vs?.setAttribute("visible", true);
    try {
      $("#video360")?.play?.();
    } catch {}
  }
}

function apply360FromInputs() {
  const panoUrl = ($("#txtPanoUrl")?.value || "").trim();
  const videoUrl = ($("#txtVideoUrl")?.value || "").trim();

  if (panoUrl) {
    const panoImg = $("#panoImg");
    const sky = $("#sky360");
    if (panoImg && sky) {
      panoImg.setAttribute("src", panoUrl);
      sky.setAttribute("src", "#panoImg");
    }
    localStorage.setItem("virtumuseum.panoUrl", panoUrl);
  }

  if (videoUrl) {
    const v = $("#video360");
    if (v) {
      v.pause?.();
      v.src = videoUrl;
      v.load?.();
    }
    localStorage.setItem("virtumuseum.videoUrl", videoUrl);
  }
}

function restore360Inputs() {
  const panoUrl = localStorage.getItem("virtumuseum.panoUrl") || "";
  const videoUrl = localStorage.getItem("virtumuseum.videoUrl") || "";
  const pano = $("#txtPanoUrl");
  const vid = $("#txtVideoUrl");
  if (pano) pano.value = panoUrl;
  if (vid) vid.value = videoUrl;
  if (panoUrl || videoUrl) apply360FromInputs();
}

function blockMoveKeys(e, { allowLeftRight = false } = {}) {
  const k = String(e?.key || "").toLowerCase();

  const isMove =
    k === "w" ||
    k === "a" ||
    k === "s" ||
    k === "d" ||
    k === "arrowup" ||
    k === "arrowdown" ||
    k === "arrowleft" ||
    k === "arrowright";

  if (!isMove) return false;

  if (allowLeftRight && (k === "arrowleft" || k === "arrowright")) return false;

  e.preventDefault?.();
  e.stopPropagation?.();
  return true;
}

function renderStopsList(stops) {
  const list = $("#stopsList");
  if (!list) return;

  list.innerHTML = "";
  stops.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = `${i + 1}. ${s.title || "Stop"}`;

    b.addEventListener("click", () => {
      const tourC = $("#tour")?.components?.["tour-guide"];
      if (!tourC) return;

      localStorage.setItem("virtumuseum.lastStopIdx", String(i));

      if (experienceMode !== "tour") {
        showToast("Teleports are only available during the guided tour.");
        return;
      }
      tourC.teleportTo?.(i);
    });

    list.appendChild(b);
  });
}

function setupUI() {
  $("#btnMenu")?.addEventListener("click", toggleMenu);
  $("#btnHUD")?.addEventListener("click", () =>
    setMinimalHUD(!$("#uiRoot")?.classList.contains("is-hud-off")),
  );

  $("#btnFullscreen")?.addEventListener("click", toggleFullscreen);
  $("#btnFullscreenWelcome")?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenButtons);
  syncFullscreenButtons();

  $("#btnBackToWelcome")?.addEventListener("click", backToWelcome);

  $("#btnInfoClose")?.addEventListener("click", () => hideInfoCard());
  $("#btnInfoToggle")?.addEventListener("click", () =>
    setInfoCardCollapsed(!infoCardCollapsed),
  );
  $("#btnInfoImgToggle")?.addEventListener("click", () =>
    setInfoCardImageHidden(!infoCardImageHidden),
  );

  $("#btnHelpModalClose")?.addEventListener("click", () =>
    setHelpModalOpen(false),
  );
  $("#btnHelpModalOk")?.addEventListener("click", () =>
    setHelpModalOpen(false),
  );
  $("#helpModalBackdrop")?.addEventListener("click", () =>
    setHelpModalOpen(false),
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isHelpModalOpen()) {
        e.preventDefault();
        e.stopPropagation();
        setHelpModalOpen(false);
      }
    },
    { capture: true },
  );

  $("#btnEnterExplore")?.addEventListener("click", () =>
    enterExperience("explore"),
  );
  $("#btnEnterTour")?.addEventListener("click", () => enterExperience("tour"));

  $("#chkWelcomeAmbient")?.addEventListener("change", async (e) => {
    const on = !!e.target.checked;
    localStorage.setItem("virtumuseum.ambient", on ? "1" : "0");
    if ($("#chkAmbient")) $("#chkAmbient").checked = on;
    try {
      if (on) await audio.startAmbient();
      else audio.stopAmbient();
    } catch {}
  });

  setTeleportEnabled(false);

  $("#btnModeMuseum")?.addEventListener("click", () => setMode("museum"));
  $("#btnModePano")?.addEventListener("click", () => setMode("pano"));
  $("#btnModeVideo")?.addEventListener("click", () => setMode("video"));
  $("#btnApply360")?.addEventListener("click", () => apply360FromInputs());

  $("#btnPhoto")?.addEventListener("click", () => takePhoto());
  $("#btnFlashlight")?.addEventListener("click", () => toggleFlashlight());
  $("#btnReset")?.addEventListener("click", () => {
    hardResetUserPose();
    setMode("museum");
    hideInfoCard();
  });
  $("#btnCopyPose")?.addEventListener("click", async () => {
    const rig = $("#rig");
    if (!rig) return;
    const p = rig.getAttribute("position");
    const r = rig.getAttribute("rotation");
    const text = `POS: "${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(
      2,
    )}"  ROT: "${r.x.toFixed(2)} ${r.y.toFixed(2)} ${r.z.toFixed(2)}"`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Pose copied to clipboard.");
    } catch {
      showToast("Pose printed to console (clipboard unavailable).");
    }
  });

  const rng = $("#rngVolume");
  const savedVol = Number(localStorage.getItem("virtumuseum.volume") || "60");
  if (rng) rng.value = String(clamp(savedVol, 0, 100));
  audio.setVolume((savedVol || 60) / 100);
  rng?.addEventListener("input", (e) => {
    const v = Number(e.target.value || 0);
    localStorage.setItem("virtumuseum.volume", String(v));
    audio.setVolume(v / 100);
  });

  const chkAmbient = $("#chkAmbient");
  const ambientOn = localStorage.getItem("virtumuseum.ambient") === "1";
  if (chkAmbient) chkAmbient.checked = ambientOn;
  if (ambientOn) {
  }
  chkAmbient?.addEventListener("change", async (e) => {
    const on = !!e.target.checked;
    localStorage.setItem("virtumuseum.ambient", on ? "1" : "0");
    if ($("#chkWelcomeAmbient")) $("#chkWelcomeAmbient").checked = on;
    try {
      if (on) await audio.startAmbient();
      else audio.stopAmbient();
    } catch {}
  });

  const chkTTS = $("#chkTTS");
  const chkRM = $("#chkReducedMotion");
  const rngSpeed = $("#rngSpeed");
  const rngZoom = $("#rngZoom");

  const ttsOn = localStorage.getItem("virtumuseum.tts") === "1";
  const rmOn = localStorage.getItem("virtumuseum.rm") === "1";
  const speedPct = Number(localStorage.getItem("virtumuseum.speed") || "100");
  const savedFov = Number(localStorage.getItem("virtumuseum.fov") || "80");

  if (chkTTS) chkTTS.checked = ttsOn;
  if (chkRM) chkRM.checked = rmOn;
  if (rngSpeed) rngSpeed.value = String(clamp(speedPct, 50, 150));

  if (rngZoom) rngZoom.value = String(clamp(120 - savedFov, 30, 90));
  setZoomFov(savedFov || 80);

  let tour = null;
  const applyTourOptions = () => {
    if (!tour) return;
    const speed = (Number(rngSpeed?.value || 100) / 100) * 1.0;
    tour?.setOptions?.({
      speed,
      reducedMotion: !!chkRM?.checked,
      tts: !!chkTTS?.checked,
    });
  };
  waitForTourComponent().then((c) => {
    tour = c;
    applyTourOptions();

    if (tour?.stops?.length) {
      window.dispatchEvent(
        new CustomEvent("tour:stopsLoaded", { detail: { stops: tour.stops } }),
      );
    }
  });

  chkTTS?.addEventListener("change", (e) => {
    localStorage.setItem("virtumuseum.tts", e.target.checked ? "1" : "0");
    applyTourOptions();
  });
  chkRM?.addEventListener("change", (e) => {
    localStorage.setItem("virtumuseum.rm", e.target.checked ? "1" : "0");
    applyTourOptions();
  });
  rngSpeed?.addEventListener("input", (e) => {
    localStorage.setItem("virtumuseum.speed", String(e.target.value || 100));
    applyTourOptions();
  });

  rngZoom?.addEventListener("input", (e) => setZoomFromSlider(e.target.value));

  window.addEventListener(
    "wheel",
    (e) => {
      const t = e.target;
      const inUi =
        (t?.closest &&
          (t.closest("#uiRoot") ||
            t.closest("#welcome") ||
            t.closest("#infoCard"))) ||
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA";
      if (inUi) return;

      const delta = Number(e.deltaY) || 0;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;

      const curr = Number(localStorage.getItem("virtumuseum.fov") || "80");
      const next = clamp(curr + Math.sign(delta) * 2, 30, 90);
      if (next === curr) return;

      e.preventDefault();
      setZoomFov(next);
    },
    { passive: false },
  );

  const voiceStatus = $("#voiceStatus");
  const btnVoice = $("#btnVoice");

  if (!voice.supported) {
    if (voiceStatus)
      voiceStatus.textContent = "Voice: unavailable in this browser";
    btnVoice?.setAttribute("disabled", "true");
  }

  const setVoiceStatus = (on) => {
    if (!voiceStatus) return;
    voiceStatus.textContent = on ? "Voice: on (en-US)" : "Voice: off";
  };

  btnVoice?.addEventListener("click", () => {
    if (!voice.supported) return;
    const on = !voice.running;
    if (on) voice.start();
    else voice.stop();
    setVoiceStatus(voice.running);
  });

  voice.onCommand = (text) => {
    const t = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (isHelpModalOpen()) {
      const wantsClose =
        t.includes("close") ||
        t.includes("ok") ||
        t.includes("confirm") ||
        t.includes("exit") ||
        t.includes("back") ||
        t.includes("fechar") ||
        t.includes("fecha") ||
        t.includes("confirmar") ||
        t.includes("sair") ||
        t.includes("voltar");

      if (wantsClose) {
        setHelpModalOpen(false);
        return;
      }
    }

    if (
      t.includes("back") ||
      t.includes("home") ||
      t.includes("start screen") ||
      t.includes("welcome") ||
      t.includes("voltar") ||
      t.includes("voltar ao inicio") ||
      t.includes("voltar ao ecra inicial") ||
      t.includes("ecra inicial") ||
      t.includes("inicio")
    ) {
      backToWelcome();
      return;
    }

    document.addEventListener("fullscreenchange", syncFullscreenButtons);

    const tourC = $("#tour")?.components?.["tour-guide"];
    if (!tourC) return;

    if (
      t.includes("start") ||
      t.includes("begin") ||
      t.includes("iniciar") ||
      t.includes("comecar")
    ) {
      enterExperience("tour");
    } else if (t.includes("pause") || t.includes("pausar")) tourC.pause();
    else if (
      t.includes("resume") ||
      t.includes("continue") ||
      t.includes("retomar") ||
      t.includes("continuar")
    )
      tourC.resume();
    else if (
      t.includes("stop") ||
      t.includes("end") ||
      t.includes("parar") ||
      t.includes("sair")
    )
      tourC.stop();
    else if (
      t.includes("explore") ||
      t.includes("free") ||
      t.includes("explorar") ||
      t.includes("livremente")
    )
      enterExperience("explore");
    else if (
      t.includes("tour") ||
      t.includes("guided") ||
      t.includes("visita guiada") ||
      t.includes("visita")
    )
      enterExperience("tour");
    else if (
      t.includes("fullscreen") ||
      t.includes("full screen") ||
      t.includes("ecra inteiro") ||
      t.includes("ecrã inteiro")
    ) {
      toggleFullscreen();
    } else if (
      t.includes("next") ||
      t.includes("proxima") ||
      t.includes("seguinte")
    )
      tourC.next();
    else if (
      t.includes("previous") ||
      t.includes("prev") ||
      t.includes("anterior") ||
      t.includes("antes")
    )
      tourC.prev();
    else if (
      t.includes("image on") ||
      t.includes("show image") ||
      t.includes("image enable") ||
      t.includes("image on") ||
      t.includes("mostrar imagem") ||
      t.includes("image ligar")
    ) {
      setInfoCardImageHidden(false);
      showToast("Images enabled.");
    } else if (
      t.includes("image off") ||
      t.includes("hide image") ||
      t.includes("image disable") ||
      t.includes("image off") ||
      t.includes("ocultar image") ||
      t.includes("image desligar")
    ) {
      setInfoCardImageHidden(true);
      showToast("Images hidden.");
    } else if (
      t.includes("hide panel") ||
      t.includes("hide info") ||
      t.includes("close panel") ||
      t.includes("ocultar painel") ||
      t.includes("ocultar info") ||
      t.includes("fechar painel")
    ) {
      setInfoCardCollapsed(true);
    } else if (
      t.includes("show panel") ||
      t.includes("show info") ||
      t.includes("open panel") ||
      t.includes("mostrar painel") ||
      t.includes("mostrar info") ||
      t.includes("abrir painel")
    ) {
      setInfoCardCollapsed(false);
    } else if (t.includes("menu")) toggleMenu();
    else if (t.includes("help") || t.includes("ajuda")) showHelp();
    else if (t.includes("flashlight") || t.includes("lanterna"))
      toggleFlashlight();
    else if (
      t.includes("photo") ||
      t.includes("screenshot") ||
      t.includes("foto") ||
      t.includes("captura")
    )
      takePhoto();
  };

  $("#btnHelp")?.addEventListener("click", showHelp);

  function showHelp() {
    const msg =
      "Help / commands:\n\n" +
      "- Menu: M (or Menu button)\n" +
      "- Start tour: Enter (or Start button)\n" +
      "- Next stop: N\n" +
      "- Previous stop: Q\n\n" +
      "Voice (if supported):\n" +
      'Say "start tour", "next", "previous", "menu", "show panel", "hide panel", "image on", "image off", "help", "flashlight", "photo".';

    setHelpModalOpen(true, msg);
  }

  window.addEventListener("tour:stopsLoaded", (e) => {
    const stops = e.detail?.stops || [];

    renderStopsList(stops);

    try {
      const computed = computeBoundsFromStops(stops);
      if (computed) applyFourWalls(computed, { visual: true });
    } catch (err) {}
  });

  window.addEventListener(
    "keydown",
    (e) => {
      const ae = document.activeElement;
      const isTyping =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (isTyping && e.key !== "Escape") return;

      const menuOpen = $("#menuPanel")?.classList.contains("is-open");
      const welcomeVisible = !$("#welcome")?.classList.contains("is-hidden");
      if (menuOpen || welcomeVisible || experienceMode === "welcome") {
        if (blockMoveKeys(e)) return;
      }

      const tourC = $("#tour")?.components?.["tour-guide"];
      const inTourMode = experienceMode === "tour" || !!tourC?.running;

      if (inTourMode && blockMoveKeys(e, { allowLeftRight: true })) return;

      const infoOpen = !$("#infoCard")?.classList.contains("is-hidden");
      const key = e.key;
      const keyLower = String(key || "").toLowerCase();

      const isMoveKey =
        keyLower === "w" ||
        keyLower === "a" ||
        keyLower === "s" ||
        keyLower === "d" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "ArrowLeft" ||
        key === "ArrowRight";

      if (
        experienceMode === "explore" &&
        !menuOpen &&
        !welcomeVisible &&
        !inTourMode &&
        isMoveKey
      ) {
        e.preventDefault?.();
        e.stopPropagation?.();
      }

      if (isMoveKey) {
        movementKeysDown.add(keyLower || key);
      }

      if (infoOpen) {
        if (key === "ArrowUp" || key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
        }
        if (!inTourMode && (key === "ArrowLeft" || key === "ArrowRight")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }

      if (inTourMode) {
        if (
          keyLower === "w" ||
          keyLower === "a" ||
          keyLower === "s" ||
          keyLower === "d" ||
          key === "ArrowUp" ||
          key === "ArrowDown"
        ) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          tourC.next();
          return;
        }
        if (key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          tourC.prev();
          return;
        }
      }

      if (
        tourC.running &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.key === "m" || e.key === "M") toggleMenu();
      if (e.key === "h" || e.key === "H")
        setMinimalHUD(!$("#uiRoot")?.classList.contains("is-hud-off"));
      if (e.key === "Escape") tourC.stop();

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        enterExperience("tour");
      }
      if (e.key === " " || e.code === "Space") {
        if (tourC.running && !tourC.paused) tourC.pause();
        else if (tourC.running && tourC.paused) tourC.resume();
      }
      if (e.key === "n" || e.key === "N") tourC.next();

      if (tourC) {
        if (e.key === "ArrowRight") tourC.next();
        if (e.key === "ArrowLeft") tourC.prev();
      }

      if (e.key === "q" || e.key === "Q") tourC.prev();
      if (e.key === "e" || e.key === "E") tourC.next();

      if (e.key === "c" || e.key === "C") takePhoto();
      if (e.key === "f" || e.key === "F") toggleFlashlight();
    },
    { capture: true },
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const key = e.key;
      const keyLower = String(key || "").toLowerCase();
      const isMoveKey =
        keyLower === "w" ||
        keyLower === "a" ||
        keyLower === "s" ||
        keyLower === "d" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "ArrowLeft" ||
        key === "ArrowRight";
      if (isMoveKey) {
        movementKeysDown.delete(keyLower || key);
        if (movementKeysDown.size === 0) resetWASDVelocity();
      }
    },
    { capture: true },
  );

  $("#btnTourNext")?.addEventListener("click", () =>
    $("#tour")?.components?.["tour-guide"]?.next?.(),
  );
  $("#btnTourPrev")?.addEventListener("click", () =>
    $("#tour")?.components?.["tour-guide"]?.prev?.(),
  );
  $("#rngMoveSpeedMenu")?.addEventListener("input", (e) =>
    setMoveSpeed(e.target.value),
  );
  $("#rngMoveSpeed")?.addEventListener("input", (e) =>
    setMoveSpeed(e.target.value),
  );

  toggleFlashlight(localStorage.getItem("virtumuseum.flashlight") === "1");

  const moveSpeed = Number(
    localStorage.getItem("virtumuseum.moveSpeed") || "2",
  );
  $("#chkWelcomeAmbient") && ($("#chkWelcomeAmbient").checked = ambientOn);
  $("#chkWelcomeTTS") && ($("#chkWelcomeTTS").checked = ttsOn);
  $("#rngMoveSpeed") &&
    ($("#rngMoveSpeed").value = String(clamp(moveSpeed, 1, 6)));
  $("#rngMoveSpeedMenu") &&
    ($("#rngMoveSpeedMenu").value = String(clamp(moveSpeed, 1, 6)));

  restore360Inputs();
  setMenuOpen(false);
  setVoiceStatus(false);
  setMinimalHUD(localStorage.getItem("virtumuseum.hudMinimal") === "1");

  setUIVisible(false);
  setWelcomeVisible(true);
  experienceMode = "welcome";
  updateTourNav(false);
}

function snapTurn(deg) {
  const rig = $("#rig");
  if (!rig) return;
  const r = rig.getAttribute("rotation");
  rig.setAttribute("rotation", `${r.x} ${r.y + deg} ${r.z}`);
}

function takePhoto() {
  try {
    const scene = AFRAME.scenes?.[0];
    const ss = scene?.components?.screenshot;
    if (!ss) {
      scene?.setAttribute("screenshot", "width: 1920; height: 1080");
    }
    (AFRAME.scenes?.[0]?.components?.screenshot || ss)?.capture("perspective");
  } catch {
    alert("Photo: capture is not available in this browser.");
  }
}

function toggleFlashlight(force) {
  const lightEl = $("#flashlight");
  if (!lightEl) return;
  const curr = Number(lightEl.getAttribute("light")?.intensity || 0);
  const on = typeof force === "boolean" ? force : curr <= 0.001;
  lightEl.setAttribute("light", "intensity", on ? 1.2 : 0.0);
  localStorage.setItem("virtumuseum.flashlight", on ? "1" : "0");
}

function setMoveSpeed(accel) {
  const rig = $("#rig");
  if (!rig) return;
  const uiVal = clamp(Number(accel) || 2, 1, 6);

  rig.setAttribute("wasd-controls", "acceleration", clamp(uiVal * 1.0, 0.5, 8));
  localStorage.setItem("virtumuseum.moveSpeed", String(uiVal));
  const r1 = $("#rngMoveSpeed");
  const r2 = $("#rngMoveSpeedMenu");
  if (r1) r1.value = String(uiVal);
  if (r2) r2.value = String(uiVal);
}

async function enterExperience(mode) {
  hardResetUserPose();

  const amb = !!$("#chkWelcomeAmbient")?.checked;
  const tts = !!$("#chkWelcomeTTS")?.checked;
  localStorage.setItem("virtumuseum.ambient", amb ? "1" : "0");
  localStorage.setItem("virtumuseum.tts", tts ? "1" : "0");

  setMoveSpeed(Number($("#rngMoveSpeed")?.value || 2));

  if ($("#chkAmbient")) $("#chkAmbient").checked = amb;
  if ($("#chkTTS")) $("#chkTTS").checked = tts;

  try {
    if (amb) await audio.startAmbient();
    else audio.stopAmbient();
  } catch {}

  setWelcomeVisible(false);
  setUIVisible(true);

  const rig = $("#rig");
  const tour = $("#tour")?.components?.["tour-guide"];
  if (!rig || !tour) return;

  if (mode === "explore") {
    experienceMode = "explore";
    syncBodyModeClasses();
    tour.stop();
    setTeleportEnabled(false);
    rig.setAttribute("wasd-controls", "enabled", false);
    updateTourNav(false);
    hideInfoCard();
    showToast("Free exploration enabled.");
  } else {
    tour.stop();
    experienceMode = "tour";
    syncBodyModeClasses();
    rig.setAttribute("wasd-controls", "enabled", false);
    setTeleportEnabled(false);
    tour.start();
    updateTourNav(true, tour.idx, tour.stops.length);
  }
  syncMovementLock();
}

let _helpLastFocusEl = null;

function isHelpModalOpen() {
  return !$("#helpModal")?.classList.contains("is-hidden");
}

function setHelpModalOpen(open, text = "") {
  const modal = $("#helpModal");
  const body = $("#helpModalBody");
  if (!modal || !body) return;

  if (open) {
    _helpLastFocusEl = document.activeElement;
    body.textContent = text || "";

    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");

    setTimeout(() => $("#btnHelpModalClose")?.focus?.(), 0);

    try {
      syncMovementLock();
    } catch {}
  } else {
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");

    try {
      _helpLastFocusEl?.focus?.();
    } catch {}

    try {
      syncMovementLock();
    } catch {}
  }
}

function initApp() {
  setupUI();

  applyFourWalls(DEFAULT_GALLERY_BOUNDS, { visual: true });

  initMobileJoystick();

  startManualMovementLoop();

  initSpawnPoseOnce();

  syncBodyModeClasses();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
