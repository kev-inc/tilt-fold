# Tilt Fold

Mobile web demo: tilt a normal phone left/right (face-up on a table) and one half of the screen folds with a Duo-style projected wallpaper + progressive blur.

Inspired by the public animation study [chuspeeism/iphone-duo](https://github.com/chuspeeism/iphone-duo). **Not affiliated with Apple.** No Apple 3D product models or marketing assets are included.

## Run

```bash
npm install
npm run dev -- --host
```

Open the printed URL on your phone (same Wi‑Fi). Prefer HTTPS or `localhost` for iOS motion permission — on a LAN IP, Safari may block orientation until you use a tunnel (e.g. Cloudflare Tunnel / ngrok).

```bash
npm run build
npm run preview -- --host
```

## On phone

1. Lay the phone **face-up** on a table.
2. Tap **Enable motion** (iOS will ask for permission).
3. Tap **Calibrate flat**.
4. Tilt left/right — the folding half blurs and darkens like the viral transition.

Desktop fallback: drag horizontally across the canvas, use the **Fold** slider, or **Play**.

## Notes

- Gyro uses `DeviceOrientation` **gamma** (left/right) while flat.
- Settings: sensitivity, invert, fold left vs right, custom wallpaper upload.
- Effect recipe: hinge-fold one half; sample UI in unfolded local space; blur radius up to 72px with `pow(edge, 1.35)` darken — same family of tricks as the Vercel study.
