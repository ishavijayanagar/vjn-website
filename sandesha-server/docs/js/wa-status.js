/**
 * Simple WhatsApp status for Settings / Status.
 * Pairing UI is handled separately (banner only when a code exists).
 */
export function describeWhatsAppStatus(health, extra = {}) {
  const wa = health?.whatsapp;
  const groups = extra.groups ?? 0;
  const number = health?.info?.wid?.user || '—';
  const online = Boolean(wa?.connected || health?.info?.wid);

  if (online) {
    return {
      online: true,
      line: 'Connected',
      sub: `${number} · ${groups} groups`,
      showPairHelp: false,
      dot: 'online',
    };
  }

  if (wa?.pairingCode) {
    return {
      online: false,
      line: 'Logged out',
      sub: `Enter code ${wa.pairingCode} in WhatsApp`,
      showPairHelp: true,
      pairHelp: 'WhatsApp → Linked devices → Link a device → Link with phone number',
      dot: 'offline',
    };
  }

  return {
    online: false,
    line: 'Offline',
    sub: groups ? `${groups} groups` : '—',
    showPairHelp: false,
    dot: 'offline',
  };
}
