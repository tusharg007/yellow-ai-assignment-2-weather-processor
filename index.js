import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './src/config.js';
import { readOrders, writeJsonAtomically, writeOrdersAtomically } from './src/json-store.js';
import { processOrders } from './src/process-orders.js';

const directory = dirname(fileURLToPath(import.meta.url));
const defaultPaths = {
  ordersPath: `${directory}/orders.json`,
  reportPath: `${directory}/evidence/live-weather-report.json`,
};

const timestamp = (now) => new Date(now()).toISOString();

function logEvent(event) {
  console.log(`[${event.at}] ${event.event}: ${event.city}${event.category ? ` (${event.category})` : ''}`);
}

export async function run({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  sleep,
  log = logEvent,
  paths = defaultPaths,
  weatherOptions = {},
  writeOrders = writeOrdersAtomically,
  writeReport = writeJsonAtomically,
  source,
} = {}) {
  const startedMs = now();
  const started_at = timestamp(() => startedMs);
  let config;
  let orders;
  try {
    config = loadConfig(env);
    orders = await readOrders(paths.ordersPath);
  } catch (error) {
    log({ at: timestamp(now), event: 'run failed', city: 'orders', category: error.category || 'input_validation' });
    return { exitCode: 1, fatal: error.category || 'input_validation' };
  }

  const processing = await processOrders(orders, {
    ...config,
    ...weatherOptions,
    fetchImpl,
    now,
    sleep,
    log,
  });
  const finishedMs = now();
  const report = {
    ...processing.report,
    started_at,
    finished_at: timestamp(() => finishedMs),
    duration_ms: Math.max(0, finishedMs - startedMs),
    source: fetchImpl === fetch ? (source || 'live_openweathermap') : (source && source !== 'live_openweathermap' ? source : 'controlled_injected_transport'),
  };

  try {
    await writeOrders(paths.ordersPath, processing.orders);
    await mkdir(dirname(paths.reportPath), { recursive: true });
    await writeReport(paths.reportPath, report);
  } catch {
    log({ at: timestamp(now), event: 'run failed', city: 'orders', category: 'persistence' });
    return { exitCode: 1, fatal: 'persistence', report };
  }

  log({ at: report.finished_at, event: `run ${report.status}`, city: 'orders' });
  return { exitCode: report.status === 'complete' ? 0 : 2, report, orders: processing.orders };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  process.exitCode = result.exitCode;
}
