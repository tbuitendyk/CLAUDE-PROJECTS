// WhatsApp notices via CallMeBot (free personal-use gateway). Each recipient
// self-authorizes once by WhatsApping "I allow callmebot to send me messages"
// to +34 644 91 07 79, which returns their personal API key. Isolated here so
// the gateway can be swapped (Twilio / Meta Cloud API) without touching the
// alert pipeline.

async function sendWhatsApp(phone, apikey, text) {
  const url =
    'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}` +
    `&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const raw = await res.text().catch(() => '');
  const body = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // CallMeBot reports failures with 2xx statuses and no "error" keyword
  // (e.g. HTTP 203 + "APIKey is invalid"), so only its explicit queue
  // confirmation counts as success.
  if (!/message queued/i.test(body)) {
    throw new Error(`CallMeBot (HTTP ${res.status}): ${body.slice(0, 200) || 'empty response'}`);
  }
}

module.exports = { sendWhatsApp };
