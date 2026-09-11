// CONTROLLED TEST DATA / NOT LIVE WEATHER.
// Uses the production processOrders logic with a fixture-backed fetch implementation.
import { writeFile } from 'node:fs/promises';
import { processOrders } from '../../src/process-orders.js';

const orders = [
  { order_id: 'controlled-1001', customer: 'Alice Smith', city: 'Rain City', status: 'Pending' },
  { order_id: 'controlled-1002', customer: 'Bob Jones', city: 'Snow City', status: 'Pending' },
  { order_id: 'controlled-1003', customer: 'Charlie Green', city: 'Extreme City', status: 'Pending' },
  { order_id: 'controlled-1004', customer: 'Dana White', city: 'Clear City', status: 'Pending' },
];

const fixtureWeather = {
  'Rain City': { main: 'Rain', description: 'rain' },
  'Snow City': { main: 'Snow', description: 'snow' },
  'Extreme City': { main: 'Extreme', description: 'extreme weather' },
  'Clear City': { main: 'Clear', description: 'clear sky' },
};

const fixtureFetch = async (url) => ({
  ok: true,
  json: async () => ({ weather: [fixtureWeather[url.searchParams.get('q')]] }),
});

const updated = await processOrders(orders, {
  apiKey: 'controlled-test-key',
  fetchImpl: fixtureFetch,
  log: () => {},
});

await writeFile(
  new URL('./orders.json', import.meta.url),
  `${JSON.stringify({
    label: 'CONTROLLED TEST DATA / NOT LIVE WEATHER',
    orders: updated.orders,
    report: updated.report,
  }, null, 2)}\n`,
);
