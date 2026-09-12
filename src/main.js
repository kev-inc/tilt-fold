import './style.css';
import { inject } from '@vercel/analytics';
import * as THREE from 'three';
import { createWallpaperCanvases, canvasFromFile } from './wallpaper.js';

/**
 * Table-locked Duo cover illusion
 * --------------------------------
 * The phone screen is only the glass. The UI lives on the table (world plane).
 * Gyro tilt = how far the glass has lifted. We project the table-locked UI
 * onto the glass (inverse of the physical tilt) and apply the cover-side
 * frost: progressive blur + darken. Inspired by chuspeeism/iphone-duo shaders;
 * no Apple assets / no on-screen folding phone model.
 */

const viewport = document.querySelector('#viewport');
const slider = document.querySelector('#angle');
const angleLabel = document.querySelector('#angle-label');
const statusEl = document.querySelector('#status');
const enableBtn = document.querySelector('#enable-motion');
const calibrateBtn = document.querySelector('#calibrate');
const sensitivityInput = document.querySelector('#sensitivity');
const invertInput = document.querySelector('#invert');
const uploadInput = document.querySelector('#upload');
const sensitivityLabel = document.querySelector('#sensitivity-label');
const fullscreenBtn = document.querySelector('#fullscreen');
const exitFullscreenBtn = document.querySelector('#exit-fullscreen');
const showHudBtn = document.querySelector('#show-hud');
const hud = document.querySelector('#hud');
const afterMotion = document.querySelector('#after-motion');
const landingHint = document.querySelector('#landing-hint');
const landingActions = document.querySelector('#landing-actions');

inject();

/** Auto hinge: false = left stuck, true = right stuck */
let hingeOnRight = false;


const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const wallpaperCanvas = await createWallpaperCanvases(1170, 2532);
const uiTexture = new THREE.CanvasTexture(wallpaperCanvas);
uiTexture.colorSpace = THREE.NoColorSpace; // 1:1 with canvas/upload pixels (no sRGB↔linear)
uiTexture.premultiplyAlpha = false;
uiTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
uiTexture.generateMipmaps = true;
uiTexture.minFilter = THREE.LinearMipmapLinearFilter;
uiTexture.magFilter = THREE.LinearFilter;
uiTexture.wrapS = uiTexture.wrapT = THREE.ClampToEdgeWrapping;

const uniforms = {
  map: { value: uiTexture },
  uiPixel: { value: new THREE.Vector2(1 / wallpaperCanvas.width, 1 / wallpaperCanvas.height) },
  // glass tilt in radians: 0 = flat on table, π/2 = edge-on
  tilt: { value: 0 },
  // 0 = hinge on left (right edge lifts), 1 = hinge on right
  hingeRight: { value: 0 },
  // approximate eye height above table, in "screen heights"
  eyeHeight: { value: 2.8 },
  resolution: { value: new THREE.Vector2(1, 1) },
};

/*
  Model
  -----
  Screen UV: u,v in [0,1], origin bottom-left.
  Glass lies in plane z=0 when flat. Hinge at u=0 (left) or u=1 (right).
  After tilt θ, a glass point at distance d from the hinge has risen:
    along the normal of the table, z = sin(θ) * d_world
    and its table-shadow x shrinks by cos(θ).

  We want the TABLE UI fixed. For each glass pixel, find where a ray from
  a fixed eye (above the table, looking down) through that glass point
  hits the table plane z=0 — but accounting for the glass having rotated.

  Simpler equivalent used here (matches the “picture stays in space” feel):
  Treat screen as the glass. Map each pixel to an unfolded table UV by
  undoing the hinge rotation in the horizontal axis, with a bit of
  perspective from eyeHeight so the free edge foreshortens. Then frost
  with the Duo outer-screen blur/darken.
*/
const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D map;
    uniform vec2 uiPixel;
    uniform float tilt;
    uniform float hingeRight;
    uniform float eyeHeight;
    uniform vec2 resolution;
    varying vec2 vUv;

    vec3 sampleTable(vec2 sourceUV, float progress, float edge) {
      float motion = smoothstep(0.0, 1.0, progress);
      float blurGradient = clamp(edge, 0.0, 1.0);
      float darkenGradient = clamp((edge - 0.05) / 0.95, 0.0, 1.0);
      // Cap frost so mid-tilt never goes fully black
      float effect = motion * pow(darkenGradient, 1.35);
      float radius = 56.0 * motion * pow(blurGradient, 1.25);

      vec2 aa = max(fwidth(sourceUV), uiPixel * 0.5);
      vec2 dx = dFdx(sourceUV) / uiPixel;
      vec2 dy = dFdy(sourceUV) / uiPixel;
      float baseLod = log2(max(1.0, max(length(dx), length(dy))));

      // Soft out-of-bounds fade (never hard-zero the whole screen)
      vec2 inside = smoothstep(-aa * 2.0, aa * 2.0, sourceUV)
        * (1.0 - smoothstep(vec2(1.0) - aa * 2.0, vec2(1.0) + aa * 2.0, sourceUV));
      float cover = clamp(inside.x * inside.y, 0.0, 1.0);
      vec2 uvClamped = clamp(sourceUV, vec2(0.0), vec2(1.0));
      vec3 color = textureLod(map, uvClamped, baseLod).rgb;

      if (radius > 0.05) {
        float lod = max(baseLod, log2(max(1.0, radius)));
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int y = -2; y <= 2; y++) {
          for (int x = -2; x <= 2; x++) {
            float wx = x == 0 ? 6.0 : (abs(x) == 1 ? 4.0 : 1.0);
            float wy = y == 0 ? 6.0 : (abs(y) == 1 ? 4.0 : 1.0);
            float w = wx * wy;
            vec2 sampleUV = clamp(sourceUV + vec2(float(x), float(y)) * uiPixel * radius, vec2(0.0), vec2(1.0));
            acc += textureLod(map, sampleUV, lod).rgb * w;
            wsum += w;
          }
        }
        color = acc / max(wsum, 1.0);
      }

      // Duo-style darken, soft OOB, never full black until progress is extreme
      float frost = min(0.92, effect * 1.55);
      color *= (1.0 - frost);
      color *= mix(0.18, 1.0, cover); // dim if looking past the table UI, don't nuke
      return color;
    }

    void main() {
      float theta = clamp(tilt, 0.0, 1.570796327);
      float c = cos(theta);
      float s = sin(theta);

      float u = vUv.x;
      float fromHinge = hingeRight > 0.5 ? u : (1.0 - u);
      float edge = fromHinge;

      // Phone width in "screen-height" units
      float aspect = resolution.x / max(resolution.y, 1.0);
      float halfW = 0.5 * aspect;
      float xFlat = (u - 0.5) * 2.0 * halfW;
      float hingeX = hingeRight > 0.5 ? -halfW : halfW;
      float xFromHinge = xFlat - hingeX; // 0 at hinge, signed toward free edge

      // Glass pose after tip (hinge stays on table)
      float xGlass = hingeX + c * xFromHinge;
      float zGlass = s * abs(xFromHinge);

      // Keep glass below the eye so rays always hit the table
      float eyeZ = max(eyeHeight, zGlass + 0.75);
      vec3 eye = vec3(0.0, 0.0, eyeZ);
      vec3 glass = vec3(xGlass, (vUv.y - 0.5), zGlass);

      vec3 dir = glass - eye;
      float denom = dir.z;
      if (abs(denom) < 1e-4) denom = denom >= 0.0 ? 1e-4 : -1e-4;
      float tHit = (0.0 - eye.z) / denom;
      // If ray goes upward/away, fall back toward hinge projection
      if (tHit < 0.0) tHit = 0.0;
      vec3 hit = eye + dir * tHit;

      float sourceU = (hit.x / (2.0 * halfW)) + 0.5;
      float sourceV = hit.y + 0.5;

      // Extra hinge-anchor (Duo outer screen): keep UV glued near hinge
      float hingeU = hingeRight > 0.5 ? 0.0 : 1.0;
      float unlockedU = sourceU;
      // Foreshorten only after the tip is meaningful; keep near-flat stable
      float tipEase = smoothstep(0.087, 0.35, theta); // ~5° → ~20°
      float foreshorten = mix(1.0, 1.0 / max(0.35, c + 0.15), tipEase * smoothstep(0.0, 0.9, fromHinge));
      float stableU = hingeU + (u - hingeU) * foreshorten;
      sourceU = mix(u, mix(stableU, unlockedU, 0.55 * tipEase), tipEase);
      float sourceVMixed = mix(vUv.y, sourceV, tipEase);
      vec2 sourceUV = vec2(sourceU, sourceVMixed);

      // Hold identity through ~0–5°, then ease projection in through ~20°
      // (kills the early stretch pop)
      float flatMix = tipEase;
      sourceUV = mix(vUv, sourceUV, flatMix);

      // progress 0..1 over our capped tilt range (~75°)
      // Delay frost slightly so the first degrees are warp-only (and warp is eased above)
      float progress = clamp(theta / 1.570796327, 0.0, 1.0);
      progress = smoothstep(0.04, 1.0, progress); // ignore ~0–2.3° of frost
      vec3 color = sampleTable(sourceUV, progress, edge);

      // Only crush to black at the very end of the slider
      color *= 1.0 - smoothstep(0.92, 1.0, progress);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  uniforms.resolution.value.set(width, height);
}
new ResizeObserver(resize).observe(viewport);
resize();

// tipDeg: degrees the glass has lifted off the table (0 = flat, 90 = edge-on).
// Matches real-world phone tilt when sensitivity = 1.00 (default 0.75).
let tipDeg = 0;
let motionEnabled = false;
let motionBaseline = 0;
let calibrateNext = false;
let autoHinge = true;
let displayTip = 0;
let targetTip = 0;

function applyTipDegrees(deg) {
  const tip = THREE.MathUtils.clamp(deg, 0, 90);
  // 1:1 — 45° phone tip → 45° shader tilt
  uniforms.tilt.value = THREE.MathUtils.degToRad(tip);
}

function setTipDegrees(deg, { fromSlider = false } = {}) {
  tipDeg = THREE.MathUtils.clamp(deg, 0, 90);
  targetTip = tipDeg;
  if (fromSlider) displayTip = tipDeg;
  applyTipDegrees(displayTip);
  slider.value = String(tipDeg);
  angleLabel.textContent = `${Math.round(tipDeg)}°`;
}

function updateHinge() {
  uniforms.hingeRight.value = hingeOnRight ? 1 : 0;
}

function syncSensitivityLabel() {
  const v = Number(sensitivityInput.value);
  sensitivityLabel.textContent = v.toFixed(2);
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen() {
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen();
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'fullscreen blocked';
  }
}

async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (err) {
    console.error(err);
  }
}

function syncFullscreenUi() {
  const on = isFullscreen();
  document.documentElement.classList.toggle('is-fullscreen', on);
  fullscreenBtn.textContent = on ? 'Exit full' : 'Fullscreen';
  if (!on) hud.classList.remove('hud-visible');
}

function revealHudTemporarily() {
  if (!isFullscreen()) return;
  hud.classList.add('hud-visible');
  clearTimeout(revealHudTemporarily._t);
  revealHudTemporarily._t = setTimeout(() => {
    if (isFullscreen()) hud.classList.remove('hud-visible');
  }, 5000);
}


function gammaToTipDegrees(gamma) {
  const sensitivity = Number(sensitivityInput.value);
  let g = gamma - motionBaseline;
  if (invertInput.checked) g = -g;

  // Auto hinge: pivot side stays stuck.
  if (autoHinge && Math.abs(g) > 3) {
    const next = g < 0;
    if (next !== hingeOnRight) {
      hingeOnRight = next;
      updateHinge();
    }
  }

  // sensitivity 1.00 = 1:1 with device gamma (degrees off flat)
  return THREE.MathUtils.clamp(Math.abs(g) * sensitivity, 0, 90);
}

function onOrientation(event) {
  if (!motionEnabled) return;
  const gamma = event.gamma ?? 0;
  if (calibrateNext) {
    motionBaseline = gamma;
    calibrateNext = false;
    targetTip = 0;
    displayTip = 0;
    statusEl.textContent = `calibrated (γ0 ${motionBaseline.toFixed(0)}°)`;
    return;
  }
  const raw = Math.abs(gamma - motionBaseline);
  targetTip = gammaToTipDegrees(gamma);
  statusEl.textContent = `glass ${Math.round(displayTip)}° (gyro ${raw.toFixed(0)}° × ${Number(sensitivityInput.value).toFixed(2)})`;
}

async function enableMotion() {
  try {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        statusEl.textContent = 'motion denied';
        return;
      }
    }
    window.addEventListener('deviceorientation', onOrientation, true);
    motionEnabled = true;
    statusEl.textContent = 'gyro on — hold flat, then tilt';
    enableBtn.textContent = 'Motion on';
    enableBtn.disabled = true;
    if (landingActions) landingActions.hidden = true;
    if (afterMotion) afterMotion.hidden = false;
    if (landingHint) {
      landingHint.textContent =
        'Phone flat = UI stuck to the table. Tilt — glass lifts, UI stays table-aligned.';
    }
    // Same user gesture → fullscreen (required by browsers)
    await enterFullscreen();
    revealHudTemporarily();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'motion unavailable';
  }
}

enableBtn.addEventListener('click', () => enableMotion());
calibrateBtn.addEventListener('click', () => {
  if (!motionEnabled) {
    motionBaseline = 0;
    statusEl.textContent = 'baseline reset';
    setTipDegrees(0, { fromSlider: true });
    return;
  }
  calibrateNext = true;
  statusEl.textContent = 'hold flat…';
});

slider.addEventListener('input', () => {
  setTipDegrees(Number(slider.value), { fromSlider: true });
});

sensitivityInput.addEventListener('input', syncSensitivityLabel);
sensitivityInput.addEventListener('change', syncSensitivityLabel);

fullscreenBtn.addEventListener('click', () => {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
});
exitFullscreenBtn.addEventListener('click', () => exitFullscreen());
showHudBtn.addEventListener('click', () => revealHudTemporarily());
document.addEventListener('fullscreenchange', syncFullscreenUi);
document.addEventListener('webkitfullscreenchange', syncFullscreenUi);
viewport.addEventListener('pointerdown', () => {
  if (isFullscreen() && !hud.classList.contains('hud-visible')) {
    revealHudTemporarily();
  }
});

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  try {
    const canvas = await canvasFromFile(file, 1170, 2532);
    uiTexture.image = canvas;
    uiTexture.colorSpace = THREE.NoColorSpace;
    uiTexture.needsUpdate = true;
    uniforms.uiPixel.value.set(1 / canvas.width, 1 / canvas.height);
  } catch {
    alert('Could not read that image.');
  } finally {
    uploadInput.value = '';
  }
});

// Drag: scrub glass lift (desktop preview of the illusion)
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  dragging = false;
  try {
    renderer.domElement.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const fromHinge = hingeOnRight ? 1 - x : x;
  setTipDegrees(THREE.MathUtils.clamp(fromHinge, 0, 1) * 90, { fromSlider: true });
});

updateHinge();
syncSensitivityLabel();
syncFullscreenUi();
setTipDegrees(0, { fromSlider: true });

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  displayTip += (targetTip - displayTip) * Math.min(1, dt * 14);

  applyTipDegrees(displayTip);
  tipDeg = displayTip;
  slider.value = String(displayTip);
  angleLabel.textContent = `${Math.round(displayTip)}°`;
  renderer.render(scene, camera);
});
