# Exchange endpoint verification — Phase 1.5

Verified 2026-07-17 (live probes from the dev environment + current official
docs). This is the ground truth the integration is built against; re-verify if
a venue starts erroring.

## Kraken

Auth (private REST): `API-Key` header + `API-Sign` =
HMAC-SHA512(path + SHA256(nonce + postdata), base64-decoded secret), base64
output. POST form-encoded to `https://api.kraken.com/0/private/<Method>`.
Response envelope `{error: [], result: {}}`.

Key setup (user checklist): create key with ONLY **Query Funds** +
**Query closed orders & trades** + **Query ledger entries**; no trade, no
withdraw. Kraken supports **IP address restriction** on API keys — pin to the
VPS IP.

Verified capabilities:
- **OHLC** (public): exactly **721 candles per interval**, any interval —
  confirmed live for `interval=1440` (~2 years daily, 2024-07-27→2026-07-17)
  and `interval=60` (30 days hourly). Candle `time` is the 00:00 UTC bucket
  start; the final candle is the in-progress day (partial, self-corrects via
  INSERT OR REPLACE like CoinGecko's trailing point).
- **AssetPairs** (public): 1515 pairs, **693 USD-quoted**; `wsname` format
  `XBT/USD`; gives `base`/`quote` in internal codes.
- **Assets** (public): 814 assets with `altname` mapping (XXBT→XBT, ZUSD→USD).
  Balance codes can carry earn/staking suffixes (`XBT.F`, `ETH2.S`) — strip
  after `.`, then altname, then alias (xbt→btc, xdg→doge).
- **Ticker** (public): multiple pairs per call — one call prices every held
  Kraken-listed asset per poll.
- **Balance** (private): `{code: amount}` map.
- **TradesHistory** (private): 50/page via `ofs`, `start`/`end` unix seconds
  (start exclusive); fields pair, time, type buy/sell, price, cost, fee, vol.
  Fee is charged in the quote currency.
- **Ledgers** (private): 50/page via `ofs`; `type` filterable to
  `deposit`/`withdrawal`; fields refid, time, type, asset, amount, fee,
  balance. Deposits/withdrawals sync reads exactly these two type filters.
- **Bulk OHLCVT**: quarterly-updated CSV zips (intervals 1,5,15,30,60,240,
  720,1440), full history since each market opened, distributed via Google
  Drive links on the support article — manual download, then
  `scripts/import-ohlcvt.js` seeds `daily_prices` from the 1440 files.

## Bitso

Auth (private REST): `Authorization: Bitso <key>:<nonce>:<sig>` where sig =
HMAC-SHA256(nonce + HTTPmethod + requestPath + JSONbody, secret), hex output.
The request path in the signature includes the query string. Base
`https://api.bitso.com`. Response envelope `{success, payload}`.

Key setup: read-only scopes only (balance, trades, fundings/withdrawals
read). Bitso ANNA (third-party account) may stay on screenshot import.

Verified capabilities:
- **available_books** (public): 98 books, including the actually-traded MXN
  markets (btc_mxn, eth_mxn, usdt_mxn, …), many *_usd books (btc_usd,
  eth_usd), and fiat crosses **usd_mxn / usd_ars / usd_brl / usd_cop** —
  usd_mxn gives a direct MXN rate with no CoinGecko cross-rate call. Payload
  includes the default maker/taker fee schedule per book.
- **OHLC**: the documented-looking `api.bitso.com/v3/ohlc` returns **404**.
  The working endpoint is
  `https://bitso.com/api/v3/ohlc?book=<book>&time_bucket=86400&start=<ms>&end=<ms>`
  (note: bitso.com host, not api.bitso.com). **Multi-year daily history
  confirmed** (3y fetched in one call). Fields: bucket_start_time,
  first_rate, last_rate (close), min/max_rate, vwap, volume, trade_count.
  Buckets start at 06:00 UTC (Mexico City midnight) — bucketed to the UTC
  day, an accepted ~6h skew. UNDOCUMENTED: treat as best-effort with
  CoinGecko fallback.
- **ticker** (public, one book per call): last/bid/ask/vwap.
- **balance** (private): `payload.balances[] {currency, available, locked,
  total}`.
- **user_trades** (private): limit ≤100, `marker`+`sort` cursor pagination;
  fields book, major, minor (both signed), price, fees_amount,
  fees_currency, side, created_at, tid, oid.
- **fundings / withdrawals** (private): same marker pagination (default
  limit 25); fields fid/wid, status, created_at, currency, amount. Only
  `complete` items count as flows.

## How the app consumes this

- Reconciliation sync (lib/sync.js): balances = ground truth; new trades
  apply to quantities with NO splice; deposits/withdrawals become pending
  flows that splice on confirmation (auto once trusted).
- Live pricing (lib/exsource.js): Kraken Ticker for any held asset with an
  unambiguous SYM/USD pair; Bitso usd_* tickers for mxn/ars/brl/cop; all
  else falls back to CoinGecko. Cuts CG quota to fallback + scanner duty.
- History (lib/history.js): Kraken daily OHLC (720d) or Bitso daily OHLC
  (multi-year, fiat books) top up daily_prices before CoinGecko is tried;
  bulk OHLCVT seeds go deeper via scripts/import-ohlcvt.js.
