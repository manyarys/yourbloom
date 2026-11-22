// Course delivery stays closed until Stripe and a private R2 PDF are configured.
// No course file or Stripe secret is ever part of the public asset directory.
export const COURSE = Object.freeze({ id: 'creator-partnerships', amount: 19000, currency: 'usd', file: 'creator-partnerships.pdf' });
const encoder = new TextEncoder();
const SESSION = /^cs_(?:test_|live_)?[A-Za-z0-9]{16,240}$/;
const PREFIX = '/course-api/';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...privateHeaders, ...extra } });
function deliveryConfigured(env) {
  return /^(?:sk|rk)_(?:test|live)_\S+$/.test(env.STRIPE_SECRET_KEY || '')
    && /^plink_[A-Za-z0-9]+$/.test(env.STRIPE_COURSE_PAYMENT_LINK_ID || '')
    && /^price_[A-Za-z0-9]+$/.test(env.STRIPE_COURSE_PRICE_ID || '')
    && typeof env.COURSE_FILES?.get === 'function' && typeof env.COURSE_FILES?.head === 'function'
    && typeof env.COURSE_FILES?.put === 'function';
}
function paymentLink(env) {
  try {
    const url = new URL(env.STRIPE_COURSE_PAYMENT_LINK);
    return url.protocol === 'https:' && url.hostname === 'buy.stripe.com' && url.pathname.length > 1 && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
async function pdfReady(env) {
  const file = await env.COURSE_FILES.head(COURSE.file);
  return !!file && file.size > 0 && file.httpMetadata?.contentType === 'application/pdf';
}
async function limitedBody(request, max) {
  if (!request.body || Number(request.headers.get('content-length')) > max) throw new Error('invalid_body');
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new Error('invalid_body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(raw);
}
export async function verifyStripeSignature(raw, header, secret, now = Date.now()) {
  if (!/^whsec_\S+$/.test(secret || '') || typeof header !== 'string' || header.length > 4096) return false;
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1])) return false;
  const timestamp = timestamps[0][1];
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value || ''));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const [, hex] of signatures) {
    const bytes = Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(timestamp + '.' + raw))) return true;
  }
  return false;
}
export function validatePaidSession(session, env) {
  const lines = session?.line_items;
  const live = env.STRIPE_COURSE_TEST_MODE !== 'true';
  if (session?.object !== 'checkout.session' || session.mode !== 'payment' || session.livemode !== live
      || session.payment_link !== env.STRIPE_COURSE_PAYMENT_LINK_ID
      || session.currency !== COURSE.currency || session.amount_subtotal !== COURSE.amount
      || session.amount_total !== COURSE.amount || lines?.has_more !== false || lines.data?.length !== 1) return 'wrong_course';
  const item = lines.data[0];
  if (item.quantity !== 1 || item.price?.id !== env.STRIPE_COURSE_PRICE_ID
      || item.price?.currency !== COURSE.currency || item.price?.unit_amount !== COURSE.amount) return 'wrong_course';
  if (session.status !== 'complete' || session.payment_status !== 'paid') return 'payment_pending';
  return null;
}
async function retrieveSession(id, env, outbound) {
  const response = await outbound('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id) + '?expand%5B%5D=line_items', {
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Stripe-Version': '2025-09-30.clover' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'session_not_found' : 'stripe_unavailable');
  const session = await response.json();
  if (session?.id !== id) throw new Error('session_not_found');
  return session;
}
async function recordAccess(session, env) {
  // The same session always produces the same object. Retries and simultaneous
  // webhook/return-page requests cannot create duplicate orders or side effects.
  const receipt = { course: COURSE.id, session: session.id, created: session.created, amount: COURSE.amount, currency: COURSE.currency };
  await env.COURSE_FILES.put('orders/' + session.id + '.json', JSON.stringify(receipt), { httpMetadata: { contentType: 'application/json' } });
}
export function createCourseRouter(outbound = fetch) {
  return async function route(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return null;
    const action = url.pathname.slice(PREFIX.length);
    if (!['config', 'access', 'download', 'webhook'].includes(action)) return json({ ok: false, code: 'not_found' }, 404);
    if (request.method !== (action === 'config' ? 'GET' : 'POST')) return json({ ok: false }, 405, { Allow: action === 'config' ? 'GET' : 'POST' });
    try {
      if (action === 'config') {
        const checkoutUrl = paymentLink(env);
        const available = env.YOURBLOOM_COURSE_ENABLED === 'true' && deliveryConfigured(env)
          && /^whsec_\S+$/.test(env.STRIPE_COURSE_WEBHOOK_SECRET || '') && !!checkoutUrl && await pdfReady(env);
        return json({ available: !!available, amount: COURSE.amount, currency: COURSE.currency, ...(available ? { checkoutUrl } : {}) });
      }
      if (!deliveryConfigured(env)) return json({ ok: false, code: 'unavailable' }, 503);
      if (action === 'webhook') {
        const raw = await limitedBody(request, 262144);
        if (!await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_COURSE_WEBHOOK_SECRET)) return json({ ok: false }, 400);
        const event = JSON.parse(raw);
        if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return json({ received: true });
        const id = event.data?.object?.id;
        if (!SESSION.test(id || '')) return json({ ok: false }, 400);
        // Fetch the current session from Stripe, never trust supplied payment data.
        const session = await retrieveSession(id, env, outbound);
        const error = validatePaidSession(session, env);
        if (error) return json({ received: true });
        if (!await pdfReady(env)) return json({ ok: false, code: 'unavailable' }, 503);
        await recordAccess(session, env);
        return json({ received: true });
      }
      if (request.headers.get('Origin') !== url.origin || (request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) return json({ ok: false }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ ok: false }, 415);
      const data = JSON.parse(await limitedBody(request, 2048));
      if (!SESSION.test(data?.session_id || '')) return json({ ok: false, code: 'invalid_session' }, 400);
      const session = await retrieveSession(data.session_id, env, outbound);
      const error = validatePaidSession(session, env);
      if (error) return json({ ok: false, code: error }, error === 'payment_pending' ? 202 : 403);
      if (!await pdfReady(env)) return json({ ok: false, code: 'unavailable' }, 503);
      await recordAccess(session, env);
      if (action === 'access') return json({ ok: true, ready: true });
      const file = await env.COURSE_FILES.get(COURSE.file);
      if (!file?.body) return json({ ok: false, code: 'unavailable' }, 503);
      return new Response(file.body, { headers: { ...privateHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="YourBloom-Creator-Partnerships.pdf"' } });
    } catch (error) {
      if (error.message === 'invalid_body' || error instanceof SyntaxError || error instanceof TypeError) return json({ ok: false, code: 'invalid_request' }, 400);
      if (error.message === 'session_not_found') return json({ ok: false, code: 'invalid_session' }, 404);
      return json({ ok: false, code: 'temporarily_unavailable' }, 503);
    }
  };
}
