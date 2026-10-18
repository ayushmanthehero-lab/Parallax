import { randomBytes } from 'node:crypto';
import { contextFor } from '../../lib/server/session.mjs';
import { runVerification } from '../../lib/server/verification.mjs';
import { graphFor, closeDatabase } from '../../lib/server/db.mjs';

// Run inside the app container. This checks the running HTTP service and uses
// the same direct database settings for an isolated, disposable workflow graph.
const origin = process.env.PARALLAX_VERIFY_ORIGIN || 'http://127.0.0.1:3000';
const ctx = contextFor(randomBytes(16).toString('hex'), 'acme');
let graphCreated = false;
try {
  const response = await fetch(new URL('/api/health', origin), { signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok || !body.ok || body.data?.status !== 'connected' || body.data?.engine !== 'FalkorDB' || !body.data?.persistent) {
    throw new Error('The running app did not report a connected, persistent FalkorDB database.');
  }
  console.log(`HTTP health: FalkorDB ${body.data.version}, ${body.data.transport}, ${body.data.persistence}`);
  graphCreated = true;
  const report = await runVerification(ctx);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (graphCreated) await (await graphFor(ctx)).delete().catch(() => {});
  await closeDatabase();
}
