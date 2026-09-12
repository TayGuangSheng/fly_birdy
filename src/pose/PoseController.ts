import { poseConfig } from '../config/poseConfig.ts'
import { LANDMARK, type PoseLandmarks, type PoseMeasurements, type WorldLandmarks } from './PoseTypes.ts'

type Point = { x: number; y: number; z: number }

const emptyMeasurements = (): PoseMeasurements => ({
  tracking: false,
  trackingConfidence: 0,
  armsExtended: false,
  leftWingAngle: 0,
  rightWingAngle: 0,
  rawBankSignal: 0,
  rawTorsoLean: 0,
  torsoLean: 0,
  shoulderWidth: 0,
  handsNearFrameEdge: false,
  roll: 0,
  pitch: 0,
  steering: 0,
  vertical: 0,
  flapping: false,
})

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
})
const distance2d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Translates MediaPipe's landmarks into body-relative measurements. It has no
 * DOM or game-engine dependency, so calibration and flight can reuse it later.
 */
export class PoseController {
  private flapArmed = false
  private flapActiveUntil = 0
  private neutralBankSignal = 0
  private neutralTorsoLean = 0

  /** Centres steering and dive around the player's held neutral T-pose. */
  public setNeutralPose(rawBankSignal: number, rawTorsoLean: number): void {
    this.neutralBankSignal = rawBankSignal
    this.neutralTorsoLean = rawTorsoLean
    this.resetFlap()
  }

  public clearNeutralPose(): void {
    this.neutralBankSignal = 0
    this.neutralTorsoLean = 0
    this.resetFlap()
  }

  public interpret(
    landmarks: PoseLandmarks | undefined,
    worldLandmarks: WorldLandmarks | undefined,
    timestamp = performance.now(),
  ): PoseMeasurements {
    if (!landmarks || !worldLandmarks) {
      this.resetFlap()
      return emptyMeasurements()
    }

    const required = [
      LANDMARK.leftShoulder,
      LANDMARK.rightShoulder,
      LANDMARK.leftElbow,
      LANDMARK.rightElbow,
      LANDMARK.leftWrist,
      LANDMARK.rightWrist,
      LANDMARK.leftHip,
      LANDMARK.rightHip,
    ]
    const requiredPoints = required.map((index) => landmarks[index])
    if (requiredPoints.some((point) => !point)) {
      this.resetFlap()
      return emptyMeasurements()
    }

    const leftShoulder = landmarks[LANDMARK.leftShoulder]
    const rightShoulder = landmarks[LANDMARK.rightShoulder]
    const leftElbow = landmarks[LANDMARK.leftElbow]
    const rightElbow = landmarks[LANDMARK.rightElbow]
    const leftWrist = landmarks[LANDMARK.leftWrist]
    const rightWrist = landmarks[LANDMARK.rightWrist]
    const shoulderWidth = distance2d(leftShoulder, rightShoulder)
    if (shoulderWidth < 0.02) {
      this.resetFlap()
      return emptyMeasurements()
    }

    const corePoints = [leftShoulder, rightShoulder, leftElbow, rightElbow, landmarks[LANDMARK.leftHip], landmarks[LANDMARK.rightHip]]
    const wingPoints = [leftWrist, rightWrist]
    const coreVisibility = average(corePoints.map((point) => point.visibility ?? 0))
    const wingVisibility = average(wingPoints.map((point) => point.visibility ?? 0))
    // Do not collapse all confidence when a hand briefly approaches the edge
    // of the webcam. Shoulders, elbows, and hips keep pose continuity while
    // wrist visibility still meaningfully affects the final signal.
    const trackingConfidence = clamp(coreVisibility * 0.72 + wingVisibility * 0.28, 0, 1)
    const armLandmarksVisible = [leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist].every(
      (point) => (point.visibility ?? 0) >= poseConfig.armLandmarkVisibility,
    )

    const leftWingAngle = this.wingAngle(leftShoulder, leftElbow, leftWrist)
    const rightWingAngle = this.wingAngle(rightShoulder, rightElbow, rightWrist)

    // Each wing is measured from its own shoulder. Moving around the frame does
    // not become a steering command as a result.
    const leftWingDrop = this.weightedWingDrop(leftShoulder, leftElbow, leftWrist)
    const rightWingDrop = this.weightedWingDrop(rightShoulder, rightElbow, rightWrist)
    const shoulderBank = leftShoulder.y - rightShoulder.y
    const wingBank = leftWingDrop - rightWingDrop
    const rawBankSignal = (wingBank * 0.75 + shoulderBank * 0.25) / shoulderWidth
    const bankSignal = rawBankSignal - this.neutralBankSignal
    const roll = this.normaliseWithDeadZone(-bankSignal, poseConfig.rollDeadZone, poseConfig.rollNormalisation)

    const rawTorsoLean = this.torsoLean(worldLandmarks)
    const torsoLean = rawTorsoLean - this.neutralTorsoLean
    const pitch = clamp(torsoLean / poseConfig.pitchNormalisation, -1, 1)

    const leftArmLength = distance2d(leftShoulder, leftWrist) / shoulderWidth
    const rightArmLength = distance2d(rightShoulder, rightWrist) / shoulderWidth
    // Extension is based on shoulder-to-wrist reach, not how horizontal the arm
    // looks to the camera. A wing held high or low is still an extended wing.
    const armsExtended =
      armLandmarksVisible &&
      leftArmLength >= poseConfig.armExtensionRatio &&
      rightArmLength >= poseConfig.armExtensionRatio
    const handsNearFrameEdge = [leftWrist, rightWrist].some(
      (wrist) => wrist.x <= poseConfig.wristFrameMargin || wrist.x >= 1 - poseConfig.wristFrameMargin,
    )

    const flapping = this.detectFlap(
      leftShoulder,
      leftElbow,
      leftWrist,
      rightShoulder,
      rightElbow,
      rightWrist,
      shoulderWidth,
      armsExtended,
      timestamp,
    )
    // Forward chest lean remains the dive input. A backward lean is deliberately
    // ignored: a single front-facing camera has poor, jittery depth resolution.
    const dive = Math.min(pitch, 0)

    return {
      tracking: trackingConfidence >= poseConfig.goodTrackingConfidence,
      trackingConfidence: clamp(trackingConfidence, 0, 1),
      armsExtended,
      leftWingAngle,
      rightWingAngle,
      rawBankSignal,
      rawTorsoLean,
      torsoLean,
      shoulderWidth,
      handsNearFrameEdge,
      roll,
      pitch,
      steering: roll,
      vertical: dive < 0 ? dive : flapping ? 1 : 0,
      flapping,
    }
  }

  private wingAngle(shoulder: Point, elbow: Point, wrist: Point): number {
    const upperArmVertical = elbow.y - shoulder.y
    const lowerArmVertical = wrist.y - elbow.y
    const upperArmHorizontal = Math.abs(elbow.x - shoulder.x)
    const lowerArmHorizontal = Math.abs(wrist.x - elbow.x)
    const vertical = upperArmVertical * 0.45 + lowerArmVertical * 0.55
    const horizontal = Math.max(upperArmHorizontal * 0.45 + lowerArmHorizontal * 0.55, 0.0001)
    return (Math.atan2(-vertical, horizontal) * 180) / Math.PI
  }

  private weightedWingDrop(shoulder: Point, elbow: Point, wrist: Point): number {
    const elbowDrop = elbow.y - shoulder.y
    const wristDrop = wrist.y - shoulder.y
    return elbowDrop * 0.35 + wristDrop * 0.65
  }

  private normaliseWithDeadZone(value: number, deadZone: number, fullScale: number): number {
    const magnitude = Math.abs(value)
    if (magnitude <= deadZone) return 0
    return clamp(Math.sign(value) * (magnitude - deadZone) / (fullScale - deadZone), -1, 1)
  }

  /**
   * Arms must first rise together, then return together before a flap counts.
   * Using each arm independently prevents ordinary left/right steering from
   * accidentally becoming a climb command.
   */
  private detectFlap(
    leftShoulder: Point,
    leftElbow: Point,
    leftWrist: Point,
    rightShoulder: Point,
    rightElbow: Point,
    rightWrist: Point,
    shoulderWidth: number,
    armsExtended: boolean,
    timestamp: number,
  ): boolean {
    if (!armsExtended) {
      this.resetFlap()
      return false
    }

    const leftLift = -this.weightedWingDrop(leftShoulder, leftElbow, leftWrist) / shoulderWidth
    const rightLift = -this.weightedWingDrop(rightShoulder, rightElbow, rightWrist) / shoulderWidth
    const bothRaised = Math.min(leftLift, rightLift) >= poseConfig.flapRaiseRatio
    const bothReturned = Math.max(leftLift, rightLift) <= poseConfig.flapReturnRatio

    if (bothRaised) this.flapArmed = true
    if (this.flapArmed && bothReturned) {
      this.flapArmed = false
      this.flapActiveUntil = timestamp + poseConfig.flapBoostDurationMilliseconds
    }

    return timestamp < this.flapActiveUntil
  }

  private resetFlap(): void {
    this.flapArmed = false
    this.flapActiveUntil = 0
  }

  private torsoLean(worldLandmarks: WorldLandmarks): number {
    const leftShoulder = worldLandmarks[LANDMARK.leftShoulder]
    const rightShoulder = worldLandmarks[LANDMARK.rightShoulder]
    const leftHip = worldLandmarks[LANDMARK.leftHip]
    const rightHip = worldLandmarks[LANDMARK.rightHip]
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 0

    const shoulders = midpoint(leftShoulder, rightShoulder)
    const hips = midpoint(leftHip, rightHip)
    const torsoHeight = Math.max(Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y), 0.001)

    // A negative value means shoulders are closer to camera than hips: forward / dive.
    return Math.atan2(shoulders.z - hips.z, torsoHeight)
  }
}
