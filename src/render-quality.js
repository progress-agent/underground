// One sizing path for startup, manual quality changes and window resize.
// Map geometry, camera and HTML labels stay independent of drawing resolution.
export function createRenderQuality({ renderer, composer }) {
  let scale = 1;
  let samples = 4;
  const get = () => ({ scale, samples, pixelRatio: renderer.getPixelRatio() });

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * scale;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  function set(next = {}) {
    const nextScale = Number(next.scale ?? scale);
    scale = Number.isFinite(nextScale) ? Math.min(1, Math.max(0.35, nextScale)) : 1;
    const nextSamples = Number(next.samples ?? samples);
    samples = [0, 2, 4].includes(nextSamples) ? nextSamples : 4;
    // Release the previous framebuffer before changing its sample count.
    // Only renderTarget1 draws geometry; the post buffer always stays at zero.
    if (composer.renderTarget1.samples !== samples) {
      composer.renderTarget1.dispose();
      composer.renderTarget1.samples = samples;
    }
    resize();
    return get();
  }

  return { set, get, resize };
}
