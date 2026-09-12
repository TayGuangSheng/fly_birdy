import * as THREE from 'three'
import { gameConfig } from '../config/gameConfig.ts'
import type { FlightInput } from '../pose/PoseTypes.ts'

export interface FlightState {
  position: THREE.Vector3
  forward: THREE.Vector3
  heading: number
  horizontalVelocity: number
  verticalVelocity: number
  roll: number
  pitch: number
  speed: number
  distance: number
  bodyControlActive: boolean
  /** The current climb/dive command, retained for immediate visual feedback. */
  verticalControl: number
  /** A recognised flap remains active for its short pose-controller window. */
  flapping: boolean
}

const damp = (current: number, target: number, response: number, deltaSeconds: number) =>
  current + (target - current) * (1 - Math.exp(-response * deltaSeconds))

const shapeInput = (value: number, gain: number) => {
  const magnitude = Math.abs(value)
  if (magnitude <= gameConfig.inputDeadZone) return 0
  const normalised = (magnitude - gameConfig.inputDeadZone) / (1 - gameConfig.inputDeadZone)
  const curved = Math.sign(value) * Math.pow(normalised, 0.86) * gain
  return THREE.MathUtils.clamp(curved, -1, 1)
}

/** Arcade flight motion with continuous, body-driven yaw and altitude control. */
export class FlightController {
  private readonly position = new THREE.Vector3(0, 17, 0)
  private readonly forward = new THREE.Vector3(0, 0, -1)
  private heading = 0
  private steering = 0
  private vertical = 0
  private verticalVelocity = 0
  private roll = 0
  private pitch = 0
  private distance = 0
  private speedMultiplier = 1

  public setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = multiplier
  }

  public reset(): void {
    this.position.set(0, 17, 0)
    this.forward.set(0, 0, -1)
    this.heading = 0
    this.steering = 0
    this.vertical = 0
    this.verticalVelocity = 0
    this.roll = 0
    this.pitch = 0
    this.distance = 0
    this.speedMultiplier = 1
  }

  public update(deltaSeconds: number, input: FlightInput): FlightState {
    const delta = Math.min(deltaSeconds, gameConfig.maxDeltaSeconds)
    const speed = gameConfig.forwardSpeed * this.speedMultiplier
    const bodyControlActive =
      input.trackingConfidence >= gameConfig.controlConfidenceThreshold && input.armsExtended
    const steeringTarget = bodyControlActive ? shapeInput(input.steering, gameConfig.steeringInputGain) : 0
    const verticalTarget = bodyControlActive ? shapeInput(input.vertical, gameConfig.verticalInputGain) : 0

    // The pose stream is already dead-zoned and calibrated. Applying another
    // easing layer here made the bird visibly trail the player's movement.
    this.steering = steeringTarget
    this.vertical = verticalTarget
    this.verticalVelocity = damp(
      this.verticalVelocity,
      this.vertical * gameConfig.maximumVerticalSpeed,
      gameConfig.verticalVelocityResponse,
      delta,
    )
    this.heading += this.steering * gameConfig.maximumYawRate * delta
    this.forward.set(Math.sin(this.heading), 0, -Math.cos(this.heading))

    this.position.addScaledVector(this.forward, speed * delta)
    this.position.y = THREE.MathUtils.clamp(
      this.position.y + this.verticalVelocity * delta,
      gameConfig.minimumAltitude,
      gameConfig.maximumAltitude,
    )

    if (this.position.y === gameConfig.minimumAltitude || this.position.y === gameConfig.maximumAltitude) {
      this.verticalVelocity = 0
    }

    this.roll = -this.steering * gameConfig.maximumBank
    this.pitch = this.vertical * gameConfig.maximumPitch
    this.distance += speed * delta

    return {
      position: this.position,
      forward: this.forward,
      heading: this.heading,
      horizontalVelocity: this.steering * speed,
      verticalVelocity: this.verticalVelocity,
      roll: this.roll,
      pitch: this.pitch,
      speed,
      distance: this.distance,
      bodyControlActive,
      verticalControl: this.vertical,
      flapping: bodyControlActive && input.flapping,
    }
  }

  /** Prevent the bird from entering the visible terrain while staying forgiving. */
  public constrainToTerrain(groundHeight: number): boolean {
    const safeAltitude = Math.max(gameConfig.minimumAltitude, groundHeight + gameConfig.groundClearance)
    if (this.position.y >= safeAltitude) return false
    this.position.y = safeAltitude
    if (this.verticalVelocity < 0) this.verticalVelocity = 0
    return true
  }
}
