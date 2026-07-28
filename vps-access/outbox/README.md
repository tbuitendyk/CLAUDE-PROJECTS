# outbox/ — mail sent AS claude@homeandofficemicro.com

`claude-mail-send.sh` reads `<name>.txt` from here, where `<name>` comes from
`outbox/NEXT`. Format:

    line 1   subject
    line 2   must start with "tl;dr" — enforced, not encouraged
    rest     body, plain text

Everything sent is committed here first. The repository, not a mailbox, is the
record of what was said.

## The inbound rule

`claude-mail-check.sh` treats a message as instructions **only** when the mail
log shows an authenticated submission by `theodore@homeandofficemicro.com` for
that exact Message-ID. A `From:` header is a string anyone can type; the SASL
login is not. Mail that fails is reported, left unread, and never acted on.

That proves the mailbox sent it, not that the owner typed it. Stolen
credentials would pass.
