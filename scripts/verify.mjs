import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { contextFor } from '../lib/server/session.mjs';
import { runVerification } from '../lib/server/verification.mjs';
import { graphFor, closeDatabase } from '../lib/server/db.mjs';

const ctx=contextFor(randomBytes(16).toString('hex'),'acme');
try {
  const report=await runVerification(ctx);
  await mkdir('reports',{recursive:true});
  await writeFile('reports/verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='passed')process.exitCode=1;
} finally {await(await graphFor(ctx)).delete().catch(()=>{});await closeDatabase();}
