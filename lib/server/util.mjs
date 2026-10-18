import { createHash, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, status = 400, details) { super(message); this.code = code; this.status = status; this.details = details; }
}
export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${randomUUID()}`;
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
export function parse(value, fallback = null) { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } }
export function hydrate(value) {
  if (!value) return null;
  const p = value.properties ?? value;
  const data = {...parse(p.dataJson, {}), ...p};
  delete data.dataJson;
  for (const key of ['resultJson', 'argsJson', 'versionsJson', 'detailsJson', 'inputsJson', 'outputsJson', 'ruleUpdatesJson']) {
    if (data[key] !== undefined) { data[key.slice(0,-4)] = parse(data[key]); delete data[key]; }
  }
  return data;
}
export function properties(type, value) {
  const result = {type, dataJson: JSON.stringify(value)};
  for (const [key, v] of Object.entries(value)) {
    if (v !== null && ['string','number','boolean'].includes(typeof v)) result[key] = v;
  }
  return result;
}
export function requireText(value, name, max = 8000, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new AppError('INVALID_INPUT', `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new AppError('INVALID_REVISION', 'A current positive revision is required.');
  return value;
}
export function commandMeta(body, operation, payload) {
  const commandId = requireText(body.commandId, 'Command identifier', 160);
  if (!/^[\w.-]+$/.test(commandId)) throw new AppError('INVALID_COMMAND', 'The command identifier contains unsupported characters.');
  return {commandId: `command_${commandId}`, payloadHash: hash({operation,payload})};
}
