/**
 * Global progress bus.
 * Any long-running operation calls startProgress / updateProgress / endProgress.
 * The Dashboard page subscribes via window events to render live progress cards.
 *
 * Event: 'sandesha:progress'  — detail: ProgressState | null (null = finished)
 *
 * ProgressState {
 *   id:       string     unique operation id
 *   label:    string     e.g. "Sending to 12 groups"
 *   done:     number     completed items
 *   total:    number     total items
 *   pct:      number     0-100
 *   eta:      string     "~8s left" or ""
 *   startTs:  number     Date.now()
 *   status:   'running' | 'done' | 'error'
 *   result:   string     final summary message
 * }
 */

let _active = null;

function emit() {
  window.dispatchEvent(new CustomEvent('sandesha:progress', { detail: _active ? { ..._active } : null }));
}

/**
 * Start a new tracked operation.
 * @param {{ id?: string, label: string, total?: number }} opts
 * @returns {string} operation id
 */
export function startProgress({ id, label, total = 0 } = {}) {
  const opId = id || `op-${Date.now()}`;
  _active = {
    id: opId,
    label,
    done: 0,
    total,
    pct: 0,
    eta: '',
    startTs: Date.now(),
    status: 'running',
    result: '',
  };
  emit();
  return opId;
}

/**
 * Update progress for the active operation.
 * @param {{ id?: string, done: number, total?: number, label?: string }} opts
 */
export function updateProgress({ id, done, total, label } = {}) {
  if (!_active) return;
  if (id && _active.id !== id) return;
  if (total != null) _active.total = total;
  _active.done = done;
  _active.pct = _active.total > 0 ? Math.min(100, Math.round((done / _active.total) * 100)) : 0;
  if (label) _active.label = label;

  if (_active.done > 0 && _active.total > 0) {
    const elapsed = Date.now() - _active.startTs;
    const msPerItem = elapsed / _active.done;
    const remainMs = (_active.total - _active.done) * msPerItem;
    const remainSec = Math.ceil(remainMs / 1000);
    _active.eta = remainSec > 1 ? `~${remainSec}s left` : 'finishing…';
  }
  emit();
}

/**
 * Mark operation done (success or error).
 * @param {{ id?: string, status?: 'done'|'error', result?: string }} opts
 */
export function endProgress({ id, status = 'done', result = '' } = {}) {
  if (!_active) return;
  if (id && _active.id !== id) return;
  _active.pct = status === 'done' ? 100 : _active.pct;
  _active.status = status;
  _active.result = result;
  _active.eta = '';
  emit();
  // Clear after 3s so dashboard stops showing the card
  const snapshot = _active;
  setTimeout(() => {
    if (_active?.id === snapshot.id) {
      _active = null;
      emit();
    }
  }, 3000);
}

/** Get current active progress (or null). */
export function getActiveProgress() {
  return _active ? { ..._active } : null;
}
