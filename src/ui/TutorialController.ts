import type { PoseMeasurements } from '../pose/PoseTypes.ts'
import { poseConfig } from '../config/poseConfig.ts'

export interface TutorialView {
  step: number
  total: number
  title: string
  instruction: string
  progress: number
  complete: boolean
}

type TutorialStep = {
  title: string
  instruction: string
  meetsCondition: (pose: PoseMeasurements) => boolean
}

const HOLD_SECONDS = 0.48

const steps: TutorialStep[] = [
  {
    title: 'Spread your wings',
    instruction: 'Hold a comfortable wide pose to wake the bird.',
    meetsCondition: (pose) => pose.trackingConfidence >= poseConfig.launchTrackingConfidence && pose.armsExtended,
  },
  {
    title: 'Tilt left',
    instruction: 'Lower your left wing and lift your right wing.',
    meetsCondition: (pose) => pose.steering <= -0.28,
  },
  {
    title: 'Tilt right',
    instruction: 'Lift your left wing and lower your right wing.',
    meetsCondition: (pose) => pose.steering >= 0.28,
  },
  {
    title: 'Flap to climb',
    instruction: 'Lift both wings, then sweep them back to a T-pose.',
    meetsCondition: (pose) => pose.flapping,
  },
  {
    title: 'Lean forward',
    instruction: 'Lean your chest forward to dive.',
    meetsCondition: (pose) => pose.vertical <= -0.24,
  },
]

/** Short movement tutorial; each motion must be held briefly to avoid false positives. */
export class TutorialController {
  private stepIndex = 0
  private heldSeconds = 0

  public update(pose: PoseMeasurements, deltaSeconds: number): TutorialView {
    const step = steps[this.stepIndex]
    if (!step) return this.view(true)

    this.heldSeconds = step.meetsCondition(pose)
      ? Math.min(HOLD_SECONDS, this.heldSeconds + deltaSeconds)
      : Math.max(0, this.heldSeconds - deltaSeconds * 1.8)

    if (this.heldSeconds >= HOLD_SECONDS) {
      this.stepIndex += 1
      this.heldSeconds = 0
    }
    return this.view(this.stepIndex >= steps.length)
  }

  public reset(): void {
    this.stepIndex = 0
    this.heldSeconds = 0
  }

  private view(complete: boolean): TutorialView {
    const step = steps[Math.min(this.stepIndex, steps.length - 1)]
    return {
      step: Math.min(this.stepIndex + 1, steps.length),
      total: steps.length,
      title: complete ? 'Ready to fly' : step.title,
      instruction: complete ? 'The valley route is open. Follow the rings.' : step.instruction,
      progress: complete ? 1 : this.heldSeconds / HOLD_SECONDS,
      complete,
    }
  }
}
