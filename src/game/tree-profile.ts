/** Placement styles choose palette/size, not separate player-facing species.
 * Ordinary trees share the approved crown; only pine has a distinct model/name.
 * Authored GLBs use grid units. Crown size is distinct from trunk collision. */
export type TreeSpecies = 'oak' | 'pine' | 'sapling' | 'fruit' | 'blossom';
export type TreeSize = 'small' | 'medium' | 'large';
export const TREE_SIZES = {
  small: { diameter: 1, trunkRadius: .14 },
  medium: { diameter: 1.5, trunkRadius: .18 },
  large: { diameter: 2, trunkRadius: .22 },
} as const;
type TreeDimensions = { size: TreeSize; scale: number };
export const treeCanopyRadius = (tree: TreeDimensions, gridSize: number) => TREE_SIZES[tree.size].diameter * gridSize * tree.scale / 2;
export const treeCollisionRadius = (tree: TreeDimensions, gridSize: number) => TREE_SIZES[tree.size].trunkRadius * gridSize * tree.scale;

export const TREE_COLORS = {
  lime: '#b3d35d', leaf: '#94bf62', pine: '#77a57c',
  gold: '#e6bf65', orange: '#df9b67', pink: '#e5aac2',
} as const;
export type TreeColor = keyof typeof TREE_COLORS;
const palettes: Record<TreeSpecies, readonly TreeColor[]> = {
  oak: ['lime', 'leaf', 'gold'], sapling: ['lime', 'leaf', 'lime'],
  pine: ['pine', 'pine', 'leaf'], fruit: ['leaf', 'gold', 'orange'],
  blossom: ['pink', 'pink', 'pink'],
};
export const treeColor = (species: TreeSpecies, tone: number): TreeColor => palettes[species][tone % 3];
export const treeName = (species?: TreeSpecies) => species === 'pine' ? '松树' : '树木';
export const treeAsset = (species: TreeSpecies, size: TreeSize) => species === 'pine' ? 'pine' : `oak${size === 'medium' ? '' : `-${size}`}`;
// Pine keeps the original tiered silhouette and shares one Geometry at all sizes.
export const treeModelScale = (species: TreeSpecies, size: TreeSize) => species === 'pine' ? TREE_SIZES[size].diameter / TREE_SIZES.medium.diameter : 1;
