// =====================================================================
// Casa din Povesti — modul email (Resend HTTP API)
// ---------------------------------------------------------------------
// Trimite doua email-uri la fiecare rezervare:
//   1. Catre proprietar (NOTIFY_EMAIL) — notificare detaliata
//   2. Catre oaspete    — confirmare
//
// Foloseste Resend.com prin HTTP (nu SMTP) — functioneaza pe Render/Railway.
//
// Daca RESEND_API_KEY nu e setat, modulul nu trimite nimic
// (returneaza ok: false, reason: 'not-configured') si NU arunca eroare.
// =====================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Casa din Povesti <onboarding@resend.dev>';
const OWNER_EMAIL = process.env.NOTIFY_EMAIL || '';
const SITE_URL = process.env.SITE_URL || '';
const SEND_GUEST = process.env.SEND_GUEST_CONFIRMATION !== 'false';

if (RESEND_API_KEY) {
  console.log('  Email Resend:                 configurat ✓');
} else {
  console.log('  Email Resend:                 neconfigurat (sar peste notificari)');
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const monthsLong = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];

function fmtDateRo(s) {
  const [y,m,d] = s.split('-').map(Number);
  return `${d} ${monthsLong[m-1]} ${y}`;
}
function fmtMoney(v) {
  return v.toLocaleString('ro-RO') + ' MDL';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---------------------------------------------------------------------
// Trimite email prin Resend HTTP API
// ---------------------------------------------------------------------
async function sendEmail({ to, subject, html, replyTo }) {
  const body = {
    from: FROM,
    to: [to],
    subject,
    html,
  };
  if (replyTo) body.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend error ${response.status}: ${err}`);
  }

  return await response.json();
}

// ---------------------------------------------------------------------
// Template: notificare proprietar
// ---------------------------------------------------------------------
function ownerHtml(r) {
  const adminLink = SITE_URL ? `<p style="font-size:13px;color:#8a7a64;margin:18px 0 0">
    <a href="${SITE_URL}" style="color:#9a5e36">${SITE_URL}</a>
  </p>` : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4ece0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2b2418">
  <table role="presentation" width="100%" style="background:#f4ece0;padding:30px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" style="max-width:600px;background:#fbf6ec;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(40,25,10,.15)">
        <tr><td style="background:#3a4a2c;padding:24px 30px;color:#f4ece0">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;line-height:1">Casa din</div>
          <div style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#d8a36a;margin-top:2px">Povești</div>
        </td></tr>

        <tr><td style="padding:30px">
          <h1 style="font-family:Georgia,serif;font-size:28px;margin:0 0 6px;font-weight:600;color:#2b2418">Rezervare nouă! 🌿</h1>
          <p style="margin:0 0 22px;color:#5a4c3b;font-size:14.5px">Cineva tocmai și-a rezervat sejurul. Detaliile sunt mai jos — răspunde direct la acest email pentru a contacta oaspetele.</p>

          <div style="background:#ede3d3;border-radius:10px;padding:18px 20px;margin-bottom:18px">
            <table width="100%" style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#5a4c3b">ID rezervare</td><td align="right" style="padding:6px 0;font-weight:600">#${r.id}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Check-in</td><td align="right" style="padding:6px 0;font-weight:600">${fmtDateRo(r.checkIn)}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Check-out</td><td align="right" style="padding:6px 0;font-weight:600">${fmtDateRo(r.checkOut)}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Nopți</td><td align="right" style="padding:6px 0;font-weight:600">${r.nights}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Oaspeți</td><td align="right" style="padding:6px 0;font-weight:600">${r.guests}</td></tr>
              <tr><td style="padding:10px 0 0;color:#5a4c3b;border-top:1px dashed rgba(60,45,25,.18)">Total</td><td align="right" style="padding:10px 0 0;font-weight:700;color:#9a5e36;font-size:16px;border-top:1px dashed rgba(60,45,25,.18)">${fmtMoney(r.totalPrice)}</td></tr>
            </table>
          </div>

          <h3 style="font-family:Georgia,serif;font-size:18px;margin:18px 0 10px;color:#2b2418">Oaspete</h3>
          <div style="background:#fff;border:1px solid rgba(60,45,25,.15);border-radius:10px;padding:18px 20px">
            <table width="100%" style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:5px 0;color:#5a4c3b;width:90px">Nume</td><td style="padding:5px 0;font-weight:600">${escapeHtml(r.name)}</td></tr>
              <tr><td style="padding:5px 0;color:#5a4c3b">Email</td><td style="padding:5px 0"><a href="mailto:${escapeHtml(r.email)}" style="color:#9a5e36;text-decoration:none">${escapeHtml(r.email)}</a></td></tr>
              <tr><td style="padding:5px 0;color:#5a4c3b">Telefon</td><td style="padding:5px 0"><a href="tel:${escapeHtml(r.phone)}" style="color:#9a5e36;text-decoration:none">${escapeHtml(r.phone)}</a></td></tr>
              ${r.notes ? `<tr><td style="padding:8px 0 0;color:#5a4c3b;vertical-align:top">Observații</td><td style="padding:8px 0 0;font-style:italic;color:#5a4c3b">${escapeHtml(r.notes)}</td></tr>` : ''}
            </table>
          </div>

          <p style="font-size:13px;color:#8a7a64;margin:22px 0 0">Statusul actual: <strong>În așteptare</strong>. Confirmă rezervarea din panoul de admin sau prin telefon.</p>
          ${adminLink}
        </td></tr>

        <tr><td style="background:#3a4a2c;padding:18px 30px;color:#cdc4ae;font-size:12px;text-align:center">
          Casa din Povești · Hulboaca, Moldova
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// ---------------------------------------------------------------------
// Template: confirmare oaspete
// ---------------------------------------------------------------------
function guestHtml(r) {
  const firstName = (r.name || '').split(' ')[0] || 'drag oaspete';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4ece0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2b2418">
  <table role="presentation" width="100%" style="background:#f4ece0;padding:30px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" style="max-width:600px;background:#fbf6ec;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(40,25,10,.15)">
        <tr><td style="background:#3a4a2c;padding:24px 30px;color:#f4ece0">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;line-height:1">Casa din</div>
          <div style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#d8a36a;margin-top:2px">Povești</div>
        </td></tr>

        <tr><td style="padding:30px">
          <h1 style="font-family:Georgia,serif;font-size:28px;margin:0 0 6px;font-weight:600">Mulțumim, ${escapeHtml(firstName)}! 🌿</h1>
          <p style="margin:0 0 8px;color:#5a4c3b;font-size:15px">Cererea ta de rezervare a fost <strong>înregistrată cu succes</strong>.</p>
          <p style="margin:0 0 22px;color:#5a4c3b;font-size:14px">Te vom contacta în scurt timp pentru a confirma rezervarea. Dacă ai întrebări între timp, răspunde direct la acest email sau sună-ne.</p>

          <div style="background:#ede3d3;border-radius:10px;padding:18px 20px;margin-bottom:18px">
            <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;margin-bottom:10px">Detaliile rezervării</div>
            <table width="100%" style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#5a4c3b">Număr rezervare</td><td align="right" style="padding:6px 0;font-weight:600">#${r.id}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Check-in</td><td align="right" style="padding:6px 0;font-weight:600">${fmtDateRo(r.checkIn)} (de la 15:00)</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Check-out</td><td align="right" style="padding:6px 0;font-weight:600">${fmtDateRo(r.checkOut)} (până la 11:00)</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Nopți</td><td align="right" style="padding:6px 0;font-weight:600">${r.nights}</td></tr>
              <tr><td style="padding:6px 0;color:#5a4c3b">Oaspeți</td><td align="right" style="padding:6px 0;font-weight:600">${r.guests}</td></tr>
              <tr><td style="padding:10px 0 0;color:#5a4c3b;border-top:1px dashed rgba(60,45,25,.18)">Total estimat</td><td align="right" style="padding:10px 0 0;font-weight:700;color:#9a5e36;font-size:16px;border-top:1px dashed rgba(60,45,25,.18)">${fmtMoney(r.totalPrice)}</td></tr>
            </table>
          </div>

          <div style="background:#fff;border-left:3px solid #9a5e36;border-radius:6px;padding:14px 18px;margin-bottom:18px;font-size:13.5px;color:#5a4c3b">
            <strong style="color:#2b2418">Plata:</strong> se face la check-in. Anularea este gratuită cu cel puțin 7 zile înainte de sosire.
          </div>

          <h3 style="font-family:Georgia,serif;font-size:18px;margin:24px 0 8px">Cum ne găsești</h3>
          <p style="margin:0 0 4px;font-size:14px;color:#5a4c3b">📍 Vadu lui Vodă, Moldova</p>
          <p style="margin:0 0 4px;font-size:14px;color:#5a4c3b">📞 +373 69 123 456</p>
          <p style="margin:0;font-size:14px;color:#5a4c3b">✉️ ${escapeHtml(OWNER_EMAIL || 'contact@casadinpovesti.md')}</p>

          <p style="font-style:italic;color:#8a7a64;margin:28px 0 0;font-size:13.5px;text-align:center">Locul unde fiecare zi devine o poveste.</p>
        </td></tr>

        <tr><td style="background:#3a4a2c;padding:18px 30px;color:#cdc4ae;font-size:12px;text-align:center">
          Casa din Povești · Vadu lui Vodă, Moldova ${SITE_URL ? `· <a href="${SITE_URL}" style="color:#d8a36a;text-decoration:none">${SITE_URL.replace(/^https?:\/\//,'')}</a>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// ---------------------------------------------------------------------
// API public
// ---------------------------------------------------------------------
export async function sendBookingEmails(reservation) {
  if (!RESEND_API_KEY) {
    return { ok: false, reason: 'not-configured' };
  }

  const tasks = [];

  // Notificare proprietar
  if (OWNER_EMAIL) {
    tasks.push(
      sendEmail({
        to: OWNER_EMAIL,
        replyTo: reservation.email,
        subject: `Rezervare nouă #${reservation.id} — ${fmtDateRo(reservation.checkIn)} → ${fmtDateRo(reservation.checkOut)}`,
        html: ownerHtml(reservation),
      }).then(() => ({ ok: true, target: 'owner' }))
        .catch(err => ({ ok: false, target: 'owner', error: err.message }))
    );
  }

  // Confirmare oaspete
  if (SEND_GUEST && reservation.email) {
    tasks.push(
      sendEmail({
        to: reservation.email,
        replyTo: OWNER_EMAIL || undefined,
        subject: `Confirmare rezervare — Casa din Povești (#${reservation.id})`,
        html: guestHtml(reservation),
      }).then(() => ({ ok: true, target: 'guest' }))
        .catch(err => ({ ok: false, target: 'guest', error: err.message }))
    );
  }

  const results = await Promise.all(tasks);
  for (const r of results) {
    if (r.ok) console.log(`[mail] trimis -> ${r.target}`);
    else console.error(`[mail] eroare -> ${r.target}: ${r.error}`);
  }
  return { ok: true, results };
}

// Helper pentru endpointul de test
export async function sendTestEmail(to) {
  if (!RESEND_API_KEY) return { ok: false, reason: 'not-configured' };
  await sendEmail({
    to,
    subject: 'Test email — Casa din Povești',
    html: `<p style="font-family:Georgia,serif;font-size:16px">Dacă primești acest email, configurarea funcționează ✓</p>`,
  });
  return { ok: true };
}