/**
 * Inner Engineering gate for volunteering forms.
 * Volunteering needs Inner Engineering completed: "Yes" asks for the
 * completion month (required); "No" blocks the submit button and links
 * to the next upcoming Inner Engineering program.
 *
 *   IEGate.mount(el, { submitBtn })  render into el
 *   IEGate.read(el)                  { ok, value, message }
 *   IEGate.reset(el)
 */
(function () {
  const IE_RE = /inner\s*engineering/i;
  const FALLBACK_HREF = 'programs.html?q=' + encodeURIComponent('Inner Engineering');
  let upcomingPromise = null;

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** Next open Inner Engineering program, or null. Fetched once per page. */
  function findUpcomingIE() {
    if (upcomingPromise) return upcomingPromise;
    if (typeof APPS_SCRIPT_URL === 'undefined') return Promise.resolve(null);
    const today = new Date().toISOString().slice(0, 10);
    upcomingPromise = fetch(`${APPS_SCRIPT_URL}?type=programs`)
      .then((r) => r.json())
      .then((data) => {
        const items = (data.items || [])
          .filter((p) => IE_RE.test(p.title || ''))
          .filter((p) => !p.startdate || p.startdate >= today)
          .sort((a, b) => String(a.startdate || '9999').localeCompare(String(b.startdate || '9999')));
        return items[0] || null;
      })
      .catch(() => null);
    return upcomingPromise;
  }

  function formatDate(ymd) {
    if (!ymd) return '';
    const d = new Date(ymd + 'T00:00:00');
    if (isNaN(d)) return ymd;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderUpcoming(box) {
    const link = box.querySelector('.ie-gate-link');
    findUpcomingIE().then((p) => {
      if (!p) return;
      const href = p.registerlink || p.registerLink || `detail.html?id=${encodeURIComponent(p.id)}&type=program`;
      const when = formatDate(p.startdate);
      link.href = href;
      if (/^https?:/i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      link.innerHTML = 'Register for ' + escapeHtml(p.title) + (when ? ' · ' + escapeHtml(when) : '') + ' →';
    });
  }

  function mount(el, opts) {
    if (!el) return;
    el._ieOpts = opts || {};
    const name = 'ieDone_' + Math.random().toString(36).slice(2, 8);
    el.classList.add('ie-gate');
    el.innerHTML = `
      <div class="form-group">
        <label>Have you completed Inner Engineering? *</label>
        <div class="ie-gate-choice" role="radiogroup">
          <label><input type="radio" name="${name}" value="yes"/><span>Yes</span></label>
          <label><input type="radio" name="${name}" value="no"/><span>No</span></label>
        </div>
      </div>
      <div class="form-group ie-gate-date" hidden>
        <label>Inner Engineering completion (month &amp; year) *</label>
        <input type="month" class="ie-gate-month" max="${currentMonth()}" placeholder="YYYY-MM"/>
      </div>
      <div class="ie-gate-block" hidden>
        <p><strong>Inner Engineering is required to volunteer.</strong>
        If you haven't completed it yet, you won't be able to volunteer for now. Please register for the upcoming program:</p>
        <a class="ie-gate-link" href="${FALLBACK_HREF}">See upcoming Inner Engineering programs →</a>
      </div>`;
    el.querySelectorAll('input[type="radio"]').forEach((r) => {
      r.addEventListener('change', () => update(el));
    });
    update(el);
  }

  function choice(el) {
    const r = el.querySelector('input[type="radio"]:checked');
    return r ? r.value : '';
  }

  function update(el) {
    const c = choice(el);
    const dateBox = el.querySelector('.ie-gate-date');
    const block = el.querySelector('.ie-gate-block');
    dateBox.hidden = c !== 'yes';
    block.hidden = c !== 'no';
    if (c === 'no') renderUpcoming(block);
    const btn = el._ieOpts && el._ieOpts.submitBtn;
    if (btn) btn.disabled = c === 'no';
  }

  function read(el) {
    const c = choice(el);
    if (!c) return { ok: false, message: 'Please tell us if you have completed Inner Engineering.' };
    if (c === 'no') return { ok: false, message: 'Inner Engineering is required to volunteer. Please register for the upcoming program.' };
    const v = (el.querySelector('.ie-gate-month').value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(v)) return { ok: false, message: 'Please enter your Inner Engineering completion month and year.' };
    if (v > currentMonth()) return { ok: false, message: 'Inner Engineering completion date cannot be in the future.' };
    const [y, m] = v.split('-');
    const label = new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + '-' + y;
    return { ok: true, value: label };
  }

  function reset(el) {
    if (!el || !el.querySelector('.ie-gate-month')) return;
    el.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = false; });
    el.querySelector('.ie-gate-month').value = '';
    update(el);
  }

  window.IEGate = { mount, read, reset };
})();
