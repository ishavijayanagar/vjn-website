/**
 * Manual-send sheet — the way to post a queued message by hand.
 *
 * Sandesha paces a fan-out over ten to twenty minutes and holds anything due
 * during quiet hours, and it cannot send at all while WhatsApp is unlinked.
 * When something needs to go out now, this is the escape hatch: take the
 * flyer into Photos, take the words onto the clipboard, post it in WhatsApp
 * yourself, then tell the queue you have done it so it does not send twice.
 */
import { escapeHtml, fetchMedia } from './api.js';
import { toast } from './toast.js';

const COPY_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const SAVE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
const TICK_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const EDIT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';

/** The promotions page mounts sheets inside the phone frame, not on body. */
function frame() {
  return document.getElementById('app') || document.body;
}

/** The board owns the gallery-save plumbing; borrow it when it is present. */
function board() {
  return window.VjnPromoBoard || null;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and a live gesture; fall back to
    // a throwaway textarea, which works in more places than it looks.
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * @param {object}   opts
 * @param {string}   opts.title      who the message is for
 * @param {string}   opts.when       when it was due to go out
 * @param {string}   opts.message    the text to copy
 * @param {string}   [opts.flyerUrl] where the attachment can be fetched
 * @param {string}   [opts.flyerName]
 * @param {number}   [opts.queuedCount] rows this message occupies in the queue
 * @param {function} [opts.onEdit]   shown as Edit when the message can be changed
 * @param {function} [opts.onPosted] called after "I posted this"; may throw
 */
export function openManualSendSheet(opts) {
  const host = frame();
  const message = String(opts.message || '');
  const hasFlyer = Boolean(opts.flyerUrl);
  const queued = Number(opts.queuedCount) || 1;
  const doneLabel = queued > 1
    ? `I posted this — cancel all ${queued} queued sends`
    : 'I posted this — cancel the queued send';

  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Post this by hand');
  sheet.innerHTML = `
    <div class="grab"></div>
    <div class="sh-head">
      <div class="sh-head-row">
        <h3>Queued message</h3>
        ${opts.onEdit ? `<button type="button" class="linkbtn" id="msEdit">${EDIT_ICON}Edit</button>` : ''}
      </div>
      <p>${escapeHtml(opts.title || '')}${opts.when ? ` · ${escapeHtml(opts.when)}` : ''}</p>
    </div>
    ${hasFlyer ? '<div class="ms-art" id="msArt"><span class="ms-art-ph"></span></div>' : ''}
    <div class="ms-label">Message</div>
    <div class="ms-msg">${message ? escapeHtml(message) : '<i>No message</i>'}</div>
    <div class="ms-steps">
      <button type="button" class="b" id="msCopy" ${message ? '' : 'disabled'}>
        <span class="lbl">${COPY_ICON}${message ? 'Copy text' : 'No text'}</span>
      </button>
      <button type="button" class="b" id="msSave" ${hasFlyer ? '' : 'disabled'}>
        <span class="lbl">${SAVE_ICON}${hasFlyer ? 'Save flyer to Photos' : 'No flyer'}</span>
      </button>
    </div>
    <p class="ms-label ms-label-lead">Or post it by hand</p>
    <p class="ms-note">Post it in WhatsApp yourself, then mark it done here so
      Sandesha does not send the same thing again.${
        queued > 1 ? ` This message is queued for ${queued} lists — all of them are cancelled.` : ''
      }</p>
    <div class="sh-foot">
      <button type="button" class="b pri" id="msDone">
        <span class="lbl">${TICK_ICON}${doneLabel}</span>
      </button>
    </div>`;

  // /media is behind the bearer token, so neither <img src> nor a bare fetch
  // can reach it. Pull the bytes once and let the preview and the save share.
  let bytesPromise = null;
  let previewUrl = '';

  function flyerBytes() {
    if (!hasFlyer) return Promise.reject(new Error('No flyer on this message'));
    if (bytesPromise) return bytesPromise;
    bytesPromise = fetchMedia(opts.flyerName || opts.flyerUrl).catch((err) => {
      bytesPromise = null;
      throw err;
    });
    return bytesPromise;
  }

  function close() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    scrim.classList.remove('on');
    sheet.classList.remove('on');
    const drop = () => {
      scrim.remove();
      sheet.remove();
    };
    sheet.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 400);
  }

  sheet.querySelector('#msCopy')?.addEventListener('click', async () => {
    const copied = await copyText(message);
    toast(copied ? 'Message copied' : 'Could not copy — select it by hand', copied ? 'ok' : 'err');
  });

  sheet.querySelector('#msSave')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const bridge = board();
    btn.disabled = true;
    try {
      // Started before the first await, so the directory picker still counts
      // as being inside the tap that opened it.
      const dirPromise = bridge ? bridge.galleryDirRequest() : null;
      const pending = flyerBytes();
      if (!bridge) {
        // No board on this page — hand the bytes over as a plain download.
        const resolved = await pending;
        const url = URL.createObjectURL(resolved.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = resolved.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Flyer downloaded', 'ok');
        return;
      }
      const done = await bridge.saveBlobToGallery(pending, {
        dirPromise,
        label: opts.title || 'Flyer',
      });
      if (done) toast(done, 'ok');
    } catch (err) {
      if (err?.name === 'AbortError') toast('Save cancelled', 'info');
      else toast(err.message || 'Could not save the flyer', 'err');
    } finally {
      btn.disabled = false;
    }
  });

  sheet.querySelector('#msDone')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.querySelector('.lbl').textContent = 'Cancelling…';
    try {
      if (opts.onPosted) await opts.onPosted();
      toast('Marked as posted — the queued send is cancelled', 'ok');
      close();
    } catch (err) {
      toast(err.message || 'Could not cancel the queued send', 'err');
      btn.disabled = false;
      btn.querySelector('.lbl').innerHTML = `${TICK_ICON}${doneLabel}`;
    }
  });

  sheet.querySelector('#msEdit')?.addEventListener('click', () => {
    close();
    opts.onEdit();
  });

  scrim.addEventListener('click', close);

  if (hasFlyer) {
    flyerBytes().then(({ blob }) => {
      const art = sheet.querySelector('#msArt');
      if (!art || !sheet.isConnected) return;
      previewUrl = URL.createObjectURL(blob);
      art.innerHTML = `<img src="${previewUrl}" alt=""/>`;
    }).catch(() => {
      const art = sheet.querySelector('#msArt');
      if (art) art.innerHTML = '<span class="ms-art-ph">Flyer unavailable — the server may be offline</span>';
    });
  }

  host.append(scrim, sheet);
  requestAnimationFrame(() => {
    scrim.classList.add('on');
    sheet.classList.add('on');
  });
}
