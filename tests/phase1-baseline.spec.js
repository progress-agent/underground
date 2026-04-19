// Phase 1 baseline diagnostic: tile loading under 12km radius
//
// Objective: measure the plateau value of stats.loaded at the canonical
// view position (-200, 85, 400) under a 30s+ settlement window with
// 500ms polling to confirm the Phase 0 dedup fix impact, and determine
// whether under-loading is real or a settle-timing artefact.
//
// Math expectation: π·12² / 4 ≈ 113 tiles at origin.
// Last session observation: 36–56 tiles (30–50% of predicted).
//
// Output: time-series CSV + 3 plateau values + screenshots.

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEASUREMENTS_DIR = path.resolve(__dirname, '..', 'test-results', 'phase1-baseline');
const SCREENSHOTS_DIR = path.join(MEASUREMENTS_DIR, 'screenshots');

// Ensure output directories exist
if (!fs.existsSync(MEASUREMENTS_DIR)) {
  fs.mkdirSync(MEASUREMENTS_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Poll stats at regular interval
async function pollStats(page, intervalMs = 500, maxTimeMs = 30000) {
  const series = [];
  const startTime = Date.now();
  let lastLoaded = null;
  let stabilisedCount = 0;
  const stabilisationThreshold = 3;

  while (true) {
    const elapsedNow = Date.now() - startTime;
    if (elapsedNow > maxTimeMs) break;

    const snapshot = await page.evaluate((elapsed) => {
      const stats = window.__ug?.surfaceLoaderStats || { loaded: 0, loading: 0 };
      const buildingCount = window.__ug?.buildingInstanceCount || 0;
      return {
        t: elapsed,
        loaded: stats.loaded,
        loading: stats.loading,
        buildingCount,
      };
    }, elapsedNow);

    const { t, loaded, loading, buildingCount } = snapshot;
    series.push(snapshot);

    // Check for stabilisation: same loaded count for 3 consecutive polls AND loading === 0
    if (loaded === lastLoaded && loading === 0) {
      stabilisedCount++;
      if (stabilisedCount >= stabilisationThreshold) {
        console.log(
          `Stabilised at t=${t}ms: loaded=${loaded}, loading=${loading}, buildingCount=${buildingCount}`,
        );
        break;
      }
    } else {
      stabilisedCount = 0;
    }
    lastLoaded = loaded;

    await page.waitForTimeout(intervalMs);
  }

  return series;
}

test('Phase 1 baseline — 3 runs at origin with 30s settle', async ({ page }) => {
  test.setTimeout(300000); // 5 minutes for 3 runs

  const allResults = [];

  // Run the measurement 3 times
  for (let runNum = 1; runNum <= 3; runNum++) {
    console.log(`\n========== RUN ${runNum}/3 ==========\n`);

    // Fresh page for each run
    await page.goto('/');

    // Wait for initial boot
    await page.waitForFunction(
      () => document.querySelector('#loadingBar')?.classList.contains('done'),
      { timeout: 120000 },
    );
    await page.waitForTimeout(2000); // Short settle post-boot

    // Position camera at canonical view
    await page.evaluate(() => {
      window.__ug.camera.position.set(-200, 85, 400);
      window.__ug.camera.lookAt(0, 20, 0);
      if (window.__ug.controls && typeof window.__ug.controls.update === 'function') {
        window.__ug.controls.target.set(0, 20, 0);
        window.__ug.controls.update();
      }
    });

    // Settle for 1s to let the loader register camera position
    await page.waitForTimeout(1000);

    // Poll for up to 30s
    const series = await pollStats(page, 500, 30000);

    // Extract final state
    const finalState = series[series.length - 1];
    const plateauLoaded = finalState.loaded;
    const plateauLoading = finalState.loading;
    const plateauBuildingCount = finalState.buildingCount;
    const settleTimeMs = finalState.t;

    allResults.push({
      runNum,
      plateauLoaded,
      plateauLoading,
      plateauBuildingCount,
      settleTimeMs,
      series,
    });

    console.log(`Run ${runNum} complete:`);
    console.log(`  Plateau (loaded, loading, buildingCount, settleTime): (${plateauLoaded}, ${plateauLoading}, ${plateauBuildingCount}, ${settleTimeMs}ms)`);

    // Take screenshot at settled state
    const screenshotPath = path.join(SCREENSHOTS_DIR, `run${runNum}-settled.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  Screenshot saved: ${screenshotPath}`);

    // Allow browser to cool briefly before next run
    if (runNum < 3) {
      await page.waitForTimeout(2000);
    }
  }

  // ── Write summary and time-series data ──

  // Build CSV header
  const csvLines = ['run,t_ms,loaded,loading,buildingCount'];

  // Add all data points
  for (const result of allResults) {
    for (const point of result.series) {
      csvLines.push(
        `${result.runNum},${point.t},${point.loaded},${point.loading},${point.buildingCount}`,
      );
    }
  }

  const csvPath = path.join(MEASUREMENTS_DIR, 'timeseries.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`Time-series CSV written: ${csvPath}`);

  // Write summary report
  const summaryLines = [
    '# Phase 1 Baseline Measurements',
    '',
    '## Summary',
    '',
    `Date: ${new Date().toISOString()}`,
    '',
    '### Plateau Values (loaded, loading, buildingCount, settle_time_ms)',
    '',
  ];

  for (const result of allResults) {
    summaryLines.push(
      `- Run ${result.runNum}: loaded=${result.plateauLoaded}, loading=${result.plateauLoading}, buildingCount=${result.plateauBuildingCount}, settleTime=${result.settleTimeMs}ms`,
    );
  }

  const avgLoaded = Math.round(
    allResults.reduce((sum, r) => sum + r.plateauLoaded, 0) / allResults.length,
  );
  const avgLoading = Math.round(
    allResults.reduce((sum, r) => sum + r.plateauLoading, 0) / allResults.length,
  );
  const avgBuildingCount = Math.round(
    allResults.reduce((sum, r) => sum + r.plateauBuildingCount, 0) / allResults.length,
  );
  const avgSettleTime = Math.round(
    allResults.reduce((sum, r) => sum + r.settleTimeMs, 0) / allResults.length,
  );

  summaryLines.push('');
  summaryLines.push('### Averages');
  summaryLines.push(`- loaded: ${avgLoaded}`);
  summaryLines.push(`- loading: ${avgLoading}`);
  summaryLines.push(`- buildingCount: ${avgBuildingCount}`);
  summaryLines.push(`- settle_time_ms: ${avgSettleTime}`);

  summaryLines.push('');
  summaryLines.push('## Math Expectation');
  summaryLines.push('- LOAD_RADIUS: 12000m');
  summaryLines.push('- Predicted tile count at origin (π·r²/grid_area): ~113 tiles');
  summaryLines.push('- Observed ratio: ' + (avgLoaded / 113 * 100).toFixed(1) + '%');

  summaryLines.push('');
  summaryLines.push('## Interpretation');
  if (avgLoading > 0 && avgLoaded < 100) {
    summaryLines.push('**Queue Starvation Signature**: loading==' + avgLoading + ' at plateau with loaded==' + avgLoaded + '.');
    summaryLines.push('The loader has drained its queue but loading > 0, suggesting internal queue starvation.');
  } else if (avgLoading === 0 && avgLoaded < 100) {
    summaryLines.push('**Radius Clamp Signature**: loading==0 at plateau with loaded==' + avgLoaded + '.');
    summaryLines.push('All eligible tiles have been loaded; check surface-loader.js for per-check caps or other limits.');
  } else if (avgLoaded >= 100) {
    summaryLines.push('**No Under-Loading**: loaded==' + avgLoaded + ' ≈ predicted (113).');
    summaryLines.push('Phase 0 dedup fix appears to have resolved the under-loading issue.');
  } else {
    summaryLines.push('**Inconclusive**: Check raw time-series data in timeseries.csv.');
  }

  const summaryPath = path.join(MEASUREMENTS_DIR, 'baseline.md');
  fs.writeFileSync(summaryPath, summaryLines.join('\n'));
  console.log(`Summary written: ${summaryPath}`);

  // ── Console output for reference ──
  console.log('\n========== PHASE 1 BASELINE COMPLETE ==========');
  console.log('Plateau values:');
  for (const result of allResults) {
    console.log(
      `  Run ${result.runNum}: loaded=${result.plateauLoaded}, loading=${result.plateauLoading}, buildingCount=${result.plateauBuildingCount}, settleTime=${result.settleTimeMs}ms`,
    );
  }
  console.log(`Averages: loaded=${avgLoaded}, loading=${avgLoading}, buildingCount=${avgBuildingCount}`);
  console.log(`Output files:\n  ${summaryPath}\n  ${csvPath}\n  ${SCREENSHOTS_DIR}/*.png`);

  // Assertions: just verify that we got data
  expect(allResults.length).toBe(3);
  for (const result of allResults) {
    expect(result.plateauLoaded).toBeGreaterThan(0);
    expect(result.series.length).toBeGreaterThan(0);
  }
});
