import * as THREE from 'three'
import { gameConfig } from '../config/gameConfig.ts'
import type { FlightState } from './FlightController.ts'

const blend = (response: number, deltaSeconds: number) => 1 - Math.exp(-response * deltaSeconds)

/**
 * A stable rear chase camera. Its horizontal position is locked to the current
 * flight heading; only vertical height receives a small cinematic smoothing.
 */
export class CameraController {
  private readonly camera: THREE.PerspectiveCamera
  private readonly desiredPosition = new THREE.Vector3()
  private readonly desiredTarget = new THREE.Vector3()
  private ready = false

  public constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  public reset(): void {
    this.ready = false
    this.camera.up.set(0, 1, 0)
  }

  public update(state: FlightState, deltaSeconds: number, groundHeightAt?: (worldX: number, worldZ: number) => number): void {
    this.desiredPosition
      .copy(state.position)
      .addScaledVector(state.forward, -gameConfig.chaseDistance)
    this.desiredPosition.y += gameConfig.chaseHeight
    if (groundHeightAt) {
      this.desiredPosition.y = Math.max(
        this.desiredPosition.y,
        groundHeightAt(this.desiredPosition.x, this.desiredPosition.z) + gameConfig.cameraGroundClearance,
      )
    }

    this.desiredTarget.copy(state.position).addScaledVector(state.forward, gameConfig.lookAhead)
    this.desiredTarget.y += 0.55

    if (!this.ready) {
      this.camera.position.copy(this.desiredPosition)
      this.ready = true
    } else {
      // A locked horizontal rear offset prevents side-on/orbiting views during
      // high-confidence, full-range body turns.
      this.camera.position.x = this.desiredPosition.x
      this.camera.position.z = this.desiredPosition.z
      this.camera.position.y += (this.desiredPosition.y - this.camera.position.y) * blend(gameConfig.chaseResponse, deltaSeconds)
    }
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.desiredTarget)
  }
}
