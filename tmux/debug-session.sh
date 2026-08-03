#!/usr/bin/env bash
# Host-side interactive debug session with a live transcript the agent can read.
#
# You own the keyboard. The agent only reads the transcript file.
#
# Usage (on the host, from this directory or via absolute path):
#   ./debug-session.sh              # start / attach, logging on
#   ./debug-session.sh attach       # same
#   ./debug-session.sh tail         # follow the transcript in another terminal
#   ./debug-session.sh path         # print transcript path
#   ./debug-session.sh clear        # truncate transcript
#   ./debug-session.sh kill         # kill the tmux session
#   ./debug-session.sh script       # fallback: no tmux, use `script -f` only

set -euo pipefail

SESSION="${DEBUG_SESSION_NAME:-debug-agent}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${DEBUG_LOG_DIR:-$ROOT/.pi/transcripts}"
TRANSCRIPT="${DEBUG_TRANSCRIPT:-$LOG_DIR/debug-session.log}"
START_DIR="${DEBUG_START_DIR:-$ROOT}"

mkdir -p "$LOG_DIR"

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \?//'
  echo "Transcript: $TRANSCRIPT"
  echo "Session:    $SESSION"
}

ensure_transcript() {
  touch "$TRANSCRIPT"
}

start_logging_on_pane() {
  # Raw pane output, continuously appended. -o means "only if not already piping".
  tmux pipe-pane -t "$SESSION" -o "cat >> $(printf %q "$TRANSCRIPT")"
  tmux set-option -t "$SESSION" status-right "LOGGING -> $TRANSCRIPT | %H:%M"
  tmux set-option -t "$SESSION" status-style "bg=colour22,fg=white"
}

cmd_start() {
  ensure_transcript
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux not found; falling back to script(1)." >&2
    cmd_script
    return
  fi

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    start_logging_on_pane
    echo "Attaching to existing session '$SESSION'."
    echo "Transcript: $TRANSCRIPT"
    exec tmux attach -t "$SESSION"
  fi

  tmux new-session -d -s "$SESSION" -c "$START_DIR"
  start_logging_on_pane
  # Banner inside the pane so it shows up in the transcript too.
  tmux send-keys -t "$SESSION" "clear; echo '=== debug-agent session ==='; echo \"transcript: $TRANSCRIPT\"; echo 'detach: Ctrl-b then d'; echo" C-m
  echo "Started session '$SESSION'."
  echo "Transcript: $TRANSCRIPT"
  echo "Detach: Ctrl-b then d"
  exec tmux attach -t "$SESSION"
}

cmd_script() {
  ensure_transcript
  echo "Starting script(1) session."
  echo "Transcript: $TRANSCRIPT"
  echo "Exit the shell to stop logging."
  cd "$START_DIR"
  # -f flush after each write so the agent can read live; -q quieter start/stop noise
  exec script -f -q "$TRANSCRIPT"
}

cmd_tail() {
  ensure_transcript
  echo "Following $TRANSCRIPT (Ctrl-C to stop following; session keeps running)"
  exec tail -n +1 -F "$TRANSCRIPT"
}

cmd_path() {
  ensure_transcript
  printf '%s\n' "$TRANSCRIPT"
}

cmd_clear() {
  ensure_transcript
  : > "$TRANSCRIPT"
  echo "Cleared $TRANSCRIPT"
}

cmd_kill() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
    echo "Killed session '$SESSION'."
  else
    echo "No tmux session named '$SESSION'."
  fi
}

main() {
  local cmd="${1:-attach}"
  case "$cmd" in
    attach|start|run|"") cmd_start ;;
    script)               cmd_script ;;
    tail|follow)          cmd_tail ;;
    path|log)             cmd_path ;;
    clear|truncate)       cmd_clear ;;
    kill|stop)            cmd_kill ;;
    -h|--help|help)       usage ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
