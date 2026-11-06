export async function startCamera(video: HTMLVideoElement, preferRear = true): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = preferRear
    ? [
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
        { audio: false, video: true },
      ]
    : [
        { audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
        { audio: false, video: true },
      ]

  let lastError: unknown
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      video.srcObject = stream
      await video.play()
      return stream
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not open camera')
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}

export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if (!('wakeLock' in navigator)) return null
    return await navigator.wakeLock.request('screen')
  } catch {
    return null
  }
}
