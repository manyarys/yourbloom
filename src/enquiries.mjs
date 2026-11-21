const ENDPOINT = '/api/partnership-enquiry';
const MAX_BYTES = 16384;
const COMMON = ['name', 'email', 'market', 'deadline', 'message'];
const ROLE_FIELDS = {
  brand: ['company', 'website', 'budget'],
  creator: ['profile', 'niche', 'preferences', 'adult', 'future'],
  agency: ['company', 'website', 'requirements'],
  event: ['company', 'website', 'budget', 'event', 'location', 'rights']
};
const LABELS = {
  name: 'Name', email: 'Email', market: 'Market', deadline: 'Preferred timing',
  message: 'Brief', company: 'Company / agency', website: 'Website', budget: 'Creator / event budget',
  profile: 'Creator profile', niche: 'Content focus', preferences: 'Collaboration preferences',
  adult: 'Adult creator', future: 'Future relevant opportunities', requirements: 'Agency requirements',
  event: 'Event / project', location: 'Event location', rights: 'Partnership rights / support'
};
const LIMITS = { name: 120, email: 254, market: 180, deadline: 120, message: 1800,
  company: 180, website: 400, budget: 100, profile: 400, niche: 180,
  preferences: 700, requirements: 700, event: 180, location: 180, rights: 700 };

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extra
  } });
}
function available(env) {
  return env.YOURBLOOM_ENQUIRIES_ENABLED === 'true'
    && /^\d+:[A-Za-z0-9_-]{20,}$/.test(env.YOURBLOOM_TELEGRAM_BOT_TOKEN || '')
    && /^-?[1-9]\d{0,15}$/.test(env.YOURBLOOM_TELEGRAM_CHAT_ID || '')
    && typeof env.ENQUIRY_RATE_LIMITER?.limit === 'function'
    && typeof env.ENQUIRY_GLOBAL_LIMITER?.limit === 'function';
}
async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new Error('too_large');
  if (!request.body) throw new Error('invalid');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('too_large'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}
export function validateEnquiry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { code: 'invalid_fields' };
  if (typeof data.audience !== 'string' || !Object.hasOwn(ROLE_FIELDS, data.audience)) return { code: 'invalid_fields' };
  const fields = [...COMMON, ...ROLE_FIELDS[data.audience]];
  const allowed = new Set(['audience', 'privacy', 'company_url', ...fields]);
  if (Object.keys(data).some(k => !allowed.has(k))) return { code: 'invalid_fields' };
  if (data.privacy !== true) return { code: 'privacy_required' };
  if (typeof data.company_url !== 'string' || data.company_url !== '') return { code: 'invalid_fields' };
  const result = { audience: data.audience };
  for (const key of fields) {
    if (['adult', 'future'].includes(key)) {
      if (data[key] !== undefined && typeof data[key] !== 'boolean') return { code: 'invalid_fields' };
      result[key] = data[key] === true;
    } else {
      if (data[key] !== undefined && typeof data[key] !== 'string') return { code: 'invalid_fields' };
      const value = (data[key] || '').trim();
      if (value.length > LIMITS[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { code: 'invalid_fields' };
      result[key] = value;
    }
  }
  if (['name', 'email', 'market', 'message'].some(k => !result[k])) return { code: 'invalid_fields' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) return { code: 'invalid_fields' };
  if (data.audience === 'creator' && (!result.profile || !result.niche || !result.adult)) return { code: 'invalid_fields' };
  for (const key of ['website', 'profile']) {
    if (!result[key]) continue;
    try { if (!['https:', 'http:'].includes(new URL(result[key]).protocol)) return { code: 'invalid_fields' }; }
    catch { return { code: 'invalid_fields' }; }
  }
  const lines = ['YOURBLOOM — NEW ENQUIRY', `Enquiry type: ${result.audience}`];
  for (const key of fields) {
    const value = result[key];
    if (value === '' || value === undefined) continue;
    lines.push(`${LABELS[key]}: ${typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}`);
  }
  lines.push('Privacy acknowledgement: Confirmed');
  const text = lines.join('\n\n');
  if (text.length > 3800) return { code: 'brief_too_long' };
  return { text };
}

export function createWorker(outbound = fetch) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== ENDPOINT && url.pathname !== ENDPOINT + '/config') {
      return env.ASSETS.fetch(request);
    }
    if (!['yourbloom.site', 'www.yourbloom.site'].includes(url.hostname)) return json({ ok: false, code: 'forbidden' }, 403);
    if (url.pathname.endsWith('/config')) {
      if (request.method !== 'GET') return json({ ok: false }, 405, { Allow: 'GET' });
      return json({ available: available(env) });
    }
    if (request.method !== 'POST') return json({ ok: false }, 405, { Allow: 'POST' });
    if (request.headers.get('Origin') !== url.origin) return json({ ok: false, code: 'forbidden' }, 403);
    if (request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin') return json({ ok: false, code: 'forbidden' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ ok: false, code: 'invalid_content_type' }, 415);
    if (!available(env)) return json({ ok: false, code: 'unavailable' }, 503);
    let limits;
    try {
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json({ ok: false, code: 'unavailable' }, 503);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      const key = 'yourbloom:enquiry:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      limits = await Promise.all([
        env.ENQUIRY_RATE_LIMITER.limit({ key }),
        env.ENQUIRY_GLOBAL_LIMITER.limit({ key: 'yourbloom:enquiry:all' })
      ]);
    } catch { return json({ ok: false, code: 'unavailable' }, 503); }
    if (limits.some(x => !x.success)) return json({ ok: false, code: 'rate_limited' }, 429, { 'Retry-After': '60' });
    let data;
    try { data = await readJson(request); }
    catch (error) { return json({ ok: false, code: error.message === 'too_large' ? 'too_large' : 'invalid_fields' }, error.message === 'too_large' ? 413 : 400); }
    const validated = validateEnquiry(data);
    if (validated.code) return json({ ok: false, code: validated.code }, 400);
    try {
      const response = await outbound('https://api.telegram.org/bot' + env.YOURBLOOM_TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.YOURBLOOM_TELEGRAM_CHAT_ID, text: validated.text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10000)
      });
      const delivery = await response.json();
      if (!response.ok || delivery.ok !== true || !Number.isInteger(delivery.result?.message_id)
        || String(delivery.result?.chat?.id) !== env.YOURBLOOM_TELEGRAM_CHAT_ID) return json({ ok: false, code: 'delivery_unconfirmed' }, 502);
      return json({ ok: true });
    } catch { return json({ ok: false, code: 'delivery_unconfirmed' }, 502); }
  } };
}
export default createWorker();
