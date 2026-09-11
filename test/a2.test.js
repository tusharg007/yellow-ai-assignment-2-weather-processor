import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../index.js';
import { weatherAwareApology } from '../src/apology.js';
import { shouldDelay } from '../src/delay-policy.js';
import { writeOrdersAtomically } from '../src/json-store.js';
import { processOrders } from '../src/process-orders.js';
import { cityQuery, fetchWeather } from '../src/weather-client.js';
import { runTransportConcurrencyProof } from './support/transport-proof.js';

const response = (body, { status = 200, retryAfter } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => name === 'retry-after' ? retryAfter || null : null },
  json: async () => body,
});
const weather = (main, description) => response({ weather: [{ main, description }] });
const baseline = [
  { order_id: '1001', customer: 'Alice Smith', city: 'New York', status: 'Pending' },
  { order_id: '1002', customer: 'Bob Jones', city: 'Mumbai', status: 'Pending' },
  { order_id: '1003', customer: 'Charlie Green', city: 'London', status: 'Pending' },
  { order_id: '1004', customer: 'InvalidCity123', city: 'InvalidCity123', status: 'Pending' },
];

async function temporaryRunDir() {
  const directory = await mkdtemp(join(tmpdir(), 'a2-'));
  return {
    directory,
    ordersPath: join(directory, 'orders.json'),
    reportPath: join(directory, 'report.json'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('immutable baseline has the exact four supplied identities and initial statuses', async () => {
  const stored = JSON.parse(await readFile(new URL('../orders.input.json', import.meta.url), 'utf8'));
  assert.deepEqual(stored, baseline);
});

test('only the exact delay categories trigger the deterministic policy', () => {
  for (const main of ['Rain', 'Snow', 'Extreme']) assert.equal(shouldDelay(main), true);
  for (const main of ['Clear', 'Clouds', 'Thunderstorm', 'Drizzle']) assert.equal(shouldDelay(main), false);
});

test('processor applies Rain, Snow, Extreme and produces truthful apologies only for new delays', async () => {
  const orders = [
    { ...baseline[0], city: 'Rain City', priority_note: 'preserve me' },
    { ...baseline[1], city: 'Snow City' },
    { ...baseline[2], city: 'Extreme City' },
    { ...baseline[3], customer: 'Dana White', city: 'Clear City' },
  ];
  const fixtures = {
    'Rain City': weather('Rain', 'light rain'),
    'Snow City': weather('Snow'),
    'Extreme City': weather('Extreme'),
    'Clear City': weather('Clear', 'clear sky'),
  };
  const result = await processOrders(orders, {
    apiKey: 'test-key', fetchImpl: (url) => fixtures[url.searchParams.get('q')], log: () => {},
  });
  assert.deepEqual(result.orders.map((order) => order.status), ['Delayed', 'Delayed', 'Delayed', 'Pending']);
  assert.equal(result.orders[0].weather_apology, undefined);
  assert.match(result.report.orders[0].apology, /Hi Alice, your order to Rain City is delayed due to light rain/);
  assert.match(result.report.orders[1].apology, /due to snow/);
  assert.match(result.report.orders[2].apology, /due to extreme weather/);
  assert.equal(result.report.orders[3].apology, undefined);
  assert.equal(result.orders[0].priority_note, 'preserve me');
});

test('apology preserves a validated description and uses a safe category fallback', () => {
  assert.match(weatherAwareApology(baseline[0], { main: 'Rain', description: 'light rain' }), /light rain/);
  assert.match(weatherAwareApology(baseline[0], { main: 'Extreme' }), /extreme weather/);
});

test('weather client encodes the specified city query and validates malformed provider data', async () => {
  let requestUrl;
  const result = await fetchWeather('New York', {
    apiKey: 'test-key',
    fetchImpl: async (url) => { requestUrl = url; return weather('Clouds', 'scattered clouds'); },
  });
  assert.equal(cityQuery('New York'), 'New York,US');
  assert.equal(requestUrl.searchParams.get('q'), 'New York,US');
  assert.equal(requestUrl.searchParams.get('units'), 'metric');
  assert.equal(requestUrl.searchParams.get('lang'), 'en');
  assert.equal(result.ok, true);
  const malformed = await fetchWeather('Mumbai', { apiKey: 'test-key', fetchImpl: async () => response({ weather: [] }) });
  assert.equal(malformed.error.category, 'malformed_response');
  const invalidJson = await fetchWeather('London', { apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) });
  assert.equal(invalidJson.error.category, 'malformed_response');
});

test('401 and 404 do not retry; 429 uses delta-seconds or defers without Retry-After', async () => {
  let calls = 0;
  const unauthorized = await fetchWeather('New York', { apiKey: 'test-key', fetchImpl: async () => { calls += 1; return response({}, { status: 401 }); } });
  assert.equal(unauthorized.error.category, 'authentication');
  assert.equal(calls, 1);
  const notFound = await fetchWeather('InvalidCity123', { apiKey: 'test-key', fetchImpl: async () => response({}, { status: 404 }) });
  assert.equal(notFound.error.category, 'not_found');
  const waits = [];
  let clock = 1_000;
  calls = 0;
  const limited = await fetchWeather('Mumbai', {
    apiKey: 'test-key', now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; },
    fetchImpl: async () => (calls += 1) === 1 ? response({}, { status: 429, retryAfter: '1' }) : weather('Clouds', 'cloudy'),
  });
  assert.equal(limited.ok, true);
  assert.deepEqual(waits, [1_000]);
  const deferred = await fetchWeather('Mumbai', {
    apiKey: 'test-key', now: () => 1_000, runDeadlineMs: 500, sleep: async () => assert.fail('must not sleep'),
    fetchImpl: async () => response({}, { status: 429, retryAfter: '1' }),
  });
  assert.equal(deferred.error.deferred, true);
  calls = 0;
  const noHeader = await fetchWeather('Mumbai', {
    apiKey: 'test-key', sleep: async () => assert.fail('must not sleep without a usable Retry-After value'),
    fetchImpl: async () => { calls += 1; return response({}, { status: 429 }); },
  });
  assert.equal(calls, 1);
  assert.equal(noHeader.error.category, 'rate_limited');
  assert.equal(noHeader.error.deferred, true);
});

test('HTTP-date Retry-After uses the injected clock and does not start a retry at the deadline', async () => {
  let clock = Date.UTC(2026, 0, 1, 0, 0, 0);
  const waits = [];
  let calls = 0;
  const httpDate = new Date(clock + 2_000).toUTCString();
  const retried = await fetchWeather('Mumbai', {
    apiKey: 'test-key', now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; },
    fetchImpl: async () => (calls += 1) === 1 ? response({}, { status: 429, retryAfter: httpDate }) : weather('Clouds', 'cloudy'),
  });
  assert.equal(retried.ok, true);
  assert.deepEqual(waits, [2_000]);
  clock = 0;
  calls = 0;
  const deadline = await fetchWeather('London', {
    apiKey: 'test-key', runDeadlineMs: 100, now: () => clock, sleep: async (ms) => { clock += ms; },
    fetchImpl: async () => { calls += 1; return response({}, { status: 500 }); },
  });
  assert.equal(calls, 1);
  assert.equal(deadline.error.category, 'server_error');
  assert.equal(deadline.error.deferred, true);
});

test('transient retry backoff never sleeps beyond the strict run deadline', async () => {
  for (const firstAttempt of [
    async () => response({}, { status: 500 }),
    async () => { throw new Error('offline'); },
    async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
  ]) {
    let clock = 0;
    let calls = 0;
    const result = await fetchWeather('London', {
      apiKey: 'test-key', runDeadlineMs: 100, now: () => clock,
      sleep: async () => assert.fail('must not sleep after the attempt consumes the deadline'),
      fetchImpl: async () => { calls += 1; clock += 100; return firstAttempt(); },
    });
    assert.equal(calls, 1);
    assert.equal(result.error.deferred, true);
  }

  let clock = 0;
  let calls = 0;
  const insufficient = await fetchWeather('London', {
    apiKey: 'test-key', runDeadlineMs: 100, now: () => clock,
    sleep: async () => assert.fail('must not sleep when 100 ms backoff does not fit inside 99 ms'),
    fetchImpl: async () => { calls += 1; clock += 1; return response({}, { status: 500 }); },
  });
  assert.equal(calls, 1);
  assert.equal(insufficient.error.deferred, true);

  clock = 0;
  calls = 0;
  const waits = [];
  const retried = await fetchWeather('London', {
    apiKey: 'test-key', runDeadlineMs: 500, now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    fetchImpl: async () => (calls += 1) === 1 ? response({}, { status: 500 }) : weather('Clouds', 'cloudy'),
  });
  assert.equal(retried.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [100]);
});

test('500, network failure, and timeout retry exactly once then return classified failures', async () => {
  let calls = 0;
  const server = await fetchWeather('London', {
    apiKey: 'test-key', sleep: async () => {}, fetchImpl: async () => { calls += 1; return response({}, { status: 500 }); },
  });
  assert.equal(server.error.category, 'server_error');
  assert.equal(calls, 2);
  calls = 0;
  const network = await fetchWeather('London', {
    apiKey: 'test-key', sleep: async () => {}, fetchImpl: async () => { calls += 1; throw new Error('offline'); },
  });
  assert.equal(network.error.category, 'network');
  assert.equal(calls, 2);
  calls = 0;
  const timeout = await fetchWeather('London', {
    apiKey: 'test-key', timeoutMs: 5, sleep: async () => {},
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      calls += 1;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(timeout.error.category, 'timeout');
  assert.equal(calls, 2);
});

test('all orders start concurrently, preserve input order despite completion order, and isolate InvalidCity123', async () => {
  const starts = [];
  const release = new Map();
  const resultPromise = processOrders(baseline, {
    apiKey: 'test-key', log: () => {},
    fetchImpl: async (url) => {
      const city = url.searchParams.get('q');
      starts.push(city);
      return new Promise((resolve) => {
        release.set(city, () => {
          if (city === 'InvalidCity123') resolve(response({}, { status: 404 }));
          else if (city === 'New York,US') resolve(weather('Rain', 'rain'));
          else resolve(weather('Clouds', 'cloudy'));
        });
      });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['New York,US', 'Mumbai,IN', 'London,GB', 'InvalidCity123']);
  ['InvalidCity123', 'London,GB', 'Mumbai,IN', 'New York,US'].forEach((city) => release.get(city)());
  const result = await resultPromise;
  assert.deepEqual(result.orders.map((order) => order.order_id), ['1001', '1002', '1003', '1004']);
  assert.deepEqual(result.orders.map((order) => order.status), ['Delayed', 'Pending', 'Pending', 'Pending']);
  assert.equal(result.report.expected_failures, 1);
  assert.equal(result.report.unexpected_failures, 0);
});

test('local HTTP transport receives all four requests before any response is released', async () => {
  const proof = await runTransportConcurrencyProof();
  assert.equal(proof.proof_passed, true);
  assert.equal(proof.request_count, 4);
  assert.equal(proof.result.succeeded, 3);
  assert.equal(proof.result.expected_failures, 1);
});

test('a rejected processOrder task preserves order data and emits a null-timing fallback record', async () => {
  let cityReads = 0;
  const rejectedOrder = {
    order_id: 'rejected', customer: 'Rejected Customer', status: 'Pending',
    get city() {
      cityReads += 1;
      if (cityReads === 2) throw new Error('deliberate pre-try rejection');
      return 'Rejected City';
    },
  };
  const orders = [{ ...baseline[0] }, rejectedOrder, { ...baseline[2] }];
  const result = await processOrders(orders, {
    apiKey: 'test-key', log: () => {}, fetchImpl: async () => weather('Clouds', 'cloudy'),
  });
  assert.deepEqual(result.orders.map((order) => order.order_id), ['1001', 'rejected', '1003']);
  assert.equal(result.orders[1].status, 'Pending');
  assert.equal(result.report.succeeded, 2);
  assert.equal(result.report.unexpected_failures, 1);
  assert.deepEqual(Object.keys(result.report.orders[1]).sort(), [
    'city', 'duration_ms', 'error', 'finished_at', 'order_id', 'retry_count', 'started_at',
  ]);
  assert.equal(result.report.orders[1].started_at, null);
  assert.equal(result.report.orders[1].finished_at, null);
  assert.equal(result.report.orders[1].duration_ms, null);
  assert.equal(result.report.orders[1].error.category, 'unexpected_error');
});

test('malformed input produces no output write and atomic replacement failure preserves existing bytes', async () => {
  const temp = await temporaryRunDir();
  try {
    await writeFile(temp.ordersPath, '{invalid', 'utf8');
    const original = await readFile(temp.ordersPath, 'utf8');
    const runResult = await run({ env: { OPENWEATHERMAP_API_KEY: 'test-key' }, paths: temp, log: () => {} });
    assert.equal(runResult.exitCode, 1);
    assert.equal(await readFile(temp.ordersPath, 'utf8'), original);
    await writeFile(temp.ordersPath, JSON.stringify(baseline), 'utf8');
    const beforeReplacement = await readFile(temp.ordersPath, 'utf8');
    await assert.rejects(() => writeOrdersAtomically(temp.ordersPath, [{ ...baseline[0], status: 'Delayed' }], {
      renameImpl: async () => { throw new Error('replace blocked'); },
    }));
    assert.equal(await readFile(temp.ordersPath, 'utf8'), beforeReplacement);
  } finally { await temp.cleanup(); }
});

test('rerun is stable and logs/reports never contain the configured key', async () => {
  const temp = await temporaryRunDir();
  const secret = 'super-secret-test-value';
  const logs = [];
  try {
    await writeFile(temp.ordersPath, JSON.stringify(baseline), 'utf8');
    const fetchImpl = async (url) => url.searchParams.get('q') === 'InvalidCity123'
      ? response({}, { status: 404 })
      : weather(url.searchParams.get('q') === 'New York,US' ? 'Rain' : 'Clouds', 'light rain');
    const options = { env: { OPENWEATHERMAP_API_KEY: secret }, paths: temp, fetchImpl, log: (event) => logs.push(JSON.stringify(event)) };
    const first = await run(options);
    const firstOutput = await readFile(temp.ordersPath, 'utf8');
    const second = await run(options);
    assert.equal(first.exitCode, 0);
    assert.equal(second.exitCode, 0);
    assert.equal(await readFile(temp.ordersPath, 'utf8'), firstOutput);
    assert.equal(JSON.stringify(second.report).includes(secret), false);
    assert.equal(logs.join('\n').includes(secret), false);
  } finally { await temp.cleanup(); }
});

test('an injected transport is labelled controlled rather than live', async () => {
  const temp = await temporaryRunDir();
  try {
    await writeFile(temp.ordersPath, JSON.stringify(baseline), 'utf8');
    const result = await run({
      env: { OPENWEATHERMAP_API_KEY: 'test-key' },
      paths: temp,
      log: () => {},
      fetchImpl: async (url) => url.searchParams.get('q') === 'InvalidCity123'
        ? response({}, { status: 404 })
        : weather('Clouds', 'cloudy'),
    });
    assert.equal(result.report.source, 'controlled_injected_transport');
  } finally { await temp.cleanup(); }
});
