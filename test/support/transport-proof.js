import { createServer } from 'node:http';
import { processOrders } from '../../src/process-orders.js';

const orders = [
  { order_id: '1001', customer: 'Alice Smith', city: 'New York', status: 'Pending' },
  { order_id: '1002', customer: 'Bob Jones', city: 'Mumbai', status: 'Pending' },
  { order_id: '1003', customer: 'Charlie Green', city: 'London', status: 'Pending' },
  { order_id: '1004', customer: 'InvalidCity123', city: 'InvalidCity123', status: 'Pending' },
];

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runTransportConcurrencyProof() {
  const proofDeadlineMs = 750;
  const arrivals = [];
  const heldResponses = [];
  let allArrived;
  const allArrivedPromise = new Promise((resolve) => { allArrived = resolve; });
  const server = createServer((request, response) => {
    const cityQuery = new URL(request.url, 'http://127.0.0.1').searchParams.get('city');
    arrivals.push({ city_query: cityQuery, received_at: new Date().toISOString(), received_ms: Date.now() });
    heldResponses.push({ cityQuery, response });
    if (heldResponses.length === orders.length) allArrived();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const processing = processOrders(orders, {
      apiKey: 'controlled-transport-key',
      timeoutMs: 1_000,
      log: () => {},
      fetchImpl: (providerUrl, options) => {
        const city = providerUrl.searchParams.get('q');
        return fetch(`http://127.0.0.1:${port}/weather?city=${encodeURIComponent(city)}`, options);
      },
    });
    await Promise.race([
      allArrivedPromise,
      waitFor(proofDeadlineMs).then(() => { throw new Error('Local server did not receive all four requests before the proof deadline.'); }),
    ]);
    const released_at = new Date().toISOString();
    for (const { cityQuery, response } of heldResponses) {
      if (cityQuery === 'InvalidCity123') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'city not found' }));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ weather: [{ main: 'Clouds', description: 'controlled clouds' }] }));
      }
    }
    const result = await processing;
    const arrivalTimes = arrivals.map((arrival) => arrival.received_ms);
    return {
      label: 'CONTROLLED LOCAL TRANSPORT PROOF / NOT LIVE WEATHER',
      proof_method: 'A local HTTP server holds every response until all four requests arrive; it throws if they do not arrive before the finite deadline.',
      proof_deadline_ms: proofDeadlineMs,
      proof_passed: heldResponses.length === orders.length,
      request_count: arrivals.length,
      arrival_span_ms: Math.max(...arrivalTimes) - Math.min(...arrivalTimes),
      arrivals: arrivals.map(({ city_query, received_at }) => ({ city_query, received_at })),
      responses_released_at: released_at,
      result: {
        attempted: result.report.attempted,
        succeeded: result.report.succeeded,
        expected_failures: result.report.expected_failures,
        unexpected_failures: result.report.unexpected_failures,
      },
    };
  } finally {
    for (const { response } of heldResponses) if (!response.writableEnded) response.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}
