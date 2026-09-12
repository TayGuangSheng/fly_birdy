import * as THREE from 'three'
import type { EnvironmentTheme } from '../config/environmentConfig.ts'
import type { FlightState } from '../game/FlightController.ts'
import { sampleRiverCentre, sampleTerrainHeight } from './TerrainSampler.ts'

const TILE_SIZE = 88
const TILE_COLUMNS = [-2, -1, 0, 1, 2]
const TILE_ROWS = [-5, -4, -3, -2, -1, 0, 1, 2, 3]
const TERRAIN_SUBDIVISIONS = 40
const RIVER_LENGTH = 1400
const RIVER_SEGMENTS = 140

type TerrainTile = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>; column: number; row: number }
type CloudBank = { group: THREE.Group; row: number; side: number }

/**
 * Bounded, world-space terrain. Every renderer-facing height is sampled from
 * the same deterministic field that flight and scenery use, so recycled tiles
 * cannot pop into an unrelated landscape.
 */
export class FlightWorld {
  private readonly scene: THREE.Scene
  private readonly terrainTiles: TerrainTile[] = []
  private readonly cloudBanks: CloudBank[] = []
  private readonly cloudMaterials: THREE.MeshStandardMaterial[] = []
  private readonly world = new THREE.Group()
  private readonly skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly skyMaterial: THREE.ShaderMaterial
  private readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  private readonly waterMaterial: THREE.MeshStandardMaterial
  private riverSection = 0
  private readonly hemisphere: THREE.HemisphereLight
  private readonly sun: THREE.DirectionalLight
  private readonly colourA = new THREE.Color()
  private readonly colourB = new THREE.Color()
  private readonly colourResult = new THREE.Color()
  // These shared colour instances are referenced directly by the terrain
  // shader uniforms, so a map hand-off can retint the whole landscape without
  // rebuilding every tile or introducing a visible colour snap.
  private readonly terrainLow = new THREE.Color(0x294f3d)
  private readonly terrainMid = new THREE.Color(0x537a43)
  private readonly terrainHigh = new THREE.Color(0x899257)
  private readonly terrainRock = new THREE.Color(0x69665b)

  public constructor(scene: THREE.Scene) {
    this.scene = scene
    scene.background = new THREE.Color(0x4e82ab)
    scene.fog = new THREE.Fog(0x8ab4c3, 128, 560)
    scene.add(this.world)

    // The sky moves with the flight camera, so colour transitions read as a
    // continuous horizon instead of a flat background colour snapping between maps.
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x4e82ab) },
        horizonColor: { value: new THREE.Color(0xb6d9d0) },
      },
      vertexShader: `
        varying float vGradient;
        void main() {
          vGradient = clamp(normalize(position).y * 0.5 + 0.5, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying float vGradient;
        void main() {
          float gradient = smoothstep(0.18, 0.86, vGradient);
          gl_FragColor = vec4(mix(horizonColor, topColor, gradient), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    })
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(720, 32, 18), this.skyMaterial)
    this.skyDome.renderOrder = -10
    this.world.add(this.skyDome)

    this.hemisphere = new THREE.HemisphereLight(0xdff6f4, 0x25494a, 1.85)
    scene.add(this.hemisphere)
    this.sun = new THREE.DirectionalLight(0xffe8b2, 3.15)
    this.sun.position.set(-105, 148, 72)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1536, 1536)
    this.sun.shadow.camera.left = -112
    this.sun.shadow.camera.right = 112
    this.sun.shadow.camera.top = 112
    this.sun.shadow.camera.bottom = -112
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 360
    this.sun.shadow.camera.updateProjectionMatrix()
    this.world.add(this.sun, this.sun.target)

    // A narrow river, deliberately below its carved terrain bed. It replaces
    // the former world-sized cyan sheet that intersected every hillside.
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a94a2,
      emissive: 0x0b242d,
      emissiveIntensity: 0.18,
      roughness: 0.26,
      metalness: 0.14,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    })
    this.water = new THREE.Mesh(this.createRiverGeometry(0), this.waterMaterial)
    this.water.position.set(0, 0, 0)
    this.water.receiveShadow = true
    this.world.add(this.water)

    for (const column of TILE_COLUMNS) {
      for (const row of TILE_ROWS) {
        const material = this.createTerrainMaterial()
        const mesh = new THREE.Mesh(this.createTerrainGeometry(column, row), material)
        mesh.position.set(column * TILE_SIZE, 0, row * TILE_SIZE)
        mesh.receiveShadow = true
        this.world.add(mesh)
        this.terrainTiles.push({ mesh, column, row })
      }
    }

    for (let row = -5; row <= 3; row += 1) {
      this.cloudBanks.push(this.createCloudBank(row, -1))
      this.cloudBanks.push(this.createCloudBank(row + 0.45, 1))
    }
  }

  public getGroundHeight(worldX: number, worldZ: number): number {
    return sampleTerrainHeight(worldX, worldZ)
  }

  public update(state: FlightState): void {
    this.skyDome.position.copy(state.position)
    const centralRow = Math.floor(state.position.z / TILE_SIZE)
    const centralColumn = Math.floor(state.position.x / TILE_SIZE)
    for (const tile of this.terrainTiles) {
      let row = tile.row
      let column = tile.column
      while (row > centralRow + 3) row -= TILE_ROWS.length
      while (row < centralRow - 5) row += TILE_ROWS.length
      while (column < centralColumn - 2) column += TILE_COLUMNS.length
      while (column > centralColumn + 2) column -= TILE_COLUMNS.length
      if (row !== tile.row || column !== tile.column) this.rebuildTile(tile, column, row)
      tile.mesh.position.set(tile.column * TILE_SIZE, 0, tile.row * TILE_SIZE)
    }

    const nextRiverSection = Math.round(state.position.z / RIVER_LENGTH)
    if (nextRiverSection !== this.riverSection) {
      const previousGeometry = this.water.geometry
      this.riverSection = nextRiverSection
      this.water.geometry = this.createRiverGeometry(this.riverSection * RIVER_LENGTH)
      previousGeometry.dispose()
    }

    // Keep the shadow frustum centred on the active slice of world instead of
    // leaving all useful shadows back at the origin after a short run.
    this.sun.position.set(state.position.x - 105, 148, state.position.z + 72)
    this.sun.target.position.set(state.position.x, 0, state.position.z - 34)
    this.sun.target.updateMatrixWorld()

    for (const cloud of this.cloudBanks) {
      let row = cloud.row
      while (row > centralRow + 3) row -= TILE_ROWS.length
      while (row < centralRow - 5) row += TILE_ROWS.length
      cloud.row = row
      cloud.group.position.z = row * TILE_SIZE
      cloud.group.position.x = cloud.side * (118 + Math.sin(row * 1.7) * 22)
    }
  }

  public applyTheme(from: EnvironmentTheme, to: EnvironmentTheme, blend: number): void {
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.blendColour(from.sky, to.sky, blend))
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.blendColour(from.fog, to.fog, blend))
    this.skyMaterial.uniforms.topColor.value.copy(this.blendColour(from.sky, to.sky, blend))
    this.skyMaterial.uniforms.horizonColor.value.copy(this.blendColour(from.skyHorizon, to.skyHorizon, blend))
    this.waterMaterial.color.copy(this.blendColour(from.water, to.water, blend))
    this.waterMaterial.emissive.copy(this.waterMaterial.color).multiplyScalar(0.12)
    this.sun.color.copy(this.blendColour(from.sun, to.sun, blend))
    this.hemisphere.color.copy(this.blendColour(from.ambient, to.ambient, blend))
    this.hemisphere.groundColor.copy(this.blendColour(from.fog, to.fog, blend))

    const cloudOpacity = THREE.MathUtils.lerp(from.cloudOpacity, to.cloudOpacity, blend)
    for (const material of this.cloudMaterials) {
      material.color.copy(this.blendColour(from.cloud, to.cloud, blend))
      material.opacity = cloudOpacity
      material.visible = cloudOpacity > 0.01
    }

    this.terrainLow.copy(this.blendColour(from.terrain[0], to.terrain[0], blend))
    this.terrainMid.copy(this.blendColour(from.terrain[1], to.terrain[1], blend))
    this.terrainHigh.copy(this.blendColour(from.terrain[2], to.terrain[2], blend))
    this.terrainRock.copy(this.blendColour(from.terrain[3], to.terrain[3], blend))
  }

  public dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.world.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      objectMaterials.forEach((material) => materials.add(material))
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
    this.scene.remove(this.world)
  }

  private rebuildTile(tile: TerrainTile, column: number, row: number): void {
    const previousGeometry = tile.mesh.geometry
    tile.mesh.geometry = this.createTerrainGeometry(column, row)
    previousGeometry.dispose()
    tile.column = column
    tile.row = row
  }

  private createTerrainGeometry(column: number, row: number): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TERRAIN_SUBDIVISIONS, TERRAIN_SUBDIVISIONS)
    geometry.rotateX(-Math.PI / 2)
    const positions = geometry.getAttribute('position')
    for (let index = 0; index < positions.count; index += 1) {
      const worldX = positions.getX(index) + column * TILE_SIZE
      const worldZ = positions.getZ(index) + row * TILE_SIZE
      const height = sampleTerrainHeight(worldX, worldZ)
      positions.setY(index, height)
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  }

  /**
   * Textureless, world-space ground cover. A small shader layer gives the
   * valley grass, dry earth, river banks, and exposed stone their own rhythm
   * instead of tinting every terrain vertex the same green.
   */
  private createTerrainMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.97,
      metalness: 0,
      side: THREE.FrontSide,
    })
    material.onBeforeCompile = (shader) => {
      shader.uniforms.terrainLow = { value: this.terrainLow }
      shader.uniforms.terrainMid = { value: this.terrainMid }
      shader.uniforms.terrainHigh = { value: this.terrainHigh }
      shader.uniforms.terrainRock = { value: this.terrainRock }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrainWorldPosition;
          varying vec3 vTerrainWorldNormal;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 terrainLow;
          uniform vec3 terrainMid;
          uniform vec3 terrainHigh;
          uniform vec3 terrainRock;
          varying vec3 vTerrainWorldPosition;
          varying vec3 vTerrainWorldNormal;

          float terrainHash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
          }

          float terrainNoise(vec2 point) {
            vec2 cell = floor(point);
            vec2 local = fract(point);
            local = local * local * (3.0 - 2.0 * local);
            float a = terrainHash(cell);
            float b = terrainHash(cell + vec2(1.0, 0.0));
            float c = terrainHash(cell + vec2(0.0, 1.0));
            float d = terrainHash(cell + vec2(1.0, 1.0));
            return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `float broadPatch = terrainNoise(vTerrainWorldPosition.xz * 0.027);
          float finePatch = terrainNoise(vTerrainWorldPosition.xz * 0.118);
          float patch = broadPatch * 0.72 + finePatch * 0.28;
          vec3 terrainColour = mix(terrainLow, terrainMid, smoothstep(0.16, 0.82, patch));
          terrainColour = mix(terrainColour, terrainHigh, smoothstep(0.62, 0.96, patch) * 0.58);

          float slope = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);
          float highGround = smoothstep(9.0, 19.0, vTerrainWorldPosition.y);
          float exposedRock = clamp(smoothstep(0.14, 0.53, slope) + highGround * 0.35, 0.0, 0.82);
          terrainColour = mix(terrainColour, terrainRock, exposedRock);

          float riverCentre = sin(vTerrainWorldPosition.z * 0.012) * 4.2;
          float riverDistance = abs(vTerrainWorldPosition.x - riverCentre);
          float riverBank = 1.0 - smoothstep(8.0, 20.0, riverDistance);
          terrainColour = mix(terrainColour, terrainLow, riverBank * 0.32);
          diffuseColor.rgb = terrainColour;
          #include <color_fragment>`,
        )
    }
    material.customProgramCacheKey = () => 'fly-birdy-procedural-terrain-v1'
    return material
  }

  private createRiverGeometry(originZ: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array((RIVER_SEGMENTS + 1) * 2 * 3)
    const indices: number[] = []
    for (let index = 0; index <= RIVER_SEGMENTS; index += 1) {
      const progress = index / RIVER_SEGMENTS
      const worldZ = originZ + (progress - 0.5) * RIVER_LENGTH
      const centreX = sampleRiverCentre(worldZ)
      const halfWidth = 12.8 + Math.sin(worldZ * 0.024) * 1.2
      const ripple = Math.sin(worldZ * 0.19) * 0.035
      const offset = index * 6
      positions[offset] = centreX - halfWidth
      positions[offset + 1] = -2.7 + ripple
      positions[offset + 2] = worldZ - originZ
      positions[offset + 3] = centreX + halfWidth
      positions[offset + 4] = -2.7 - ripple
      positions[offset + 5] = worldZ - originZ
      if (index < RIVER_SEGMENTS) {
        const start = index * 2
        indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2)
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
  }

  private blendColour(from: number, to: number, blend: number): THREE.Color {
    this.colourA.setHex(from)
    this.colourB.setHex(to)
    return this.colourResult.lerpColors(this.colourA, this.colourB, blend)
  }

  private createCloudBank(row: number, side: number): CloudBank {
    const group = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({
      color: 0xe7f4e7,
      flatShading: true,
      roughness: 0.98,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    })
    this.cloudMaterials.push(material)
    for (let index = 0; index < 5; index += 1) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(5.2 + (index % 2) * 2.4, 1), material)
      puff.position.set((index - 2) * 6.2, 28 + (index % 3) * 2.7, Math.sin(index * 1.7 + row) * 8)
      puff.scale.y = 0.48
      group.add(puff)
    }
    group.position.z = row * TILE_SIZE
    group.position.x = side * (118 + Math.sin(row * 1.7) * 22)
    this.world.add(group)
    return { group, row, side }
  }
}
