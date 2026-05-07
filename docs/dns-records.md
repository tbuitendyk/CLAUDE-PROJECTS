# DNS records

For each of the two sending domains, you need:

1. **An SPF record** that authorises *both* IONOS (your direct-delivery IP) and
   Brevo (the relay).
2. **A DKIM record** for Brevo (you keep your existing iRedMail DKIM record
   too — both signatures coexist on the same message).
3. **A DMARC record** (you almost certainly already have this from iRedMail;
   nothing to change).
4. **A Brevo verification TXT** (only until verification completes; Brevo's UI
   shows it).

Replace `example.com` with each of your real domains.

## 1. SPF

The most common mistake here is *replacing* your existing SPF record with
Brevo's, which then drops your IONOS IP and breaks direct delivery to
non-Microsoft recipients. SPF allows only one TXT record starting with
`v=spf1` per domain — you must merge.

**Before** (typical iRedMail / IONOS setup):

```
example.com.  TXT  "v=spf1 mx ~all"
```

**After** (merged):

```
example.com.  TXT  "v=spf1 mx include:spf.brevo.com ~all"
```

Notes:

- `mx` already authorises whatever IPs your domain's MX records resolve to,
  which on iRedMail means the mail VM's IONOS IP — keep it.
- `include:spf.brevo.com` adds Brevo's outbound IP ranges. (Brevo also
  publishes `spf.brevosend.com`; either works, but `spf.brevo.com` is what the
  current UI hands out.)
- Leave the qualifier as `~all` (softfail) unless you know you want `-all`.
- Do **not** add a second `v=spf1` record. Multiple SPF records = permerror.

## 2. DKIM (Brevo)

Brevo's UI gives you the exact record. It is one of:

- A TXT record named `mail._domainkey.example.com` with a long `k=rsa; p=...`
  value, **or**
- A CNAME record `mail._domainkey.example.com` -> `mail.domainkey.<id>.brevo-code.com`

Add it verbatim. Your existing iRedMail DKIM record (usually
`dkim._domainkey.example.com`) stays exactly as it is — they use different
selectors (`mail` vs `dkim`) and don't conflict. A relayed message ends up
with two DKIM signatures, which is fine.

## 3. DMARC

If iRedMail already set up DMARC for you, you don't need to change it. A
typical record is:

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:postmaster@example.com"
```

DMARC passes if **either** SPF **or** DKIM aligns with the From: domain. With
the SPF and DKIM above, both will align for direct mail (via your IP + the
iRedMail `dkim` selector) and DKIM will align for Brevo-relayed mail (via
Brevo's `mail` selector signing as your domain).

If you're tightening DMARC to `p=quarantine` or `p=reject`, do the SPF/DKIM
work first, watch DMARC aggregate reports for a couple of weeks, then move.

## 4. Brevo verification TXT (temporary)

While verifying a domain, Brevo asks you to add a TXT record like:

```
example.com.  TXT  "brevo-code:abcdef0123456789"
```

You can leave it in place after verification (no harm) or delete it — Brevo
re-checks DKIM/SPF, not this token, after initial setup.

## Verifying from the mail VM

Once propagated:

```sh
dig +short TXT example.com
dig +short TXT mail._domainkey.example.com
dig +short CNAME mail._domainkey.example.com
dig +short TXT _dmarc.example.com
```

You can also use https://mxtoolbox.com/spf.aspx and the SPF/DKIM/DMARC
analyser at https://www.mail-tester.com/ to send a test message through the
relay and see all alignments at once.
