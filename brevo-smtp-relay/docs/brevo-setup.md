# Brevo setup

This is the manual, one-time work you do on Brevo's web UI before running the
installer. It produces three things:

1. SPF/DKIM DNS records to add for each of your two sending domains.
2. A verified-sender state on Brevo for each domain.
3. An SMTP key (the password Postfix will use).

## 1. Create the account

- Sign up at https://www.brevo.com/.
- Pick the free plan (300/day, 9,000/month).

## 2. Verify each sending domain

For each of the two domains the iRedMail server sends as:

1. In the Brevo UI go to **Senders & IP -> Domains**.
2. Click **Add a domain**, enter the domain (e.g. `example.com`), confirm.
3. Brevo presents three DNS records:
   - A DKIM TXT or CNAME record (something like `mail._domainkey`).
   - A Brevo verification TXT record (`brevo-code:...`).
   - An optional DMARC record (skip if you already have one).
4. Add those records to your DNS (see [`dns-records.md`](dns-records.md) for
   the SPF caveats — Brevo's own instructions don't always emphasise the
   include-merge step).
5. Wait a few minutes for propagation, then click **Authenticate this domain**.
   You should get a green check on DKIM and the verification record.

Repeat for the second domain.

## 3. Generate the SMTP key

1. In the Brevo UI go to **SMTP & API -> SMTP**.
2. The SMTP server settings shown will be:
   - **Host:** `smtp-relay.brevo.com`
   - **Port:** `587` (STARTTLS) or `465` (SMTPS). We use 587.
   - **Login:** the email address shown in that panel (looks like
     `xxxxxx@smtp-brevo.com`).
   - **Password:** click **Generate a new SMTP key** -> copy the value.
3. Treat the SMTP key like a password. It goes in `/etc/postfix/sasl_passwd`
   on the mail VM (mode 600), never into git.

## 4. Make sure both domains are listed as authorized senders

In **Senders & IP -> Senders**, confirm that the From addresses your
iRedMail users actually send from are either:

- Listed individually as authorized senders, **or**
- Covered by a verified sending domain (which is the easier path — once a
  domain is verified, any From address on that domain is allowed).

If Brevo rejects mail with `550 ... not a valid sender`, this is the cause.

## 5. (Optional) Restrict outbound headers

Brevo will, by default, append a tracking pixel and click-track links. For a
transactional / personal use case you usually want this off:

- **SMTP & API -> SMTP -> Tracking** — disable open & click tracking.

That's it. You now have the credentials needed for `sasl_passwd`, and the
DNS records that make Microsoft trust the relayed mail.
