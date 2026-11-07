import './style.css'
import { PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { startCamera, stopCamera, requestWakeLock } from './camera'
import { isDeviceUpsideDown, startGravityMonitor } from './device/gravity'
import { drawPose } from './pose/draw'
import { detectRawHandstand, HandstandTracker } from './pose/handstand'
import { createPoseLandmarker, detectPose } from './pose/landmarker'
import {
  addHandstandSeconds,
  getTodayRecord,
  loadData,
  recentDays,
  recordHoldSeconds,
  setGoalMinutes,
  type AppData,
} from './storage/daily'
import { formatDuration } from './timer/format'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app missing')

app.innerHTML = `
  <div class="gate" id="gate">
    <div class="gate-card">
      <h1>hand<span>time</span></h1>
      <p>Only time spent inverted counts. Point a camera at your full body, kick up, and the timer runs while you hold.</p>
      <button class="btn btn-primary" id="enable-camera" type="button">Enable camera</button>
      <p class="error hidden" id="gate-error"></p>
    </div>
  </div>

  <div class="stage hidden" id="stage">
    <div class="camera-plane" id="camera-plane">
      <video id="video" playsinline muted autoplay></video>
      <canvas id="overlay"></canvas>
    </div>
    <div class="veil" aria-hidden="true"></div>

    <div class="hud">
      <div class="top-bar">
        <h1 class="brand">hand<span>time</span></h1>
        <div class="top-meta">
          <div class="status-pill" id="status-pill">upright</div>
          <p class="reason" id="reason">waiting for pose</p>
        </div>
      </div>

      <div class="center-stack">
        <p class="eyebrow" id="session-label">today's handstand time</p>
        <p class="timer" id="timer">00:00</p>
        <div class="hold-row">
          <div class="hold-stat">
            <span class="hold-label" id="hold-label">this hold</span>
            <strong id="hold-time">00:00</strong>
          </div>
          <div class="hold-stat">
            <span class="hold-label">best</span>
            <strong id="best-time">00:00</strong>
          </div>
        </div>
        <div class="goal-row">
          <div class="goal-label">
            <span>Daily goal</span>
            <strong id="goal-text">0 / 10 min</strong>
          </div>
          <div class="track" aria-hidden="true"><span id="goal-fill"></span></div>
        </div>
      </div>

      <div class="bottom-bar">
        <div class="controls">
          <button class="btn btn-primary" id="toggle-session" type="button">Start</button>
          <button class="btn" id="flip-camera" type="button">Flip camera</button>
        </div>
        <div class="goal-edit">
          <label for="goal-input">Goal (min)</label>
          <input id="goal-input" type="number" min="1" max="180" step="1" />
        </div>
        <div class="history" id="history" title="Last 7 days"></div>
      </div>
    </div>
  </div>
`

const gate = el<HTMLDivElement>('gate')
const gateError = el<HTMLParagraphElement>('gate-error')
const enableBtn = el<HTMLButtonElement>('enable-camera')
const stage = el<HTMLDivElement>('stage')
const cameraPlane = el<HTMLDivElement>('camera-plane')
const video = el<HTMLVideoElement>('video')
const overlay = el<HTMLCanvasElement>('overlay')
const statusPill = el<HTMLDivElement>('status-pill')
const reasonEl = el<HTMLParagraphElement>('reason')
const timerEl = el<HTMLParagraphElement>('timer')
const holdLabel = el<HTMLSpanElement>('hold-label')
const holdTimeEl = el<HTMLElement>('hold-time')
const bestTimeEl = el<HTMLElement>('best-time')
const goalText = el<HTMLElement>('goal-text')
const goalFill = el<HTMLSpanElement>('goal-fill')
const toggleBtn = el<HTMLButtonElement>('toggle-session')
const flipBtn = el<HTMLButtonElement>('flip-camera')
const goalInput = el<HTMLInputElement>('goal-input')
const historyEl = el<HTMLDivElement>('history')

const canvasCtx = overlay.getContext('2d')
if (!canvasCtx) throw new Error('2D canvas unavailable')
const ctx: CanvasRenderingContext2D = canvasCtx

let data: AppData = loadData()
let landmarker: PoseLandmarker | null = null
let stream: MediaStream | null = null
let wakeLock: WakeLockSentinel | null = null
let preferRear = true
let mirrored = true
let sessionActive = false
let raf = 0
let lastVideoTime = -1
let lastPersist = performance.now()
let handstandClockStart: number | null = null
/** Wall-clock start of the current continuous hold (stable handstand). */
let holdClockStart: number | null = null
/** Most recent completed hold, kept on screen until the next one starts. */
let lastHoldSeconds = 0
let holdWasActive = false

const tracker = new HandstandTracker()

goalInput.value = String(data.goalMinutes)
renderStats()
renderHistory()
renderHoldStats(performance.now())

enableBtn.addEventListener('click', () => {
  void boot()
})

toggleBtn.addEventListener('click', () => {
  if (sessionActive) stopSession()
  else startSession()
})

flipBtn.addEventListener('click', () => {
  void flipCamera()
})

goalInput.addEventListener('change', () => {
  const value = Number(goalInput.value)
  if (!Number.isFinite(value)) return
  data = setGoalMinutes(data, value)
  goalInput.value = String(data.goalMinutes)
  renderStats()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionActive) {
    void requestWakeLock().then((lock) => {
      wakeLock = lock
    })
  }
})

async function boot(): Promise<void> {
  enableBtn.disabled = true
  gateError.classList.add('hidden')
  enableBtn.textContent = 'Loading model…'

  try {
    // Same user gesture as camera — required for motion permission on iOS.
    void startGravityMonitor()
    landmarker = await createPoseLandmarker()
    enableBtn.textContent = 'Starting camera…'
    stream = await startCamera(video, preferRear)
    mirrored = preferRear === false
    cameraPlane.classList.toggle('mirror-off', !mirrored)

    gate.classList.add('hidden')
    stage.classList.remove('hidden')
    resizeOverlay()
    loop()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Camera or model failed to start'
    gateError.textContent = message
    gateError.classList.remove('hidden')
    enableBtn.disabled = false
    enableBtn.textContent = 'Try again'
  }
}

function startSession(): void {
  sessionActive = true
  handstandClockStart = null
  holdClockStart = null
  holdWasActive = false
  tracker.reset()
  toggleBtn.textContent = 'Stop'
  toggleBtn.classList.add('is-live')
  void requestWakeLock().then((lock) => {
    wakeLock = lock
  })
  renderStats()
  renderHoldStats(performance.now())
}

function stopSession(): void {
  const now = performance.now()
  flushHandstandTime(now, false)
  finishHold(now)
  sessionActive = false
  handstandClockStart = null
  tracker.reset()
  toggleBtn.textContent = 'Start'
  toggleBtn.classList.remove('is-live')
  stage.classList.remove('is-handstand')
  statusPill.classList.remove('on')
  statusPill.textContent = 'upright'
  void wakeLock?.release()
  wakeLock = null
  renderStats()
  renderHoldStats(now)
}

async function flipCamera(): Promise<void> {
  preferRear = !preferRear
  stopCamera(stream)
  stream = null
  stream = await startCamera(video, preferRear)
  mirrored = !preferRear
  cameraPlane.classList.toggle('mirror-off', !mirrored)
  lastVideoTime = -1
}

function loop(): void {
  raf = requestAnimationFrame(loop)
  resizeOverlay()

  if (!landmarker || video.readyState < 2) return

  const now = performance.now()
  if (video.currentTime === lastVideoTime) {
    updateTimerDisplay(now)
    renderHoldStats(now)
    return
  }
  lastVideoTime = video.currentTime

  let result: PoseLandmarkerResult
  try {
    result = detectPose(landmarker, video, now)
  } catch {
    return
  }

  ctx.clearRect(0, 0, overlay.width, overlay.height)

  const landmarks = result.landmarks[0]
  if (!landmarks) {
    const idle = tracker.update({ inverted: false, reason: 'no pose' }, now)
    applyPoseUi(idle, now)
    return
  }

  let raw = detectRawHandstand(landmarks, { maintain: tracker.active })
  if (raw.inverted && isDeviceUpsideDown()) {
    raw = { inverted: false, reason: 'phone upside down' }
  }
  const state = tracker.update(raw, now)
  drawPose(ctx, landmarks, overlay.width, overlay.height, state.isHandstand)
  applyPoseUi(state, now)
}

function applyPoseUi(
  state: ReturnType<HandstandTracker['update']>,
  now: number,
): void {
  reasonEl.textContent = state.reason

  if (state.isHandstand) {
    stage.classList.add('is-handstand')
    statusPill.classList.add('on')
    statusPill.textContent = 'handstand'
    if (sessionActive && handstandClockStart === null) {
      handstandClockStart = now
    }
    if (sessionActive && holdClockStart === null) {
      holdClockStart = now
      holdWasActive = true
    }
  } else {
    stage.classList.remove('is-handstand')
    statusPill.classList.remove('on')
    statusPill.textContent = state.rawInverted ? 'locking in…' : 'upright'
    flushHandstandTime(now, false)
    if (holdWasActive) finishHold(now)
  }

  if (sessionActive && state.isHandstand && now - lastPersist > 1000) {
    flushHandstandTime(now, true)
    lastPersist = now
  }

  updateTimerDisplay(now)
  renderHoldStats(now)
}

function finishHold(now: number): void {
  if (holdClockStart === null) {
    holdWasActive = false
    return
  }
  const held = (now - holdClockStart) / 1000
  holdClockStart = null
  holdWasActive = false
  if (held <= 0) return
  lastHoldSeconds = held
  const previousBest = data.longestSeconds
  data = recordHoldSeconds(data, held)
  if (data.longestSeconds > previousBest) {
    bestTimeEl.classList.remove('is-new')
    // Retrigger CSS animation when a record is set.
    void bestTimeEl.offsetWidth
    bestTimeEl.classList.add('is-new')
  }
}

function flushHandstandTime(now: number, keepRunning: boolean): void {
  if (handstandClockStart === null) return
  const delta = (now - handstandClockStart) / 1000
  handstandClockStart = keepRunning && sessionActive ? now : null
  if (delta <= 0) return
  data = addHandstandSeconds(data, delta)
  renderStats()
  renderHistory()
}

function updateTimerDisplay(now: number): void {
  const live =
    sessionActive && handstandClockStart !== null
      ? (now - handstandClockStart) / 1000
      : 0
  const today = getTodayRecord(data).seconds + live
  timerEl.textContent = formatDuration(today)

  const goalSeconds = data.goalMinutes * 60
  const pct = Math.min(100, (today / goalSeconds) * 100)
  goalFill.style.width = `${pct}%`
  const mins = today / 60
  goalText.textContent = `${mins.toFixed(1)} / ${data.goalMinutes} min`
}

function renderHoldStats(now: number): void {
  const liveHold =
    sessionActive && holdClockStart !== null ? (now - holdClockStart) / 1000 : 0
  const showingLive = liveHold > 0
  holdLabel.textContent = showingLive ? 'this hold' : 'last hold'
  holdTimeEl.textContent = formatDuration(showingLive ? liveHold : lastHoldSeconds)
  holdTimeEl.classList.toggle('is-live', showingLive)
  bestTimeEl.textContent = formatDuration(data.longestSeconds)
}

function renderStats(): void {
  updateTimerDisplay(performance.now())
  renderHoldStats(performance.now())
}

function renderHistory(): void {
  const days = recentDays(data, 7).reverse()
  const max = Math.max(data.goalMinutes * 60, ...days.map((d) => d.record.seconds), 1)
  historyEl.innerHTML = days
    .map((d, index) => {
      const height = Math.max(8, Math.round((d.record.seconds / max) * 48))
      const classes = [
        'history-day',
        d.record.goalMet ? 'met' : '',
        index === days.length - 1 ? 'today' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return `<div class="${classes}" style="height:${height}px" title="${d.date}: ${formatDuration(d.record.seconds)}"></div>`
    })
    .join('')
}

function resizeOverlay(): void {
  const w = cameraPlane.clientWidth
  const h = cameraPlane.clientHeight
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w
    overlay.height = h
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`#${id} missing`)
  return node as T
}

window.addEventListener('beforeunload', () => {
  flushHandstandTime(performance.now(), false)
  stopCamera(stream)
  cancelAnimationFrame(raf)
  landmarker?.close()
})
