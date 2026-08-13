# Client materials received 2026-08-13 (via owner)

Post-v1 additions — NOT wired into the site; each needs an owner/client
decision first.

## 1. Crypto payment info (`PAGOS_CON_CRIPTOMONEDAS.rtf`)

Deposit screens from the client's **Bitso** account ("depósito a través de
Bitso"). Extracted addresses (the RTF's images are WMF blobs; text layer
verified):

| Currency | Network | Address | Caveat |
|---|---|---|---|
| ETH | Ethereum | `0x74D74C4B569FDE16293FdC7c8c096251D7024793` | shared address |
| "Tether America USD (USAT)" | ERC-20 | same `0x74D7…4793` | client's naming, sic |
| USDC | ERC-20 | same `0x74D7…4793` | |
| BTC | Bitcoin | `bc1qw72gauakmjjecajfvtfaukqr2jznpz4wt88tsu72yvwlp56f5amq8jfqgu` | **rotates after each deposit** — unsafe to publish statically |
| XRP | Ripple | `rLSn6Z3T8uCxbcd1oxwfGQN1Fdn5CyGujK` | **no destination tag given** — exchange XRP deposits usually need one; confirm with client before ever publishing |

Decision pending: whether/how the site offers crypto payment (e.g. a
"pago con cripto" info block: publish the stable ERC-20 address + "BTC/XRP
por WhatsApp"), vs. keeping crypto entirely off-site (WhatsApp-only).

## 2. Testimonial (`testimonial-lourdes.jpg`)

Photo + MT trading-history screenshot + quote from "Lourdes" thanking
Javier. Candidate for a testimonials section (post-v1 scope). Before
publishing: confirm the client has her permission to use name+photo.

## 3. Mercado Pago access (chat, not stored here)

The client's MP login is passwordless — user ID + one-time code to the
registrant mailbox/SMS. No credentials in git, ever; the site only ever
needs the public `mpago.la/…` payment link, which remains blocked on the
offer/price decision.
