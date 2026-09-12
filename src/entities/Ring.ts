import * as THREE from 'three'
import type { CourseEntity } from './CourseEntity.ts'
import { disposeGroup } from './CourseEntity.ts'

export class Ring implements CourseEntity {
  public readonly kind = 'ring' as const
  public readonly group = new THREE.Group()
  public readonly position: THREE.Vector3
  public readonly collisionRadius: number
  private readonly forward: THREE.Vector3
  private collected = false
  private missed = false

  public constructor(position: THREE.Vector3, forward: THREE.Vector3) {
    this.position = position.clone()
    this.collisionRadius = 3.6
    this.forward = forward.clone().normalize()
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.25, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xffd46f, emissive: 0x5f3a11, emissiveIntensity: 1.3, roughness: 0.42 }),
    )
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.075, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9 }),
    )
    this.group.position.copy(this.position)
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.forward)
    this.group.add(outer, inner)
  }

  public update(elapsedSeconds: number): void {
    this.group.rotation.z = elapsedSeconds * 0.65
  }

  public test(playerPosition: THREE.Vector3, birdRadius: number) {
    if (this.collected || this.missed) return null
    const offset = playerPosition.clone().sub(this.position)
    const depth = Math.abs(offset.dot(this.forward))
    const radialDistance = Math.sqrt(Math.max(0, offset.lengthSq() - depth * depth))
    if (depth <= birdRadius + 0.8 && radialDistance <= this.collisionRadius - birdRadius * 0.25) {
      this.collected = true
      this.group.visible = false
      return { type: 'ring', perfect: radialDistance <= 1.05 } as const
    }
    return null
  }

  public hasPassed(playerPosition: THREE.Vector3, routeForward: THREE.Vector3): boolean {
    const hasPassed = this.position.clone().sub(playerPosition).dot(routeForward) < -7
    if (hasPassed && !this.collected) this.missed = true
    return hasPassed
  }

  public consumeMiss(): boolean {
    if (!this.missed) return false
    this.missed = false
    return true
  }

  public dispose(): void { disposeGroup(this.group) }
}
