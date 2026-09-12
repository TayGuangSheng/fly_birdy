import * as THREE from 'three'
import type { CourseEntity } from './CourseEntity.ts'
import { disposeGroup } from './CourseEntity.ts'

export class Obstacle implements CourseEntity {
  public readonly kind = 'obstacle' as const
  public readonly group = new THREE.Group()
  public readonly position: THREE.Vector3
  public readonly collisionRadius: number
  private nearMissAwarded = false
  private collisionReported = false
  private closestDistance = Number.POSITIVE_INFINITY

  /**
   * A course hazard is a rooted rock spire, not an airborne boulder. Its
   * collision centre sits inside the visible mass while the group itself is
   * anchored exactly to the sampled terrain height.
   */
  public constructor(position: THREE.Vector3, radius: number, colour: number, groundHeight: number, height: number) {
    this.position = new THREE.Vector3(position.x, groundHeight + height * 0.48, position.z)
    this.collisionRadius = Math.max(radius + 2.3, height * 0.34)

    const baseMaterial = new THREE.MeshStandardMaterial({ color: colour, flatShading: true, roughness: 0.98 })
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: this.lighten(colour, 0.16), flatShading: true, roughness: 0.96 })
    const shadowMaterial = new THREE.MeshStandardMaterial({ color: this.darken(colour, 0.18), flatShading: true, roughness: 1 })
    const base = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.8, height, 7, 2), baseMaterial)
    base.position.y = height * 0.5
    base.rotation.y = this.formationAngle(position)
    this.enableShadows(base)
    this.group.add(base)

    const ridge = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.05, height * 0.72, 6, 1), ridgeMaterial)
    ridge.position.set(radius * 0.34, height * 0.48, -radius * 0.2)
    ridge.rotation.set(0, this.formationAngle(position) + 0.55, -0.1)
    this.enableShadows(ridge)
    this.group.add(ridge)

    const outcrop = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.72, 1), shadowMaterial)
    outcrop.position.set(-radius * 0.85, radius * 0.42, radius * 0.38)
    outcrop.scale.set(1.35, 0.7, 1.05)
    outcrop.rotation.set(0.15, this.formationAngle(position) - 0.35, -0.12)
    this.enableShadows(outcrop)
    this.group.add(outcrop)

    this.group.position.set(position.x, groundHeight, position.z)
  }

  public update(): void {}

  public test(playerPosition: THREE.Vector3, birdRadius: number) {
    const distance = playerPosition.distanceTo(this.position)
    this.closestDistance = Math.min(this.closestDistance, distance)
    if (!this.collisionReported && distance <= this.collisionRadius + birdRadius) {
      this.collisionReported = true
      return { type: 'collision' } as const
    }
    return null
  }

  public hasPassed(playerPosition: THREE.Vector3, routeForward: THREE.Vector3): boolean {
    return this.position.clone().sub(playerPosition).dot(routeForward) < -14
  }

  public consumeNearMiss(birdRadius: number): boolean {
    const collisionDistance = this.collisionRadius + birdRadius
    const nearMissDistance = collisionDistance + 2.7
    if (this.nearMissAwarded || this.collisionReported || this.closestDistance <= collisionDistance || this.closestDistance > nearMissDistance) {
      return false
    }
    this.nearMissAwarded = true
    return true
  }

  public dispose(): void { disposeGroup(this.group) }

  private enableShadows(mesh: THREE.Mesh): void {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }

  private formationAngle(position: THREE.Vector3): number {
    return Math.sin(position.x * 0.17 + position.z * 0.11) * 1.7
  }

  private lighten(colour: number, amount: number): number {
    return new THREE.Color(colour).lerp(new THREE.Color(0xf3dfbd), amount).getHex()
  }

  private darken(colour: number, amount: number): number {
    return new THREE.Color(colour).lerp(new THREE.Color(0x13242a), amount).getHex()
  }
}
