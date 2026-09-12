/**
 * Default screen: user-provided iOS home screen screenshot
 * (resized to 1170×2532 for the Tilt Fold canvas).
 */

export async function createWallpaperCanvases(width = 1170, height = 2532) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  try {
    const img = await loadImage('/stock/default-home.png');
    // cover-fit
    const scale = Math.max(width / img.width, height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } catch (err) {
    console.warn('Stock home screen failed to load, using fallback', err);
    drawFallbackLock(ctx, width, height);
  }

  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function drawFallbackLock(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1a1440');
  g.addColorStop(0.5, '#c45c8a');
  g.addColorStop(1, '#f6d9a8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `200 ${Math.round(h * 0.12)}px -apple-system, ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('9:41', w / 2, h * 0.28);
}

export async function canvasFromFile(file, width = 1170, height = 2532) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, width, height);
    const scale = Math.max(width / img.width, height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
