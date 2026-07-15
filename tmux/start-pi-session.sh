#!/usr/bin/env bash
#
# (Re)create the persistent pi coding session. Run after a reboot.
# Detached by default; attach explicitly with:  tmux attach -t pi-code
#
# Layout — ONE window named "code" with TWO panes, visible at the same time:
#   top ~70%  :  pi (inside LXC `pi-dev`)
#   bot ~30%  :  a shell; prefix + Tab swaps it between `pi-dev` and the host
#
# There is also a SECOND window "_backstage" used only as storage so the
# non-visible bottom shell stays alive. DO NOT switch to it (prefix + 2) —
# it will fill the whole screen because it's a window, not a pane. Stay in
# window "code" and use prefix + Tab to swap the bottom shell.
#
set -euo pipefail

SESSION=pi-code
CT="${PI_DEV_CONTAINER:-pi-dev}"
BOT_PCT="${BOT_PCT:-30}"   # bottom pane height as % of rows

# Seed an initial size; tmux can't infer one with no client attached.
# It auto-resizes to your terminal when you attach. Override via env if desired.
COLS="${TMUX_COLS:-120}"; ROWS="${TMUX_ROWS:-140}"
# Bottom pane height in rows. NOTE: -l (absolute) not -p (percent), because
# -p fails with "size missing" when no client is attached.
BOT_ROWS=$(( ROWS * BOT_PCT / 100 ))

# --- pane commands (swap these for the real lxc/pi invocations) -------------
# Real versions (commented):
#   TOP_CMD="lxc exec $CT --env TERM=xterm-256color -- bash -lc 'pi; exec bash -l'"
#   DEV_CMD="lxc exec $CT --env TERM=xterm-256color -- bash -l"
#   HOST_CMD="bash -l"
# Dummy versions for layout debugging:
TOP_CMD="echo '*** TOP: pi in $CT (placeholder)'; bash"
DEV_CMD="echo '*** BOTTOM dev shell in $CT (placeholder)'; bash"
HOST_CMD="echo '*** BOTTOM host shell (placeholder)'; bash"

tmux kill-session -t "$SESSION" 2>/dev/null || true

# Window "code": top pane runs pi in the container.
tmux new-session -d -s "$SESSION" -n code -x "$COLS" -y "$ROWS" "$TOP_CMD"
TOP=$(tmux display-message -p -t "$SESSION:code" '#{pane_id}')

# Split off the bottom (absolute height; -p breaks headless).
tmux split-window -v -l "$BOT_ROWS" -t "$TOP" "$DEV_CMD"
BOT_A=$(tmux display-message -p -t "$SESSION:code" '#{pane_id}')

# Guard: the split MUST have produced two panes. If it didn't, fail loudly
# instead of silently leaving pi filling the whole window.
N=$(tmux list-panes -t "$SESSION:code" | wc -l)
if [[ "$N" -ne 2 ]]; then
  echo "ERROR: expected 2 panes in 'code', got $N. Aborting." >&2
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  exit 1
fi

# Second window "_backstage" holds the host shell — storage only, never
# switch to it. swap-pane exchanges it with the visible bottom pane; both
# shells stay alive. {bottom} always targets whichever shell now occupies
# the bottom of the "code" window, regardless of swap state.
tmux new-window -t "$SESSION" -n _backstage "$HOST_CMD"
BOT_B=$(tmux display-message -p -t "$SESSION:_backstage" '#{pane_id}')
tmux select-window -t "$SESSION:code"

tmux bind-key -T prefix Tab \
  swap-pane -s "$BOT_B" -t "$BOT_A" \; select-pane -t {bottom}

tmux select-pane -t "$BOT_A"

cat <<EOF
Session '$SESSION' ready. Attach with:  tmux attach -t $SESSION

You should see ONE window ("code") with TWO panes tiled:
  top  ~$((100 - BOT_PCT))%  -> pi in $CT
  bot  ~$BOT_PCT%  -> a shell (prefix + Tab swaps it: $CT <-> host)

Do NOT switch to window "_backstage" (prefix + 2) — it's storage, full-screen.
EOF
