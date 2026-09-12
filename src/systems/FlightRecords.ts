export interface FlightRecord {
  bestScore: number
  bestDistance: number
  totalFlights: number
}

export interface FlightRecordUpdate {
  record: FlightRecord
  isNewBestScore: boolean
  isNewBestDistance: boolean
}

const storageKey = 'fly-birdy.flight-record.v1'
const emptyRecord: FlightRecord = { bestScore: 0, bestDistance: 0, totalFlights: 0 }

/** Keeps a small, local-only flight history. Failure to access storage is safe. */
export class FlightRecords {
  public read(): FlightRecord {
    try {
      const value = window.localStorage.getItem(storageKey)
      if (!value) return { ...emptyRecord }
      const parsed = JSON.parse(value) as Partial<FlightRecord>
      return {
        bestScore: this.positiveInteger(parsed.bestScore),
        bestDistance: this.positiveInteger(parsed.bestDistance),
        totalFlights: this.positiveInteger(parsed.totalFlights),
      }
    } catch {
      return { ...emptyRecord }
    }
  }

  public recordFlight(score: number, distance: number): FlightRecordUpdate {
    const previous = this.read()
    const roundedScore = this.positiveInteger(score)
    const roundedDistance = this.positiveInteger(distance)
    const isNewBestScore = roundedScore > previous.bestScore
    const isNewBestDistance = roundedDistance > previous.bestDistance
    const record: FlightRecord = {
      bestScore: Math.max(previous.bestScore, roundedScore),
      bestDistance: Math.max(previous.bestDistance, roundedDistance),
      totalFlights: previous.totalFlights + 1,
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(record))
    } catch {
      // Private browsing and strict storage settings should never block play.
    }
    return { record, isNewBestScore, isNewBestDistance }
  }

  private positiveInteger(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  }
}
