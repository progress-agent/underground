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
    headless: false, // WebGL needs GPU — headless SwiftShader can't create context
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
