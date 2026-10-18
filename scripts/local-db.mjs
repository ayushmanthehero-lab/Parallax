import { FalkorDB } from 'falkordblite';
import { FalkorDB as Client } from 'falkordb';
import { mkdir, writeFile, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';

const directory=process.env.PARALLAX_DB_PATH || '/tmp/parallax-falkordb';
await mkdir(directory,{recursive:true});
const db=await FalkorDB.open({path:directory,additionalConfig:{appendonly:'yes',appendfsync:'everysec'}});
const client=await Client.connect({socket:{path:db.socketPath}});
const connection=await client.connection;
const stableSocket=path.join(directory,'redis.sock');
await unlink(stableSocket).catch(()=>{});
await symlink(db.socketPath,stableSocket);
console.log('PARALLAX local FalkorDB is running.');
console.log('Unix socket:',stableSocket);
await writeFile(path.join(directory,'connection.json'),JSON.stringify({socket:stableSocket,directory}));
console.log('Use this socket as FALKORDB_SOCKET. Keep this process running.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await connection.sendCommand(['SAVE']).catch(()=>{});await client.close();await db.close();process.exit(0);});
setInterval(()=>{},30000);
