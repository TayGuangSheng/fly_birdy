export type EnvironmentId = 'valley' | 'canyon' | 'clouds' | 'cavern' | 'storm'

export interface EnvironmentTheme {
  id: EnvironmentId
  name: string
  startDistance: number
  /** Upper and lower colours of the procedural sky dome. */
  sky: number
  skyHorizon: number
  fog: number
  water: number
  cloud: number
  cloudOpacity: number
  terrain: number[]
  sun: number
  ambient: number
}

export const environmentThemes: EnvironmentTheme[] = [
  {
    id: 'valley', name: 'Sunlit Valley', startDistance: 0,
    sky: 0x4e82ab, skyHorizon: 0xb6d9d0, fog: 0x8ab4c3, water: 0x4a94a2, cloud: 0xe7f4e7, cloudOpacity: 0.62,
    // Low ground, living cover, sunlit earth, exposed stone.
    terrain: [0x294f3d, 0x537a43, 0x899257, 0x69665b], sun: 0xffe8b2, ambient: 0xdff6f4,
  },
  {
    id: 'canyon', name: 'Red Rock Canyon', startDistance: 800,
    sky: 0x805267, skyHorizon: 0xeab18a, fog: 0xc58a70, water: 0x7b6c62, cloud: 0xf0c1a4, cloudOpacity: 0.26,
    terrain: [0x6f473e, 0xa15e43, 0xd18a5b, 0x6a4d48], sun: 0xffc28d, ambient: 0xf4c7a4,
  },
  {
    id: 'clouds', name: 'Cloud Sea', startDistance: 1750,
    sky: 0x5e9dd0, skyHorizon: 0xd9f2f3, fog: 0xc6e5ef, water: 0x6daec9, cloud: 0xf6fffa, cloudOpacity: 0.92,
    terrain: [0x456f70, 0x72a18a, 0xa1b987, 0x647173], sun: 0xfff2c0, ambient: 0xe6f9ff,
  },
  {
    id: 'cavern', name: 'Crystal Caves', startDistance: 3000,
    sky: 0x080f28, skyHorizon: 0x454d7c, fog: 0x293252, water: 0x293f62, cloud: 0x6873a2, cloudOpacity: 0,
    terrain: [0x172642, 0x2f4564, 0x41628a, 0x1c2b4d], sun: 0x9a84ef, ambient: 0x6a79b3,
  },
  {
    id: 'storm', name: 'Storm Peaks', startDistance: 4300,
    sky: 0x071521, skyHorizon: 0x456976, fog: 0x304656, water: 0x314d63, cloud: 0x243b49, cloudOpacity: 0.88,
    terrain: [0x203b45, 0x3d5960, 0x627474, 0x263943], sun: 0xaec4d5, ambient: 0x637b91,
  },
]

export const environmentTransitionDistance = 220
