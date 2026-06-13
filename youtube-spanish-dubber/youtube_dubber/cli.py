"""Operator CLI for one-off/manual tasks that shouldn't run inside the service.

    python -m youtube_dubber.cli authorize             one-time YouTube OAuth setup
    python -m youtube_dubber.cli submit <url>          enqueue a job via the local API
    python -m youtube_dubber.cli status <job_id>       check a job's status
    python -m youtube_dubber.cli check-extraction [url] probe which yt-dlp player
                                                        client returns real formats
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

from .config import settings


def _cmd_authorize(_: argparse.Namespace) -> None:
    from .pipeline import uploader
    uploader.run_authorization_flow()
    print(f"Saved credentials to {settings.youtube_token_file}. The service can now upload unattended.")


def _cmd_submit(args: argparse.Namespace) -> None:
    base = f"http://{settings.host}:{settings.port}"
    resp = requests.post(f"{base}/jobs", json={"url": args.url, "target_language": args.lang})
    resp.raise_for_status()
    print(json.dumps(resp.json(), indent=2))


def _cmd_status(args: argparse.Namespace) -> None:
    base = f"http://{settings.host}:{settings.port}"
    resp = requests.get(f"{base}/jobs/{args.job_id}")
    resp.raise_for_status()
    print(json.dumps(resp.json(), indent=2))


def _cmd_check_extraction(args: argparse.Namespace) -> None:
    """Probe each player client in the ladder against a sample video and report
    which return real (non-storyboard) formats -- the deploy self-test and the
    operator's go-to when downloads start failing the bot-check."""
    from .pipeline import downloader

    url = args.url or "https://www.youtube.com/watch?v=Dj5OYkgDtHU"
    print(f"Probing yt-dlp player clients for {url}")
    best = None
    for client, count in downloader.probe_client_formats(url):
        label = client or "default"
        print(f"  {label:14s} -> {count} real formats")
        if best is None and count > 0:
            best = client
    if best is not None:
        print(f"Working player client: {best or 'default'} "
              f"(set DUBBER_YTDLP_PLAYER_CLIENTS={best} to lock it in)")
    else:
        print("No player client returned real formats -- the token provider, "
              "cookies, or the box's IP is the problem, not the client.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="youtube-dubber")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("authorize", help="One-time interactive YouTube OAuth authorization").set_defaults(func=_cmd_authorize)

    submit_parser = sub.add_parser("submit", help="Submit a YouTube URL to be dubbed")
    submit_parser.add_argument("url")
    submit_parser.add_argument("--lang", default=None, help="Target language code (default: es)")
    submit_parser.set_defaults(func=_cmd_submit)

    status_parser = sub.add_parser("status", help="Check a job's status")
    status_parser.add_argument("job_id")
    status_parser.set_defaults(func=_cmd_status)

    check_parser = sub.add_parser(
        "check-extraction", help="Probe which yt-dlp player client returns real formats"
    )
    check_parser.add_argument("url", nargs="?", default=None, help="Video URL (default: a sample)")
    check_parser.set_defaults(func=_cmd_check_extraction)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
