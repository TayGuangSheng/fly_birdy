export interface ScoreSnapshot {
  score: number
  feathers: number
  featherTrails: number
  rings: number
  perfectRings: number
  nearMisses: number
  multiplier: number
}

export interface ScoreAward {
  points: number
  multiplier: number
}

/** Owns all scoring rules; rendering and course generation do not alter score directly. */
export class ScoreSystem {
  private score = 0
  private feathers = 0
  private featherTrails = 0
  private rings = 0
  private perfectRings = 0
  private nearMisses = 0
  private multiplier = 1
  private lastDistance = 0

  public reset(): void {
    this.score = 0
    this.feathers = 0
    this.featherTrails = 0
    this.rings = 0
    this.perfectRings = 0
    this.nearMisses = 0
    this.multiplier = 1
    this.lastDistance = 0
  }

  public addDistance(distance: number): void {
    const travelled = Math.max(0, Math.floor(distance) - Math.floor(this.lastDistance))
    this.score += travelled
    this.lastDistance = distance
  }

  public collectRing(perfect: boolean): ScoreAward {
    this.rings += 1
    if (perfect) this.perfectRings += 1
    const points = (perfect ? 350 : 250) * this.multiplier
    const multiplier = this.multiplier
    this.score += points
    this.multiplier = Math.min(5, this.multiplier + 1)
    return { points, multiplier }
  }

  public collectFeather(): ScoreAward {
    this.feathers += 1
    const points = 50 * this.multiplier
    this.score += points
    return { points, multiplier: this.multiplier }
  }

  /**
   * A Feather Trail is the full curved line leading into a ring. Individual
   * feathers are still worth collecting, while a clean line gives players a
   * satisfying optional precision objective on every section.
   */
  public completeFeatherTrail(featherCount: number): ScoreAward {
    this.featherTrails += 1
    const points = (100 + Math.max(0, featherCount) * 35) * this.multiplier
    this.score += points
    return { points, multiplier: this.multiplier }
  }

  public awardNearMiss(): ScoreAward {
    this.nearMisses += 1
    const points = 100 * this.multiplier
    this.score += points
    return { points, multiplier: this.multiplier }
  }

  public missRing(): void {
    this.multiplier = Math.max(1, this.multiplier - 1)
  }

  public snapshot(): ScoreSnapshot {
    return {
      score: this.score,
      feathers: this.feathers,
      featherTrails: this.featherTrails,
      rings: this.rings,
      perfectRings: this.perfectRings,
      nearMisses: this.nearMisses,
      multiplier: this.multiplier,
    }
  }
}
