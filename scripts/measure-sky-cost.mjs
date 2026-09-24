// measure-sky-cost.mjs: GPU cost of the Lane S analytic sky (sprint 24Sep26h).
// Usage: node scripts/measure-sky-cost.mjs [origin=http://localhost:5173]
//
// Method: render the real frame once into the scene's 4x MSAA half-float
// target (so depth holds the city), then time, with EXT_disjoint_timer_query,
// 300 extra draws of the sky triangle against 300 draws of the SAME triangle
// with a constant shader and identical depth state. The difference is the
// sky's own shading cost on the pixels it actually covers. Run it with the GPU
// otherwise idle: other WebGL work interleaves with the timer and swamps a
// sub-millisecond difference.
import { chromium } from '@playwright/test';
const origin = process.argv[2] || 'http://localhost:5173';
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${origin}/?fast=1&buildings=baked`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal && window.__ug.groundReady && window.__ugSky, null, { timeout: 180000 });
await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.fpsControls.enabled = false; });
const VIEWS = { street: [[3200, 130, -10], [4200, 180, -500]], overview: [[0, 20000, 18000], [0, 0, 0]], skyUp: [[0, 3000, 0], [0, 9000, -2000]], landing: [[-194.2, 300, -2162.8], [-988.5, 250, -1557.1]] };
for (const [name, [p, t]] of Object.entries(VIEWS)) {
  await page.evaluate(([p, t]) => { const u = window.__ug; u.camera.position.set(...p); u.controls.target.set(...t); }, [p, t]);
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const u = window.__ug, T = window.__ugTHREE, R = u.composer.renderer, gl = R.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const sky = window.__ugSky.mesh, parent = sky.parent, rt = u.composer.renderTarget1;
    const s = new T.Scene(), empty = new T.Scene();
    // Control: the same triangle, depth state and order, with a constant shader.
    const ctrl = new T.Mesh(sky.geometry, new T.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.2,0.3,0.4,1.0); }', depthTest: true, depthWrite: false, depthFunc: T.LessEqualDepth }));
    ctrl.frustumCulled = false; empty.add(ctrl);
    const timeQ = async (scene, n) => {
      const q = gl.createQuery();
      R.setRenderTarget(rt);
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < n; i++) R.render(scene, u.camera);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      R.setRenderTarget(null);
      for (let k = 0; k < 400; k++) { await new Promise(r => setTimeout(r, 5)); if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break; }
      return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    };
    // Fill colour and depth with the real frame, then add sky draws on top of that depth.
    const wasVisible = sky.visible;
    R.setRenderTarget(rt); R.autoClear = true; R.render(u.scene, u.camera);
    R.autoClear = false;
    parent.remove(sky); s.add(sky); sky.visible = true;
    await timeQ(s, 5); await timeQ(empty, 5);
    const out = [];
    for (let k = 0; k < 12; k++) { const a = await timeQ(s, 300), e = await timeQ(empty, 300); out.push((a - e) / 300); }
    s.remove(sky); parent.add(sky); sky.visible = wasVisible; R.autoClear = true;
    out.sort((a, b) => a - b);
    return { median: +((out[5] + out[6]) / 2).toFixed(3), all: out.map(v => +v.toFixed(3)) };
  });
  console.log(name, JSON.stringify(r));
}
await b.close();
