import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCourseRouter, verifyStripeSignature, validatePaidSession, COURSE } from '../src/course.mjs';
import { createWorker } from '../src/enquiries.mjs';
const origin = 'https://yourbloom.site';
const id = 'cs_test_' + 'a'.repeat(48);
const secret = 'whsec_test_only';
function paid(extra = {}) {
  return { id, object:'checkout.session', created: 1800000000, mode:'payment', livemode:false,
    payment_link:'plink_expected', status:'complete', payment_status:'paid', currency:'usd', amount_subtotal:19000, amount_total:19000,
    line_items:{has_more:false,data:[{quantity:1,price:{id:'price_expected',currency:'usd',unit_amount:19000}}]}, ...extra };
}
function setup(session = paid(), overrides = {}) {
  const objects = new Map(); const calls = [];
  const env = { YOURBLOOM_COURSE_ENABLED:'true', STRIPE_COURSE_TEST_MODE:'true', STRIPE_SECRET_KEY:'sk_test_not_a_real_key',
    STRIPE_COURSE_PAYMENT_LINK:'https://buy.stripe.com/test_example', STRIPE_COURSE_PAYMENT_LINK_ID:'plink_expected',
    STRIPE_COURSE_PRICE_ID:'price_expected', STRIPE_COURSE_WEBHOOK_SECRET:secret,
    COURSE_FILES:{ head:async key=> key===COURSE.file?{size:24,httpMetadata:{contentType:'application/pdf'}}:null,
      get:async key=>key===COURSE.file?{body:'%PDF-1.7\nFictional QA file'}:null,
      put:async (key,value)=>{objects.set(key,value);return {key};}},...overrides };
  const outbound=async(url,options)=>{calls.push({url,options});return Response.json(session);};
  return {env,objects,calls,route:createCourseRouter(outbound),worker:createWorker(outbound)};
}
function request(action, data={session_id:id}, headers={}) {
  return new Request(origin+'/course-api/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
}
function signedEvent(type='checkout.session.completed',eventId='evt_test',timestamp=Math.floor(Date.now()/1000),bodyId=id) {
  const raw=JSON.stringify({id:eventId,type,data:{object:{id:bodyId}}});
  const signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  return new Request(origin+'/course-api/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${timestamp},v1=${signature}`},body:raw});
}
test('unconfigured enrollment stays closed and reveals no checkout or credentials',async()=>{
  const h=setup(paid(),{STRIPE_SECRET_KEY:undefined});
  assert.deepEqual(await (await h.route(new Request(origin+'/course-api/config'),h.env)).json(),{available:false,amount:19000,currency:'usd'});
  assert.equal((await h.route(request('download'),h.env)).status,503);
  assert.equal(h.calls.length,0);
});
test('checkout opens only with a ready private PDF and explicit launch flag',async()=>{
  const h=setup(); const response=await h.route(new Request(origin+'/course-api/config'),h.env);
  assert.deepEqual(await response.json(),{available:true,amount:19000,currency:'usd',checkoutUrl:'https://buy.stripe.com/test_example'});
  for(const overrides of [{YOURBLOOM_COURSE_ENABLED:'false'},{STRIPE_COURSE_WEBHOOK_SECRET:undefined},{STRIPE_COURSE_PAYMENT_LINK:'https://evil.example/pay'},{COURSE_FILES:{...h.env.COURSE_FILES,head:async()=>null}}]){
    const result=await h.route(new Request(origin+'/course-api/config'),{...h.env,...overrides});
    assert.equal((await result.json()).available,false);
  }
});
test('paid matching order unlocks access and private PDF; no public file URL',async()=>{
  const h=setup(); const access=await h.route(request('access'),h.env);
  assert.deepEqual(await access.json(),{ok:true,ready:true});
  const download=await h.route(request('download'),h.env);
  assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'application/pdf');
  assert.equal(download.headers.get('Cache-Control'),'private, no-store');
  assert.match(download.headers.get('Content-Disposition'),/^attachment/);assert.match(await download.text(),/^%PDF/);
  assert.equal(h.objects.size,1);
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer sk_test_not_a_real_key');
});
test('unpaid and asynchronous pending payments cannot download',async()=>{
  for(const state of [{payment_status:'unpaid'},{status:'open'},{payment_status:'no_payment_required'}]){
    const h=setup(paid(state)); const res=await h.route(request('download'),h.env);
    assert.equal(res.status,202);assert.equal((await res.json()).code,'payment_pending');assert.equal(h.objects.size,0);
  }
});
test('a real payment for another product, amount, currency or environment never unlocks the PDF',async()=>{
  const invalid=[{payment_link:'plink_other'},{amount_total:1},{amount_subtotal:1},{currency:'eur'},{livemode:true},{mode:'subscription'},
    {line_items:{has_more:false,data:[{quantity:1,price:{id:'price_other',currency:'usd',unit_amount:19000}}]}},
    {line_items:{has_more:false,data:[{quantity:2,price:{id:'price_expected',currency:'usd',unit_amount:19000}}]}},
    {line_items:{has_more:true,data:paid().line_items.data}}];
  for(const extra of invalid){const h=setup(paid(extra));assert.equal((await h.route(request('download'),h.env)).status,403);assert.equal(h.objects.size,0);}
});
test('malformed session and cross-origin calls never contact Stripe',async()=>{
  const h=setup();
  assert.equal((await h.route(request('access',{session_id:'../../secrets'}),h.env)).status,400);
  assert.equal((await h.route(request('download',undefined,{Origin:'https://evil.example'}),h.env)).status,403);
  assert.equal((await h.route(request('access',undefined,{'Sec-Fetch-Site':'cross-site'}),h.env)).status,403);
  assert.equal((await h.route(request('download',undefined,{'Content-Type':'text/plain'}),h.env)).status,415);
  assert.equal(h.calls.length,0);
});
test('body size limits apply to chunked requests without content-length',async()=>{
  const h=setup();const req=new Request(origin+'/course-api/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(3000)});
  assert.equal((await h.route(req,h.env)).status,400);assert.equal(h.calls.length,0);
});
test('missing file and upstream failures cannot produce a successful download',async()=>{
  const h=setup();assert.equal((await h.route(request('download'),{...h.env,COURSE_FILES:{...h.env.COURSE_FILES,get:async()=>null}})).status,503);
  const route=createCourseRouter(async()=>{throw new Error('private upstream detail');});
  const response=await route(request('access'),h.env);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|sk_test/);
});
test('Stripe signatures cover the exact raw body and enforce timestamp tolerance',async()=>{
  const now=1800000000000;const raw='{"exact":"body"}'; const t=now/1000;
  const sign=(timestamp)=>createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  assert.equal(await verifyStripeSignature(raw,`t=${t},v1=${sign(t)}`,secret,now),true);
  assert.equal(await verifyStripeSignature(raw+' ',`t=${t},v1=${sign(t)}`,secret,now),false);
  for(const offset of [-301,301])assert.equal(await verifyStripeSignature(raw,`t=${t+offset},v1=${sign(t+offset)}`,secret,now),false);
  assert.equal(await verifyStripeSignature(raw,`t=${t},v1=${sign(t)}`,'whsec_wrong',now),false);
  assert.equal(await verifyStripeSignature(raw,`t=${t},t=${t},v1=${sign(t)}`,secret,now),false);
});
test('unsigned or tampered webhook cannot create access',async()=>{
  const h=setup();let req=signedEvent(); const raw=await req.text();
  const tampered=new Request(req.url,{method:'POST',headers:req.headers,body:raw+' '});
  assert.equal((await h.route(tampered,h.env)).status,400);
  assert.equal((await h.route(new Request(req.url,{method:'POST',body:raw}),h.env)).status,400);
  assert.equal(h.calls.length,0);assert.equal(h.objects.size,0);
});
test('duplicate webhook and return-page fulfillment create one deterministic receipt',async()=>{
  const h=setup();const responses=await Promise.all([h.route(signedEvent(),h.env),h.route(signedEvent(),h.env),h.route(request('access'),h.env)]);
  assert.ok(responses.every(res=>res.status===200));assert.equal(h.objects.size,1);
  const receipt=JSON.parse([...h.objects.values()][0]);assert.equal(receipt.course,COURSE.id);assert.equal(receipt.amount,19000);
});
test('delayed success is fulfilled; completed but unpaid or wrong-product events are ignored',async()=>{
  const h=setup();assert.equal((await h.route(signedEvent('checkout.session.async_payment_succeeded'),h.env)).status,200);assert.equal(h.objects.size,1);
  for(const session of [paid({payment_status:'unpaid'}),paid({payment_link:'plink_other'})]){
    const other=setup(session);assert.equal((await other.route(signedEvent(),other.env)).status,200);assert.equal(other.objects.size,0);
  }
});
test('existing Worker delegates course routes while preserving legacy assets',async()=>{
  const h=setup();h.env.ASSETS={fetch:async()=>new Response('existing asset')};
  assert.equal((await h.worker.fetch(new Request(origin+'/course-api/config'),h.env)).status,200);
  assert.equal(await (await h.worker.fetch(new Request(origin+'/course.html'),h.env)).text(),'existing asset');
  assert.equal((await h.route(new Request(origin+'/course-api/download'),h.env)).status,405);
});
