import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, hash } from './util.mjs';

const COOKIE='parallax_session';
const devKey=globalThis[Symbol.for('parallax.dev-secret')] ??= randomBytes(32).toString('hex');
function secret() {
  const value=process.env.PARALLAX_SESSION_SECRET;
  if(process.env.VERCEL && (!value || value.length<32))throw new AppError('SESSION_NOT_CONFIGURED','The deployment needs its workspace signing secret.',503);
  return value && value.length>=32?value:devKey;
}
function sign(encoded) { return createHmac('sha256',secret()).update(encoded).digest('base64url'); }
export function contextFor(visitor,tenant='acme') {
  if(!['acme','nova'].includes(tenant))throw new AppError('INVALID_TENANT','Choose Acme Orbit or Nova Labs.');
  return {visitor,tenant,actor:'You · demo reviewer',graphName:`parallax_${hash(`${visitor}:${tenant}:${secret()}`).slice(0,32)}`};
}
export function sessionFor(request) {
  const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  let session;
  if(cookie) {
    const [encoded,sig]=cookie.split('.');
    if(encoded && sig) {
      const expected=sign(encoded);
      if(sig.length===expected.length && timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) {
        try { const parsed=JSON.parse(Buffer.from(encoded,'base64url').toString()); if(parsed.exp>Date.now() && /^[a-f0-9]{32}$/.test(parsed.visitor) && ['acme','nova'].includes(parsed.tenant))session=parsed; }catch{}
      }
    }
  }
  const isNew=!session;
  session??={visitor:randomBytes(16).toString('hex'),tenant:'acme',exp:Date.now()+7*86400000};
  return {...contextFor(session.visitor,session.tenant),isNew,session};
}
export function sessionCookie(context) {
  const encoded=Buffer.from(JSON.stringify({...context.session,tenant:context.tenant})).toString('base64url');
  return `${COOKIE}=${encoded}.${sign(encoded)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.VERCEL?'; Secure':''}`;
}
export function checkOrigin(request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)throw new AppError('ORIGIN_REJECTED','This request must come from the workspace.',403);
}
export function checkAccess(request) {
  const access=process.env.PARALLAX_ACCESS_TOKEN;
  if(access && request.headers.get('x-parallax-access-token')!==access)throw new AppError('ACCESS_REQUIRED','This deployment requires a workspace access token.',401);
}
