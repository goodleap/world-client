import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:4174');
  const result = await page.evaluate(async () => {
    const B = await import('/node_modules/.vite/deps/@babylonjs_core.js');
    const { installMatteMaterials } = await import('/src/game/matte-material.ts');
    const { refreshFrozenMaterials } = await import('/src/game/material-invalidation.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; document.body.replaceChildren(canvas);
    const engine = new B.Engine(canvas, false, { preserveDrawingBuffer: true }), scene = new B.Scene(engine); installMatteMaterials(scene);
    const camera = new B.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2, 4, B.Vector3.Zero(), scene); camera.mode = 1;
    camera.orthoLeft = camera.orthoBottom = -1; camera.orthoRight = camera.orthoTop = 1;
    const sky = new B.HemisphericLight('sky', B.Vector3.Up(), scene); sky.intensity = .2;
    const sun = new B.DirectionalLight('sun', new B.Vector3(0, 0, 1), scene); sun.intensity = .4;
    const fire = new B.PointLight('fire', new B.Vector3(0, 0, -1), scene); fire.intensity = .6; fire.diffuse.set(1, .5, .1); fire.setEnabled(false);
    const mesh = B.MeshBuilder.CreatePlane('ground', { size: 2 }, scene), material = new B.StandardMaterial('matte', scene); mesh.material = material;
    material.specularColor = B.Color3.Black(); material.diffuseColor.set(.4, .4, .4);
    const texture = new B.RawTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, B.Constants.TEXTUREFORMAT_RGBA, scene, false, false);
    material.detailMap.texture = texture; material.detailMap.isEnabled = true; material.detailMap.bumpLevel = 0; material.freeze();
    async function sample() { await scene.whenReadyAsync(); scene.render(); scene.render(); return Array.from(await engine.readPixels(64, 64, 1, 1)); }
    const off = await sample(), before = mesh.subMeshes[0].materialDefines;
    const source = mesh.subMeshes[0].effect.fragmentSourceCode;
    const shader = { specular: before.SPECULARTERM, colorDetailOnly: before.COLOR_DETAIL_ONLY, colorOnlyCode: /vec2 uvOffset=vec2\(0\.0\);\s*vec4 detailColor=texture(?:2D)?\(detailSampler,vDetailUV\)/.test(source) };
    fire.setEnabled(true); refreshFrozenMaterials(scene); const on = await sample();
    const activePointLight = mesh.subMeshes[0].materialDefines.POINTLIGHT2;
    fire.setEnabled(false); refreshFrozenMaterials(scene); const offAgain = await sample();
    const frozen = material.isFrozen; scene.dispose(); engine.dispose();
    return { shader, off, on, offAgain, frozen, activePointLight };
  });
  console.log(JSON.stringify(result)); await writeFile('/workspace/artifacts/material-shader.json', JSON.stringify(result, null, 2));
  if (result.shader.specular || !result.shader.colorDetailOnly || !result.shader.colorOnlyCode || !result.activePointLight || !result.frozen
    || result.on[0] <= result.off[0] + 5 || result.offAgain.some((v, i) => Math.abs(v - result.off[i]) > 1)) throw new Error('Frozen material/shader regression');
} finally { await browser.close(); }
