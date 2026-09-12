export const sampleRiverCentre = (worldZ: number): number => Math.sin(worldZ * 0.012) * 4.2

/**
 * Deterministic terrain data shared by rendering, scenery placement, and flight
 * safety. Keeping the height field in one place prevents visual ground from
 * drifting away from the physical flight floor when tiles recycle.
 */
export const sampleTerrainHeight = (worldX: number, worldZ: number): number => {
  const riverCentre = sampleRiverCentre(worldZ)
  const riverDistance = worldX - riverCentre
  // The flight lane stays generous around the river, while the world rises
  // into broad shoulders beyond it. This gives the camera a real valley
  // silhouette without turning the collectible lane into a terrain obstacle.
  const broadHills = Math.sin(worldX * 0.017 + worldZ * 0.011) * 2.35
  const longRidges = Math.cos(worldZ * 0.024 - worldX * 0.011) * 1.7
  const foldedGround = Math.sin(worldX * 0.045 - worldZ * 0.021) * Math.cos(worldZ * 0.032) * 1.25
  const smallFacets = Math.sin(worldX * 0.083 + worldZ * 0.017) * Math.cos(worldZ * 0.069) * 0.48
  const valleyBasin = -8.9 * Math.exp(-(riverDistance * riverDistance) / 185)
  const outsideLane = Math.max(0, Math.abs(riverDistance) - 15)
  const valleyShoulders = 10.5 * (1 - Math.exp(-(outsideLane * outsideLane) / 980))
  return broadHills + longRidges + foldedGround + smallFacets + valleyBasin + valleyShoulders - 0.8
}
