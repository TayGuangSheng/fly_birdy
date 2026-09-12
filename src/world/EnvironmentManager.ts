import * as THREE from 'three'
import { environmentThemes, environmentTransitionDistance, type EnvironmentId, type EnvironmentTheme } from '../config/environmentConfig.ts'
import type { FlightState } from '../game/FlightController.ts'
import { FlightWorld } from './FlightWorld.ts'

const CHUNK_SIZE = 72
const CHUNK_COLUMNS = [-2, -1, 0, 1, 2]
const CHUNK_ROWS = [-4, -3, -2, -1, 0, 1, 2, 3]

interface MassifCollider {
  x: number
  z: number
  groundHeight: number
  radius: number
  height: number
}

type EnvironmentChunk = {
  group: THREE.Group
  column: number
  row: number
  themeId: EnvironmentId
  massifColliders: MassifCollider[]
}

export interface EnvironmentSnapshot {
  id: EnvironmentId
  name: string
}

/**
 * World-space, bounded set dressing. Chunks are deterministic and only recycle
 * around the player's X/Z position; they never inherit bird altitude or heading.
 */
export class EnvironmentManager {
  private readonly scene: THREE.Scene
  private readonly world: FlightWorld
  private readonly root = new THREE.Group()
  private readonly chunks: EnvironmentChunk[] = []
  private readonly rain: THREE.Points
  private rainPositions = new Float32Array(0)

  public constructor(scene: THREE.Scene, world: FlightWorld) {
    this.scene = scene
    this.world = world
    for (const column of CHUNK_COLUMNS) {
      for (const row of CHUNK_ROWS) {
        const group = new THREE.Group()
        this.root.add(group)
        const chunk = { group, column, row, themeId: 'valley' as EnvironmentId, massifColliders: [] }
        this.chunks.push(chunk)
        this.rebuildChunk(chunk)
      }
    }
    this.rain = this.createRain()
    this.rain.visible = false
    this.root.add(this.rain)
    this.scene.add(this.root)
  }

  public update(distance: number, state: FlightState, deltaSeconds: number): EnvironmentSnapshot {
    const transition = this.transitionFor(distance)
    this.world.applyTheme(transition.from, transition.to, transition.blend)
    const visibleTheme = transition.blend >= 0.5 ? transition.to : transition.from
    this.recycleChunks(state, distance)

    const stormBlend = this.themeBlend(transition, 'storm')
    this.rain.visible = stormBlend > 0.015
    ;(this.rain.material as THREE.PointsMaterial).opacity = 0.54 * stormBlend
    if (this.rain.visible) {
      this.rain.position.copy(state.position)
      this.updateRain(state.speed, deltaSeconds)
    }
    return { id: visibleTheme.id, name: visibleTheme.name }
  }

  public dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
      geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      objectMaterials.forEach((material) => materials.add(material))
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    this.scene.remove(this.root)
  }

  /** Keep the Red Rock Canyon's visible mountains as solid as course spires. */
  public collidesWithMassif(position: THREE.Vector3, birdRadius: number): boolean {
    for (const chunk of this.chunks) {
      for (const massif of chunk.massifColliders) {
        const horizontalDistance = Math.hypot(position.x - massif.x, position.z - massif.z)
        if (horizontalDistance > massif.radius + birdRadius) continue

        // The faceted mesh tapers from a broad, grounded base into a peak. A
        // matching tapered collision volume avoids passing through a visible
        // canyon wall while still allowing flight cleanly over its summit.
        const surfaceProgress = THREE.MathUtils.clamp(horizontalDistance / massif.radius, 0, 1)
        const mountainSurface = massif.groundHeight + massif.height * (1 - surfaceProgress)
        if (position.y - birdRadius <= mountainSurface && position.y + birdRadius >= massif.groundHeight) return true
      }
    }
    return false
  }

  private recycleChunks(state: FlightState, distance: number): void {
    const { position } = state
    const centralColumn = Math.floor(position.x / CHUNK_SIZE)
    const centralRow = Math.floor(position.z / CHUNK_SIZE)
    for (const chunk of this.chunks) {
      let column = chunk.column
      let row = chunk.row
      while (column < centralColumn - 2) column += CHUNK_COLUMNS.length
      while (column > centralColumn + 2) column -= CHUNK_COLUMNS.length
      while (row < centralRow - 4) row += CHUNK_ROWS.length
      while (row > centralRow + 3) row -= CHUNK_ROWS.length
      const hasMoved = column !== chunk.column || row !== chunk.row
      const chunkCentreX = column * CHUNK_SIZE
      const chunkCentreZ = row * CHUNK_SIZE
      const forwardOffset =
        (chunkCentreX - position.x) * state.forward.x +
        (chunkCentreZ - position.z) * state.forward.z
      const themeId = this.themeForDistance(distance + forwardOffset)
      if (hasMoved || themeId !== chunk.themeId) {
        chunk.column = column
        chunk.row = row
        chunk.themeId = themeId
        this.rebuildChunk(chunk)
      }
    }
  }

  private rebuildChunk(chunk: EnvironmentChunk): void {
    this.clearChunk(chunk.group)
    chunk.massifColliders.length = 0
    chunk.group.position.set(chunk.column * CHUNK_SIZE, 0, chunk.row * CHUNK_SIZE)
    const random = this.createRandom(this.seedFor(chunk.themeId, chunk.column, chunk.row))
    if (chunk.themeId === 'valley') this.populateValley(chunk, random)
    else if (chunk.themeId === 'canyon') this.populateCanyon(chunk, random)
    else if (chunk.themeId === 'clouds') this.populateCloudKingdom(chunk, random)
    else if (chunk.themeId === 'cavern') this.populateCavern(chunk, random)
    else this.populateStorm(chunk, random)
  }

  private populateValley(chunk: EnvironmentChunk, random: () => number): void {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x67473a, flatShading: true, roughness: 0.95 })
    const foliageA = new THREE.MeshStandardMaterial({ color: 0x356c51, flatShading: true, roughness: 0.98 })
    const foliageB = new THREE.MeshStandardMaterial({ color: 0x4b8260, flatShading: true, roughness: 0.98 })
    const stone = new THREE.MeshStandardMaterial({ color: 0x607267, flatShading: true, roughness: 1 })
    const count = 4 + Math.floor(random() * 3)
    // A forest has the highest visible object count. Batch its three reusable
    // tree pieces per chunk so visual density does not turn into hundreds of
    // draw calls on a laptop.
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.48, 4.6, 6), trunk, count)
    const lowerCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.35, 5.8, 7), foliageA, count)
    const upperCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.72, 4.3, 7), foliageB, count)
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    for (let index = 0; index < count; index += 1) {
      const side = random() < 0.5 ? -1 : 1
      const localX = side * (17 + random() * 15)
      const localZ = -31 + random() * 62
      const treeScale = 0.75 + random() * 0.7
      const ground = this.groundAt(chunk, localX, localZ)
      quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI, 0))
      scale.setScalar(treeScale)
      position.set(localX, ground + 2.25 * treeScale, localZ)
      matrix.compose(position, quaternion, scale)
      stems.setMatrixAt(index, matrix)
      position.y = ground + 5.2 * treeScale
      matrix.compose(position, quaternion, scale)
      lowerCrowns.setMatrixAt(index, matrix)
      position.y = ground + 7.75 * treeScale
      matrix.compose(position, quaternion, scale)
      upperCrowns.setMatrixAt(index, matrix)
    }
    stems.instanceMatrix.needsUpdate = true
    lowerCrowns.instanceMatrix.needsUpdate = true
    upperCrowns.instanceMatrix.needsUpdate = true
    for (const forestPart of [stems, lowerCrowns, upperCrowns]) {
      forestPart.castShadow = true
      forestPart.receiveShadow = true
      forestPart.computeBoundingSphere()
      chunk.group.add(forestPart)
    }

    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), stone, 2)
    for (let index = 0; index < 2; index += 1) {
      const localX = (random() - 0.5) * 54
      const localZ = -31 + random() * 62
      const rockScale = 0.9 + random() * 1.1
      position.set(localX, this.groundAt(chunk, localX, localZ) + rockScale * 0.45, localZ)
      quaternion.setFromEuler(new THREE.Euler(random(), random() * Math.PI, random() * 0.35))
      scale.set(rockScale, rockScale * 0.9, rockScale)
      matrix.compose(position, quaternion, scale)
      rocks.setMatrixAt(index, matrix)
    }
    rocks.instanceMatrix.needsUpdate = true
    rocks.castShadow = true
    rocks.receiveShadow = true
    rocks.computeBoundingSphere()
    chunk.group.add(rocks)
  }

  private populateCanyon(chunk: EnvironmentChunk, random: () => number): void {
    const warmRock = new THREE.MeshStandardMaterial({ color: 0x8d5541, flatShading: true, roughness: 0.98 })
    const sunRock = new THREE.MeshStandardMaterial({ color: 0xb56d4d, flatShading: true, roughness: 0.98 })
    const side = random() < 0.5 ? -1 : 1
    // These are terrain-conforming massifs, not tall stretched rocks. Keeping
    // their bases beyond the route lane frames the run without reading as an
    // airborne obstacle.
    const localX = side * (33 + random() * 6)
    const localZ = -29 + random() * 58
    const height = 28 + random() * 16
    const mainMaterial = random() < 0.5 ? warmRock : sunRock
    const radius = 10 + random() * 4
    chunk.group.add(this.createMassif(chunk, random, localX, localZ, radius, height, mainMaterial))
    this.addMassifCollider(chunk, localX, localZ, radius, height)

    const shoulderMaterial = mainMaterial === warmRock ? sunRock : warmRock
    const shoulderX = localX + side * (8 + random() * 6)
    const shoulderZ = localZ + (random() - 0.5) * 18
    const shoulderRadius = 5.5 + random() * 3.5
    const shoulderHeight = 13 + random() * 11
    chunk.group.add(
      this.createMassif(
        chunk,
        random,
        shoulderX,
        shoulderZ,
        shoulderRadius,
        shoulderHeight,
        shoulderMaterial,
      ),
    )
    this.addMassifCollider(chunk, shoulderX, shoulderZ, shoulderRadius, shoulderHeight)
  }

  private populateCloudKingdom(chunk: EnvironmentChunk, random: () => number): void {
    const shadedStone = new THREE.MeshStandardMaterial({ color: 0x506b67, flatShading: true, roughness: 0.96 })
    const sunlitStone = new THREE.MeshStandardMaterial({ color: 0x789687, flatShading: true, roughness: 0.96 })
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0fbf5,
      flatShading: true,
      roughness: 1,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    })
    const side = random() < 0.5 ? -1 : 1
    // The old detached dodecahedron read as a floating boulder. Cloud Sea now
    // carries its mist on tall, grounded alpine shoulders just outside the
    // playable air lane.
    const localX = side * (34 + random() * 5)
    const localZ = -31 + random() * 62
    const height = 26 + random() * 15
    const mainMaterial = random() < 0.5 ? shadedStone : sunlitStone
    chunk.group.add(this.createMassif(chunk, random, localX, localZ, 10 + random() * 3.5, height, mainMaterial))
    chunk.group.add(
      this.createMassif(
        chunk,
        random,
        localX + side * (9 + random() * 7),
        localZ + (random() - 0.5) * 19,
        5.5 + random() * 3,
        12 + random() * 10,
        mainMaterial === shadedStone ? sunlitStone : shadedStone,
      ),
    )
    this.addCloudShelf(chunk, random, localX, localZ, height, side, cloudMaterial)
  }

  private populateCavern(chunk: EnvironmentChunk, random: () => number): void {
    const rock = new THREE.MeshStandardMaterial({ color: 0x263655, flatShading: true, roughness: 0.94 })
    const crystal = new THREE.MeshStandardMaterial({ color: 0x75e0d0, emissive: 0x17676f, emissiveIntensity: 1.15, flatShading: true, roughness: 0.55 })
    const side = random() < 0.5 ? -1 : 1
    const localX = side * (18 + random() * 17)
    const localZ = -31 + random() * 62
    const height = 15 + random() * 17
    const pillar = new THREE.Mesh(new THREE.ConeGeometry(3.1 + random() * 2.4, height, 6), rock)
    this.placeOnGround(pillar, chunk, localX, localZ, height * 0.5)
    pillar.rotation.z = side * (0.06 + random() * 0.18)
    this.enableShadows(pillar)
    chunk.group.add(pillar)
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.65 + random() * 0.55, 4.4 + random() * 3.8, 5), crystal)
    this.placeOnGround(shard, chunk, localX - side * (4.2 + random() * 2), localZ + (random() - 0.5) * 8, 2.7)
    shard.rotation.z = side * 0.35
    chunk.group.add(shard)
  }

  private populateStorm(chunk: EnvironmentChunk, random: () => number): void {
    const darkRock = new THREE.MeshStandardMaterial({ color: 0x344957, flatShading: true, roughness: 1 })
    const stormCloud = new THREE.MeshStandardMaterial({ color: 0x253946, flatShading: true, roughness: 1, transparent: true, opacity: 0.86, depthWrite: false })
    const side = random() < 0.5 ? -1 : 1
    const localX = side * (32 + random() * 7)
    const localZ = -31 + random() * 62
    const height = 25 + random() * 16
    chunk.group.add(this.createMassif(chunk, random, localX, localZ, 9 + random() * 4, height, darkRock))

    // Clouds cut through the peak rather than hovering as isolated dark rocks.
    const cloudHeight = this.groundAt(chunk, localX, localZ) + height * 0.58
    for (let index = 0; index < 3; index += 1) {
      const cloud = new THREE.Mesh(new THREE.DodecahedronGeometry(5 + random() * 2.8, 1), stormCloud)
      cloud.position.set(localX + side * (index - 1) * 5.1, cloudHeight + index * 1.1, localZ + (index - 1) * 3.3)
      cloud.scale.set(1.45, 0.42, 1)
      chunk.group.add(cloud)
    }
  }

  /**
   * Build a faceted mountain whose outer ring follows the sampled terrain.
   * This avoids the tell-tale gap under a primitive even where a hillside is
   * uneven, and gives every environment a recognisable silhouette.
   */
  private createMassif(
    chunk: EnvironmentChunk,
    random: () => number,
    localX: number,
    localZ: number,
    radius: number,
    height: number,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const segments = 7
    const ringRadii = [1, 0.63, 0.29]
    const ringHeights = [0, 0.3, 0.64]
    const radialVariation = Array.from({ length: segments }, () => 0.84 + random() * 0.28)
    const angleOffset = random() * Math.PI * 2
    const positions: number[] = []
    const indices: number[] = []

    for (let ring = 0; ring < ringRadii.length; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = angleOffset + (segment / segments) * Math.PI * 2
        const taperedRadius = radius * ringRadii[ring] * radialVariation[segment] * (ring === 0 ? 1 : 0.94 + random() * 0.12)
        const x = localX + Math.cos(angle) * taperedRadius
        const z = localZ + Math.sin(angle) * taperedRadius
        const ground = this.groundAt(chunk, x, z)
        const ridgeLift = height * ringHeights[ring] + (ring === 0 ? 0 : (random() - 0.5) * height * 0.08)
        positions.push(x, ground + ridgeLift, z)
      }
    }

    for (let ring = 0; ring < ringRadii.length - 1; ring += 1) {
      const current = ring * segments
      const next = (ring + 1) * segments
      for (let segment = 0; segment < segments; segment += 1) {
        const after = (segment + 1) % segments
        indices.push(current + segment, next + segment, current + after)
        indices.push(current + after, next + segment, next + after)
      }
    }

    const peakX = localX + (random() - 0.5) * radius * 0.24
    const peakZ = localZ + (random() - 0.5) * radius * 0.24
    const peakIndex = positions.length / 3
    positions.push(peakX, this.groundAt(chunk, peakX, peakZ) + height * (0.94 + random() * 0.12), peakZ)
    const finalRing = (ringRadii.length - 1) * segments
    for (let segment = 0; segment < segments; segment += 1) {
      const after = (segment + 1) % segments
      indices.push(finalRing + segment, peakIndex, finalRing + after)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const massif = new THREE.Mesh(geometry, material)
    this.enableShadows(massif)
    return massif
  }

  /** A mist shelf overlaps a peak so it reads as weather, not a floating island. */
  private addCloudShelf(
    chunk: EnvironmentChunk,
    random: () => number,
    localX: number,
    localZ: number,
    mountainHeight: number,
    side: number,
    material: THREE.MeshStandardMaterial,
  ): void {
    const puffs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(4.7, 1), material, 4)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    for (let index = 0; index < 4; index += 1) {
      const x = localX - side * (index - 1.5) * 3.4
      const z = localZ + (index - 1.5) * 3.1
      position.set(x, this.groundAt(chunk, x, z) + mountainHeight * (0.22 + index * 0.045), z)
      rotation.setFromEuler(new THREE.Euler(0, random() * Math.PI, 0))
      scale.set(1.15 + random() * 0.42, 0.34 + random() * 0.12, 0.85 + random() * 0.28)
      matrix.compose(position, rotation, scale)
      puffs.setMatrixAt(index, matrix)
    }
    puffs.instanceMatrix.needsUpdate = true
    puffs.computeBoundingSphere()
    chunk.group.add(puffs)
  }

  private placeOnGround(object: THREE.Object3D, chunk: EnvironmentChunk, localX: number, localZ: number, lift = 0): void {
    object.position.set(localX, this.groundAt(chunk, localX, localZ) + lift, localZ)
  }

  private addMassifCollider(
    chunk: EnvironmentChunk,
    localX: number,
    localZ: number,
    radius: number,
    height: number,
  ): void {
    chunk.massifColliders.push({
      x: chunk.group.position.x + localX,
      z: chunk.group.position.z + localZ,
      groundHeight: this.groundAt(chunk, localX, localZ),
      // The outer faceted ring varies by up to 12% from the authored radius.
      radius: radius * 1.14,
      height: height * 1.08,
    })
  }

  private groundAt(chunk: EnvironmentChunk, localX: number, localZ: number): number {
    return this.world.getGroundHeight(chunk.column * CHUNK_SIZE + localX, chunk.row * CHUNK_SIZE + localZ)
  }

  private enableShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  private clearChunk(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      objectMaterials.forEach((material) => materials.add(material))
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    group.clear()
  }

  private transitionFor(distance: number): { from: EnvironmentTheme; to: EnvironmentTheme; blend: number } {
    let current = environmentThemes[0]
    for (let index = 1; index < environmentThemes.length; index += 1) {
      const next = environmentThemes[index]
      const transitionStart = next.startDistance - environmentTransitionDistance
      if (distance < transitionStart) break
      if (distance < next.startDistance) {
        const rawBlend = (distance - transitionStart) / environmentTransitionDistance
        const blend = rawBlend * rawBlend * (3 - 2 * rawBlend)
        return { from: current, to: next, blend }
      }
      current = next
    }
    return { from: current, to: current, blend: 0 }
  }

  /**
   * Scenery switches per spatial chunk rather than rebuilding the whole world
   * at the visual midpoint. The player therefore flies into the next map while
   * the previous one falls away behind them.
   */
  private themeForDistance(distance: number): EnvironmentId {
    const transition = this.transitionFor(Math.max(0, distance))
    return transition.blend >= 0.5 ? transition.to.id : transition.from.id
  }

  private themeBlend(
    transition: { from: EnvironmentTheme; to: EnvironmentTheme; blend: number },
    themeId: EnvironmentId,
  ): number {
    if (transition.from.id === themeId && transition.to.id === themeId) return 1
    if (transition.to.id === themeId) return transition.blend
    if (transition.from.id === themeId) return 1 - transition.blend
    return 0
  }

  private createRain(): THREE.Points {
    this.rainPositions = new Float32Array(220 * 3)
    for (let index = 0; index < 220; index += 1) this.resetRaindrop(index)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3))
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc1e1ec, size: 0.095, transparent: true, opacity: 0.54, depthWrite: false }))
  }

  private updateRain(speed: number, deltaSeconds: number): void {
    for (let index = 0; index < 220; index += 1) {
      const offset = index * 3
      this.rainPositions[offset + 1] -= (20 + speed * 0.42) * deltaSeconds
      this.rainPositions[offset + 2] += speed * deltaSeconds * 0.75
      if (this.rainPositions[offset + 1] < -10 || this.rainPositions[offset + 2] > 10) this.resetRaindrop(index)
    }
    this.rain.geometry.getAttribute('position').needsUpdate = true
  }

  private resetRaindrop(index: number): void {
    const offset = index * 3
    this.rainPositions[offset] = (Math.random() - 0.5) * 46
    this.rainPositions[offset + 1] = Math.random() * 36 - 4
    this.rainPositions[offset + 2] = -Math.random() * 76
  }

  private seedFor(theme: EnvironmentId, column: number, row: number): number {
    let themeValue = 0
    for (let index = 0; index < theme.length; index += 1) themeValue = Math.imul(themeValue + theme.charCodeAt(index), 31)
    return (Math.imul(column, 73856093) ^ Math.imul(row, 19349663) ^ themeValue) >>> 0
  }

  private createRandom(seed: number): () => number {
    let value = seed || 1
    return () => {
      value += 0x6d2b79f5
      let mixed = value
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
  }
}
