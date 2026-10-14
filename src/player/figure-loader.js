// figure-loader.js: fetch the figure after the opening (sprint 14Oct26w, lane P, D-053 item 3: "The view starts
// in first person until the figure has loaded, so there is no stand-in"). GLTFLoader is imported on demand, so
// neither the loader nor the 2 MB file touches the opening's main thread. A failure is a warning, never a throw:
// the walker simply stays in first person.
import { createFigure } from './figure.js';

export function createFigureLoader({ THREE, parent, manifest }) {
  let status = 'idle', figure = null, promise = null;
  async function run() {
    status = 'loading';
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(manifest.url);
      figure = createFigure({ THREE, gltf, manifest });
      parent.add(figure.group);
      status = 'ready';
      return figure;
    } catch (err) {
      status = 'failed';
      console.warn('[player] the figure did not load; the walker stays in first person', err);
      return null;
    }
  }
  return {
    load() { return promise ?? (promise = run()); },
    get loaded() { return status === 'ready'; },
    get figure() { return figure; },
    get status() { return status; },
  };
}
