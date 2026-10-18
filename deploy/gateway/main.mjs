import { FalkorDB as FalkorDBLite } from 'falkordblite';
import { FalkorDB } from 'falkordb';
import { createRequire } from 'node:module';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGatewayServer, validateGatewayToken } from './server.mjs';

const require = createRequire(import.meta.url);
let active;

/** One embedded process owns the attached volume; never open a DB per request. */
export async function startGateway({
  dataDir = process.env.FALKORDB_DATA_DIR || '/data',
  token = process.env.FALKORDB_GATEWAY_TOKEN,
  port = Number(process.env.PORT || 8080),
  host = '0.0.0.0',
} = {}) {
  validateGatewayToken(token);
  if (active) throw new Error('A FalkorDB gateway is already running in this process.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This gateway image requires Linux x64.');
  const directory = resolve(dataDir);
  if (process.env.RAILWAY_ENVIRONMENT_ID && resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/unmounted') !== directory) {
    throw new Error('Attach a Railway persistent volume at FALKORDB_DATA_DIR before starting the gateway.');
  }
  active = true;
  let embedded, db, server;
  try {
    process.umask(0o077);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o700);
    const binaries = join(dirname(require.resolve('@falkordblite/linux-x64/package.json')), 'bin');
    const signalListeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
    embedded = await FalkorDBLite.open({
      path: directory,
      redisServerPath: join(binaries, 'redis-server'), modulePath: join(binaries, 'falkordb.so'),
      timeout: 20000, logLevel: 'warning',
      additionalConfig: {
        port: '0', bind: '127.0.0.1', unixsocketperm: '700',
        appendonly: 'yes', appendfsync: 'always', 'no-appendfsync-on-rewrite': 'no',
        'aof-use-rdb-preamble': 'yes', 'aof-load-truncated': 'no',
        save: '60 1', 'stop-writes-on-bgsave-error': 'yes',
      },
    });
    // Lite 0.3.0 registers SHUTDOWN NOSAVE signal handlers that race the
    // gateway's HTTP drain. Remove only listeners added by this open call;
    // preserve prior application handlers and Lite's last-resort exit cleanup.
    // The standalone entry below owns drain -> SAVE -> client/database close.
    for (const [signal, previous] of signalListeners) {
      for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.removeListener(signal, listener);
    }
    db = await FalkorDB.connect({ socket: { path: embedded.socketPath, connectTimeout: 5000, reconnectStrategy: false } });
    // There are no unbounded schema operations either: the module default also
    // covers index commands whose SDK helpers do not accept TIMEOUT options.
    await db.configSet('TIMEOUT', 15000);
    db.on('error', () => { console.error('The private FalkorDB connection was interrupted.'); });
    const durableVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH === directory || process.env.FALKORDB_DURABLE_VOLUME === 'true';
    server = createGatewayServer({ db, token, durableVolume });
    await new Promise((resolveListening, reject) => { server.once('error', reject); server.listen(port, host, resolveListening); });
    let closing;
    async function close() {
      return closing ??= (async () => {
        await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
        try {
          const connection = await db.connection;
          await connection.sendCommand(['SAVE']);
        } finally {
          try { await db.close(); }
          finally { await embedded.close(); active = false; }
        }
      })();
    }
    return { server, close };
  } catch (error) {
    if (server?.listening) await new Promise(resolveClosed => server.close(resolveClosed));
    if (db) await db.close().catch(() => {});
    if (embedded) await embedded.close().catch(() => {});
    active = false;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const gateway = await startGateway();
    console.log(`PARALLAX FalkorDB gateway ready on port ${gateway.server.address().port}.`);
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      const forced = setTimeout(() => { console.error('Gateway shutdown exceeded its drain period.'); process.exit(1); }, 28000).unref();
      try { await gateway.close(); clearTimeout(forced); process.exit(0); }
      catch { console.error('Gateway could not complete its graceful database shutdown.'); process.exit(1); }
    });
  } catch {
    console.error('Gateway startup failed. Check the attached volume, pinned binaries, and required environment settings.');
    process.exit(1);
  }
}
