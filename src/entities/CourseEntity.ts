import * as THREE from 'three'

export type CourseEvent =
  | { type: 'ring'; perfect: boolean }
  | { type: 'ringMiss' }
  | { type: 'feather' }
  | { type: 'featherTrail'; feathers: number }
  | { type: 'nearMiss' }
  | { type: 'collision' }

export interface CourseEntity {
  readonly group: THREE.Group
  readonly position: THREE.Vector3
  readonly collisionRadius: number
  readonly kind: 'obstacle' | 'ring' | 'feather'
  update(elapsedSeconds: number): void
  test(playerPosition: THREE.Vector3, birdRadius: number): CourseEvent | null
  /**
   * `routeForward` is the direction of travel when this entity was spawned,
   * not necessarily the bird's current heading.  This preserves scoring
   * semantics if the player turns away from an older procedural section.
   */
  hasPassed(playerPosition: THREE.Vector3, routeForward: THREE.Vector3): boolean
  dispose(): void
}

export const disposeGroup = (group: THREE.Group): void => {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}
