import { Game, type FlightTelemetry, type GameEvent } from '../game/Game.ts'
import { poseConfig } from '../config/poseConfig.ts'
import { PoseController } from '../pose/PoseController.ts'
import { PoseRenderer } from '../pose/PoseRenderer.ts'
import type { PoseLandmarkerService } from '../pose/PoseLandmarkerService.ts'
import type { PoseMeasurements } from '../pose/PoseTypes.ts'
import { FlightRecords } from '../systems/FlightRecords.ts'

type GameScreenState = 'ready' | 'loading' | 'arming' | 'flying' | 'paused' | 'results' | 'error'
type CalibrationSample = { bankSignal: number; torsoLean: number }

const TRACKING_LOSS_GRACE_MS = 450
const RECOVERY_COUNTDOWN_MS = 3_000
const VIDEO_STALL_GRACE_MS = 650
// This stays intentionally small: drawing the pilot sight should never compete
// with pose inference or the main WebGL flight view.
const PILOT_VIEW_WIDTH = 320
const PILOT_VIEW_HEIGHT = 180

type PilotSightState = 'searching' | 'locked' | 'paused'

/** Keeps webcam setup behind Fly Birdy's game-first presentation. */
export class FlightPrototype {
  private readonly root: HTMLDivElement
  private poseService: PoseLandmarkerService | null = null
  private readonly poseController = new PoseController()
  private readonly flightRecords = new FlightRecords()
  private pilotRenderer: PoseRenderer | null = null
  private game: Game | null = null
  private stream: MediaStream | null = null
  private animationFrame: number | null = null
  private lastVideoTime = -1
  private lastPoseUpdateTime = 0
  private lastVideoFrameTime = 0
  private state: GameScreenState = 'ready'
  private stateMessage = ''
  private calibrated = false
  private calibrationSeconds = 0
  private calibrationSamples: CalibrationSample[] = []
  private awaitingTakeoff = false
  private runActive = false
  private runFinished = false
  private trackingPaused = false
  private trackingLossStartedAt: number | null = null
  private recoveryStartedAt: number | null = null
  private toastTimer: number | null = null
  private pilotSightState: PilotSightState | null = null
  private pilotAspect = ''
  private poseLoopActive = false

  public constructor(root: HTMLDivElement) {
    this.root = root
  }

  public mount(): void {
    this.root.innerHTML = `
      <main id="flight-shell" class="game-shell">
        <section class="game-stage" aria-label="Fly Birdy game">
          <canvas id="flight-canvas" class="flight-canvas" aria-label="Fly Birdy flight view"></canvas>
          <div class="stage-vignette" aria-hidden="true"></div>

          <header class="game-header">
            <div class="game-brand" aria-label="Fly Birdy"><span>fly</span> birdy</div>
            <div id="environment-name" class="environment-label">Sunlit Valley</div>
          </header>

          <div id="flight-stats" class="flight-stats" aria-label="Flight score">
            <div class="score-stat"><span>Score</span><strong id="flight-score">0</strong></div>
            <div><span>Distance</span><strong id="flight-distance">0</strong><em>m</em></div>
            <div><span>Feathers</span><strong id="flight-feathers">0</strong></div>
            <div><span>Multiplier</span><strong id="flight-multiplier">&times;1</strong></div>
          </div>

          <div id="flight-mode" class="flight-mode state-ready" role="status" aria-live="polite"><i></i><span id="flight-mode-text">PRESS PLAY</span></div>

          <section id="game-menu" class="game-menu" aria-labelledby="game-title">
            <p id="menu-kicker">Arcade flight</p>
            <h1 id="game-title"><span>fly</span> birdy</h1>
            <div class="menu-flight-line" aria-hidden="true"><i></i><i></i></div>
            <p id="menu-copy">Flap to climb. Lean forward to dive.</p>
            <button id="launch-flight" class="menu-launch" type="button">Play</button>
            <small>Camera stays on your device.</small>
          </section>

          <section id="tracking-pause" class="tracking-pause" aria-live="assertive" hidden>
            <p>PAUSED</p><strong id="tracking-pause-text">Step back into view</strong>
          </section>

          <div id="score-toast" class="score-toast" role="status" aria-live="polite"></div>

          <section id="run-results" class="run-results" aria-labelledby="results-heading" hidden>
            <p>Flight over</p><h2 id="results-heading">Wings<br>clipped.</h2>
            <div id="record-callout" class="record-callout" role="status" aria-live="polite" hidden>
              <span id="record-callout-text">New flight record</span>
            </div>
            <div class="results-grid">
              <span>Score <strong id="result-score">0</strong></span>
              <span>Distance <strong id="result-distance">0 m</strong></span>
              <span>Rings <strong id="result-rings">0</strong></span>
              <span>Perfect rings <strong id="result-perfect">0</strong></span>
              <span>Feathers <strong id="result-feathers">0</strong></span>
              <span>Near misses <strong id="result-near">0</strong></span>
            </div>
            <div class="results-record" aria-label="Personal flight record">
              <span>Best score <strong id="result-best-score">0</strong></span>
              <span>Longest <strong id="result-best-distance">0 m</strong></span>
            </div>
            <div class="results-actions">
              <button id="restart-run" type="button">Fly again</button>
              <button id="end-flight" class="end-flight" type="button">End flight</button>
            </div>
          </section>

          <aside id="pilot-overlay" class="pilot-overlay" aria-hidden="true" hidden>
            <div class="pilot-camera-frame">
              <video id="pilot-camera" class="pilot-video" autoplay muted playsinline aria-hidden="true"></video>
              <canvas id="pilot-pose-overlay" class="pilot-pose-overlay" aria-hidden="true"></canvas>
            </div>
            <div class="pilot-overlay-top" aria-hidden="true">
              <span>Pilot sight</span>
              <span id="pilot-status" class="pilot-overlay-status" data-state="searching"><i></i><span id="pilot-status-text">SEARCHING</span></span>
            </div>
          </aside>
        </section>
      </main>
    `

    this.pilotRenderer = new PoseRenderer(this.getElement<HTMLCanvasElement>('pilot-pose-overlay'))
    this.getElement<HTMLButtonElement>('launch-flight').addEventListener('click', () => void this.launch())
    this.getElement<HTMLButtonElement>('restart-run').addEventListener('click', () => this.restartRun())
    this.getElement<HTMLButtonElement>('end-flight').addEventListener('click', () => this.endSession())

    try {
      this.game = new Game(this.getElement<HTMLCanvasElement>('flight-canvas'))
      this.game.setTelemetryListener((telemetry) => this.updateFlightTelemetry(telemetry))
      this.game.setGameEventListener((event) => this.handleGameEvent(event))
    } catch {
      this.showRendererError()
    }
  }

  public destroy(): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.releaseCamera()
    this.game?.dispose()
  }

  private async launch(): Promise<void> {
    if (!this.game || this.state === 'loading' || this.state === 'arming' || this.state === 'flying') return
    if (!navigator.mediaDevices?.getUserMedia) {
      this.showLaunchError('This browser cannot open a camera for Fly Birdy.')
      return
    }

    const button = this.getElement<HTMLButtonElement>('launch-flight')
    button.disabled = true
    button.textContent = 'Starting...'
    this.setState('loading', 'STARTING')

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        // A 30 fps, 960 px stream keeps body control responsive on laptops
        // and phones without asking MediaPipe to inspect unnecessary pixels.
        video: {
          facingMode: 'user',
          width: { ideal: 960, max: 1280 },
          height: { ideal: 540, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      await this.createPoseService()
      const video = this.getElement<HTMLVideoElement>('pilot-camera')
      video.srcObject = this.stream
      await video.play()
      this.pilotAspect = ''
      this.updatePilotAspect(video)
      this.getElement('pilot-overlay').hidden = false
      this.getElement('flight-shell').classList.add('is-camera-live')
      this.setPilotStatus('searching')

      this.resetCalibration()
      this.lastVideoTime = -1
      this.lastPoseUpdateTime = 0
      this.lastVideoFrameTime = performance.now()
      this.trackingLossStartedAt = null
      this.recoveryStartedAt = null
      this.trackingPaused = false
      this.awaitingTakeoff = false
      this.runActive = false
      this.game?.setTrackingPaused(true)
      this.game?.start()

      this.getElement('flight-shell').classList.add('is-arming')
      this.getElement('game-menu').classList.add('is-arming')
      this.setMenuCopy('Open your wings', 'Stand tall and spread wide.')
      this.setState('arming', 'WINGS OUT TO BEGIN')
      this.poseLoopActive = true
      this.loop(performance.now())
    } catch (error) {
      this.releaseCamera()
      const reason = error instanceof Error ? error.name : 'Unknown error'
      this.showLaunchError(this.errorMessage(reason))
    }
  }

  private loop = (now: number): void => {
    if (!this.poseLoopActive) return
    const video = this.getElement<HTMLVideoElement>('pilot-camera')
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime
        this.lastVideoFrameTime = now
        const poseService = this.poseService
        if (!poseService) throw new Error('Pose tracker is not ready')
        const result = poseService.detect(video, now)
        const landmarks = result?.landmarks[0]
        const measurements = this.poseController.interpret(landmarks, result?.worldLandmarks[0], now)
        const deltaSeconds = this.lastPoseUpdateTime === 0 ? 0 : Math.min((now - this.lastPoseUpdateTime) / 1000, 0.1)
        this.lastPoseUpdateTime = now
        const pilotHeight = this.updatePilotAspect(video)
        // Gameplay takes priority over the cosmetic pilot inset. This keeps a
        // newly inferred gesture on the same frame as the bird update.
        this.updatePose(measurements, deltaSeconds, now)
        this.updatePilotStatus(measurements)
        this.pilotRenderer?.draw(landmarks, this.hasClearPose(measurements), PILOT_VIEW_WIDTH, pilotHeight)
      } else if (this.lastVideoFrameTime > 0 && now - this.lastVideoFrameTime >= VIDEO_STALL_GRACE_MS) {
        this.handleTrackingUnavailable(now)
      }
    } catch {
      this.handlePoseFailure()
      return
    }
    if (this.poseLoopActive) this.animationFrame = requestAnimationFrame(this.loop)
  }

  private updatePose(measurements: PoseMeasurements, deltaSeconds: number, now: number): void {
    if (this.runFinished) return
    if (!this.hasClearPose(measurements)) {
      this.handleTrackingUnavailable(now)
      return
    }

    this.trackingLossStartedAt = null
    if (!this.calibrated) {
      this.advanceCalibration(measurements, deltaSeconds)
      return
    }
    if (this.trackingPaused) {
      this.advanceRecovery(measurements, now)
      return
    }
    if (this.awaitingTakeoff) {
      if (!measurements.armsExtended) {
        this.setState('arming', 'WINGS OUT TO BEGIN')
        return
      }
      this.startRun(measurements)
      return
    }
    if (!this.runActive) return

    this.game?.setFlightInput(measurements)
    this.setState('flying', 'FLYING')
  }

  private advanceCalibration(measurements: PoseMeasurements, deltaSeconds: number): void {
    if (!measurements.armsExtended) {
      this.clearCalibrationProgress()
      this.setMenuCopy('Open your wings', 'Stand tall and spread wide.')
      this.setState('arming', 'WINGS OUT TO BEGIN')
      return
    }

    this.calibrationSeconds = Math.min(poseConfig.calibrationHoldSeconds, this.calibrationSeconds + deltaSeconds)
    this.calibrationSamples.push({ bankSignal: measurements.rawBankSignal, torsoLean: measurements.rawTorsoLean })
    if (this.calibrationSeconds < poseConfig.calibrationHoldSeconds) return

    this.poseController.setNeutralPose(
      this.averageCalibrationSample('bankSignal'),
      this.averageCalibrationSample('torsoLean'),
    )
    this.calibrated = true
    this.startRun(measurements)
  }

  private startRun(measurements: PoseMeasurements): void {
    this.awaitingTakeoff = false
    this.runActive = true
    this.trackingPaused = false
    this.game?.setTrackingPaused(false)
    this.game?.setFlightInput(measurements)
    this.game?.beginRun()
    const menu = this.getElement('game-menu')
    menu.classList.add('is-hidden')
    menu.setAttribute('aria-hidden', 'true')
    menu.inert = true
    const launchButton = this.getElement<HTMLButtonElement>('launch-flight')
    launchButton.blur()
    launchButton.disabled = true
    launchButton.tabIndex = -1
    this.getElement('flight-shell').classList.remove('is-arming')
    this.getElement('flight-shell').classList.add('is-playing')
    this.setState('flying', 'FLYING')
  }

  private handleTrackingUnavailable(now: number): void {
    this.setPilotStatus(this.trackingPaused ? 'paused' : 'searching')
    if (!this.calibrated) {
      this.clearCalibrationProgress()
      this.setMenuCopy('Open your wings', 'Step back a little, then spread wide.')
      this.setState('arming', 'WINGS OUT TO BEGIN')
      return
    }
    if (!this.runActive || this.awaitingTakeoff || this.runFinished) return

    this.recoveryStartedAt = null
    if (this.trackingPaused) return
    if (this.trackingLossStartedAt === null) this.trackingLossStartedAt = now
    if (now - this.trackingLossStartedAt < TRACKING_LOSS_GRACE_MS) return

    this.trackingPaused = true
    this.game?.setTrackingPaused(true)
    this.showTrackingPause('Step back into view')
    this.setPilotStatus('paused')
    this.setState('paused', 'PAUSED')
  }

  private advanceRecovery(measurements: PoseMeasurements, now: number): void {
    if (!this.runActive) return
    if (this.recoveryStartedAt === null) this.recoveryStartedAt = now
    const elapsed = now - this.recoveryStartedAt
    if (elapsed < RECOVERY_COUNTDOWN_MS) {
      this.showTrackingPause(`Resuming in ${Math.max(1, Math.ceil((RECOVERY_COUNTDOWN_MS - elapsed) / 1000))}`)
      return
    }

    this.trackingPaused = false
    this.recoveryStartedAt = null
    this.game?.setTrackingPaused(false)
    this.game?.setFlightInput(measurements)
    this.hideTrackingPause()
    this.setState('flying', 'FLYING')
  }

  private updateFlightTelemetry(telemetry: FlightTelemetry): void {
    this.setText('flight-score', telemetry.score.toLocaleString())
    this.setText('flight-distance', telemetry.distance.toFixed(0))
    this.setText('flight-feathers', String(telemetry.feathers))
    this.setText('flight-multiplier', `×${telemetry.multiplier}`)
    this.setText('environment-name', telemetry.environment)
  }

  private handleGameEvent(event: GameEvent): void {
    if (event.type === 'toast') {
      this.showToast(event.text)
      return
    }
    this.runActive = false
    this.runFinished = true
    this.setText('result-score', event.score.score.toLocaleString())
    this.setText('result-distance', `${event.distance.toFixed(0)} m`)
    this.setText('result-rings', String(event.score.rings))
    this.setText('result-perfect', String(event.score.perfectRings))
    this.setText('result-feathers', String(event.score.feathers))
    this.setText('result-near', String(event.score.nearMisses))
    const recordUpdate = this.flightRecords.recordFlight(event.score.score, event.distance)
    this.setText('result-best-score', recordUpdate.record.bestScore.toLocaleString())
    this.setText('result-best-distance', `${recordUpdate.record.bestDistance.toLocaleString()} m`)
    const recordCallout = this.getElement('record-callout')
    const recordMessage = recordUpdate.isNewBestScore && recordUpdate.isNewBestDistance
      ? 'New flight record'
      : recordUpdate.isNewBestScore
        ? 'New best score'
        : recordUpdate.isNewBestDistance
          ? 'New longest flight'
          : ''
    recordCallout.hidden = !recordMessage
    if (recordMessage) this.setText('record-callout-text', recordMessage)
    this.getElement('run-results').hidden = false
    this.getElement('flight-shell').classList.remove('is-playing')
    this.setState('results', 'FLIGHT OVER')
  }

  private restartRun(): void {
    this.runFinished = false
    this.runActive = false
    this.awaitingTakeoff = true
    this.trackingPaused = false
    this.trackingLossStartedAt = null
    this.recoveryStartedAt = null
    this.getElement('run-results').hidden = true
    this.getElement('record-callout').hidden = true
    this.game?.restart()
    this.game?.setTrackingPaused(true)
    this.getElement('flight-shell').classList.remove('is-playing')
    this.getElement('flight-shell').classList.add('is-arming')
    this.setState('arming', 'WINGS OUT TO BEGIN')
  }

  /** Stop camera capture and return to the initial game scene. */
  private endSession(message?: string): void {
    this.releaseCamera()
    this.game?.restart()
    this.game?.stop()
    this.game?.setTrackingPaused(true)
    this.resetCalibration()
    this.runFinished = false
    this.runActive = false
    this.awaitingTakeoff = false
    this.trackingPaused = false
    this.trackingLossStartedAt = null
    this.recoveryStartedAt = null
    this.getElement('run-results').hidden = true
    this.getElement('record-callout').hidden = true
    this.hideTrackingPause()

    const menu = this.getElement('game-menu')
    menu.classList.remove('is-arming', 'is-hidden')
    menu.setAttribute('aria-hidden', 'false')
    menu.inert = false
    this.restoreMenu()
    const button = this.getElement<HTMLButtonElement>('launch-flight')
    button.disabled = false
    button.tabIndex = 0
    button.textContent = 'Play'

    const shell = this.getElement('flight-shell')
    shell.classList.remove('is-arming', 'is-playing', 'is-camera-live')
    if (message) {
      this.setMenuCopy('Fly Birdy', message)
      this.setState('error', 'TRACKING STOPPED')
    } else {
      this.setState('ready', 'PRESS PLAY')
    }
  }

  private resetCalibration(): void {
    this.calibrated = false
    this.clearCalibrationProgress()
    this.poseController.clearNeutralPose()
  }

  private clearCalibrationProgress(): void {
    this.calibrationSeconds = 0
    this.calibrationSamples = []
  }

  private averageCalibrationSample(key: keyof CalibrationSample): number {
    const total = this.calibrationSamples.reduce((sum, sample) => sum + sample[key], 0)
    return this.calibrationSamples.length === 0 ? 0 : total / this.calibrationSamples.length
  }

  private hasClearPose(measurements: PoseMeasurements): boolean {
    return measurements.trackingConfidence >= poseConfig.launchTrackingConfidence
  }

  private showTrackingPause(message: string): void {
    this.setText('tracking-pause-text', message)
    this.getElement('tracking-pause').hidden = false
  }

  private hideTrackingPause(): void {
    this.getElement('tracking-pause').hidden = true
  }

  private showToast(text: string): void {
    const toast = this.getElement('score-toast')
    toast.textContent = text
    toast.classList.remove('is-visible')
    window.requestAnimationFrame(() => toast.classList.add('is-visible'))
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1150)
  }

  private showLaunchError(message: string): void {
    const button = this.getElement<HTMLButtonElement>('launch-flight')
    button.disabled = false
    button.tabIndex = 0
    button.textContent = 'Try again'
    this.setMenuCopy('Fly Birdy', message)
    const menu = this.getElement('game-menu')
    menu.classList.remove('is-arming', 'is-hidden')
    menu.setAttribute('aria-hidden', 'false')
    menu.inert = false
    const shell = this.getElement('flight-shell')
    shell.classList.remove('is-arming', 'is-playing', 'is-camera-live')
    this.getElement('pilot-overlay').hidden = true
    this.setState('error', 'CAMERA NEEDED')
  }

  private showRendererError(): void {
    const button = this.getElement<HTMLButtonElement>('launch-flight')
    button.disabled = true
    button.textContent = 'Unavailable'
    this.setMenuCopy('Fly Birdy', 'This browser cannot run the graphics needed for Fly Birdy.')
    this.setState('error', 'UNSUPPORTED BROWSER')
  }

  private handlePoseFailure(): void {
    this.endSession('Body tracking stopped. Press Play to restart the camera.')
  }

  private releaseCamera(): void {
    this.poseLoopActive = false
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    const video = this.root.querySelector<HTMLVideoElement>('#pilot-camera')
    if (video) video.srcObject = null
    this.poseService?.destroy()
    this.poseService = null
    this.pilotRenderer?.clear()
    this.pilotSightState = null
    const pilotOverlay = this.root.querySelector<HTMLElement>('#pilot-overlay')
    if (pilotOverlay) pilotOverlay.hidden = true
  }

  /** Match the inset to the real camera ratio so skeleton joints never drift. */
  private updatePilotAspect(video: HTMLVideoElement): number {
    if (!video.videoWidth || !video.videoHeight) return PILOT_VIEW_HEIGHT
    const aspect = `${video.videoWidth} / ${video.videoHeight}`
    if (this.pilotAspect !== aspect) {
      this.pilotAspect = aspect
      this.getElement('pilot-overlay').style.setProperty('--pilot-aspect', aspect)
    }
    return Math.max(1, Math.round(PILOT_VIEW_WIDTH * video.videoHeight / video.videoWidth))
  }

  /** Load the heavy vision runtime only after the player has chosen to play. */
  private async createPoseService(): Promise<void> {
    const { PoseLandmarkerService } = await import('../pose/PoseLandmarkerService.ts')
    const service = new PoseLandmarkerService()
    try {
      await service.initialise()
      this.poseService = service
    } catch (error) {
      service.destroy()
      throw error
    }
  }

  private updatePilotStatus(measurements: PoseMeasurements): void {
    this.setPilotStatus(this.trackingPaused ? 'paused' : this.hasClearPose(measurements) ? 'locked' : 'searching')
  }

  private setPilotStatus(state: PilotSightState): void {
    if (this.pilotSightState === state) return
    this.pilotSightState = state
    const status = this.getElement('pilot-status')
    status.dataset.state = state
    this.setText('pilot-status-text', state === 'locked' ? 'LOCKED' : state === 'paused' ? 'HOLD' : 'SEARCHING')
  }

  private restoreMenu(): void {
    this.getElement('game-title').innerHTML = '<span>fly</span> birdy'
    this.setText('menu-kicker', 'Arcade flight')
    this.setText('menu-copy', 'Flap to climb. Lean forward to dive.')
  }

  private setMenuCopy(title: string, copy: string): void {
    this.setText('game-title', title)
    this.setText('menu-copy', copy)
  }

  private setState(state: GameScreenState, message: string): void {
    if (this.state === state && this.stateMessage === message) return
    this.state = state
    this.stateMessage = message
    const mode = this.getElement('flight-mode')
    mode.className = `flight-mode state-${state}`
    this.setText('flight-mode-text', message)
  }

  private errorMessage(reason: string): string {
    if (reason === 'NotAllowedError') return 'Camera access is off. Turn it on in your browser, then try again.'
    if (reason === 'NotFoundError') return 'No camera found. Connect one, then try again.'
    return 'Fly Birdy could not start the camera. Try again.'
  }

  private getElement<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`)
    if (!element) throw new Error(`Missing UI element: ${id}`)
    return element
  }

  private setText(id: string, text: string): void {
    this.getElement(id).textContent = text
  }
}
