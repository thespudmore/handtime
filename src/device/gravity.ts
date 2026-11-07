export type GravitySample = {
  x: number
  y: number
  z: number
}

let latest: GravitySample | null = null
let listening = false

/**
 * Screen-upright gravity pulls toward the bottom of the phone (negative y in
 * the DeviceMotion body frame). Flipping the phone 180° flips that sign —
 * the classic "arms up + upside-down phone" cheat.
 */
export function isDeviceUpsideDown(g: GravitySample | null = latest): boolean {
  if (!g) return false

  const ax = Math.abs(g.x)
  const ay = Math.abs(g.y)
  const az = Math.abs(g.z)

  // Lying flat — orientation cheat doesn't apply; leave it to pose geometry.
  if (az > ax && az > ay && az > 7) return false

  // Portrait-ish: reject only when clearly inverted past horizontal.
  if (ay >= ax) {
    return g.y > 5
  }

  // Landscape filming varies by primary/secondary; rely on geometry there.
  // Still catch landscape-secondary when the browser reports it.
  const type = screen.orientation?.type ?? ''
  return type === 'landscape-secondary' || type === 'portrait-secondary'
}

export function getLatestGravity(): GravitySample | null {
  return latest
}

type DeviceOrientationConstructor = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

/** Best-effort; safe to call from the camera-enable tap (needed on iOS). */
export async function startGravityMonitor(): Promise<void> {
  if (listening || typeof window === 'undefined') return
  if (!('DeviceMotionEvent' in window)) return

  const DOE = DeviceMotionEvent as unknown as DeviceOrientationConstructor
  if (typeof DOE.requestPermission === 'function') {
    try {
      const result = await DOE.requestPermission()
      if (result !== 'granted') return
    } catch {
      return
    }
  }

  window.addEventListener('devicemotion', onMotion, { passive: true })
  listening = true
}

function onMotion(event: DeviceMotionEvent): void {
  const g = event.accelerationIncludingGravity
  if (!g || g.x == null || g.y == null || g.z == null) return
  latest = { x: g.x, y: g.y, z: g.z }
}
