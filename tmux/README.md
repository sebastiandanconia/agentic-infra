# tmux tooling for agentic work

This directory holds small tmux helpers used around AI coding agents. There are two different jobs here; do not conflate them.

| Tool | Job |
| --- | --- |
| **`pair-shell.sh`** | Live pair context: you type on the host; an agent reads a streaming transcript. |
| **`start-pi-session.sh`** | Legacy dual-pane layout that used to host the agent UI itself. |

These days the agent chat UI is rendered with [herdr](https://herdr.dev), not with the dual-pane script below. The important, current tool in this folder is **pair-shell**.

---

## `pair-shell` — live pair context

**Pair with an agent that can see your terminal — but not type in it.**

### The problem

Coding agents are safest inside a containment boundary (see `lxc/` in this repo). Real work still spills onto the host: nftables, LXD, disks, hardware, Docker coexistence, bootstrap. That host work used to mean copy/paste into the agent chat — a slow path that breaks flow.

### The idea

**Live pair context** streams your terminal into a file the agent can read, instead of diverting context through the clipboard.

- You own the keyboard on the host.
- The agent gets read-only eyes on a continuously appended transcript.
- No host shell is handed to the agent.
- Closes the gap between “I did a thing” and “the agent saw the thing” without giving the agent a shell on the host.
- Shared terminal context without shared control.

### Usage

Session name is **required**. The tmux session is always `pair-<session>` so it never collides with agent UI sessions in `tmux ls`.

```sh
# From the directory you want treated as the work root (frozen at create):
./pair-shell.sh nftables-docker           # start or attach
./pair-shell.sh nftables-docker tail      # follow the transcript elsewhere
./pair-shell.sh nftables-docker path      # print absolute transcript path
./pair-shell.sh nftables-docker clear     # truncate transcript
./pair-shell.sh nftables-docker kill      # kill the tmux session
./pair-shell.sh nftables-docker script    # no tmux: script(1) fallback
./pair-shell.sh help
```

### Transcript path

Default layout at **create** time (unless overridden):

```text
$PWD/.pair-shell/<session>.log
```

The work root and absolute transcript path are frozen into the tmux session (`@pair_start_dir`, `@pair_transcript`) when the session is first created. Later `attach` / `tail` / `path` / `clear` from another cwd still hit that same file; reattach does not retarget the log.

Printed paths keep both forms when they differ:

- **Short form** uses a literal `$PWD/...` prefix. Here `$PWD` always means the cwd of the shell that should read the message — the same directory `sh -c 'echo "$PWD"'` would print in that shell — never a frozen start dir that differs from that shell's cwd. Outer CLI hints recompute the short form from **this process's** cwd (so attach from a parent directory may show `$PWD/subdir/.pair-shell/<session>.log`). The in-pane banner and status bar use the **session start dir** (pane cwd) as `$PWD`.
- **Absolute form** is the frozen real path (source of truth for agents).

If the transcript is not under the relevant cwd, short form falls back to the absolute path.

On start, and again the first time you detach from a **newly created** session, the script prints these locations.

`path` prints only the absolute path on stdout (handy for agents and scripts).

Optional env overrides:

| Variable | Meaning |
| --- | --- |
| `PAIR_START_DIR` | Shell cwd inside the session (default: invoke cwd) |
| `PAIR_LOG_DIR` | Transcript directory (default: `<start>/.pair-shell`) |
| `PAIR_TRANSCRIPT` | Full transcript file path |

### gitignore

Add this to projects where you use pair-shell (transcripts often contain host details you do not want in git):

```gitignore
.pair-shell/
```

### Suggested agent prompt

After starting a session:

```text
I am working on the host in a pair-shell session. Read-only live transcript
(absolute path from `./pair-shell.sh <session> path`). Prefer that absolute
path; a $PWD-relative short form is only valid for the shell that printed it.
I own the keyboard. Suggest next steps; do not assume you can run host commands.
```

### Security posture

pair-shell is intentionally **not** a way to let the agent drive the host. It is a one-way observability channel for times when you have already stepped outside the container boundary. Keep secrets out of the pane (passwords, tokens, `.env` dumps); the transcript is plain text on disk.

---

## Legacy: `start-pi-session.sh` (agent UI layout)

> **Note:** Agent session rendering in my workflow has moved to [herdr](https://herdr.dev). This script is kept as a reference for persistent dual-pane tmux layouts (remote SSH attach, vertical monitors, swappable host/guest shells). Prefer herdr for the agent chat surface; prefer `pair-shell` for host-side live pair context.

A script that (re)creates a persistent tmux coding session for working with a Terminal User Interface coding agent such as [pi](https://github.com/earendil-works/pi-coding-agent). Where the code and documentation refer to Pi, you can just as easily use Claude Code or OpenAI Codex.

### Use case

An auxiliary computer with a vertically-oriented widescreen monitor, SSH'd into a laptop. The session lives on the laptop (detached), so an SSH disconnect just drops the client — the session and every shell inside it keep running. Reconnect and re-attach from the aux box and you're back where you left off.

The layout is one window with two panes tiled top/bottom:

- **top ~75%** — `pi` running inside the LXC container `pi-dev`
- **bottom ~25%** — a shell you can swap between `pi-dev` and the host with `prefix + Tab` (both shells stay alive; only one is on screen at a time)

A vertical monitor gives the top pane plenty of rows for pi's output while keeping a shell reachable below it.

### Usage

After a reboot (or any time you want a fresh session), on the laptop:

```sh
./start-pi-session.sh
tmux attach -t pi-code
```

From the auxiliary computer:

```sh
ssh <user>@<laptop> -t tmux attach -t pi-code
```

Re-run the script to recreate the session from scratch (it kills any existing `pi-code` first).

### Key bindings

- `prefix + Tab` — swap the bottom shell (`pi-dev` ↔ host)
- `prefix + arrows` — move focus between panes

### Notes

- **Stay in window `code`** (window 1). There is a second window, `_backstage`, used only as storage so the non-visible bottom shell stays alive. Don't switch to it (`prefix + 2`) — it's full-screen.
- The bottom pane height is `BOT_PCT` percent of rows (default 25): `BOT_PCT=40 ./start-pi-session.sh`
- Override the seed size (snaps to your terminal on attach): `TMUX_COLS=120 TMUX_ROWS=140 ./start-pi-session.sh`
- The pane commands are currently dummy `bash` shells at the top of the script (`TOP_CMD`/`DEV_CMD`/`HOST_CMD`). Uncomment the real `lxc exec ...` lines and delete the dummy three to actually launch your coding agent in the container.

## Optional: `~/.tmux.conf`: enable mouse

Add this line to `~/.tmux.conf` to enable mouse support (scroll, click-to-select panes, drag to resize):

```
set -g mouse on
```

If your config has any of `mode-mouse`, `mouse-select-pane`, `mouse-resize-pane`, or `mouse-select-window`, delete them — those were removed in tmux 2.1 (2015) and replaced by the single `mouse` option above.

Apply changes without restarting tmux:

```sh
tmux source-file ~/.tmux.conf
```
