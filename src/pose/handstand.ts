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

export type DetectOptions = {
  /**
   * Softer geometry used only to *stay* in a hold. Entering still uses the
   * stricter thresholds so random poses don't start the clock.
   */
  maintain?: boolean
}

type Thresholds = {
  visibility: number
  ankleHipGap: number
  hipShoulderGap: number
  shoulderWristGap: number
  minSpan: number
  maxLateralRatio: number
}

const ENTER: Thresholds = {
  visibility: 0.45,
  ankleHipGap: 0.02,
  hipShoulderGap: 0.02,
  shoulderWristGap: 0.01,
  minSpan: 0.28,
  maxLateralRatio: 0.85,
}

/** Tolerates a dip, banana, or brief landmark wobble mid-hold. */
const MAINTAIN: Thresholds = {
  visibility: 0.28,
  ankleHipGap: 0,
  hipShoulderGap: 0,
  shoulderWristGap: -0.02,
  minSpan: 0.2,
  maxLateralRatio: 1.15,
}

/**
 * Geometric handstand check using image coordinates (y grows downward).
 * Wall-assisted counts — we only require an inverted body line.
 */
export function detectRawHandstand(
  landmarks: Point[],
  options: DetectOptions = {},
): RawHandstandSample {
  if (landmarks.length < 29) {
    return { inverted: false, reason: 'no pose' }
  }

  const t = options.maintain ? MAINTAIN : ENTER

  const lw = landmarks[LM.leftWrist]
  const rw = landmarks[LM.rightWrist]
  const ls = landmarks[LM.leftShoulder]
  const rs = landmarks[LM.rightShoulder]
  const lh = landmarks[LM.leftHip]
  const rh = landmarks[LM.rightHip]
  const la = landmarks[LM.leftAnkle]
  const ra = landmarks[LM.rightAnkle]

  const keyPoints = [lw, rw, ls, rs, lh, rh, la, ra]
  if (!keyPoints.every((p) => visibleEnough(p, t.visibility))) {
    return { inverted: false, reason: 'low confidence' }
  }

  const wrists = midpoint(lw, rw)
  const shoulders = midpoint(ls, rs)
  const hips = midpoint(lh, rh)
  const ankles = midpoint(la, ra)

  // Inverted: ankles above hips above shoulders/wrists (smaller y = higher on screen)
  const anklesAboveHips = ankles.y < hips.y - t.ankleHipGap
  const hipsAboveShoulders = hips.y < shoulders.y - t.hipShoulderGap
  const shouldersAboveWrists = shoulders.y < wrists.y - t.shoulderWristGap

  const verticalSpan = Math.abs(ankles.y - wrists.y)
  const lateralDrift = Math.abs(ankles.x - wrists.x)
  const stacked = verticalSpan > t.minSpan && lateralDrift < verticalSpan * t.maxLateralRatio

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

  /**
   * Enter quickly once the shape is clear; exit slowly so a half-second dip
   * or confidence blip does not split one hold into two.
   */
  constructor(enterMs = 350, exitMs = 1400) {
    this.enterMs = enterMs
    this.exitMs = exitMs
  }

  /** Whether we are currently counting a stable handstand. */
  get active(): boolean {
    return this.isHandstand
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
