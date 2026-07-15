# Postfix changes

The installer adds the following parameters to `/etc/postfix/main.cf`. None of
them conflict with the defaults that iRedMail sets up.

```
# --- BEGIN claude-3-alternate-smtp-forwarder ---
# Selectively relay mail through Brevo for Microsoft-hosted recipients.
# All other recipients still go direct from this host.

transport_maps =
    hash:/etc/postfix/transport_brevo

smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_sasl_mechanism_filter = plain, login

# Force STARTTLS for the Brevo next-hop.
smtp_tls_security_level = may
smtp_tls_policy_maps = hash:/etc/postfix/tls_policy

# Avoid Postfix stripping SASL credentials in headers
smtp_header_checks =

# --- END claude-3-alternate-smtp-forwarder ---
```

A few notes for anyone reading this later:

- We do **not** set `relayhost`. A bare `relayhost` would force *every*
  outbound message through the smarthost, which is not what we want.
- The `transport_maps` entry coexists with iRedMail's existing transports.
  iRedMail typically uses `dovecot` for local delivery and the default `smtp`
  transport for outbound, neither of which we're changing.
- `smtp_sasl_password_maps` is keyed by next-hop. Postfix only presents the
  Brevo SMTP key when the next-hop matches `[smtp-relay.brevo.com]:587`, so
  direct deliveries don't accidentally leak credentials.
- `smtp_tls_policy_maps` pins the Brevo next-hop to `encrypt`, while keeping
  the global `smtp_tls_security_level = may` so direct deliveries still work
  with hosts that don't offer TLS.

## Files written by the installer

| Path | Mode | Tracked in git | Purpose |
| --- | --- | --- | --- |
| `/etc/postfix/transport_brevo` | 644 | yes (template) | Recipient-domain -> relay map |
| `/etc/postfix/transport_brevo.db` | 644 | no | `postmap` output |
| `/etc/postfix/sasl_passwd` | 600 | **no** | SASL credentials (your Brevo key) |
| `/etc/postfix/sasl_passwd.db` | 600 | no | `postmap` output |
| `/etc/postfix/tls_policy` | 644 | yes | TLS policy for Brevo next-hop |
| `/etc/postfix/tls_policy.db` | 644 | no | `postmap` output |
| `/etc/cron.d/smtp-forwarder-autopromote` | 644 | yes | 15-min auto-promote cron |

## Rolling back

The installer keeps a timestamped backup of `/etc/postfix/main.cf` the first
time it edits the file:

```
/etc/postfix/main.cf.bak.<unix-timestamp>
```

To roll back manually:

```sh
sudo cp /etc/postfix/main.cf.bak.<timestamp> /etc/postfix/main.cf
sudo postfix reload
```

Or use the installer's uninstall flag:

```sh
sudo bash scripts/install.sh --uninstall
```

Which removes the block delimited by `# --- BEGIN ... # --- END ...` from
`main.cf`, removes the cron file, and reloads Postfix. It does **not** delete
your transport map or sasl password file (so reinstalling is one command).
