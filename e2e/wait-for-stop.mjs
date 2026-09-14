// Owned fixture stimulus only; expiry never grants permission to continue.
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const [receipt, token, seconds = '300'] = process.argv.slice(2);
const duration = Number(seconds);
if (!isAbsolute(receipt ?? '') || !token || !Number.isInteger(duration) || duration < 1 || duration > 600) {
  throw new Error('Usage: node wait-for-stop.mjs <absolute-receipt> <token> [1..600 seconds]');
}
writeFileSync(receipt, JSON.stringify({ token, pid: process.pid, readyAt: new Date().toISOString(),
  expiresAfterSeconds: duration }) + '\n', { flag: 'wx' });
const timer = setTimeout(() => { process.stderr.write('STOP_BOUNDARY_EXPIRED\n'); process.exit(2); }, duration * 1000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  clearTimeout(timer);
  process.stderr.write(`STOP_BOUNDARY_SIGNAL: ${signal}\n`);
  process.exit(signal === 'SIGTERM' ? 143 : 130);
});
