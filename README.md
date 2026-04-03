# KJV Bible Verse Lookup — MCP Server

An MCP tool that finds the closest matching KJV verse to any text snippet and
returns it with `n` verses of context before and after, formatted as a clean
passage with a single reference at the end.

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Download the KJV Bible (one-time, ~2 MB)
python download_kjv.py

# 3. Test the server directly
python server.py
```

## Register with Claude

### Claude Code (this project — already configured via .mcp.json)

The `.mcp.json` in this directory registers the server automatically when you
open this folder in Claude Code.  Restart Claude Code after the first setup.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "kjv-bible": {
      "command": "python",
      "args": ["/home/user/Claude-1/server.py"]
    }
  }
}
```

Then restart Claude Desktop.

## Usage

In any Claude chat session, Claude will call the tool automatically when you
reference a Bible verse.  You can also ask explicitly:

> "Look up 'for God so loved the world' with 2 verses of context."

The tool returns:

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

## Tool parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `snippet` | string | — | Partial or full KJV verse text |
| `context_verses` | int | 3 | Verses before and after the match |
