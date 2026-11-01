/** Shared physical dimensions, in world units. Placement still reserves 2x2
 * grid cells. The stone ring's rendered outer edge is 1.33; 0.01 clearance
 * covers its low-poly silhouette without blocking the empty cell corners. */
export const CAMPFIRE_SHAPE = { stones: 11, orbit: 1.02, stoneWidth: .62, stoneDepth: .52, radius: 1.34 };
