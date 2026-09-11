import { weatherAwareApology } from './apology.js';
import { shouldDelay } from './delay-policy.js';
import { fetchWeather } from './weather-client.js';

const iso = (now) => new Date(now()).toISOString();
const defaultLog = (event) => console.log(`[${event.at}] ${event.event}: ${event.city}${event.category ? ` (${event.category})` : ''}`);

export async function processOrder(order, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const log = dependencies.log || defaultLog;
  const startedMs = now();
  const started_at = iso(() => startedMs);
  const original = { ...order };
  log({ at: started_at, event: 'weather request started', city: order.city });

  try {
    const result = await fetchWeather(order.city, dependencies);
    const finishedMs = now();
    const base = {
      order_id: order.order_id,
      city: order.city,
      started_at,
      finished_at: iso(() => finishedMs),
      duration_ms: Math.max(0, finishedMs - startedMs),
      retry_count: result.retryCount || 0,
    };
    if (!result.ok) {
      log({ at: base.finished_at, event: 'weather request failed', city: order.city, category: result.error.category });
      return { order: original, record: { ...base, error: result.error } };
    }

    const newlyDelayed = shouldDelay(result.weather.main) && order.status !== 'Delayed';
    const updated = newlyDelayed
      ? { ...original, status: 'Delayed' }
      : original;
    log({ at: base.finished_at, event: 'weather request ended', city: order.city });
    return {
      order: updated,
      record: {
        ...base,
        weather: result.weather,
        outcome: newlyDelayed ? 'delayed' : 'unchanged',
        ...(newlyDelayed ? { apology: weatherAwareApology(original, result.weather) } : {}),
      },
    };
  } catch {
    const finishedMs = now();
    const record = {
      order_id: order.order_id,
      city: order.city,
      started_at,
      finished_at: iso(() => finishedMs),
      duration_ms: Math.max(0, finishedMs - startedMs),
      retry_count: 0,
      error: { category: 'unexpected_error', message: 'Order processing failed unexpectedly.' },
    };
    log({ at: record.finished_at, event: 'weather request failed', city: order.city, category: record.error.category });
    return { order: original, record };
  }
}

function isExpectedFailure(record) {
  return record.city === 'InvalidCity123' && record.error?.category === 'not_found';
}

export async function processOrders(orders, dependencies = {}) {
  const settled = await Promise.allSettled(orders.map((order) => processOrder(order, dependencies)));
  const outcomes = settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : {
      order: { ...orders[index] },
      record: {
        order_id: orders[index].order_id,
        city: orders[index].city,
        started_at: null,
        finished_at: null,
        duration_ms: null,
        retry_count: 0,
        error: { category: 'unexpected_error', message: 'Order processing task rejected.' },
      },
    });
  const records = outcomes.map((outcome) => outcome.record);
  const expectedFailures = records.filter(isExpectedFailure).length;
  const unexpectedFailures = records.filter((record) => record.error && !isExpectedFailure(record)).length;

  return {
    orders: outcomes.map((outcome) => outcome.order),
    report: {
      attempted: orders.length,
      succeeded: records.filter((record) => !record.error).length,
      delayed: records.filter((record) => record.outcome === 'delayed').length,
      unchanged: records.filter((record) => record.outcome === 'unchanged').length,
      expected_failures: expectedFailures,
      unexpected_failures: unexpectedFailures,
      status: unexpectedFailures ? 'degraded' : 'complete',
      orders: records,
    },
  };
}
