/**
 * Export members — Messaging → Tools. The page itself lives in
 * ../export-members-core.js (shared with the Nurturing Settings page); this
 * only says where Messaging gets its groups and how it asks for the export.
 */
import { api } from '../api.js';
import { getState, refreshCore } from '../store.js';
import { mountExportMembers } from '../export-members-core.js';

let view = null;

export function renderExportMembers() {
  const container = document.getElementById('sub-export-members');
  if (!container) return;
  if (!view) {
    view = mountExportMembers(container, {
      getGroups: async () => {
        const s = getState();
        if (!s.groups.length && !s.groupsLoaded) await refreshCore();
        const { groups, loadError } = getState();
        if (!groups.length && loadError) throw new Error(loadError);
        return groups;
      },
      exportMembers: (jids) => api('/groups/export-members', { method: 'POST', body: JSON.stringify({ jids }) }),
    });
  }
  view.render();
}
