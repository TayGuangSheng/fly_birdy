import * as THREE from 'three'
import type { FlightState } from './FlightController.ts'

/** A colourful, procedural low-poly kestrel built entirely from Three.js geometry. */
export class Bird {
  public readonly group = new THREE.Group()
  private readonly visual = new THREE.Group()
  private readonly leftWingRoot = new THREE.Group()
  private readonly rightWingRoot = new THREE.Group()
  private readonly tailRoot = new THREE.Group()

  public constructor() {
    const plum = new THREE.MeshStandardMaterial({ color: 0xc86b42, flatShading: true, roughness: 0.86 })
    const wing = new THREE.MeshStandardMaterial({ color: 0x375268, flatShading: true, roughness: 0.9 })
    const chest = new THREE.MeshStandardMaterial({ color: 0xf4d8a1, flatShading: true, roughness: 0.93 })
    const beak = new THREE.MeshStandardMaterial({ color: 0xf4bd54, flatShading: true, roughness: 0.72 })
    const eye = new THREE.MeshBasicMaterial({ color: 0x142630 })

    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), plum)
    body.scale.set(0.78, 0.67, 1.55)
    body.castShadow = true
    body.receiveShadow = true
    this.visual.add(body)

    const breast = new THREE.Mesh(new THREE.OctahedronGeometry(0.68, 1), chest)
    breast.position.set(0, -0.13, -0.46)
    breast.scale.set(0.72, 0.48, 1.1)
    this.visual.add(breast)

    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 1), plum)
    head.position.set(0, 0.23, -1.32)
    head.scale.set(0.94, 0.88, 1.1)
    head.castShadow = true
    this.visual.add(head)

    for (const side of [-1, 1]) {
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 5), chest)
      eyeWhite.position.set(side * 0.3, 0.36, -1.68)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), eye)
      pupil.position.set(side * 0.335, 0.37, -1.75)
      this.visual.add(eyeWhite, pupil)
    }

    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.6, 4), beak)
    bill.rotation.x = -Math.PI / 2
    bill.position.set(0, 0.18, -2.0)
    this.visual.add(bill)

    this.leftWingRoot.position.set(-0.54, 0.08, 0.02)
    this.rightWingRoot.position.set(0.54, 0.08, 0.02)
    this.leftWingRoot.add(this.createWing(-1, wing, plum))
    this.rightWingRoot.add(this.createWing(1, wing, plum))
    this.visual.add(this.leftWingRoot, this.rightWingRoot)

    this.tailRoot.position.set(0, -0.08, 1.32)
    for (const offset of [-0.22, 0, 0.22]) {
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.7, 3), wing)
      feather.rotation.x = Math.PI / 2
      feather.position.set(offset, 0, 0.7)
      feather.rotation.z = -offset * 0.7
      this.tailRoot.add(feather)
    }
    this.visual.add(this.tailRoot)
    this.group.add(this.visual)
  }

  public update(state: FlightState, elapsedSeconds: number): void {
    this.group.position.copy(state.position)
    // The procedural model is authored nose-first along local -Z, while the
    // flight vector uses +sin(heading) on X. Negating yaw keeps the visible
    // bird, course direction, and rear chase camera in the same world frame.
    this.group.rotation.y = -state.heading
    this.visual.rotation.x = state.pitch
    this.visual.rotation.z = state.roll
    this.visual.position.y = Math.sin(elapsedSeconds * 2.2) * 0.045

    // A recognised flap should animate on the pose frame that detected it,
    // rather than waiting for the vertical-velocity response to build up.
    const manoeuvre = Math.min(
      1,
      Math.max(state.flapping ? 1 : 0, Math.abs(state.verticalControl), Math.abs(state.verticalVelocity) / 8 + Math.abs(state.roll) / 1.4),
    )
    const flapSpeed = state.flapping ? 8.5 : 2.2 + manoeuvre * 3.4
    const wingAngle = -0.08 + Math.sin(elapsedSeconds * flapSpeed) * (0.08 + manoeuvre * 0.3)
    this.rightWingRoot.rotation.z = wingAngle
    this.leftWingRoot.rotation.z = -wingAngle
    this.rightWingRoot.rotation.y = -0.08 + state.roll * 0.13
    this.leftWingRoot.rotation.y = 0.08 + state.roll * 0.13
    this.tailRoot.rotation.x = -state.pitch * 0.75 + Math.sin(elapsedSeconds * 1.8) * 0.045
    this.tailRoot.rotation.z = -state.roll * 0.33
  }

  public dispose(): void {
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
  }

  private createWing(side: -1 | 1, primary: THREE.Material, accent: THREE.Material): THREE.Group {
    const group = new THREE.Group()
    const main = new THREE.Mesh(new THREE.ConeGeometry(0.56, 3.1, 4), primary)
    main.rotation.z = side === 1 ? -Math.PI / 2 : Math.PI / 2
    main.position.set(side * 1.28, 0, 0.1)
    main.castShadow = true
    main.receiveShadow = true
    group.add(main)

    for (let index = 0; index < 3; index += 1) {
      const feather = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.45, 3), accent)
      feather.rotation.z = side === 1 ? -Math.PI / 2 : Math.PI / 2
      feather.position.set(side * (2.05 + index * 0.24), -0.04 - index * 0.08, 0.16 + (index - 1) * 0.26)
      feather.castShadow = true
      group.add(feather)
    }
    return group
  }
}
