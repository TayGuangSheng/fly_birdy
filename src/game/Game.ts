import * as THREE from 'three'
import type { CourseEvent } from '../entities/CourseEntity.ts'
import type { FlightInput } from '../pose/PoseTypes.ts'
import { DifficultySystem } from '../systems/DifficultySystem.ts'
import { ScoreSystem, type ScoreSnapshot } from '../systems/ScoreSystem.ts'
import { CourseManager } from '../world/CourseManager.ts'
import { EnvironmentManager } from '../world/EnvironmentManager.ts'
import { FlightWorld } from '../world/FlightWorld.ts'
import { gameConfig } from '../config/gameConfig.ts'
import { Bird } from './Bird.ts'
import { CameraController } from './CameraController.ts'
import { FlightEffects } from './FlightEffects.ts'
import { FlightController, type FlightState } from './FlightController.ts'
import { usesIPadPerformanceProfile } from '../platform/deviceProfile.ts'

const neutralInput: FlightInput = {
  roll: 0,
  pitch: 0,
  steering: 0,
  vertical: 0,
  flapping: false,
  armsExtended: false,
  trackingConfidence: 0,
}

export interface FlightTelemetry {
  speed: number
  altitude: number
  steering: number
  vertical: number
  distance: number
  bodyControlActive: boolean
  score: number
  feathers: number
  featherTrails: number
  rings: number
  perfectRings: number
  nearMisses: number
  multiplier: number
  difficulty: number
  environment: string
}

/** Semantic feedback stays separate from UI copy so audio and visuals can react consistently. */
export type GameFeedbackCue =
  | 'ring'
  | 'perfectRing'
  | 'feather'
  | 'featherTrail'
  | 'nearMiss'
  | 'ringMiss'
  | 'crash'

export type GameEvent =
  | { type: 'toast'; text: string; cue?: GameFeedbackCue }
  | { type: 'gameOver'; score: ScoreSnapshot; distance: number; cue: 'crash' }

export class Game {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(57, 16 / 9, 0.1, 900)
  private readonly clock = new THREE.Clock()
  private readonly flight = new FlightController()
  private readonly bird = new Bird()
  private readonly cameraController = new CameraController(this.camera)
  private readonly effects = new FlightEffects(this.scene)
  private readonly world = new FlightWorld(this.scene)
  private readonly environments = new EnvironmentManager(this.scene, this.world)
  private readonly difficulty = new DifficultySystem()
  private readonly score = new ScoreSystem()
  private readonly course = new CourseManager(this.scene, (event) => this.handleCourseEvent(event))
  private state: FlightState
  private input: FlightInput = neutralInput
  private animationFrame: number | null = null
  private running = false
  private courseActive = false
  private trackingPaused = false
  private runStartDistance = 0
  private gameOver = false
  private crashRemaining = 0
  private lastEnvironment = 'valley'
  private telemetryListener: ((telemetry: FlightTelemetry) => void) | null = null
  private gameEventListener: ((event: GameEvent) => void) | null = null

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const useIPadProfile = usesIPadPerformanceProfile()
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Leave room for the pose-tracking WebGL context on iPadOS.
      antialias: !useIPadProfile,
      precision: useIPadProfile ? 'mediump' : 'highp',
      powerPreference: useIPadProfile ? 'default' : 'high-performance',
    })
    this.renderer.setPixelRatio(useIPadProfile ? 1 : Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = !useIPadProfile
    if (!useIPadProfile) this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.scene.add(this.bird.group)
    this.state = this.flight.update(0, neutralInput)
    this.constrainFlightToGround()
    this.bird.update(this.state, 0)
    this.world.update(this.state)
    this.environments.update(0, this.state, 0)
    this.cameraController.update(this.state, 0, this.world.getGroundHeight.bind(this.world))
    window.addEventListener('resize', this.resize)
    this.resize()
    this.render()
  }

  public setFlightInput(input: FlightInput): void {
    this.input = input
    if (!this.running || this.trackingPaused || this.gameOver) return

    // The pose callback normally runs after the render callback. Apply its
    // controls now so the player does not have to wait for another display
    // frame before seeing their bird bank, pitch, or flap.
    this.state = this.flight.update(0, input)
    const elapsedSeconds = this.clock.getElapsedTime()
    this.bird.update(this.state, elapsedSeconds)
    this.cameraController.update(this.state, 0, this.world.getGroundHeight.bind(this.world))
    this.render()
  }

  public setTelemetryListener(listener: (telemetry: FlightTelemetry) => void): void {
    this.telemetryListener = listener
  }

  public setGameEventListener(listener: (event: GameEvent) => void): void {
    this.gameEventListener = listener
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()
    this.animationFrame = requestAnimationFrame(this.loop)
  }

  public beginRun(): void {
    if (this.courseActive || this.gameOver) return
    this.courseActive = true
    this.effects.setActive(true)
    this.runStartDistance = this.state.distance
    this.score.reset()
    this.course.startAt(this.state.distance)
  }

  public restart(): void {
    this.stop()
    this.gameOver = false
    this.crashRemaining = 0
    this.courseActive = false
    this.trackingPaused = false
    this.runStartDistance = 0
    this.score.reset()
    this.course.reset()
    this.effects.setActive(false)
    this.lastEnvironment = 'valley'
    this.flight.reset()
    this.cameraController.reset()
    this.state = this.flight.update(0, neutralInput)
    this.constrainFlightToGround()
    this.bird.update(this.state, 0)
    this.world.update(this.state)
    this.environments.update(0, this.state, 0)
    this.cameraController.update(this.state, 0, this.world.getGroundHeight.bind(this.world))
    this.render()
    this.start()
  }

  /** Stop the render loop while preserving the last rendered game scene. */
  public stop(): void {
    this.running = false
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.clock.stop()
  }

  public dispose(): void {
    this.stop()
    window.removeEventListener('resize', this.resize)
    this.course.dispose()
    this.environments.dispose()
    this.world.dispose()
    this.effects.dispose()
    this.bird.dispose()
    this.renderer.dispose()
  }

  /** Freeze the simulation during a webcam-tracking interruption. */
  public setTrackingPaused(paused: boolean): void {
    this.trackingPaused = paused
    if (paused) this.input = neutralInput
  }

  private loop = (): void => {
    if (!this.running) return
    const rawDeltaSeconds = this.clock.getDelta()
    const deltaSeconds = this.gameOver
      ? rawDeltaSeconds * gameConfig.crashTimeScale
      : this.trackingPaused
        ? 0
        : rawDeltaSeconds
    const elapsedSeconds = this.clock.getElapsedTime()
    const previousRunDistance = this.courseActive ? Math.max(0, this.state.distance - this.runStartDistance) : 0
    const profile = this.difficulty.getProfile(previousRunDistance)
    if (!this.trackingPaused) {
      this.flight.setSpeedMultiplier(profile.speedMultiplier)
      this.state = this.flight.update(deltaSeconds, this.input)
      this.constrainFlightToGround()
    }
    const runDistance = this.courseActive ? Math.max(0, this.state.distance - this.runStartDistance) : 0
    this.bird.update(this.state, elapsedSeconds)
    this.effects.update(this.state, deltaSeconds)
    this.world.update(this.state)
    const environment = this.environments.update(runDistance, this.state, deltaSeconds)
    this.cameraController.update(this.state, deltaSeconds, this.world.getGroundHeight.bind(this.world))

    if (this.courseActive && environment.id !== this.lastEnvironment) {
      this.lastEnvironment = environment.id
      this.gameEventListener?.({ type: 'toast', text: environment.name.toUpperCase() })
    }

    if (this.courseActive && !this.gameOver && !this.trackingPaused) {
      this.course.update(this.state, profile, elapsedSeconds)
      this.score.addDistance(runDistance)
    } else if (this.gameOver) {
      this.crashRemaining -= rawDeltaSeconds
    }

    this.render()
    const score = this.score.snapshot()
    this.telemetryListener?.({
      speed: this.state.speed,
      altitude: this.state.position.y,
      steering: this.input.steering,
      vertical: this.input.vertical,
      distance: runDistance,
      bodyControlActive: this.state.bodyControlActive,
      ...score,
      difficulty: profile.level,
      environment: environment.name,
    })

    if (this.gameOver && this.crashRemaining <= 0) {
      this.running = false
      this.gameEventListener?.({ type: 'gameOver', score, distance: runDistance, cue: 'crash' })
      return
    }
    this.animationFrame = requestAnimationFrame(this.loop)
  }

  private handleCourseEvent(event: CourseEvent): void {
    if (this.gameOver) return
    if (event.type === 'ring') {
      const award = this.score.collectRing(event.perfect)
      const label = event.perfect ? 'PERFECT!' : 'RING'
      this.gameEventListener?.({
        type: 'toast',
        text: `${label} +${award.points}  \u00d7${award.multiplier}`,
        cue: event.perfect ? 'perfectRing' : 'ring',
      })
      this.effects.burst(this.state.position, event.perfect ? 0xfff0ab : 0xffd46f, 16)
      return
    }
    if (event.type === 'ringMiss') {
      this.score.missRing()
      this.gameEventListener?.({ type: 'toast', text: 'RING MISSED', cue: 'ringMiss' })
      return
    }
    if (event.type === 'feather') {
      const award = this.score.collectFeather()
      this.gameEventListener?.({ type: 'toast', text: `FEATHER +${award.points}`, cue: 'feather' })
      this.effects.burst(this.state.position, 0xf4f8e6, 12)
      return
    }
    if (event.type === 'featherTrail') {
      const award = this.score.completeFeatherTrail(event.feathers)
      this.gameEventListener?.({
        type: 'toast',
        text: `TRAIL COMPLETE +${award.points}`,
        cue: 'featherTrail',
      })
      this.effects.burst(this.state.position, 0x9cf4d0, 28)
      return
    }
    if (event.type === 'nearMiss') {
      const award = this.score.awardNearMiss()
      this.gameEventListener?.({ type: 'toast', text: `NEAR MISS +${award.points}`, cue: 'nearMiss' })
      return
    }
    this.gameOver = true
    this.crashRemaining = gameConfig.crashSlowMotionSeconds
    this.effects.burst(this.state.position, 0xff806e, 46)
  }

  private constrainFlightToGround(): void {
    const groundHeight = this.world.getGroundHeight(this.state.position.x, this.state.position.z)
    if (this.flight.constrainToTerrain(groundHeight)) this.state.verticalVelocity = 0
  }

  private resize = (): void => {
    const width = Math.max(this.canvas.clientWidth, 1)
    const height = Math.max(this.canvas.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.render()
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
