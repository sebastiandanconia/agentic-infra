# Agentic tmux Session

A script that (re)creates a persistent tmux coding session for working with a Terminal User Interface coding agent such as [pi](https://github.com/earendil-works/pi-coding-agent). Where the code and documentation refer to Pi, you can just as easily use Claude Code or OpenAI Codex.

## Use case

An auxiliary computer with a vertically-oriented widescreen monitor, SSH'd into a laptop. The session lives on the laptop (detached), so an SSH disconnect just drops the client — the session and every shell inside it keep running. Reconnect and re-attach from the aux box and you're back where you left off.

The layout is one window with two panes tiled top/bottom:

- **top ~75%** — `pi` running inside the LXC container `pi-dev`
- **bottom ~25%** — a shell you can swap between `pi-dev` and the host with `prefix + Tab` (both shells stay alive; only one is on screen at a time)

A vertical monitor gives the top pane plenty of rows for pi's output while keeping a shell reachable below it.

## Running it

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

## `~/.tmux.conf`: enable mouse

Add this line to `~/.tmux.conf` to enable mouse support (scroll, click-to-select panes, drag to resize):

```
set -g mouse on
```

If your config has any of `mode-mouse`, `mouse-select-pane`, `mouse-resize-pane`, or `mouse-select-window`, delete them — those were removed in tmux 2.1 (2015) and replaced by the single `mouse` option above.

Apply changes without restarting tmux:

```sh
tmux source-file ~/.tmux.conf
```
