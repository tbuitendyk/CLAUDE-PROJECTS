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
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`CallMeBot ${res.status}: ${body.slice(0, 200)}`);
  // CallMeBot returns 200 with an error message in the body on bad keys.
  if (/error/i.test(body) && !/message queued/i.test(body)) {
    throw new Error(`CallMeBot: ${body.slice(0, 200)}`);
  }
}

module.exports = { sendWhatsApp };
