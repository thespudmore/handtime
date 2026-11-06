import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  active: boolean,
): void {
  const color = active ? '#b8f23a' : 'rgba(245, 240, 230, 0.7)'
  const lineWidth = active ? 3.5 : 2

  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = color
  ctx.fillStyle = color

  for (const connection of PoseLandmarker.POSE_CONNECTIONS) {
    const pa = landmarks[connection.start]
    const pb = landmarks[connection.end]
    if (!pa || !pb) continue
    if ((pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue

    ctx.beginPath()
    ctx.moveTo(pa.x * width, pa.y * height)
    ctx.lineTo(pb.x * width, pb.y * height)
    ctx.stroke()
  }

  for (const p of landmarks) {
    if ((p.visibility ?? 1) < 0.4) continue
    ctx.beginPath()
    ctx.arc(p.x * width, p.y * height, active ? 4.5 : 3.2, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
