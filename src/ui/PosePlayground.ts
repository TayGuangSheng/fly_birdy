import { PoseController } from '../pose/PoseController.ts'
import { PoseLandmarkerService } from '../pose/PoseLandmarkerService.ts'
import { PoseRenderer } from '../pose/PoseRenderer.ts'
import type { PoseMeasurements } from '../pose/PoseTypes.ts'

type PlaygroundState = 'idle' | 'starting' | 'searching' | 'tracking' | 'error'

const value = (number: number) => `${number >= 0 ? '+' : ''}${number.toFixed(2)}`
const degrees = (number: number) => `${number >= 0 ? '+' : ''}${number.toFixed(1)}°`

export class PosePlayground {
  private readonly root: HTMLDivElement
  private readonly poseService = new PoseLandmarkerService()
  private readonly poseController = new PoseController()
  private renderer: PoseRenderer | null = null
  private stream: MediaStream | null = null
  private animationFrame: number | null = null
  private lastVideoTime = -1
  private state: PlaygroundState = 'idle'

  public constructor(root: HTMLDivElement) {
    this.root = root
  }

  public mount(): void {
    this.root.innerHTML = `
      <main class="flight-deck">
        <header class="topbar">
          <a class="brand" href="/" aria-label="Fly Birdy motion lab home"><span class="brand-mark" aria-hidden="true">⌁</span><span>Fly Birdy</span></a>
          <div class="topbar-context">Motion lab</div>
          <div class="local-badge"><span class="live-dot"></span> Camera stays local</div>
        </header>

        <section class="intro" aria-labelledby="page-title">
          <div><p class="eyebrow">Flight control lab</p><h1 id="page-title">Teach the sky<br>your body language.</h1></div>
          <p class="intro-copy">A private place to inspect wing controls. Keep your upper body in frame and spread your arms to see the flight signals.</p>
        </section>

        <section class="deck-grid" aria-label="Webcam tracking playground">
          <section class="camera-card" aria-label="Live camera with pose overlay">
            <div class="camera-chrome">
              <div><span class="camera-label">Pilot view</span><span id="camera-message" class="camera-message">Ready to start</span></div>
              <button id="start-camera" class="start-button" type="button">Start camera</button>
            </div>
            <div class="camera-stage">
              <video id="webcam" autoplay muted playsinline aria-label="Webcam preview"></video>
              <canvas id="pose-overlay" aria-label="Pose skeleton overlay"></canvas>
              <div id="camera-placeholder" class="camera-placeholder"><span class="wing-glyph" aria-hidden="true">⌁</span><strong>Camera standing by</strong><span>Allow access when you are ready to test.</span></div>
              <div id="tracking-pill" class="tracking-pill state-idle"><span class="signal-icon" aria-hidden="true"></span><span id="tracking-pill-text">Awaiting camera</span></div>
            </div>
            <div class="camera-footer"><span><span class="legend-line"></span> Pose connections</span><span id="frame-rate">— FPS</span></div>
          </section>

          <aside class="telemetry" aria-label="Live pose measurements">
            <div class="telemetry-header"><div><p class="eyebrow">Live telemetry</p><h2>Body → flight</h2></div><div id="tracking-status" class="status-readout state-idle">WAITING</div></div>
            <div class="signal-hero"><span>Player confidence</span><strong id="confidence-value">0%</strong><div class="confidence-meter" aria-hidden="true"><span id="confidence-bar"></span></div><p id="tracking-detail">Start the camera to load pose tracking.</p></div>
            <section class="measurement-group" aria-labelledby="wings-heading">
              <h3 id="wings-heading">Wing geometry</h3>
              <dl class="measurements"><div><dt>Left wing angle</dt><dd id="left-wing">—</dd></div><div><dt>Right wing angle</dt><dd id="right-wing">—</dd></div><div><dt>Arms extended</dt><dd id="arms-extended">—</dd></div></dl>
            </section>
            <section class="measurement-group" aria-labelledby="attitude-heading">
              <h3 id="attitude-heading">Raw flight attitude</h3>
              <dl class="measurements attitude-values"><div><dt>Roll</dt><dd id="roll">—</dd></div><div><dt>Pitch</dt><dd id="pitch">—</dd></div><div><dt>Turn</dt><dd id="turn">—</dd></div><div><dt>Vertical</dt><dd id="vertical">—</dd></div></dl>
            </section>
            <p class="telemetry-note">Raw signals only. The flight view centres its controls around your neutral T-pose before launch.</p>
          </aside>
        </section>

        <section class="test-strip" aria-labelledby="test-heading">
          <div><p class="eyebrow">Suggested test</p><h2 id="test-heading">One motion at a time.</h2></div>
          <ol><li><span>01</span> Stand 1–2 m back with shoulders and hips in frame.</li><li><span>02</span> Hold a T-pose; both wing angles should settle near 0°.</li><li><span>03</span> Raise one wing and lower the other; roll and turn should change continuously.</li><li><span>04</span> Lift both wings, then return to a T-pose to trigger climb. Lean forward to dive.</li></ol>
        </section>
        <footer class="privacy-note">Your camera is used locally for pose tracking. Video is not recorded or uploaded.</footer>
      </main>
    `

    this.renderer = new PoseRenderer(this.getElement<HTMLCanvasElement>('pose-overlay'))
    this.getElement<HTMLButtonElement>('start-camera').addEventListener('click', () => void this.start())
  }

  public destroy(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.poseService.destroy()
  }

  private async start(): Promise<void> {
    if (this.state === 'starting' || this.state === 'tracking' || this.state === 'searching') return
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setError('This browser does not support webcam access. Use a recent Chrome, Edge, Firefox, or Safari release.')
      return
    }

    this.setState('starting', 'Requesting camera and loading the pose model…')
    const button = this.getElement<HTMLButtonElement>('start-camera')
    button.disabled = true
    button.textContent = 'Starting…'

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      await this.poseService.initialise()
      const video = this.getElement<HTMLVideoElement>('webcam')
      video.srcObject = this.stream
      await video.play()
      this.getElement('camera-placeholder').classList.add('is-hidden')
      button.textContent = 'Camera active'
      this.setState('searching', 'Pose model ready — step fully into view.')
      this.lastVideoTime = -1
      this.loop(performance.now())
    } catch (error) {
      this.poseService.destroy()
      this.stream?.getTracks().forEach((track) => track.stop())
      this.stream = null
      const reason = error instanceof Error ? error.name : 'Unknown error'
      this.setError(this.cameraErrorMessage(reason))
      button.disabled = false
      button.textContent = 'Try again'
    }
  }

  private loop = (now: number): void => {
    const video = this.getElement<HTMLVideoElement>('webcam')
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime
      const result = this.poseService.detect(video, now)
      const landmarks = result?.landmarks[0]
      const measurements = this.poseController.interpret(landmarks, result?.worldLandmarks[0], now)
      this.renderer?.draw(landmarks, measurements.tracking, video.videoWidth, video.videoHeight)
      this.updateMeasurements(measurements)
    }
    this.updateFps(now)
    this.animationFrame = requestAnimationFrame(this.loop)
  }

  private updateMeasurements(measurements: PoseMeasurements): void {
    const state: PlaygroundState = measurements.tracking ? 'tracking' : 'searching'
    const detail = measurements.tracking
      ? measurements.armsExtended ? 'Full wing profile visible. Raw input is live.' : 'Tracking is good. Extend both arms to test wing posture.'
      : 'Looking for shoulders, elbows, wrists, and hips.'
    this.setState(state, detail)
    this.setText('left-wing', degrees(measurements.leftWingAngle))
    this.setText('right-wing', degrees(measurements.rightWingAngle))
    this.setText('arms-extended', measurements.armsExtended ? 'YES' : 'NO')
    this.setText('roll', value(measurements.roll))
    this.setText('pitch', value(measurements.pitch))
    this.setText('turn', value(measurements.steering))
    this.setText('vertical', value(measurements.vertical))
    this.setText('confidence-value', `${Math.round(measurements.trackingConfidence * 100)}%`)
    this.getElement('confidence-bar').style.width = `${measurements.trackingConfidence * 100}%`
  }

  private setState(state: PlaygroundState, detail: string): void {
    this.state = state
    const good = state === 'tracking'
    const stateClass = `state-${state}`
    const status = this.getElement('tracking-status')
    const pill = this.getElement('tracking-pill')
    status.className = `status-readout ${stateClass}`
    pill.className = `tracking-pill ${stateClass}`
    status.textContent = good ? 'GOOD' : state === 'error' ? 'ERROR' : state === 'starting' ? 'LOADING' : state === 'idle' ? 'WAITING' : 'LOST'
    this.setText('tracking-pill-text', good ? 'Tracking good' : state === 'starting' ? 'Loading pose' : state === 'idle' ? 'Awaiting camera' : 'Player lost')
    this.setText('tracking-detail', detail)
    this.setText('camera-message', good ? 'Skeleton locked' : detail)
  }

  private setError(message: string): void { this.setState('error', message); this.renderer?.clear() }

  private updateFps(now: number): void {
    const display = this.getElement('frame-rate')
    const last = Number(display.dataset.lastFrame ?? now)
    const fps = 1000 / Math.max(now - last, 1)
    const previous = Number(display.dataset.fps ?? fps)
    const smoothed = previous + (fps - previous) * 0.08
    display.dataset.lastFrame = String(now)
    display.dataset.fps = String(smoothed)
    display.textContent = `${Math.round(smoothed)} FPS`
  }

  private cameraErrorMessage(reason: string): string {
    if (reason === 'NotAllowedError') return 'Camera permission was declined. Allow camera access in your browser, then try again.'
    if (reason === 'NotFoundError') return 'No camera was found. Connect one, then try again.'
    return `Could not start the camera or pose model (${reason}). Check your connection and try again.`
  }

  private getElement<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`)
    if (!element) throw new Error(`Missing UI element: ${id}`)
    return element
  }

  private setText(id: string, text: string): void { this.getElement(id).textContent = text }
}
