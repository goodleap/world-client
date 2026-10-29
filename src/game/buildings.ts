import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Palette } from './models';
import { roundedBox, ellipsoid, tintHeight } from './environment-shapes';

/** Curved terracotta courses follow the roof silhouette in the reference sheet. */
export function tiledRoof(scene: Scene, p: Palette, x: number, z: number, width: number, depth: number, height: number, rise: number) {
  const half = width / 2 + .35, rows = Math.ceil(half / .57), cols = Math.ceil((depth + .65) / .62);
  const step = half / rows, tileWidth = (depth + .65) / cols;
  for (const side of [-1, 1]) {
    // From eaves to ridge so every higher course overlaps the lower one.
    for (let row = rows - 1; row >= 0; row--) {
      const t = (row + .5) / rows, slope = rise * 1.5 * Math.sqrt(t) / half;
      for (let col = 0; col < cols; col++) {
        const tile = roundedBox(scene, 'terracotta-tile', [step * Math.sqrt(1 + slope * slope) + .06, .18, tileWidth - .022],
          [x + side * half * t, height + rise * (1 - t ** 1.5) + .12 + (rows - row) * .009, z + (col - (cols - 1) / 2) * tileWidth],
          (row + col * 3) % 5 === 0 ? p.roofLight : p.terracotta, .065);
        tile.rotation.z = -side * Math.atan(slope);
      }
    }
  }
  for (let col = 0; col < cols; col++) {
    roundedBox(scene, 'roof-ridge-tile', [.43, .3, tileWidth + .02], [x, height + rise + .17, z + (col - (cols - 1) / 2) * tileWidth], p.roofLight, .13);
  }
}

function gable(scene: Scene, p: Palette, x: number, z: number, width: number, depth: number, height: number) {
  const positions: number[] = [], indices: number[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const a = -width / 2 + width * i / 16, b = -width / 2 + width * (i + 1) / 16;
      const ya = 1.14 * (1 - Math.abs(a / (width / 2 + .35)) ** 1.5), yb = 1.14 * (1 - Math.abs(b / (width / 2 + .35)) ** 1.5);
      const start = positions.length / 3;
      positions.push(a, 0, side * depth / 2, b, 0, side * depth / 2, a, ya, side * depth / 2, b, yb, side * depth / 2);
      indices.push(...(side < 0 ? [start, start + 1, start + 2, start + 1, start + 3, start + 2] : [start, start + 2, start + 1, start + 1, start + 2, start + 3]));
    }
  }
  const data = new VertexData(), normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals); data.positions = positions; data.normals = normals; data.indices = indices;
  const mesh = new Mesh('cream-gable', scene); data.applyToMesh(mesh); mesh.position.set(x, height, z); mesh.material = p.plaster;
}

export function referenceHouse(scene: Scene, p: Palette, b: { id: string; x: number; z: number; width: number; depth: number; height: number }) {
  const { x, z, width: w, depth: d, height: h } = b;
  const front = z - d / 2;
  const walls = roundedBox(scene, `${b.id}-walls`, [w, h, d], [x, h / 2 + .12, z], p.cream, .16);
  tintHeight(walls, '#f1e8d3', '#ffffff');
  gable(scene, p, x, z, w, d, h + .12);
  const count = Math.ceil(w / .65);
  for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
    roundedBox(scene, 'foundation-stone', [w / count - .025, .38, .3], [x + (i - (count - 1) / 2) * w / count, .22, z + side * d / 2], i % 3 ? p.stoneLight : p.stone, .07);
  }
  const sideCount = Math.ceil(d / .65);
  for (const side of [-1, 1]) for (let i = 0; i < sideCount; i++) {
    roundedBox(scene, 'side-foundation-stone', [.3, .38, d / sideCount - .025], [x + side * w / 2, .22, z + (i - (sideCount - 1) / 2) * d / sideCount], i % 3 ? p.stoneLight : p.stone, .07);
  }
  for (const dx of [-w / 2, w / 2]) {
    roundedBox(scene, 'timber-corner', [.2, h - .3, .2], [x + dx, (h + .4) / 2, front - .04], p.timberLight, .055);
    for (const side of [-1, 1]) roundedBox(scene, 'corner-stone', [.42, .4, .43], [x + dx, .58, z + side * (d / 2 - .08)], p.stoneLight, .07);
  }
  roundedBox(scene, 'lintel-beam', [w + .14, .2, .18], [x, h + .04, front - .06], p.timberLight, .06);
  tiledRoof(scene, p, x, z, w, d, h + .12, 1.14);
  // Recessed teal door, warm timber casing, and stone doorstep.
  const doorX = x - .35;
  roundedBox(scene, 'door-recess', [1.18, 2.12, .1], [doorX, 1.16, front - .025], p.woodDark, .045);
  roundedBox(scene, 'door', [1.0, 1.96, .12], [doorX, 1.19, front - .13], p.sage, .035);
  for (const dx of [-.58, .58]) roundedBox(scene, 'door-casing', [.13, 2.16, .18], [doorX + dx, 1.19, front - .19], p.timberLight, .04);
  roundedBox(scene, 'door-casing-top', [1.25, .14, .18], [doorX, 2.27, front - .19], p.timberLight, .04);
  ellipsoid(scene, 'brass-door-knob', [.13, .13, .12], [doorX + .32, 1.1, front - .24], p.golden);
  roundedBox(scene, 'door-step', [1.35, .17, .65], [doorX, .13, front - .4], p.stoneLight, .06);
  roundedBox(scene, 'door-step-lower', [1.48, .12, .45], [doorX, .06, front - .8], p.stoneLight, .05);
  const windowXs = w > 4 ? [x - 1.43, x + 1.14] : [x + .85];
  for (const wx of windowXs) {
    roundedBox(scene, 'window-recess', [.82, .96, .1], [wx, 1.58, front - .04], p.woodDark, .07);
    roundedBox(scene, 'window-glass', [.65, .76, .08], [wx, 1.59, front - .09], p.window, .02);
    for (const dx of [-.4, .4]) roundedBox(scene, 'window-frame', [.1, 1.0, .16], [wx + dx, 1.58, front - .15], p.timberLight, .025);
    for (const y of [1.09, 2.07]) roundedBox(scene, 'window-frame', [.86, .11, .16], [wx, y, front - .15], p.timberLight, .025);
    roundedBox(scene, 'window-cross', [.055, .8, .08], [wx, 1.58, front - .16], p.linen, .018);
    roundedBox(scene, 'window-cross', [.71, .055, .08], [wx, 1.63, front - .16], p.linen, .018);
    roundedBox(scene, 'flower-box', [.94, .23, .38], [wx, 1.04, front - .2], p.timber, .06);
    for (let i = -1; i <= 1; i++) {
      ellipsoid(scene, 'window-leaves', [.29, .26, .26], [wx + i * .26, 1.23, front - .3], p.leaf);
      ellipsoid(scene, 'window-flower', [.12, .12, .1], [wx + i * .26, 1.36, front - .32], i % 2 ? p.golden : p.flower);
    }
  }
  // Both side elevations have framed windows, rather than an unfinished blank wall.
  for (const side of [-1, 1]) {
    const sx = x + side * (w / 2 + .035);
    roundedBox(scene, 'side-window-recess', [.1, 1.0, .95], [sx, 1.57, z], p.woodDark, .045);
    roundedBox(scene, 'side-window-glass', [.08, .78, .73], [sx + side * .07, 1.57, z], p.window, .02);
    for (const dz of [-.46, .46]) roundedBox(scene, 'side-window-frame', [.16, 1.02, .11], [sx + side * .1, 1.57, z + dz], p.timberLight, .025);
    for (const y of [1.08, 2.06]) roundedBox(scene, 'side-window-frame', [.16, .11, 1.0], [sx + side * .1, y, z], p.timberLight, .025);
    roundedBox(scene, 'side-window-bar', [.08, .8, .055], [sx + side * .13, 1.57, z], p.linen, .018);
    roundedBox(scene, 'side-window-bar', [.08, .055, .76], [sx + side * .13, 1.57, z], p.linen, .018);
  }
  // The chimney also uses the reference's pale stone and rounded cap.
  if (b.id === 'cottage') {
    for (let row = 0; row < 4; row++) roundedBox(scene, 'chimney-stone', [.58, .28, .61], [x + 1.12, h + .5 + row * .28, z + .75], row % 2 ? p.stoneLight : p.stone, .045);
    roundedBox(scene, 'chimney-cap', [.76, .24, .78], [x + 1.12, h + 1.58, z + .75], p.stoneLight, .06);
    roundedBox(scene, 'chimney-opening', [.4, .015, .42], [x + 1.12, h + 1.705, z + .75], p.woodDark, .004);
  }
}
