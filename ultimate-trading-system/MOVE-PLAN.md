# Moving to the new server: what goes, what stays, and in what order

The owner's order on 2026-09-28: "write up the move plan". **This is a plan, not
a deploy. Nothing in it is built and nothing runs until the owner says so, step
by step.** It is the companion to `COMMERCIAL-SPLIT-DESIGN.md`, which says what
the two sides are; this says how we get to the first of them.

As in that file, three kinds of thing are kept apart: **what the owner decided**
(their words), **what I FOUND in the code** (with the file, all read 2026-09-28),
and **what I PROPOSED**, which nobody has agreed to.

---

## A. What the owner decided

1. "at this stage the project will be moving to the new server for further dev
   and rollout" — the new machine is where the work happens from here, not only
   where it will run.
2. "don't worry about the data from the existing site ... that's staying where
   it is."
3. "i'll be putting the video help files on those magnetic spindles."
4. "with the exception to a short intro video the training / help content videos
   will only be available to signed-up accounts."
5. The machine under consideration when this was written: a dedicated server
   with 32 GB RAM and 2 × 1 TB spinning disks, in a United States datacenter, at
   $63 a month. The choice between it and an SSD machine was open; point 2 is
   what makes the spinning disks reasonable, because no record set and no sweep
   ever lands on them.

---

## B. What moves, and what stays

**Nothing that holds data moves.** That is the whole shape of this plan and it
is what makes it safe.

| | Where it ends up |
|---|---|
| The web application — every screen, the service, the deploy | **New box.** |
| The website, sign-up, admin, accounts | **New box** (mostly not built yet — section I). |
| Video help content | **New box**, on its own disk area (section E). |
| The owner's record sets, all 5.7 GB | **Stays.** Never copied. |
| The owner's price history | **Stays.** |
| The old order program, `general-classifier`, and its live positions | **Stays, untouched.** |
| The trading engine in Mexico City | **Stays** where it is; only what it calls changes, and late (step 8). |
| The owner's mail and business machines | **Stays, untouched.** |

**FOUND, and it is why this is easy**: `deploy/install.sh` rsyncs the repository
into `/opt/ultimate-trading-system` with `--exclude 'data'`. The installer has
never moved, read or written a record set. Installing on a new machine therefore
creates an empty `data` directory and nothing else — there is no migration to
write, and no migration to get wrong.

---

## C. FOUND: what standing it up actually takes

Read out of `deploy/install.sh` and the `vps-access` branch on 2026-09-28, so
the steps below are against what the code does rather than what I remember.

- **The installer is self-contained.** It installs `rsync`, `ca-certificates`
  and `curl`, makes a system user `uts` that cannot log in, rsyncs the repo to
  `/opt/ultimate-trading-system`, runs `npm ci`, seeds
  `/etc/ultimate-trading-system/env` from `deploy/env.example` if absent, and
  installs, enables and restarts `ultimate-trading-system.service` on
  `127.0.0.1:8094`. It then checks `/api/healthz` and fails if it does not answer.
- **Node: any version 18 or newer.** I told the owner earlier that the Node
  major on Debian 13 would be the first thing to fail. **That was wrong** — the
  installer reads `node -v`, refuses only below 18, and says so: it "will not
  replace the interpreter", because on the current box `general-classifier` runs
  on that same `/usr/bin/node` and shells out to `node` by name. Debian 13 ships
  well above 18. It is a non-issue and the correction belongs here rather than
  in a conversation nobody will re-read.
- **The general-classifier check is not fatal.** The installer ends by asserting
  the old order program is still active; on a machine that has never had one it
  prints "NOT active — it was not touched by this script, but check it" and
  carries on. On the new box that line is noise, not a failure.
- **The public face is nginx, from a different branch.** The installer's own
  closing words: the public URL "needs the nginx location from the website
  branch (ships via deploy-website). Until then the app is only reachable
  locally."
- **The deploy door is in the repository.** `vps-access/install-deploy-control.sh`,
  `vps-access/deploy-control/server.py`, its systemd unit, and the nginx site
  are all committed, so the same door can be stood up on a second machine.

---

## D. PROPOSED: the order

Each step says who does it. **Every step that touches the new machine is the
owner's press or the owner's account with the provider; nothing here is a thing
a session does unasked.**

1. **Take the machine, with the disks mirrored.** Confirm with the provider
   whether the two disks are RAID1 (≈1 TB usable) or separate. Mirrored is the
   right answer for anything a subscriber depends on. *Owner.*
2. **Base the machine**: Debian 13, a non-root account with sudo, keys only, no
   password logins, a firewall that allows 22, 80 and 443 and nothing else, and
   unattended security updates. *Owner, or a script the owner runs.*
3. **Stand up the deploy door on the new box**, from `vps-access`, with its own
   hostname and its own token. **This is the step everything else waits on**,
   because until it exists no session can deploy, read or check anything there.
   *Owner runs it; I write it if asked.*
4. **First install, with no public face.** Run the installer. It should end with
   `healthz OK on 127.0.0.1:8094` and an empty `data` directory. At this point
   the new box runs the whole application and serves it to nobody. *Owner
   presses; I check it over the new door.*
5. **nginx and a certificate**, for the new hostname. The site is reachable
   publicly for the first time here. Until the accounts work exists (section I)
   it should sit behind a holding password, because the interfaces are not yet
   anybody's but the owner's. *Owner.*
6. **Point the deploy of the `ultimate-trading-system` branch at the new box**,
   and decide what the old box's deploy becomes — frozen, or a second target.
   See section F: this is the step with the rule consequence, not just a script
   change. *Owner decides; I write the scripts.*
7. **Video** (section E). Independent of everything above and can be done in
   parallel once step 5 is up.
8. **Last, and only when the owner is ready: re-point the owner's own trading
   engine.** The engine in Mexico City calls out to a URL written into its
   `config.json` by the install command it was set up with. Until this step it
   goes on calling the old box and goes on trading exactly as it does today.
   Changing it means a new install command from the new box's own Compute tab.
   **This is real money and it is the owner's press alone** — and it should not
   happen until the new box has been serving reliably for long enough that the
   owner would be comfortable if it were the only one.

---

## E. PROPOSED: the video, which is the one real piece of engineering here

The owner has decided the videos live on the spinning disks. Good — this section
is how to make that work rather than an argument against it.

**Two classes of file, and they are served differently.**

- **The short intro video is public.** An ordinary file served by nginx, with
  long cache headers. Nothing checks anything.
- **Every other video is for signed-up accounts only**, and that means it cannot
  be a plain file under a public path — a public path is a link anybody can
  pass on.

**PROPOSED — the app authorises, nginx serves the bytes.** A request for a
gated video goes to the application, which checks the session and the
subscription and then answers with a header naming an internal path; nginx
serves the file from disk and the application never touches a byte of video.
(nginx calls this an internal redirect; the location holding the videos is
marked `internal` so it cannot be reached from outside.) The reasons this is the
right shape rather than streaming from Node:

- **Seeking.** A viewer dragging the scrubber sends a range request. nginx
  answers ranges natively and correctly; a hand-written Node implementation has
  to do it by hand and usually gets it subtly wrong.
- **Concurrency.** Every simultaneous viewer would otherwise hold a socket in
  the event loop of the process that also draws every screen. This keeps video
  entirely out of the application's way.
- **One check, one place.** Authorisation stays in the application, where the
  subscription state lives, and is not duplicated into web-server configuration.

**Where they sit on disk.** Their own directory, outside the application tree
and outside `data` — the installer rsyncs over `/opt/ultimate-trading-system` on
every deploy, and video must never be in reach of that. Nothing about a deploy
should be able to delete an hour of recorded help.

**What spinning disks are and are not good at.** Streaming one file start to
finish is sequential and HDDs are fine at it. What makes them seek is many
viewers at different points of different files at once. Two practical levers,
both free: keep the bitrate modest (1080p at a sane bitrate, not a master
export), and let the browser cache aggressively — a second viewing should not
touch the disk at all.

**PROPOSED, and worth deciding early**: keep the masters somewhere other than
this machine. The videos are authored content — the one thing on the new box
that cannot be rebuilt from the repository — and two mirrored disks in one
chassis is redundancy, not a backup.

---

## F. FOUND and PROPOSED: two boxes, and the one rule it collides with

**The deploy door is pinned to one machine.** Every script on the `vps-access`
branch names this box's paths, and `deploy-uts.sh` clones the branch and runs
`deploy/install.sh` there. The new box needs its own door, its own hostname and
its own token (step 3), and the deploy scripts need either a sibling per machine
or a machine argument. *PROPOSED: a machine argument, because two copies of the
same script is exactly the drift RULE TWO exists to stop.*

**And here is the consequence nobody would look for.** RULE ONE-A says the
closed word list is generated from **what the box serves**, not from the
repository, and `SERVED.json` records "the commit the box last deployed" with
the hash of every file the screens are drawn from. With two machines serving,
"the box" is no longer one thing. Until the old one stops serving the screens,
either:

- the record says which machine it was taken from, and the check knows which one
  is authoritative; or
- exactly one machine is the authority for the word list and the other is
  understood to be behind.

**PROPOSED: the new box becomes the authority the moment it serves the screens**,
and `SERVED.json` grows the machine it was captured from so a later session
cannot mistake one for the other. This needs settling before the first deploy to
the new box, because the moment both serve, a word list generated from the wrong
one authorises words the owner cannot see — which is the exact failure RULE
ONE-A was written for.

---

## G. What must not be touched, at any step

- `general-classifier` and its live positions.
- The trading engine in Mexico City, until step 8 and the owner's own press.
- The two VirtualBox guests, the mail machine, and the 161 GB they hold.
- The owner's record sets, price history and greenlights. They stay, and nothing
  in this plan reads them.

---

## H. Rollback

**Because no data moves, every step before 8 is reversible by doing nothing.**
The old box keeps its data, keeps serving, and keeps its deploy. If the new box
is wrong, stop using it; nothing has been taken away from the old one. Step 8 —
re-pointing the owner's engine — is the first step with a cost to undo, and
undoing it is another install command, not a restore.

That property is worth protecting as the plan is carried out: **the moment
something starts writing data only the new box has, the easy rollback is gone.**
Say so out loud when that day comes.

---

## I. Not in this plan

- **Accounts, trials, subscriptions, billing and the admin interface.** They do
  not exist yet. This plan moves what is built; it does not build the product.
- **The split itself** — feeding CPU-heavy work down to users' facilities. That
  is `COMMERCIAL-SPLIT-DESIGN.md`, and it is the larger body of work.
- **Any change to the screens.** The application that lands on the new box is
  the application that runs today.

---

## J. Not decided

1. **Whether the old box keeps deploying the branch** after step 6, or is
   frozen. This decides whether the machine argument in section F is temporary.
2. **Which machine is the word-list authority during the overlap** (section F).
   The only item here that must be settled *before* the first deploy to the new
   box rather than during.
3. **The holding password in step 5**, or whether the site simply is not linked
   anywhere until accounts exist.
4. **Whether the owner's own facilities move too, eventually.** Under the split
   the owner is user zero: their sweep processor, decision engine and trading
   platform are theirs and can stay exactly where they are. Nothing requires
   them to move, and this plan assumes they do not.
