import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',

  // Keep initial load snappy: split large deps (Three.js) into separate chunks.
  build: {
    // Keep the warning threshold slightly above Three's minified footprint.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/three/')) return 'three';
            // Put everything else in a generic vendor chunk.
            return 'vendor';
          }
        },
      },
    },
  },
});
