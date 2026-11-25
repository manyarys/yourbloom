# YourBloom course page and PDF delivery

Public page: `https://yourbloom.site/learn`. Course title: **Creator Growth & Brand Deals**. Price: **$190 USD**, one payment. The course has a 72-page creator-facing edition covering content, audience growth, commercial work and SMM/agent decisions. Its PDF remains private until the owner authorises paid release. The new page does not replace the unrelated legacy `course.html` program or `thankyou.html`.

## Current state

The page is ready to review. Enrollment intentionally stays closed until the private PDF, Stripe configuration and launch switch are all ready. The public button shows an enrollment information dialog. There are no fake payments, automatic email promises, invented testimonials or public course downloads.

The hero uses Maria’s supplied portrait, `assets/maria-portrait.webp`, unchanged. Previous editorial model assets remain available for existing references but are no longer used on the creator landing pages. The original YourBloom flower logo is unchanged. The public cover preview matches the creator-facing edition; the complete PDF is not part of the public repository. Local fonts Anton and Mrs Saint Delafield are distributed under the accompanying SIL OFL licenses. Colors: raspberry `#C94070`, cream `#FBF6F0`, charcoal `#191519`.

## Stripe and Cloudflare setup, when the course is ready

1. Create the final PDF. Put **only** the PDF in a **private** R2 bucket as `creator-partnerships.pdf`, with HTTP content type `application/pdf`. Do not enable public bucket access, do not put the PDF in GitHub or `assets/`. Add the bucket binding `COURSE_FILES` to the deployed Worker and to Wrangler when its actual bucket name is known:

   ```json
   "r2_buckets": [{ "binding": "COURSE_FILES", "bucket_name": "ACTUAL_PRIVATE_BUCKET_NAME" }]
   ```

2. Create one Stripe price: USD 190.00, one-time, quantity one, without discounts, optional extras or added tax. The server currently verifies the exact $190 total and rejects a different product or price. If tax or discounts are required later, update the pricing rules and tests deliberately before activating them.
3. Set the Payment Link's **After payment** redirect to:

   `https://yourbloom.site/course-access?session_id={CHECKOUT_SESSION_ID}`

4. Store server settings in the Cloudflare Worker. Secret values belong in Cloudflare secrets, never HTML, browser JavaScript, GitHub or chat:

   | Setting | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Stripe secret or restricted key with Checkout Session read access |
   | `STRIPE_COURSE_WEBHOOK_SECRET` | Endpoint signing secret beginning `whsec_` |
   | `STRIPE_COURSE_PAYMENT_LINK` | The actual public `https://buy.stripe.com/...` URL |
   | `STRIPE_COURSE_PAYMENT_LINK_ID` | Corresponding `plink_...` ID |
   | `STRIPE_COURSE_PRICE_ID` | Corresponding `price_...` ID |
   | `YOURBLOOM_COURSE_ENABLED` | `true` only after an end-to-end test succeeds |
   | `STRIPE_COURSE_TEST_MODE` | `true` for test mode only; omit or set `false` for live |

5. Register **snapshot** Stripe events at `https://yourbloom.site/course-api/webhook`:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
6. Complete a Stripe **test-mode** checkout and confirm redirect, server verification and PDF download. Confirm invalid/unpaid/wrong-product sessions cannot download. Then use matching live key, live price, live link and live webhook secret; remove test mode and activate enrollment. No real payment was made during development.

## Delivery behavior

- `/course-api/config` exposes only public availability and the checkout link. It fails closed if any required setting or private PDF is missing.
- `/course-api/access` and `/course-api/download` accept a same-origin POST with a Checkout Session ID. The Worker retrieves the session directly from Stripe and checks its mode, environment, product price, Payment Link, quantity, currency, exact amount and paid status before granting access.
- `/course-api/webhook` checks the raw-body HMAC signature and a five-minute timestamp tolerance before fetching the current Stripe session. It handles delayed payments. A deterministic private R2 receipt is written under `orders/<session>.json`; concurrent requests and duplicate events have the same result.
- The return page verifies payment independently, so access does not depend on webhook timing. PDF responses have private/no-store headers. The page removes the session query from the address bar and has no third-party scripts or referrer leakage. The session is a private access credential; purchasers should keep the original access link private. No login-based library or automatic email fulfillment is implemented. Order support uses the existing studio email.
- A refund does not automatically revoke an already downloaded PDF. Automated refund/dispute revocation and transactional email can be added separately if needed.

The existing enquiry Worker and static website remain in place; the course API is routed through the same Worker. All original enquiry tests plus the new payment/delivery tests run using `node --test tests/*.test.mjs` with stubbed outbound services.

## Reference documentation

- Stripe fulfillment: https://docs.stripe.com/checkout/fulfillment
- Payment Link redirects: https://docs.stripe.com/payment-links/post-payment
- Webhook signatures: https://docs.stripe.com/webhooks
- Cloudflare private R2 bindings: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

Visual inspiration: the worn paper, dark textured background, torn edges, oversized condensed typography and handwritten overlays at niolysale.com. YourBloom composition, model, logo, palette and copy are original or belong to the existing YourBloom project.
