"""Operator CLI for one-off/manual tasks that shouldn't run inside the service.

    python -m youtube_dubber.cli authorize        one-time YouTube OAuth setup
    python -m youtube_dubber.cli submit <url>     enqueue a job via the local API
    python -m youtube_dubber.cli status <job_id>  check a job's status
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

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
