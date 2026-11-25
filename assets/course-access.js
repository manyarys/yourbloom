const status = document.querySelector('#access-status');
const title = document.querySelector('#access-title');
const download = document.querySelector('#download-course');
const retry = document.querySelector('#check-payment');
const candidate = new URL(location.href).searchParams.get('session_id');
let session = '';
if (/^cs_(?:test_|live_)?[A-Za-z0-9]{16,240}$/.test(candidate || '')) {
  session = candidate;
  try { sessionStorage.setItem('yourbloom.course.session', session); } catch { /* Access still works without storage. */ }
} else {
  try { session = sessionStorage.getItem('yourbloom.course.session') || ''; } catch { /* The return URL is required on this device. */ }
}
if (location.search) history.replaceState(null, '', location.pathname);
function state(heading, message, ready = false, canRetry = false) {
  title.textContent = heading; status.textContent = message;
  download.hidden = !ready; retry.hidden = !canRetry;
}
async function api(action) {
  return fetch('/course-api/' + action, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: session }) });
}
async function checkPayment() {
  if (!session) { state('YOUR NEXT CHAPTER.', 'Open the course access link shown after checkout to verify your order. If you haven’t purchased the course, you can explore it below.'); return; }
  retry.disabled = true;
  state('CHECKING YOUR ORDER.', 'Your payment is being verified. This usually takes a moment.');
  try {
    const response = await api('access');
    const data = await response.json();
    if (response.ok && data.ok === true && data.ready === true) state('YOURS TO EXPLORE.', 'Your payment is confirmed. Download your Creator Growth & Brand Deals PDF and work through it at your own pace.', true);
    else if (response.status === 202) state('ONE MOMENT MORE.', 'Your payment is still processing. Your PDF will unlock once it is confirmed. You can check again below.', false, true);
    else if ([400, 403, 404].includes(response.status)) state('LET’S CHECK THE LINK.', 'This link could not be verified for this course. Open the access link from your checkout, or contact YourBloom with your order confirmation.');
    else state('LET’S TRY AGAIN.', 'Course access is temporarily unavailable. Keep your checkout confirmation and try again shortly. Contact YourBloom if you need help.', false, true);
  } catch { state('LET’S TRY AGAIN.', 'We couldn’t reach the course service. Check your connection and try again.', false, true); }
  finally { retry.disabled = false; }
}
retry.addEventListener('click', checkPayment);
download.addEventListener('click', async () => {
  download.disabled = true; status.textContent = 'Preparing your PDF download…';
  try {
    const response = await api('download');
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('download_unavailable');
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = blobUrl; link.download = 'YourBloom-Creator-Growth-and-Brand-Deals.pdf';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    status.textContent = 'Your download is ready. Enjoy your course—and keep this access link private.';
  } catch { status.textContent = 'The download could not be completed. Please try again or contact YourBloom with your order confirmation.'; }
  finally { download.disabled = false; }
});
checkPayment();
