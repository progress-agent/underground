import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  retries: 0,
  // WebGL context competition on the shared dev server — serial is the reliability contract.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    // Headless WITH real GPU: with the ANGLE Metal args below, headless Chromium
    // gets the actual Apple GPU (verified 06Jul26: UNMASKED_RENDERER = "ANGLE Metal
    // Renderer: Apple M2 Max" and the full scene renders identically to headed).
    // The old "headless SwiftShader can't create WebGL" note is stale. Headless
    // also stops test windows stealing keyboard focus from the user's session.
    headless: true,
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=metal'], // macOS Metal backend for WebGL
    },
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
