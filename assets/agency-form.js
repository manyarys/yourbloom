/* YourBloom navigation and enquiries. Bot credentials exist only on the server. */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  const closeMenu = focus => {
    if (!toggle || !nav) return;
    nav.dataset.open = 'false'; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Menu';
    if (focus) toggle.focus();
  };
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? 'Close' : 'Menu';
    nav.dataset.open = String(open);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') closeMenu(true); });
  document.addEventListener('click', e => { if (toggle?.getAttribute('aria-expanded') === 'true' && !e.target.closest('.site-header')) closeMenu(); });
  nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu(false)));
  const form = document.getElementById('enquiry-form');
  if (!form) return;
  const button = document.getElementById('send-brief');
  const clear = document.getElementById('clear-form');
  const status = document.getElementById('form-status');
  const endpoint = '/api/partnership-enquiry';
  let ready = false, sending = false;
  const unavailable = 'The enquiry form is temporarily unavailable. Please email hello@yourbloom.site.';
  function roleChanged() {
    const role = form.querySelector('[name="audience"]:checked')?.value || 'brand';
    form.querySelectorAll('[data-for-roles]').forEach(group => {
      const visible = group.dataset.forRoles.split(' ').includes(role); group.hidden = !visible;
      group.querySelectorAll('input,select,textarea').forEach(field => { field.disabled = !visible; field.required = visible && field.dataset.required === 'true'; });
    });
    form.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(e => { e.textContent = ''; });
  }
  const role = new URLSearchParams(location.search).get('audience');
  if (['brand', 'creator', 'agency', 'event'].includes(role)) form.querySelector(`[name="audience"][value="${role}"]`).checked = true;
  form.querySelectorAll('[name="audience"]').forEach(e => e.addEventListener('change', roleChanged));
  roleChanged();
  async function checkAvailability() {
    try {
      const response = await fetch(endpoint + '/config', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
      const config = await response.json(); ready = response.ok && config.available === true;
    } catch { ready = false; }
    button.disabled = !ready;
    status.textContent = ready ? '' : unavailable;
  }
  function validate() {
    const errors = [];
    form.querySelectorAll('input,select,textarea').forEach(field => {
      if (field.disabled || field.type === 'radio' || field.name === 'company_url') return;
      const error = document.getElementById(field.id + '-error');
      let message = '';
      if (field.required && (field.type === 'checkbox' ? !field.checked : !field.value.trim())) message = field.type === 'checkbox' ? 'Please confirm this to continue.' : 'Please complete this field.';
      else if (!field.checkValidity()) message = field.type === 'email' ? 'Enter a valid email address.' : 'Please check this value.';
      if (!message && field.type === 'url' && field.value) {
        try { if (!['http:', 'https:'].includes(new URL(field.value).protocol)) message = 'Use a complete http:// or https:// address.'; }
        catch { message = 'Use a complete http:// or https:// address.'; }
      }
      if (error) error.textContent = message;
      if (message) { field.setAttribute('aria-invalid', 'true'); errors.push(field); } else field.removeAttribute('aria-invalid');
    });
    if (errors.length) { status.textContent = 'Please check the highlighted fields.'; errors[0].focus(); return false; }
    return true;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !ready) return;
    if (!validate()) return;
    const values = Object.fromEntries(new FormData(form));
    for (const key of ['adult', 'future', 'privacy']) if (key in values) values[key] = values[key] === 'on';
    sending = true; button.disabled = true; clear.disabled = true; button.textContent = 'Sending…';
    const controls = [...form.querySelectorAll('input,select,textarea')].filter(e => !e.disabled);
    controls.forEach(e => { e.disabled = true; });
    status.textContent = 'Sending your enquiry…';
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        const messages = {
          invalid_fields: 'Please check your details and try again.', privacy_required: 'Please confirm the privacy acknowledgement.',
          brief_too_long: 'Please shorten your brief and optional details, then try again.', too_large: 'Please shorten your brief and try again.',
          rate_limited: 'Please wait a little before sending another enquiry.', unavailable,
          delivery_unconfirmed: 'We could not confirm delivery. Please email hello@yourbloom.site before sending again.'
        };
        status.textContent = messages[result.code] || messages.delivery_unconfirmed;
        return;
      }
      form.reset(); status.textContent = 'Your enquiry has been delivered. We’ll reply using the email you provided.';
      status.focus();
    } catch {
      status.textContent = 'We could not confirm delivery. Please email hello@yourbloom.site before sending again.';
    } finally {
      controls.forEach(e => { e.disabled = false; }); roleChanged();
      sending = false; clear.disabled = false; button.textContent = 'Send your brief'; button.disabled = !ready;
    }
  });
  clear.addEventListener('click', () => { if (!sending) { form.reset(); roleChanged(); status.textContent = ready ? '' : unavailable; } });
  checkAvailability();
})();
