const dialog = document.querySelector('#enrollment');
let checkoutUrl = '';
document.querySelectorAll('[data-year]').forEach(node => { node.textContent = new Date().getFullYear(); });
document.querySelectorAll('[data-enroll]').forEach(link => {
  link.addEventListener('click', event => {
    if (checkoutUrl) return;
    event.preventDefault();
    if (dialog?.showModal) dialog.showModal();
    else location.href = 'mailto:hello@yourbloom.site?subject=YourBloom%20course%20launch';
  });
});
document.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
async function loadEnrollment() {
  try {
    const response = await fetch('/course-api/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    const data = await response.json();
    if (data.available !== true || data.amount !== 19000 || data.currency !== 'usd') return;
    const url = new URL(data.checkoutUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'buy.stripe.com' || url.username || url.password) return;
    checkoutUrl = url.href;
    document.querySelectorAll('[data-enroll]').forEach(link => { link.href = checkoutUrl; });
    document.querySelectorAll('[data-availability]').forEach(node => { node.textContent = 'One-time payment. PDF download after confirmed checkout.'; });
    const answer = document.querySelector('[data-sales-answer]');
    if (answer) answer.textContent = 'Yes. Use the course button to pay $190 USD securely through Stripe. Your course is available to download after payment is confirmed.';
  } catch { /* Keep the accurate pre-launch state when enrollment is unavailable. */ }
}
loadEnrollment();
