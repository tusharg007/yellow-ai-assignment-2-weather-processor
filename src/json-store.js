import { basename, dirname, join } from 'node:path';
import { open, readFile, rename, rm } from 'node:fs/promises';

export function validateOrders(value) {
  if (!Array.isArray(value)) throw new Error('Orders input must be a JSON array.');
  const ids = new Set();
  value.forEach((order, index) => {
    if (!order || typeof order !== 'object' || Array.isArray(order)) throw new Error(`Order ${index} must be an object.`);
    for (const field of ['order_id', 'customer', 'city', 'status']) {
      if (typeof order[field] !== 'string' || !order[field].trim()) throw new Error(`Order ${index} has an invalid ${field}.`);
    }
    if (ids.has(order.order_id)) throw new Error(`Duplicate order_id: ${order.order_id}.`);
    ids.add(order.order_id);
  });
  return value;
}

export async function readOrders(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read valid orders JSON: ${error instanceof SyntaxError ? 'invalid JSON.' : 'file read failed.'}`);
  }
  return validateOrders(parsed);
}

async function atomicWrite(filePath, payload, validate, { renameImpl = rename } = {}) {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'w');
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    validate(JSON.parse(await readFile(temporaryPath, 'utf8')));
    await renameImpl(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeOrdersAtomically(filePath, orders, options) {
  validateOrders(orders);
  await atomicWrite(filePath, `${JSON.stringify(orders, null, 2)}\n`, validateOrders, options);
}

export async function writeJsonAtomically(filePath, value, options) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`, () => {}, options);
}
