import * as THREE from 'three'
import type { CourseEntity } from './CourseEntity.ts'
import { disposeGroup } from './CourseEntity.ts'

export class Feather implements CourseEntity {
  public readonly kind = 'feather' as const
  public readonly group = new THREE.Group()
  public readonly position: THREE.Vector3
  public readonly collisionRadius = 1.2
  private collected = false
  private readonly phase: number

  public constructor(position: THREE.Vector3, phase: number) {
    this.position = position.clone()
    this.phase = phase
    const material = new THREE.MeshStandardMaterial({ color: 0xf4f8e6, emissive: 0x294c54, emissiveIntensity: 0.7, flatShading: true })
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 4), material)
    blade.rotation.x = Math.PI / 2
    const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 5), new THREE.MeshBasicMaterial({ color: 0xffd978 }))
    quill.rotation.x = Math.PI / 2
    this.group.position.copy(this.position)
    this.group.add(blade, quill)
  }

  public update(elapsedSeconds: number): void {
    this.group.position.y = this.position.y + Math.sin(elapsedSeconds * 2.8 + this.phase) * 0.45
    this.group.rotation.y = elapsedSeconds * 1.7 + this.phase
  }

  public test(playerPosition: THREE.Vector3, birdRadius: number) {
    if (this.collected) return null
    if (playerPosition.distanceTo(this.group.position) <= this.collisionRadius + birdRadius) {
      this.collected = true
      this.group.visible = false
      return { type: 'feather' } as const
    }
    return null
  }

  public hasPassed(playerPosition: THREE.Vector3, routeForward: THREE.Vector3): boolean {
    return this.position.clone().sub(playerPosition).dot(routeForward) < -5
  }

  public dispose(): void { disposeGroup(this.group) }
}
