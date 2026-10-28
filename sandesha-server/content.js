'use strict';

/** Site text/banner and the fixed list of program names (Sheet tabs Site, ProgramTitles). */

const SITE_DEFAULTS = {
  hero_quote:
    '"If tears of joy, tears of love, tears of ecstasy have not washed your cheeks, you are yet to experience life."',
  about_label: 'About This Centre',
  about_heading: 'A Space for Inner Wellbeing',
  about_body:
    'A local Isha Foundation centre offering yoga, meditation, and inner wellbeing programs. Whether you are a beginner or a seasoned practitioner, this is a space for you to grow, transform, and contribute.',
  footer_address: '195, 1st Floor, 17th Cross Rd,\nCHBS Layout, MC Layout,\nVijayanagar, Bengaluru – 560040',
  footer_phone: '+91 80957 63111',
  footer_hours: 'Mon – Sun\n10:00 AM – 8:00 PM',
  hero_image: '',
  hero_image_mobile: '',
  banner_enabled: '',
  banner_image: '',
  banner_link: '',
  banner_until: '',
  banner_text: '',
};

function createContent({ db, onChange = () => {} }) {
  const q = {
    siteAll: db.prepare('SELECT key, value FROM site_content'),
    sitePut: db.prepare('INSERT INTO site_content (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    titlesAll: db.prepare('SELECT title, active FROM program_titles'),
    titleGet: db.prepare('SELECT title, active FROM program_titles WHERE lower(title) = lower(?)'),
    titlePut: db.prepare('INSERT INTO program_titles (title, active) VALUES (?, 1) ON CONFLICT (title) DO UPDATE SET active = 1'),
    titleSet: db.prepare('UPDATE program_titles SET active = ? WHERE title = ?'),
  };

  function site() {
    const content = { ...SITE_DEFAULTS };
    for (const r of q.siteAll.all()) if (r.key) content[r.key] = r.value;
    return { content };
  }

  /** Only the keys the caller sent, so saving the banner never blanks other text. */
  function saveSite(incoming) {
    const changed = [];
    db.transaction(() => {
      for (const key of Object.keys(SITE_DEFAULTS)) {
        if (!incoming || incoming[key] === undefined) continue;
        const value = String(incoming[key]);
        q.sitePut.run(key, value);
        changed.push([key, value]);
      }
    })();
    for (const [key, value] of changed) onChange('site', 'upsert', key, { key, value });
  }

  function titles() {
    return q.titlesAll.all().filter((t) => t.active).map((t) => t.title);
  }

  function addTitle(raw) {
    const title = String(raw || '').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('Enter a program name.');
    const existing = q.titleGet.get(title);
    if (existing && existing.active) throw new Error('That program name is already in the list.');
    if (existing) q.titleSet.run(1, existing.title);
    else q.titlePut.run(title);
    onChange('programTitles', 'upsert', existing ? existing.title : title, { title: existing ? existing.title : title, active: 'yes' });
    return titles();
  }

  function importSite(rows) {
    db.transaction(() => { for (const r of rows || []) if (r.key) q.sitePut.run(String(r.key), String(r.value || '')); })();
  }

  function importTitles(rows) {
    db.transaction(() => {
      for (const r of rows || []) {
        const title = String(r.title || '').trim();
        if (!title) continue;
        q.titlePut.run(title);
        if (/^no$/i.test(String(r.active || ''))) q.titleSet.run(0, title);
      }
    })();
  }

  return { site, saveSite, titles, addTitle, importSite, importTitles };
}

module.exports = { createContent, SITE_DEFAULTS };
