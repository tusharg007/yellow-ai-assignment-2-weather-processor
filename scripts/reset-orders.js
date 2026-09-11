import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOrders, writeOrdersAtomically } from '../src/json-store.js';

const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const baseline = await readOrders(`${directory}/orders.input.json`);
await writeOrdersAtomically(`${directory}/orders.json`, baseline);
console.log('orders.json reset from immutable orders.input.json.');
