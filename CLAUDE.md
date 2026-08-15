# CLAUDE.md — `dubber` branch (youtube-spanish-dubber backend)

> # 🛑 OWNER STOP DIRECTIVE — 2026-08-15, ACTIVE UNTIL THE OWNER LIFTS IT
>
> **Do NOT send any network traffic to homsionos01 / deploy.buitendyk.ca.**
> The owner is troubleshooting severe network problems reaching that box and
> has ordered all Claude sessions to stop generating traffic against it.
>
> - Do NOT call the deploy endpoint (`run-script`, `status`, `sync`, deploys) —
>   it has been stopped anyway; calls will fail.
> - Do NOT arm or re-arm any loop/wakeup that polls the box. If you have one
>   armed, STOP IT NOW (`/loop` stop, or ScheduleWakeup stop:true).
> - Your deployed services on that host (classifier / balancers / dubber) have
>   been stopped and disabled deliberately. Do NOT restart them.
> - Repo work (git on GitHub) is fine. Anything touching the VPS is not.
>
> This block is removed by the owner or the vps-access session when the
> all-clear is given.


## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation friction.
- If there's a real fork or a missing detail, check in briefly before spending effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch exists
  rather than assuming its spelling).

This repo is split **one project per branch**. This branch carries only the
dubbing **service/backend** (`youtube-spanish-dubber/`): the Python pipeline
(transcribe → translate → TTS → mux → upload) run as the `youtube-dubber`
systemd service (uvicorn on `127.0.0.1:8088`, deployed to `/opt/youtube-dubber`).

**The dubber's web UI is NOT here.** `index.html` / `dubber.js` / `style.css`
live on the `website` branch (the portal serves them at `/dubber/` and proxies
`/dubber/api/` to this service). A UI-only change ships via `deploy-website`,
not `deploy-dubber`.

## Deploy

SSH is blocked from cloud sessions; deploys go through the HTTPS endpoint:
`POST https://deploy.buitendyk.ca/run`, header
`Authorization: Bearer $DEPLOY_API_TOKEN`, body `{"action":"deploy-dubber"}`.
That action self-syncs `origin/dubber`, runs
`youtube-spanish-dubber/deploy/install.sh`, and **auto-restarts** the service
(so a backend change usually needs no separate restart).
`{"action":"status"}` shows health; `{"action":"restart-dubber"}` restarts and
kills a running dub job.

Loop: commit to `dubber` (here or directly on GitHub) → "deploy the dubber".

## Tests

Suite lives in `youtube-spanish-dubber/tests/` (pytest); the heavy-pipeline
tests skip cleanly when those deps aren't installed. Run before deploying
backend changes:

```bash
cd youtube-spanish-dubber && python -m pytest -q
```

Infra / deploy tooling and the full security model live on the `vps-access` branch.
