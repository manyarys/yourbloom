/* YourBloom isolated frontend. No network requests or production integrations. */
(() => {
  'use strict';
  window.yourbloomDraftEvents?.abort();
  const events = new AbortController();
  window.yourbloomDraftEvents = events;
  document.documentElement.classList.add('js');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  const closeMenu = (restoreFocus = false) => {
    if (!toggle || !nav) return;
    nav.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Menu';
    if (restoreFocus) toggle.focus();
  };
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    nav.dataset.open = String(open);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') closeMenu(true);
  }, { signal: events.signal });
  document.addEventListener('click', e => {
    if (toggle?.getAttribute('aria-expanded') === 'true' && !e.target.closest('.site-header')) closeMenu();
  }, { signal: events.signal });
  nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu()));

  const form = document.getElementById('enquiry-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const preview = document.getElementById('brief-preview');
  const previewText = document.getElementById('brief-preview-text');
  const previewButton = document.getElementById('preview-brief');
  previewButton.disabled = false;
  form.addEventListener('submit', e => e.preventDefault());

  function updateRole() {
    const role = form.querySelector('[name="audience"]:checked')?.value || 'brand';
    form.querySelectorAll('[data-for-roles]').forEach(group => {
      const visible = group.dataset.forRoles.split(' ').includes(role);
      group.hidden = !visible;
      group.querySelectorAll('input,select,textarea').forEach(field => {
        field.disabled = !visible;
        field.required = visible && field.dataset.required === 'true';
      });
    });
    preview.hidden = true;
    status.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(f => f.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(f => f.textContent = '');
  }
  const queryRole = new URLSearchParams(location.search).get('audience');
  const roleFromHash = new URLSearchParams(location.hash.split('?')[1] || '').get('audience');
  const requested = roleFromHash || queryRole;
  if (['brand','creator','agency','event'].includes(requested)) form.querySelector(`[name="audience"][value="${requested}"]`).checked = true;
  form.querySelectorAll('[name="audience"]').forEach(r => r.addEventListener('change', updateRole));
  updateRole();

  function validate() {
    const errors = [];
    form.querySelectorAll('input,select,textarea').forEach(field => {
      if (field.disabled || field.type === 'radio') return;
      const error = document.getElementById(`${field.id}-error`);
      let message = '';
      if (field.required && ((field.type === 'checkbox' && !field.checked) || (field.type !== 'checkbox' && !field.value.trim()))) message = field.type === 'checkbox' ? 'Please confirm this to continue.' : 'Please complete this field.';
      else if (field.value && !field.checkValidity()) message = field.type === 'email' ? 'Enter a valid email address.' : field.type === 'url' ? 'Enter a complete website address, beginning with https://.' : 'Please check this value.';
      if (!message && field.type === 'url' && field.value) {
        try { if (!['https:','http:'].includes(new URL(field.value).protocol)) message = 'Use an https:// or http:// address.'; }
        catch { message = 'Enter a complete website address, beginning with https://.'; }
      }
      if (error) error.textContent = message;
      if (message) { field.setAttribute('aria-invalid','true'); errors.push(field); }
      else field.removeAttribute('aria-invalid');
    });
    if (errors.length) {
      status.textContent = `Please check ${errors.length === 1 ? 'the highlighted field' : 'the highlighted fields'}. Nothing has been sent.`;
      errors[0].focus();
      return false;
    }
    return true;
  }
  previewButton.addEventListener('click', () => {
    preview.hidden = true;
    if (!validate()) return;
    const values = new FormData(form);
    const names = {audience:'Enquiry',name:'Name',email:'Email',company:'Company / agency',website:'Website',market:'Market',deadline:'Preferred timing',budget:'Creator / event budget',profile:'Public creator profile',niche:'Content focus',preferences:'Collaboration preferences',event:'Event / project',location:'Event location',rights:'Partnership rights / scope',requirements:'Agency requirements',message:'Brief',adult:'Adult creator',future:'Future relevant opportunities'};
    const lines = [];
    for (const [key,value] of values) {
      if (!value || !names[key]) continue;
      lines.push(`${names[key]}: ${value === 'on' ? 'Confirmed' : value}`);
    }
    previewText.textContent = lines.join('\n\n');
    preview.hidden = false;
    status.textContent = 'Your brief preview is ready below. Nothing has been sent or saved.';
    preview.focus();
  });
  document.getElementById('clear-brief')?.addEventListener('click', () => {
    form.reset();updateRole();previewText.textContent='';status.textContent='Preview cleared. Nothing was sent or saved.';
  });
})();
