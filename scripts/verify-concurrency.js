import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from '../src/json-store.js';
import { runTransportConcurrencyProof } from '../test/support/transport-proof.js';

const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const report = await runTransportConcurrencyProof();
await writeJsonAtomically(`${directory}/evidence/concurrency-report.json`, report);
console.log('Controlled concurrency proof written to evidence/concurrency-report.json.');
