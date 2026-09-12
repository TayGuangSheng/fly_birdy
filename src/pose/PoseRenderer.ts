import type { PoseLandmarks } from './PoseTypes.ts'

const connections: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23],
  [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]
const focalLandmarks = new Set([0, 11, 12, 13, 14, 15, 16, 23, 24])

export class PoseRenderer {
  private readonly canvas: HTMLCanvasElement

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  public clear(): void {
    const context = this.canvas.getContext('2d')
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  public draw(landmarks: PoseLandmarks | undefined, isTracking: boolean, width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const context = this.canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    if (!landmarks) return

    context.lineCap = 'round'
    context.lineJoin = 'round'
    const lineColour = isTracking ? '#9ff7d2' : '#f4b860'
    for (const [fromIndex, toIndex] of connections) {
      const from = landmarks[fromIndex]
      const to = landmarks[toIndex]
      if (!from || !to || from.visibility < 0.2 || to.visibility < 0.2) continue
      context.beginPath()
      context.moveTo(from.x * width, from.y * height)
      context.lineTo(to.x * width, to.y * height)
      context.strokeStyle = lineColour
      context.globalAlpha = Math.min(from.visibility, to.visibility) * 0.86
      context.lineWidth = focalLandmarks.has(fromIndex) || focalLandmarks.has(toIndex) ? 4 : 2
      context.stroke()
    }

    for (let index = 0; index < landmarks.length; index += 1) {
      const landmark = landmarks[index]
      if (!landmark || landmark.visibility < 0.25) continue
      const focal = focalLandmarks.has(index)
      context.beginPath()
      context.arc(landmark.x * width, landmark.y * height, focal ? 5.2 : 2.4, 0, Math.PI * 2)
      context.fillStyle = focal ? '#f8f5e8' : lineColour
      context.globalAlpha = landmark.visibility
      context.fill()
    }
    context.globalAlpha = 1
  }
}
