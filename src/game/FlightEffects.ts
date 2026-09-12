import * as THREE from 'three'
import type { FlightState } from './FlightController.ts'

type Burst = { points: THREE.Points; velocities: Float32Array; age: number; duration: number }
const STREAK_COUNT = 42

/** Lightweight speed streaks and short-lived impact/collectible bursts. */
export class FlightEffects {
  private readonly group = new THREE.Group()
  private readonly streakGeometry: THREE.BufferGeometry
  private readonly streakPositions: Float32Array
  private readonly bursts: Burst[] = []
  private readonly scene: THREE.Scene
  private active = false

  public constructor(scene: THREE.Scene) {
    this.scene = scene
    this.streakPositions = new Float32Array(STREAK_COUNT * 2 * 3)
    this.streakGeometry = new THREE.BufferGeometry()
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3))
    const material = new THREE.LineBasicMaterial({ color: 0xd4fff0, transparent: true, opacity: 0.16 })
    const streaks = new THREE.LineSegments(this.streakGeometry, material)
    this.resetAllStreaks()
    this.group.add(streaks)
    this.group.visible = false
    scene.add(this.group)
  }

  public setActive(active: boolean): void {
    this.active = active
    this.group.visible = active
    if (active) this.resetAllStreaks()
  }

  public update(state: FlightState, deltaSeconds: number): void {
    // Keep the normal glide visually quiet. Streaks appear only at the upper
    // end of the difficulty-speed curve instead of forming a permanent grid.
    const showStreaks = this.active && state.speed >= 32
    this.group.visible = showStreaks
    if (showStreaks) {
      this.group.position.copy(state.position)
      this.group.rotation.y = -state.heading
      const positions = this.streakPositions
      for (let index = 0; index < STREAK_COUNT; index += 1) {
        const start = index * 6
        positions[start + 2] += state.speed * deltaSeconds * 1.65
        positions[start + 5] += state.speed * deltaSeconds * 1.65
        if (positions[start + 2] > 9) this.resetStreak(index)
      }
      this.streakGeometry.getAttribute('position').needsUpdate = true
    }

    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index]
      burst.age += deltaSeconds
      const positionsAttribute = burst.points.geometry.getAttribute('position')
      const positionsArray = positionsAttribute.array as Float32Array
      for (let particle = 0; particle < positionsAttribute.count; particle += 1) {
        const offset = particle * 3
        positionsArray[offset] += burst.velocities[offset] * deltaSeconds
        positionsArray[offset + 1] += burst.velocities[offset + 1] * deltaSeconds
        positionsArray[offset + 2] += burst.velocities[offset + 2] * deltaSeconds
      }
      positionsAttribute.needsUpdate = true
      const material = burst.points.material as THREE.PointsMaterial
      material.opacity = Math.max(0, 1 - burst.age / burst.duration)
      if (burst.age >= burst.duration) {
        this.scene.remove(burst.points)
        burst.points.geometry.dispose()
        material.dispose()
        this.bursts.splice(index, 1)
      }
    }
  }

  public burst(position: THREE.Vector3, colour: number, amount = 20): void {
    const positions = new Float32Array(amount * 3)
    const velocities = new Float32Array(amount * 3)
    for (let index = 0; index < amount; index += 1) {
      const offset = index * 3
      velocities[offset] = (Math.random() - 0.5) * 8
      velocities[offset + 1] = (Math.random() - 0.3) * 7
      velocities[offset + 2] = (Math.random() - 0.5) * 8
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({ color: colour, size: 0.38, transparent: true, opacity: 1, depthWrite: false })
    const points = new THREE.Points(geometry, material)
    points.position.copy(position)
    this.scene.add(points)
    this.bursts.push({ points, velocities, age: 0, duration: 0.62 })
  }

  public dispose(): void {
    this.scene.remove(this.group)
    this.streakGeometry.dispose()
    const streak = this.group.children[0]
    if (streak instanceof THREE.LineSegments) (streak.material as THREE.Material).dispose()
    for (const burst of this.bursts) {
      this.scene.remove(burst.points)
      burst.points.geometry.dispose()
      ;(burst.points.material as THREE.Material).dispose()
    }
    this.bursts.length = 0
  }

  private resetAllStreaks(): void {
    for (let index = 0; index < STREAK_COUNT; index += 1) this.resetStreak(index)
  }

  private resetStreak(index: number): void {
    const offset = index * 6
    const startZ = -18 - Math.random() * 72
    const length = 2.2 + Math.random() * 5.5
    const x = (Math.random() - 0.5) * 22
    const y = (Math.random() - 0.5) * 12 + 2
    this.streakPositions[offset] = x
    this.streakPositions[offset + 1] = y
    this.streakPositions[offset + 2] = startZ
    this.streakPositions[offset + 3] = x
    this.streakPositions[offset + 4] = y
    this.streakPositions[offset + 5] = startZ + length
  }
}
