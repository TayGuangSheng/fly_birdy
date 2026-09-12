export interface DifficultyProfile {
  level: number
  speedMultiplier: number
  sectionSpacing: number
  obstacleCount: number
  laneOffset: number
  altitudeOffset: number
}

/** Smooth distance-based progression: density and speed rise without sudden jumps. */
export class DifficultySystem {
  public getProfile(distance: number): DifficultyProfile {
    const progress = Math.min(distance / 3000, 1)
    const level = distance < 500 ? 1 : distance < 1500 ? 2 : distance < 3000 ? 3 : 4

    return {
      level,
      speedMultiplier: 1 + progress * 0.38,
      sectionSpacing: 74 - progress * 18,
      obstacleCount: level === 1 ? 1 : level === 2 ? 2 : 3,
      laneOffset: 6 + progress * 4,
      altitudeOffset: level < 3 ? 3.5 : 6.5,
    }
  }
}
