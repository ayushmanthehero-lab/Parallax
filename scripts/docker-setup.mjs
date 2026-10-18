import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const requiredSecrets = ['FALKORDB_PASSWORD', 'PARALLAX_SESSION_SECRET', 'PARALLAX_MCP_TOKEN', 'FALKORDB_BROWSER_SECRET'];

export async function setupDockerEnvironment(path = fileURLToPath(new URL('../.env.docker.local', import.meta.url))) {
  const secrets = requiredSecrets.map(name => `${name}=${randomBytes(32).toString('hex')}`);
  const content = [
    '# Private local Docker settings. Keep this file private and retain it across restarts.',
    '# The session secret is needed to find your existing browser workspace.',
    ...secrets,
    'PARALLAX_PORT=3000',
    'PARALLAX_DB_PORT=6379',
    'FALKORDB_BROWSER_PORT=3002',
    'FALKORDB_BROWSER_ENABLED=1',
    '',
  ].join('\n');
  try {
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    return { created: true, path };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(path, 'utf8');
    for (const name of requiredSecrets) {
      if (!new RegExp(`^${name}=[a-f0-9]{64}$`, 'm').test(existing)) {
        throw new Error(`Existing local environment is missing a valid ${name}. It was left unchanged; repair that setting before starting Docker.`);
      }
    }
    return { created: false, path };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await setupDockerEnvironment();
    console.log(result.created ? 'Created private .env.docker.local with fresh local secrets.' : 'Using existing .env.docker.local; all secrets retained.');
    console.log('Start: docker compose --env-file .env.docker.local up --build --wait');
    console.log('Open:  http://localhost:3000');
    console.log('Graph: http://localhost:3002');
    console.log('Check: docker compose --env-file .env.docker.local exec app node deploy/local/verify.mjs');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
