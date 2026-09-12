import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { poseConfig } from '../config/poseConfig.ts'

/** Owns the MediaPipe runtime; UI and pose interpretation stay elsewhere. */
export class PoseLandmarkerService {
  private landmarker: PoseLandmarker | null = null

  public async initialise(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(poseConfig.wasmBaseUrl)
    const options = {
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: poseConfig.minPoseDetectionConfidence,
      minPosePresenceConfidence: poseConfig.minPosePresenceConfidence,
      minTrackingConfidence: poseConfig.minTrackingConfidence,
    }
    try {
      // GPU inference keeps the current camera frame close to the render frame
      // on devices that expose WebGL acceleration.
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: poseConfig.modelAssetUrl, delegate: 'GPU' },
      })
    } catch {
      // Some browsers or privacy modes do not allow the GPU delegate. Falling
      // back keeps pose control available instead of failing camera startup.
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: poseConfig.modelAssetUrl, delegate: 'CPU' },
      })
    }
  }

  public detect(video: HTMLVideoElement, timestamp: number): PoseLandmarkerResult | null {
    return this.landmarker?.detectForVideo(video, timestamp) ?? null
  }

  public destroy(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
