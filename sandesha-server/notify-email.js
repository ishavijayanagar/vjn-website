'use strict';

/**
 * Optional SMTP notifier for WhatsApp pairing codes and dashboard URLs.
 * Uses Node's built-in net/tls (no extra npm dependency).
 * No-op unless SANDESHA_NOTIFY_EMAIL and SMTP_* are configured.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');

function loadEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

loadEnvFile(path.join(__dirname, '.env'));

function isNotifyConfigured() {
  return Boolean(
    process.env.SANDESHA_NOTIFY_EMAIL &&
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function formatPairingCode(code) {
  const raw = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return raw || String(code || '');
}

function encodeSubject(subject) {
  // RFC 2047 for non-ASCII; keep simple ASCII subjects as-is
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** SANDESHA_NOTIFY_EMAIL may hold several addresses, comma/semicolon separated. */
function splitRecipients(to) {
  return String(to || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

function buildMimeMessage({ from, to, subject, text, html, attachments }) {
  const stamp = Date.now().toString(36);
  const altBoundary = `sandesha_alt_${stamp}`;
  const mixBoundary = `sandesha_mix_${stamp}`;
  const hasAtt = Array.isArray(attachments) && attachments.length > 0;
  const headers = [
    `From: ${from}`,
    `To: ${splitRecipients(to).join(', ')}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    hasAtt
      ? `Content-Type: multipart/mixed; boundary="${mixBoundary}"`
      : `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ''
  ];

  const alt = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${altBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || text.replace(/\n/g, '<br>\n'),
    `--${altBoundary}--`,
    ''
  ];

  if (!hasAtt) return headers.concat(alt).join('\r\n');

  const parts = [
    `--${mixBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    ...alt
  ];
  for (const a of attachments) {
    const b64 = Buffer.from(a.content).toString('base64').replace(/(.{76})/g, '$1\r\n');
    parts.push(
      `--${mixBoundary}`,
      `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.filename}"`,
      '',
      b64
    );
  }
  parts.push(`--${mixBoundary}--`, '');
  return headers.concat(parts).join('\r\n');
}

function createSmtpSession(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setEncoding('utf8');
    socket.on('error', reject);
  });
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk;
      // SMTP multi-line: final line is "NNN " (space) not "NNN-"
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve({ code: Number(last.slice(0, 3)), text: buffer });
      }
    };
    const onError = (err) => {
      socket.off('data', onData);
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function smtpCommand(socket, command, expectCodes) {
  if (command !== null) socket.write(command.endsWith('\r\n') ? command : `${command}\r\n`);
  const res = await readResponse(socket);
  if (expectCodes && !expectCodes.includes(res.code)) {
    throw new Error(`SMTP unexpected ${res.code}: ${res.text.trim()}`);
  }
  return res;
}

async function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.setEncoding('utf8');
    secure.on('error', reject);
  });
}

/**
 * Minimal SMTP AUTH LOGIN send (supports port 465 implicit TLS and 587 STARTTLS).
 */
async function sendMailViaSmtp({ from, to, subject, text, html, attachments }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const implicitTls = port === 465;

  let socket = await createSmtpSession(host, port, implicitTls);
  await smtpCommand(socket, null, [220]);
  await smtpCommand(socket, `EHLO sandesha.local`, [250]);

  if (!implicitTls) {
    await smtpCommand(socket, 'STARTTLS', [220]);
    socket = await upgradeToTls(socket, host);
    await smtpCommand(socket, `EHLO sandesha.local`, [250]);
  }

  await smtpCommand(socket, 'AUTH LOGIN', [334]);
  await smtpCommand(socket, Buffer.from(user, 'utf8').toString('base64'), [334]);
  await smtpCommand(socket, Buffer.from(pass, 'utf8').toString('base64'), [235]);

  // Envelope from: strip display name if present
  const mailFrom = (from.match(/<([^>]+)>/) || [, from])[1].trim();
  await smtpCommand(socket, `MAIL FROM:<${mailFrom}>`, [250]);
  for (const rcpt of splitRecipients(to)) {
    await smtpCommand(socket, `RCPT TO:<${rcpt}>`, [250, 251]);
  }
  await smtpCommand(socket, 'DATA', [354]);

  const mime = buildMimeMessage({ from, to, subject, text, html, attachments });
  // Dot-stuffing: lines starting with .
  const stuffed = mime.replace(/^\./gm, '..');
  socket.write(`${stuffed}\r\n.\r\n`);
  await smtpCommand(socket, null, [250]);
  await smtpCommand(socket, 'QUIT', [221]).catch(() => {});
  socket.end();
}

/**
 * @param {{ subject: string, text: string, html?: string }} opts
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
async function sendNotifyEmail(opts) {
  if (!isNotifyConfigured()) {
    return { sent: false, skipped: true };
  }

  try {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const to = process.env.SANDESHA_NOTIFY_EMAIL;
    await sendMailViaSmtp({
      from,
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message || String(err) };
  }
}

async function sendPairingCodeEmail(code) {
  const formatted = formatPairingCode(code);
  const text = [
    `Your Sandesha WhatsApp pairing code is: ${formatted}`,
    '',
    'On your phone:',
    '1. Open WhatsApp',
    '2. Linked devices → Link a device',
    '3. Tap "Link with phone number instead"',
    `4. Enter: ${formatted}`,
    '',
    'This code expires in a few minutes. If it expired, check the bot terminal or wait for a new email.'
  ].join('\n');

  const html = `
    <p>Your Sandesha WhatsApp pairing code is:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:0.12em;font-family:monospace">${formatted}</p>
    <ol>
      <li>Open WhatsApp on your phone</li>
      <li>Linked devices → Link a device</li>
      <li>Tap <strong>Link with phone number instead</strong></li>
      <li>Enter <strong>${formatted}</strong></li>
    </ol>
    <p style="color:#666">This code expires in a few minutes.</p>
  `.trim();

  return sendNotifyEmail({
    subject: `Sandesha pairing code`,
    text,
    html
  });
}

async function sendQrEmail(qrPath, opts = {}) {
  let png;
  try {
    png = fs.readFileSync(qrPath);
  } catch (err) {
    return { sent: false, error: `QR image not readable: ${err.message}` };
  }
  const liveUrl = opts.liveUrl ? String(opts.liveUrl).replace(/\/$/, '') : '';
  const text = [
    'Sandesha needs WhatsApp linked. Scan the attached QR code:',
    '',
    'WhatsApp → Settings → Linked devices → Link a device',
    '',
    'QR codes expire within about a minute. If this one no longer works, open a fresh one' +
      (liveUrl ? `: ${liveUrl}` : ' from the server dashboard.'),
  ].join('\n');
  const html = `
    <p><strong>Sandesha needs WhatsApp linked.</strong> Scan the attached <code>sandesha-qr.png</code>:</p>
    <p>WhatsApp &rarr; Settings &rarr; Linked devices &rarr; Link a device</p>
    <p style="color:#666">QR codes expire within about a minute.${liveUrl ? ` If it no longer works, open a fresh one: <a href="${liveUrl}">${liveUrl}</a>` : ''}</p>
  `.trim();
  return sendNotifyEmail({
    subject: 'Sandesha: scan WhatsApp QR code',
    text,
    html,
    attachments: [{ filename: 'sandesha-qr.png', contentType: 'image/png', content: png }]
  });
}

async function sendDashboardUrlEmail(url, opts = {}) {
  const dashboardUrl = String(url || '').trim().replace(/\/$/, '');
  if (!dashboardUrl) {
    return { sent: false, error: 'No dashboard URL provided' };
  }
  const localUrl = opts.localUrl || 'http://127.0.0.1:42620/';
  const text = [
    'Sandesha is online.',
    '',
    `Dashboard (public): ${dashboardUrl}`,
    `Local (on the server): ${localUrl}`,
    '',
    'Open the public link on your phone or laptop, then log in with your admin password.',
    'Note: Quick Tunnel URLs change every time the tunnel restarts.',
  ].join('\n');

  const html = `
    <p><strong>Sandesha is online.</strong></p>
    <p>Dashboard (public):<br>
      <a href="${dashboardUrl}" style="font-size:18px;word-break:break-all">${dashboardUrl}</a>
    </p>
    <p>Open the public link, then log in with your admin password.</p>
    <p style="color:#666;font-size:13px">Quick Tunnel URLs change every time the tunnel restarts.</p>
  `.trim();

  return sendNotifyEmail({
    subject: 'Sandesha dashboard is online',
    text,
    html
  });
}

module.exports = {
  isNotifyConfigured,
  formatPairingCode,
  sendNotifyEmail,
  sendPairingCodeEmail,
  sendQrEmail,
  sendDashboardUrlEmail
};

// CLI: node notify-email.js dashboard <url>
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  (async () => {
    if (cmd === 'dashboard' && arg) {
      const result = await sendDashboardUrlEmail(arg);
      if (result.skipped) {
        console.log('Email skipped (set SANDESHA_NOTIFY_EMAIL + SMTP_* in .env)');
        process.exit(0);
      }
      if (result.sent) {
        console.log('Dashboard URL emailed to', process.env.SANDESHA_NOTIFY_EMAIL);
        process.exit(0);
      }
      console.error('Failed to email dashboard URL:', result.error || 'unknown');
      process.exit(1);
    }
    console.error('Usage: node notify-email.js dashboard <https-url>');
    process.exit(2);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
