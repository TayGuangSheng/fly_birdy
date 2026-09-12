import * as THREE from 'three'
import { Feather } from '../entities/Feather.ts'
import type { CourseEntity, CourseEvent } from '../entities/CourseEntity.ts'
import { Obstacle } from '../entities/Obstacle.ts'
import { Ring } from '../entities/Ring.ts'
import { gameConfig } from '../config/gameConfig.ts'
import type { FlightState } from '../game/FlightController.ts'
import type { DifficultyProfile } from '../systems/DifficultySystem.ts'
import { sampleTerrainHeight } from './TerrainSampler.ts'

const up = new THREE.Vector3(0, 1, 0)
const rockColours = [0x6d6761, 0x6d5654, 0x53666b, 0x706550]

/**
 * A course section is authored relative to the direction the bird was flying
 * when it was spawned.  Keeping that direction avoids treating a sharp bank
 * as though the player had flown through (or missed) a ring from an older
 * route.
 */
interface ManagedCourseEntity {
  readonly entity: CourseEntity
  readonly routeForward: THREE.Vector3
  readonly expiresAtDistance: number
}

/** Runtime ownership for the individual feathers in one optional flight line. */
interface FeatherTrail {
  readonly total: number
  readonly activeFeathers: Set<Feather>
  readonly collectedFeathers: Set<Feather>
  complete: boolean
}

/** Bounded procedural course sections with an explicit, collectible safe centreline. */
export class CourseManager {
  private readonly scene: THREE.Scene
  private readonly onEvent: (event: CourseEvent) => void
  private readonly entities: ManagedCourseEntity[] = []
  private readonly featherTrailIds = new Map<Feather, number>()
  private readonly featherTrails = new Map<number, FeatherTrail>()
  private nextSectionDistance = 72
  private sectionNumber = 0

  public constructor(scene: THREE.Scene, onEvent: (event: CourseEvent) => void) {
    this.scene = scene
    this.onEvent = onEvent
  }

  public update(state: FlightState, profile: DifficultyProfile, elapsedSeconds: number): void {
    while (this.nextSectionDistance < state.distance + gameConfig.courseSpawnAhead) {
      this.createSection(state, profile)
      this.nextSectionDistance += profile.sectionSpacing
    }

    for (let index = this.entities.length - 1; index >= 0; index -= 1) {
      const managed = this.entities[index]
      const { entity } = managed

      // Distance is monotonically increasing even when the player curves away
      // from a route.  Retire abandoned route sections silently instead of
      // leaving their collision objects alive forever or fabricating a miss.
      if (state.distance > managed.expiresAtDistance) {
        this.removeAt(index)
        continue
      }

      entity.update(elapsedSeconds)
      const event = entity.test(state.position, gameConfig.birdCollisionRadius)
      if (event) {
        this.onEvent(event)
        if (entity instanceof Feather) this.recordFeatherTrailCollection(entity)
      }

      if (entity.hasPassed(state.position, managed.routeForward)) {
        if (entity instanceof Ring && entity.consumeMiss()) this.onEvent({ type: 'ringMiss' })
        if (entity instanceof Obstacle && entity.consumeNearMiss(gameConfig.birdCollisionRadius)) this.onEvent({ type: 'nearMiss' })
        this.removeAt(index)
      }
    }
  }

  public reset(): void {
    for (const { entity } of this.entities) {
      this.scene.remove(entity.group)
      entity.dispose()
    }
    this.entities.length = 0
    this.featherTrailIds.clear()
    this.featherTrails.clear()
    this.nextSectionDistance = 72
    this.sectionNumber = 0
  }

  public startAt(distance: number): void {
    this.reset()
    this.nextSectionDistance = distance + 72
  }

  public dispose(): void { this.reset() }

  private createSection(state: FlightState, profile: DifficultyProfile): void {
    const sectionDistance = this.nextSectionDistance - state.distance
    const routeDistance = this.nextSectionDistance
    const forward = state.forward.clone().normalize()
    const right = new THREE.Vector3().crossVectors(forward, up).normalize()
    const anchor = state.position.clone().addScaledVector(forward, sectionDistance)
    const laneChoices = [-1, 0, 1]
    const lane = laneChoices[this.sectionNumber % laneChoices.length]
    const altitudeWave = profile.level < 2 ? 0 : Math.sin(this.sectionNumber * 1.73) * profile.altitudeOffset
    const safeCentre = anchor
      .addScaledVector(right, lane * profile.laneOffset)
      .addScaledVector(up, altitudeWave)

    const ring = new Ring(safeCentre, forward)
    this.add(ring, routeDistance, forward)

    this.createFeatherTrail(safeCentre, forward, right, profile, routeDistance)

    for (let index = 0; index < profile.obstacleCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const radius = 3.7 + ((this.sectionNumber + index) % 3) * 0.6
      const obstaclePosition = safeCentre
        .clone()
        // Rock spires frame the course rather than hovering inside it. The
        // larger lateral clearance leaves a readable route through the valley.
        .addScaledVector(right, side * (profile.laneOffset + radius + 8.2))
        .addScaledVector(forward, (index - 1) * 5.4)
      const groundHeight = sampleTerrainHeight(obstaclePosition.x, obstaclePosition.z)
      const height = Math.max(18, safeCentre.y - groundHeight + 5 + ((this.sectionNumber + index) % 3) * 2.2)
      this.add(
        new Obstacle(
          obstaclePosition,
          radius,
          rockColours[(this.sectionNumber + index) % rockColours.length],
          groundHeight,
          height,
        ),
        routeDistance,
        forward,
      )
    }

    this.sectionNumber += 1
  }

  private add(entity: CourseEntity, routeDistance: number, routeForward: THREE.Vector3): void {
    this.entities.push({
      entity,
      routeForward: routeForward.clone(),
      expiresAtDistance: routeDistance + gameConfig.courseDespawnBehind,
    })
    this.scene.add(entity.group)
  }

  private removeAt(index: number): void {
    const { entity } = this.entities[index]
    if (entity instanceof Feather) this.releaseFeatherTrail(entity)
    this.scene.remove(entity.group)
    entity.dispose()
    this.entities.splice(index, 1)
  }

  /**
   * Feather Trails are deliberately forgiving in the opening biome and form
   * a larger banking/climbing sweep as the flight speed rises. They point at
   * the ring without ever blocking the safe route, so they read as an
   * inviting optional skill line rather than another obstacle.
   */
  private createFeatherTrail(
    safeCentre: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    profile: DifficultyProfile,
    routeDistance: number,
  ): void {
    const trailId = this.sectionNumber
    const featherCount = profile.level >= 3 ? 6 : 5
    const sweepSign = this.sectionNumber % 2 === 0 ? 1 : -1
    const liftSign = this.sectionNumber % 3 === 0 ? 1 : -1
    const sweep = 0.7 + (profile.level - 1) * 0.8
    const lift = 0.3 + (profile.level - 1) * 0.55
    const trail: FeatherTrail = {
      total: featherCount,
      activeFeathers: new Set<Feather>(),
      collectedFeathers: new Set<Feather>(),
      complete: false,
    }
    this.featherTrails.set(trailId, trail)

    for (let index = 0; index < featherCount; index += 1) {
      const progress = index / (featherCount - 1)
      const featherPosition = safeCentre
        .clone()
        .addScaledVector(forward, -20 + progress * 16.5)
        .addScaledVector(right, Math.sin(progress * Math.PI) * sweep * sweepSign)
        .addScaledVector(up, Math.sin(progress * Math.PI) * lift * liftSign)
      const feather = new Feather(featherPosition, this.sectionNumber + index * 0.7)
      trail.activeFeathers.add(feather)
      this.featherTrailIds.set(feather, trailId)
      this.add(feather, routeDistance, forward)
    }
  }

  private recordFeatherTrailCollection(feather: Feather): void {
    const trailId = this.featherTrailIds.get(feather)
    if (trailId === undefined) return
    const trail = this.featherTrails.get(trailId)
    if (!trail || trail.complete || trail.collectedFeathers.has(feather)) return

    trail.collectedFeathers.add(feather)
    if (trail.collectedFeathers.size !== trail.total) return

    trail.complete = true
    this.onEvent({ type: 'featherTrail', feathers: trail.total })
  }

  private releaseFeatherTrail(feather: Feather): void {
    const trailId = this.featherTrailIds.get(feather)
    if (trailId === undefined) return
    this.featherTrailIds.delete(feather)
    const trail = this.featherTrails.get(trailId)
    if (!trail) return
    trail.activeFeathers.delete(feather)
    if (trail.activeFeathers.size === 0) this.featherTrails.delete(trailId)
  }
}
