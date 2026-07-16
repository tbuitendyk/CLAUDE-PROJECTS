# Claude Projects

One-off projects built with Claude Code, each living in its own
self-contained subdirectory with its own README, dependencies and (where
applicable) deployment instructions.

## Projects

- [`asset-balancer/`](asset-balancer/) — a manual asset-rebalancing watcher:
  profiles of assets priced against an index asset, organized into sets;
  polls CoinGecko on a schedule, tracks relative-value drift against
  recorded baselines, and emails a rebalance signal when assets in a set
  drift apart past a threshold. Web UI served at
  `https://www.buitendyk.ca/balancer/`.
- [`youtube-spanish-dubber/`](youtube-spanish-dubber/) — a self-hosted
  service for a Debian VPS that takes a YouTube video URL, produces a
  Spanish voice-over of it (from an existing transcript, an
  auto-generated one, or a freshly transcribed one), and publishes the
  result to your own YouTube channel — built entirely from free,
  open-source tools.
- [`www.buitendyk.ca/`](www.buitendyk.ca/) — the static portal site for
  `https://www.buitendyk.ca`, tying together the tools and projects hosted
  on this VPS (Bible lookup tools, docs, and a control-panel sub-page for
  the YouTube Spanish Dubber, gated behind HTTP Basic Auth).

To add a new project, create a new top-level directory for it (with its own
README, dependencies, etc.) and list it here.
