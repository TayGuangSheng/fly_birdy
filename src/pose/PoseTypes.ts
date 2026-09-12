import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PoseLandmarks = NormalizedLandmark[]
export type WorldLandmarks = Landmark[]

export interface FlightInput {
  /** -1 is a left bank; +1 is a right bank. */
  roll: number
  /** -1 is a forward / dive lean; +1 is a backward chest lean. */
  pitch: number
  /** Analogue left/right steering signal. */
  steering: number
  /** Forward chest lean dives; a completed two-arm flap climbs. */
  vertical: number
  /** True briefly after a recognised two-arm flap. */
  flapping: boolean
  armsExtended: boolean
  trackingConfidence: number
}

export interface PoseMeasurements extends FlightInput {
  tracking: boolean
  leftWingAngle: number
  rightWingAngle: number
  /** Uncalibrated inputs used to establish the player's neutral pose. */
  rawBankSignal: number
  rawTorsoLean: number
  torsoLean: number
  shoulderWidth: number
  handsNearFrameEdge: boolean
}

export const LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const
