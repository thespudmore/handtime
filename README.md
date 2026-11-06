# handtime

A browser app that tracks **time spent in a handstand**, not total practice time. It uses your device camera and MediaPipe Pose; an accumulating timer only runs while your body looks inverted.

Works on phone, tablet, and laptop browsers. Data stays in `localStorage` on the device.

## Use

1. Open the app and allow camera access.
2. Frame your full body.
3. Tap **Start**, kick up (wall-assisted is fine).
4. The timer accumulates only while a handstand is detected.
5. Set a daily goal (minutes). Progress and a 7-day bar history are stored locally.

## Develop

```bash
npm install
npm run dev
```

## Deploy (GitHub Pages)

```bash
npm run deploy
```

This builds to `dist/` and pushes to the `gh-pages` branch. In the repo settings, set Pages to deploy from `gh-pages`.

Live URL once enabled: https://thespudmore.github.io/handtime/

## Stack

- Vite + TypeScript
- MediaPipe Pose Landmarker (lite)
- Rule-based handstand detection with enter/exit hysteresis
- `localStorage` for daily totals and goals
