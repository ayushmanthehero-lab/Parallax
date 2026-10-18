const GRAPH_NAME = /^parallax_[a-f0-9]{24,40}$/;

/** A small server-only transport for the authenticated, explicit gateway API. */
export function createHttpDatabase({ url = process.env.FALKORDB_HTTP_URL, token = process.env.FALKORDB_GATEWAY_TOKEN } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('FALKORDB_HTTP_URL must be a valid HTTPS URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) throw new Error('FALKORDB_HTTP_URL must use HTTPS except for a local loopback gateway.');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('The gateway URL must be an origin without credentials, a path, or URL parameters.');
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32 || Buffer.byteLength(token) > 1024 || /\s/.test(token)) throw new Error('FALKORDB_GATEWAY_TOKEN must be a private token of at least 32 bytes without whitespace.');
  let closed = false;
  async function request(path, method = 'GET', body) {
    if (closed) throw new Error('The FalkorDB HTTP adapter has been closed.');
    let response;
    try {
      response = await fetch(new URL(path, endpoint), {
        method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store', credentials: 'omit',
      });
    } catch { throw new Error('The FalkorDB gateway could not be reached securely.'); }
    let payload;
    try { payload = await response.json(); } catch { throw new Error('The FalkorDB gateway returned an invalid response.'); }
    if (!response.ok) {
      const error = new Error(typeof payload?.error?.message === 'string' ? payload.error.message : 'The FalkorDB gateway operation failed.');
      error.code = payload?.error?.code || 'GATEWAY_UNAVAILABLE'; error.status = response.status;
      throw error;
    }
    return payload;
  }
  return Object.freeze({
    selectGraph(name) {
      if (typeof name !== 'string' || !GRAPH_NAME.test(name)) throw new Error('A server-selected workspace graph is required.');
      const path = `/v1/graphs/${name}`;
      const operation = async (suffix, body) => (await request(`${path}/${suffix}`, 'POST', body)).result;
      return Object.freeze({
        query: (query, { params = {}, TIMEOUT = 5000 } = {}) => operation('query', { query, params, timeout: TIMEOUT }),
        roQuery: (query, { params = {}, TIMEOUT = 5000 } = {}) => operation('ro-query', { query, params, timeout: TIMEOUT }),
        delete: async () => { await request(path, 'DELETE'); },
        createNodeRangeIndex: (label, ...properties) => operation('range-index', { label, properties }),
        createNodeFulltextIndex: (label, ...properties) => operation('fulltext-index', { label, properties }),
        constraintCreate: (constraintType, entityType, label, ...properties) => operation('constraint', { constraintType, entityType, label, properties }),
      });
    },
    async getStatus() {
      const status = await request('/v1/status');
      return { ...status, transport: endpoint.protocol === 'https:' ? 'HTTPS gateway / private Unix socket' : 'local HTTP gateway / private Unix socket' };
    },
    async close() { closed = true; },
  });
}
