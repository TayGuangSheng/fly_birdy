/**
 * Small, procedural sound palette for Fly Birdy.
 *
 * It intentionally owns no autoplay behaviour: `activate()` must be called
 * directly from a player gesture (the Play button), and `play()` silently
 * does nothing until that has happened. This lets the game feel responsive
 * without shipping audio files or surprising a player before they opt in.
 */
export type FlightSoundCue =
  | 'flap'
  | 'ring'
  | 'perfectRing'
  | 'feather'
  | 'nearMiss'
  | 'ringMiss'
  | 'streak'
  | 'crash'

type Waveform = OscillatorType

export class AudioDirector {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private readonly activeSources = new Set<AudioScheduledSourceNode>()
  private enabled = true
  private disposed = false
  private lastFlapAt = Number.NEGATIVE_INFINITY

  /**
   * Call synchronously inside an intentional user action. Creating/resuming
   * an AudioContext anywhere else can be blocked by browser autoplay policy.
   */
  public activate(): void {
    if (!this.enabled || this.disposed || typeof window === 'undefined') return

    try {
      if (!this.context) {
        const context = new AudioContext()
        const master = context.createGain()
        // Feedback should support the flight, not compete with the room or
        // the webcam. Individual cues stay deliberately quiet as well.
        master.gain.value = 0.18
        master.connect(context.destination)
        this.context = context
        this.master = master
      }

      // Resume is intentionally fire-and-forget. A browser may reject it in
      // an unusual embedded context; gameplay should continue silently.
      void this.context.resume().catch(() => undefined)
    } catch {
      // Web Audio is enhancement-only. Do not let an unavailable output
      // device or restrictive browser block a flight.
      this.context = null
      this.master = null
    }
  }

  /** Play one compact acknowledgement for a semantic game event. */
  public play(cue: FlightSoundCue): void {
    const context = this.context
    if (!this.enabled || this.disposed || !context || !this.master || context.state !== 'running') return

    switch (cue) {
      case 'flap':
        this.playFlap()
        break
      case 'ring':
        this.tone(620, 920, 0.12, 0.18, 'sine')
        this.tone(980, 1_210, 0.08, 0.055, 'sine', 0.025)
        break
      case 'perfectRing':
        this.tone(660, 1_120, 0.17, 0.25, 'sine')
        this.tone(990, 1_480, 0.2, 0.12, 'sine', 0.045)
        this.tone(1_320, 1_760, 0.16, 0.06, 'triangle', 0.09)
        break
      case 'feather':
        this.tone(1_120, 1_520, 0.09, 0.13, 'triangle')
        this.tone(1_540, 1_940, 0.075, 0.055, 'sine', 0.035)
        break
      case 'nearMiss':
        this.noise(0.13, 0.12, 1_050, 'bandpass')
        this.tone(220, 150, 0.14, 0.075, 'triangle')
        break
      case 'ringMiss':
        this.tone(260, 190, 0.1, 0.055, 'sine')
        break
      case 'streak':
        this.tone(760, 1_280, 0.18, 0.14, 'sine')
        this.tone(1_140, 1_700, 0.14, 0.075, 'sine', 0.05)
        break
      case 'crash':
        this.noise(0.28, 0.38, 170, 'lowpass')
        this.tone(150, 48, 0.34, 0.25, 'sawtooth')
        break
    }
  }

  /** Allows a future settings toggle without coupling it to Web Audio. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.suspend()
  }

  /** Mute background processing when a flight session ends. */
  public suspend(): void {
    if (!this.context || this.context.state !== 'running') return
    void this.context.suspend().catch(() => undefined)
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // A source may already have naturally ended.
      }
    }
    this.activeSources.clear()
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => undefined)
    this.context = null
    this.master = null
  }

  private playFlap(): void {
    const now = performance.now()
    // The pose controller keeps a flap signal alive briefly; this prevents a
    // single gesture from becoming a long buzzing sound.
    if (now - this.lastFlapAt < 240) return
    this.lastFlapAt = now
    this.noise(0.075, 0.07, 700, 'bandpass')
    this.tone(180, 115, 0.095, 0.09, 'triangle')
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    waveform: Waveform,
    delay = 0,
  ): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return

    const startAt = context.currentTime + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = waveform
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), startAt)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), startAt + duration)
    this.envelope(gain.gain, startAt, duration, volume)
    oscillator.connect(gain)
    gain.connect(master)
    this.track(oscillator)
    oscillator.start(startAt)
    oscillator.stop(startAt + duration + 0.025)
  }

  private noise(
    duration: number,
    volume: number,
    cutoffFrequency: number,
    filterType: BiquadFilterType,
    delay = 0,
  ): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return

    const sampleCount = Math.max(1, Math.ceil(context.sampleRate * duration))
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate)
    const samples = buffer.getChannelData(0)
    // Slightly decaying noise avoids the hard-edged static of a raw buffer.
    for (let index = 0; index < samples.length; index += 1) {
      const fade = 1 - index / samples.length
      samples[index] = (Math.random() * 2 - 1) * fade
    }

    const startAt = context.currentTime + delay
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = filterType
    filter.frequency.setValueAtTime(cutoffFrequency, startAt)
    filter.Q.setValueAtTime(filterType === 'bandpass' ? 0.9 : 0.45, startAt)
    this.envelope(gain.gain, startAt, duration, volume)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    this.track(source)
    source.start(startAt)
    source.stop(startAt + duration + 0.025)
  }

  private envelope(parameter: AudioParam, startAt: number, duration: number, volume: number): void {
    const attack = Math.min(0.018, duration * 0.22)
    parameter.setValueAtTime(0.0001, startAt)
    parameter.exponentialRampToValueAtTime(Math.max(0.0002, volume), startAt + attack)
    parameter.exponentialRampToValueAtTime(0.0001, startAt + duration)
  }

  private track(source: AudioScheduledSourceNode): void {
    this.activeSources.add(source)
    source.addEventListener('ended', () => this.activeSources.delete(source), { once: true })
  }
}
