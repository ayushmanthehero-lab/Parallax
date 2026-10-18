import { getVercelOidcToken } from '@vercel/oidc';

// This project default was verified against the live Gateway model catalog.
// Deployments can select another supported provider/model through configuration.
const DEFAULT_GATEWAY_MODEL = 'openai/gpt-4.1-mini';
const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const text = value => typeof value === 'string' ? value.trim() : '';

function failure(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/** Safe to return in health/bootstrap responses: no credentials or token values. */
export function getAgentConfiguration(env = process.env) {
  const selected = text(env.PARALLAX_AI_PROVIDER);
  if (selected === 'guided' || (!selected && !text(env.LLM_API_KEY))) {
    return { mode: 'guided', provider: 'guided', model: null };
  }
  if (selected === 'vercel-gateway') {
    return { mode: 'model', provider: 'vercel-gateway', model: text(env.AI_GATEWAY_MODEL) || DEFAULT_GATEWAY_MODEL };
  }
  if (!selected || selected === 'openai-compatible') {
    return { mode: 'model', provider: 'openai-compatible', model: text(env.LLM_MODEL) || null };
  }
  throw failure('MODEL_CONFIGURATION', 'PARALLAX_AI_PROVIDER must be guided, vercel-gateway or openai-compatible.');
}

/** Resolve inside the active request; never keep an OIDC token in global state. */
export async function resolveModelConnection({ env, getOidcToken = getVercelOidcToken, deadline = Date.now() + 30_000 }) {
  const configuration = getAgentConfiguration(env);
  if (configuration.provider === 'vercel-gateway') {
    let token = text(env.AI_GATEWAY_API_KEY);
    if (!token) {
      let timeout;
      try {
        token = text(await Promise.race([
          getOidcToken({ expirationBufferMs: 30_000 }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(failure('MODEL_AUTHENTICATION_TIMEOUT', 'Obtaining the current Vercel identity exceeded the authentication time bound. Retry after checking this project’s OIDC configuration. No guided fallback was substituted.')), Math.max(1, Math.min(5000, deadline - Date.now())));
          }),
        ]));
      } catch (error) {
        if (error?.code === 'MODEL_AUTHENTICATION_TIMEOUT') throw error;
        throw failure('MODEL_AUTHENTICATION', 'The current Vercel OIDC identity could not be obtained. Check this project’s OIDC configuration, or supply an AI Gateway key for local development. No guided fallback was substituted.');
      } finally { clearTimeout(timeout); }
    }
    if (!token) throw failure('MODEL_AUTHENTICATION', 'AI Gateway authentication is missing. Enable Vercel OIDC for this deployment or configure an AI Gateway key. No guided fallback was substituted.');
    return { ...configuration, endpoint: GATEWAY_ENDPOINT, token };
  }
  if (!configuration.model) throw failure('MODEL_CONFIGURATION', 'A model provider is configured, but LLM_MODEL is missing. Configure a model or use guided mode.');
  const token = text(env.LLM_API_KEY);
  if (!token) throw failure('MODEL_AUTHENTICATION', 'The configured OpenAI-compatible provider requires LLM_API_KEY. No guided fallback was substituted.');
  let base;
  try { base = new URL(env.LLM_BASE_URL || 'https://api.openai.com/v1'); }
  catch { throw failure('MODEL_CONFIGURATION', 'LLM_BASE_URL is not a valid URL.'); }
  if (!['https:', 'http:'].includes(base.protocol) || (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw failure('MODEL_CONFIGURATION', 'Model endpoints must use HTTPS, except a local development endpoint.');
  }
  return { ...configuration, endpoint: `${base.href.replace(/\/+$/, '')}/chat/completions`, token };
}

/** Interpret actionable Gateway outcomes without exposing the raw provider body. */
export async function modelResponseError(response, provider) {
  if (provider === 'vercel-gateway') {
    let errorType;
    try {
      const payload = await response.json();
      errorType = payload?.error?.type || payload?.error?.code;
    } catch { /* The status remains useful when the provider returns a non-JSON error. */ }
    if (response.status === 401) return failure('MODEL_AUTHENTICATION', 'AI Gateway rejected this project’s request authentication. Check the deployed OIDC configuration or Gateway key. No guided fallback was substituted.');
    if (response.status === 403 && errorType === 'customer_verification_required') return failure('MODEL_CUSTOMER_VERIFICATION', 'Vercel AI Gateway requires account verification before this project can use its model credits. Review the account’s AI Gateway settings. No guided fallback was substituted.');
    if (response.status === 402 && errorType === 'quota_for_entity_exceeded') return failure('MODEL_BUDGET_EXHAUSTED', 'The configured AI Gateway budget has been reached. Model investigations remain unavailable until the budget refreshes or an account owner changes it. No guided fallback was substituted.');
    if (response.status === 402) return failure('MODEL_CREDITS_EXHAUSTED', 'This Vercel account has no available AI Gateway credits for the request. Review the account’s AI Gateway credit balance. No guided fallback was substituted.');
    if (response.status === 429) return failure('MODEL_RATE_LIMITED', 'AI Gateway or its model provider is rate limited. Retry later; completed graph work remains persisted. No guided fallback was substituted.', 429);
  }
  return failure('MODEL_RESPONSE_ERROR', `The configured model returned HTTP ${response.status}. Check its model name, account access and endpoint settings.`, 502);
}

/** Only bounded identifiers and numeric usage enter durable model receipts. */
export function modelReceipt(configuration, payload) {
  const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(value) ? value : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    provider: configuration.provider,
    model: identifier(payload?.model) || configuration.model,
    generationId: identifier(payload?.id),
    usage: {
      inputTokens: count(payload?.usage?.prompt_tokens),
      outputTokens: count(payload?.usage?.completion_tokens),
      totalTokens: count(payload?.usage?.total_tokens),
    },
  };
}
