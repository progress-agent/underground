#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.UG_CHECK_PORT || 5174);
const BASE_URL = process.env.UG_CHECK_URL || `http://127.0.0.1:${PORT}`;
const SAFETY_EPSILON = 0.05;
const EXPECTED_LINES = [
  'bakerloo',
  'central',
  'circle',
  'district',
  'dlr',
  'hammersmith-city',
  'jubilee',
  'metropolitan',
  'northern',
  'piccadilly',
  'victoria',
  'waterloo-city',
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Keep polling while Vite starts.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  let vite = null;
  if (!process.env.UG_CHECK_URL) {
    vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', chunk => process.stdout.write(chunk));
    vite.stderr.on('data', chunk => process.stderr.write(chunk));
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=metal'],
  });

  try {
    await waitForServer(BASE_URL);
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${BASE_URL}/?fast=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const ug = window.__ug;
      if (!ug?.lineBranchCenterPts || !ug?.thamesProfileSampler || !ug?.isInThames) return false;
      return ug.lineBranchCenterPts.size >= 12;
    }, null, { timeout: 90000 });

    const result = await page.evaluate(async ({ expectedLines, epsilon }) => {
      const ug = window.__ug;
      const THREE = await import('/node_modules/three/build/three.module.js');
      const VE = ug.VERTICAL_EXAGGERATION;
      const waterY = 2 * VE;
      const rows = [];

      for (const lineId of expectedLines) {
        const branches = ug.lineBranchCenterPts.get(lineId) || [];
        const failures = [];
        let riverSamples = 0;
        let minClearanceScene = Infinity;

        for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
          const branch = branches[branchIndex];
          if (!branch || branch.length < 2) continue;
          const points = branch.map(p => new THREE.Vector3(p.x, p.y, p.z));
          const curve = new THREE.CatmullRomCurve3(points);
          curve.curveType = 'catmullrom';
          curve.tension = 0.5;
          const divisions = Math.max(120, points.length * 40);

          for (let i = 0; i <= divisions; i++) {
            const u = i / divisions;
            const p = curve.getPoint(u);
            if (!ug.isInThames(p.x, p.z)) continue;

            const prof = ug.thamesProfileSampler.sampleAt(p.x, p.z);
            if (!prof) continue;
            const floorY = waterY - prof.d * VE;
            const clearanceScene = floorY - p.y;
            riverSamples++;
            minClearanceScene = Math.min(minClearanceScene, clearanceScene);

            if (!(p.y < floorY - epsilon)) {
              failures.push({
                branchIndex,
                u,
                x: p.x,
                y: p.y,
                z: p.z,
                floorY,
                depthM: prof.d,
                clearanceScene,
              });
            }
          }
        }

        rows.push({
          lineId,
          status: failures.length === 0 ? 'PASS' : 'FAIL',
          riverSamples,
          minClearanceScene: Number.isFinite(minClearanceScene) ? minClearanceScene : null,
          minClearanceM: Number.isFinite(minClearanceScene) ? minClearanceScene / VE : null,
          failures: failures.slice(0, 5),
        });
      }

      return rows;
    }, { expectedLines: EXPECTED_LINES, epsilon: SAFETY_EPSILON });

    let failed = false;
    for (const row of result) {
      const minM = row.minClearanceM === null ? 'n/a' : `${row.minClearanceM.toFixed(2)}m`;
      console.log(`${row.status} ${row.lineId}: ${row.riverSamples} river samples, min clearance below bed ${minM}`);
      if (row.failures.length > 0) {
        failed = true;
        console.log(JSON.stringify(row.failures, null, 2));
      }
    }

    if (failed) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (vite) {
      vite.kill('SIGTERM');
      await wait(500);
      if (!vite.killed) vite.kill('SIGKILL');
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
