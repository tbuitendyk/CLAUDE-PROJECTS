# KJV Bible Verse Lookup — MCP Server

Finds the closest matching KJV verse to any text snippet and returns it with
`n` verses of context, formatted as a clean passage with a single reference.

**Works on your phone** via Claude.ai — deploy once, use everywhere.

---

## Quick deploy to your phone (Claude.ai)

### Option A — Railway (recommended, free tier available)

1. Fork / push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select this repo — Railway detects the `Dockerfile` automatically
4. Add an environment variable: `API_KEY` = any secret string you choose
5. Deploy. Railway gives you a public URL like `https://kjv-bible-mcp.up.railway.app`

### Option B — Render (also free tier)

1. Go to [render.com](https://render.com) → New → Web Service → connect this repo
2. Render reads `render.yaml` automatically and generates an `API_KEY` for you
3. Find the generated key in Render Dashboard → Environment tab

### Add to Claude.ai (phone or web)

Once deployed:

1. Open Claude.ai → **Settings** → **Integrations** → **Add MCP Server**
2. Enter your server URL: `https://your-app.up.railway.app/mcp`
3. Set the authorization header: `Bearer YOUR_API_KEY`
4. Save — the `kjv_lookup` tool is now available in every chat

---

## Local use (Claude Desktop / Claude Code)

```bash
pip install -r requirements.txt
python download_kjv.py        # one-time, downloads ~2 MB KJV JSON

# Claude Code — already configured via .mcp.json in this directory
# Claude Desktop — add to claude_desktop_config.json (see below)
TRANSPORT=stdio python server.py
```

**Claude Desktop** `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kjv-bible": {
      "command": "python",
      "args": ["/path/to/Claude-1/server.py"],
      "env": { "TRANSPORT": "stdio" }
    }
  }
}
```

---

## Environment variables

| Variable    | Default     | Description                                      |
|-------------|-------------|--------------------------------------------------|
| `TRANSPORT` | `http`      | `http` for remote, `stdio` for local Claude apps |
| `PORT`      | `8000`      | HTTP port                                        |
| `HOST`      | `0.0.0.0`   | Bind address                                     |
| `API_KEY`   | _(unset)_   | Bearer token — set this to protect your endpoint |

---

## How it works

Claude calls:
```
kjv_lookup(snippet="for god so loved the world", context_verses=2)
```

Returns:
```
For God so loved the world, that he gave his only begotten Son, that
whosoever believeth in him should not perish, but have everlasting life.

For God sent not his Son into the world to condemn the world; but that
the world through him might be saved.

He that believeth on him is not condemned: but he that believeth not is
condemned already, because he hath not believed in the name of the only
begotten Son of God.

John 3:16-18
```

The KJV data (~31,102 verses) is downloaded automatically on first startup
from a public-domain GitHub source.
