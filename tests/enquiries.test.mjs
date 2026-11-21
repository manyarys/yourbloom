import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, validateEnquiry } from '../src/enquiries.mjs';
import { readFileSync } from 'node:fs';

// All outbound Telegram requests are stubbed. These are not real credentials.
const token = '123456:' + 'test_only_not_a_real_bot_token';
const origin = 'https://yourbloom.site';
const endpoint = origin + '/api/partnership-enquiry';
const base = { audience: 'brand', name: 'Test founder', email: 'qa@example.invalid',
  market: 'International', message: 'A fictional campaign brief', privacy: true, company_url: '' };
function environment(extra = {}) {
  return { YOURBLOOM_ENQUIRIES_ENABLED: 'true', YOURBLOOM_TELEGRAM_BOT_TOKEN: token,
    YOURBLOOM_TELEGRAM_CHAT_ID: '123456789',
    ENQUIRY_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ENQUIRY_GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async request => new Response('asset:' + new URL(request.url).pathname) }, ...extra };
}
function request(body = base, extra = {}) {
  return new Request(endpoint, { method: 'POST', headers: { Origin: origin,
    'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.15', ...extra.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function harness(outcome = 'success') {
  const sent = [];
  const worker = createWorker(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    if (outcome === 'throw') throw new Error('Do not disclose ' + token);
    if (outcome === 'invalid_json') return new Response('bad gateway', { status: 502 });
    return Response.json({ ok: outcome !== 'rejected', description: token,
      result: { message_id: 42, chat: { id: outcome === 'wrong_chat' ? 777 : 123456789 } } },
      { status: outcome === 'http_error' ? 500 : 200 });
  });
  return { worker, sent };
}

test('unconfigured server never accepts an enquiry or calls Telegram', async () => {
  const { worker, sent } = harness();
  const env = environment({ YOURBLOOM_ENQUIRIES_ENABLED: undefined });
  const config = await worker.fetch(new Request(endpoint + '/config'), env);
  assert.deepEqual(await config.json(), { available: false });
  assert.equal((await worker.fetch(request(), env)).status, 503);
  assert.equal(sent.length, 0);
});
test('config exposes availability without secrets or destination', async () => {
  const { worker } = harness();
  const res = await worker.fetch(new Request(endpoint + '/config'), environment());
  assert.deepEqual(await res.json(), { available: true });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
test('confirmed delivery includes every populated field and returns success', async () => {
  const { worker, sent } = harness();
  const res = await worker.fetch(request({ ...base, company: 'Example brand', website: 'https://example.com',
    deadline: 'Next month or flexible', budget: 'To be discussed' }), environment());
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].body.chat_id, '123456789');
  for (const value of ['Test founder', 'qa@example.invalid', 'International', 'A fictional campaign brief',
    'Example brand', 'https://example.com', 'Next month or flexible', 'To be discussed']) assert.ok(sent[0].body.text.includes(value));
  assert.equal(sent[0].body.parse_mode, undefined);
  assert.deepEqual(sent[0].body.link_preview_options, { is_disabled: true });
});
for (const role of ['creator', 'agency', 'event']) {
  test('delivers complete ' + role + ' details', async () => {
    const extras = {
      creator: { profile: 'https://example.com/creator', niche: 'Travel', preferences: 'Editorial', adult: true, future: false },
      agency: { company: 'Example agency', website: 'https://example.com', requirements: 'Written approvals' },
      event: { event: 'Sample event', location: 'Online', rights: 'Creator attendance', budget: 'Not yet set' }
    }[role];
    const { worker, sent } = harness();
    const res = await worker.fetch(request({ ...base, audience: role, ...extras }), environment());
    assert.equal(res.status, 200);
    for (const value of Object.values(extras).filter(v => typeof v === 'string')) assert.ok(sent[0].body.text.includes(value));
    if (role === 'creator') assert.match(sent[0].body.text, /Future relevant opportunities: No/);
  });
}
for (const outcome of ['rejected', 'throw', 'http_error', 'invalid_json', 'wrong_chat']) {
  test('never reports success for ' + outcome, async () => {
    const { worker } = harness(outcome);
    const res = await worker.fetch(request(), environment());
    assert.equal(res.status, 502);
    const text = await res.text(); assert.ok(!text.includes(token));
    assert.deepEqual(JSON.parse(text), { ok: false, code: 'delivery_unconfirmed' });
  });
}
test('rejects cross-origin requests without contacting Telegram', async () => {
  const { worker, sent } = harness();
  assert.equal((await worker.fetch(request(base, { headers: { Origin: 'https://example.invalid' } }), environment())).status, 403);
  assert.equal(sent.length, 0);
});
test('rejects non-JSON and malformed JSON', async () => {
  const { worker, sent } = harness();
  assert.equal((await worker.fetch(request(base, { headers: { 'Content-Type': 'text/plain' } }), environment())).status, 415);
  assert.equal((await worker.fetch(request('{bad'), environment())).status, 400);
  assert.equal(sent.length, 0);
});
test('bounds request bytes even with no content length', async () => {
  const { worker, sent } = harness();
  const res = await worker.fetch(request(JSON.stringify({ ...base, message: 'x'.repeat(17000) })), environment());
  assert.equal(res.status, 413); assert.equal(sent.length, 0);
});
test('rate limiting fails closed and prevents outgoing messages', async () => {
  const { worker, sent } = harness();
  assert.equal((await worker.fetch(request(), environment({ ENQUIRY_RATE_LIMITER: { limit: async () => ({ success: false }) } }))).status, 429);
  assert.equal((await worker.fetch(request(), environment({ ENQUIRY_RATE_LIMITER: { limit: async () => { throw new Error(); } } }))).status, 503);
  assert.equal(sent.length, 0);
});
test('invalid data, unknown destination fields and honeypot cannot be delivered', async () => {
  const { worker, sent } = harness();
  for (const data of [{ ...base, privacy: false }, { ...base, chat_id: '999' }, { ...base, company_url: 'spam' },
    { ...base, audience: ['brand'] }, { ...base, name: null }, { ...base, email: 'bad-email' },
    { ...base, website: 'javascript:alert(1)' }, { ...base, audience: 'creator', adult: false },
    { ...base, message: 'x'.repeat(1801) }]) {
    assert.equal((await worker.fetch(request(data), environment())).status, 400);
  }
  assert.equal(sent.length, 0);
});
test('long combined submissions are rejected rather than silently truncated', () => {
  const result = validateEnquiry({ ...base, audience: 'creator', profile: 'https://example.com/' + 'c'.repeat(380),
    niche: 'x'.repeat(180), preferences: 'x'.repeat(700), adult: true, message: 'x'.repeat(1800),
    name: 'x'.repeat(120), email: 'x'.repeat(240) + '@a.co', market: 'x'.repeat(180), deadline: 'x'.repeat(120) });
  assert.equal(result.code, 'brief_too_long');
});
test('legacy pages and course API routes still go to the existing asset binding', async () => {
  const { worker, sent } = harness();
  for (const path of ['/shop', '/course', '/api/progress', '/api/token-by-email']) {
    const res = await worker.fetch(new Request(origin + path), environment());
    assert.equal(await res.text(), 'asset:' + path);
  }
  assert.equal(sent.length, 0);
});
test('only permitted request methods are accepted', async () => {
  const { worker, sent } = harness();
  assert.equal((await worker.fetch(new Request(endpoint), environment())).status, 405);
  assert.equal((await worker.fetch(new Request(endpoint + '/config', { method: 'POST' }), environment())).status, 405);
  assert.equal(sent.length, 0);
});
test('public page has no prototype copy and cannot send without consent', () => {
  const page = readFileSync(new URL('../contact.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /\bdemo(?:nstration)?\b|\bpreview\b/i);
  assert.match(page, /id="send-brief"[^>]*type="submit"[^>]*disabled/);
  assert.match(page, /id="privacy"[^>]*required/);
  assert.match(page, /connect-src &#x27;self&#x27;/);
});
