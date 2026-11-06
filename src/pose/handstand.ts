import { LM, midpoint, visibleEnough, type Point } from './landmarks'

export type RawHandstandSample = {
  inverted: boolean
  reason: string
}

export type StableHandstandState = {
  isHandstand: boolean
  rawInverted: boolean
  reason: string
  enterProgress: number
  exitProgress: number
}

/**
 * Geometric handstand check using image coordinates (y grows downward).
 * Wall-assisted counts — we only require an inverted body line.
 */
export function detectRawHandstand(landmarks: Point[]): RawHandstandSample {
  if (landmarks.length < 29) {
    return { inverted: false, reason: 'no pose' }
  }

  const lw = landmarks[LM.leftWrist]
  const rw = landmarks[LM.rightWrist]
  const ls = landmarks[LM.leftShoulder]
  const rs = landmarks[LM.rightShoulder]
  const lh = landmarks[LM.leftHip]
  const rh = landmarks[LM.rightHip]
  const la = landmarks[LM.leftAnkle]
  const ra = landmarks[LM.rightAnkle]

  const keyPoints = [lw, rw, ls, rs, lh, rh, la, ra]
  if (!keyPoints.every((p) => visibleEnough(p))) {
    return { inverted: false, reason: 'low confidence' }
  }

  const wrists = midpoint(lw, rw)
  const shoulders = midpoint(ls, rs)
  const hips = midpoint(lh, rh)
  const ankles = midpoint(la, ra)

  // Inverted: ankles above hips above shoulders/wrists (smaller y = higher on screen)
  const anklesAboveHips = ankles.y < hips.y - 0.02
  const hipsAboveShoulders = hips.y < shoulders.y - 0.02
  const shouldersAboveWrists = shoulders.y < wrists.y - 0.01

  // Body roughly stacked vertically (not a deep bridge / cartwheel silhouette)
  const verticalSpan = Math.abs(ankles.y - wrists.y)
  const lateralDrift = Math.abs(ankles.x - wrists.x)
  const stacked = verticalSpan > 0.28 && lateralDrift < verticalSpan * 0.85

  // Hands should be the lowest major joint cluster
  const handsLow = wrists.y > hips.y && wrists.y > shoulders.y

  if (!anklesAboveHips) return { inverted: false, reason: 'feet not up' }
  if (!hipsAboveShoulders) return { inverted: false, reason: 'not inverted' }
  if (!shouldersAboveWrists && !handsLow) {
    return { inverted: false, reason: 'hands not supporting' }
  }
  if (!stacked) return { inverted: false, reason: 'not stacked' }

  return { inverted: true, reason: 'handstand' }
}

export class HandstandTracker {
  private isHandstand = false
  private invertedSince: number | null = null
  private uprightSince: number | null = null
  private readonly enterMs: number
  private readonly exitMs: number

  constructor(enterMs = 400, exitMs = 450) {
    this.enterMs = enterMs
    this.exitMs = exitMs
  }

  update(raw: RawHandstandSample, now = performance.now()): StableHandstandState {
    if (raw.inverted) {
      this.uprightSince = null
      if (this.invertedSince === null) this.invertedSince = now

      const held = now - this.invertedSince
      if (!this.isHandstand && held >= this.enterMs) {
        this.isHandstand = true
      }

      return {
        isHandstand: this.isHandstand,
        rawInverted: true,
        reason: raw.reason,
        enterProgress: this.isHandstand ? 1 : Math.min(1, held / this.enterMs),
        exitProgress: 0,
      }
    }

    this.invertedSince = null
    if (this.uprightSince === null) this.uprightSince = now

    const lost = now - this.uprightSince
    if (this.isHandstand && lost >= this.exitMs) {
      this.isHandstand = false
    }

    return {
      isHandstand: this.isHandstand,
      rawInverted: false,
      reason: raw.reason,
      enterProgress: 0,
      exitProgress: this.isHandstand ? Math.min(1, lost / this.exitMs) : 0,
    }
  }

  reset(): void {
    this.isHandstand = false
    this.invertedSince = null
    this.uprightSince = null
  }
}
