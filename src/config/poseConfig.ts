export const poseConfig = {
  /** MediaPipe assets are fetched once by the browser; webcam frames never leave it. */
  wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  modelAssetUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  // The flight view is intentionally compact, so it needs a more forgiving
  // detector than the old lab-only defaults. Flight is still separately gated
  // by arm extension and confidence before motion is accepted.
  minPoseDetectionConfidence: 0.4,
  minPosePresenceConfidence: 0.4,
  minTrackingConfidence: 0.4,
  requiredLandmarkVisibility: 0.24,
  armLandmarkVisibility: 0.1,
  wristFrameMargin: 0.075,
  goodTrackingConfidence: 0.42,
  launchTrackingConfidence: 0.28,
  calibrationHoldSeconds: 1.1,
  armExtensionRatio: 0.55,
  // Ignore relaxed-arm jitter and reserve a full turn for a clearly asymmetric
  // wing pose. Values are measured relative to shoulder width.
  rollDeadZone: 0.14,
  rollNormalisation: 0.84,
  pitchNormalisation: 0.28,
  // A deliberate flap is easier to recognise from a front-facing webcam than
  // a backwards torso lean. Lift both wrists above shoulder level, then bring
  // them back down to earn a short climb boost.
  flapRaiseRatio: 0.18,
  flapReturnRatio: 0.04,
  flapBoostDurationMilliseconds: 650,
} as const
