#!/usr/bin/env bash
# pair-shell — live pair context for host-side work with an AI agent.
#
# Pair with an agent that can see your terminal — but not type in it.
#
# You own the keyboard. The agent only reads the transcript file.
# Use this when you must work outside the agent container boundary
# (firewall, LXD, hardware, host networking) and want the agent to
# follow along without copy/paste into a chat window.
#
# Usage (cwd matters: the transcript is rooted at $PWD unless overridden):
#   ./pair-shell.sh <session>              # start / attach, logging on
#   ./pair-shell.sh <session> attach       # same
#   ./pair-shell.sh <session> tail         # follow the transcript in another terminal
#   ./pair-shell.sh <session> path         # print absolute transcript path
#   ./pair-shell.sh <session> clear        # truncate transcript
#   ./pair-shell.sh <session> kill         # kill the tmux session
#   ./pair-shell.sh <session> script       # fallback: no tmux, use `script -f` only
#   ./pair-shell.sh help
#
# Environment (optional overrides):
#   PAIR_START_DIR     Working directory for the shell (default: invoke cwd)
#   PAIR_LOG_DIR       Transcript directory (default: <start>/.pair-shell)
#   PAIR_TRANSCRIPT    Full transcript path (default: <log-dir>/<session>.log)
#
set -euo pipefail

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \?//'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  echo "error: session name is required" >&2
  echo >&2
  usage >&2
  exit 2
fi

SESSION_RAW="$1"
shift

case "$SESSION_RAW" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

if [[ ! "$SESSION_RAW" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "error: invalid session name '$SESSION_RAW'" >&2
  echo "use only letters, digits, dot, underscore, hyphen; must start with alnum" >&2
  exit 2
fi

# tmux session name is always prefixed so `tmux ls` stays unambiguous vs agent UI.
SESSION_NAME="$SESSION_RAW"
TMUX_SESSION="pair-${SESSION_NAME}"

# Freeze the invoke cwd as the pair root unless the caller overrode it.
START_DIR="${PAIR_START_DIR:-$PWD}"
LOG_DIR="${PAIR_LOG_DIR:-$START_DIR/.pair-shell}"
TRANSCRIPT="${PAIR_TRANSCRIPT:-$LOG_DIR/${SESSION_NAME}.log}"

# Short path form: $PWD always means the cwd of the shell that should read
# the message — i.e. the same directory `sh -c 'echo "$PWD"'` prints when
# run in that shell — never a frozen start dir that differs from that cwd.
# root is that shell's cwd. If TRANSCRIPT is not under root, short form is
# the absolute path (both forms identical).
transcript_display_for() {
  local root="${1%/}"
  local abs="$TRANSCRIPT"
  if [[ "$abs" == "$root"/* ]]; then
    printf '%s\n' "\$PWD/${abs#"$root"/}"
  elif [[ "$abs" == "$root" ]]; then
    printf '%s\n' '\$PWD'
  else
    printf '%s\n' "$abs"
  fi
}

# Outer CLI messages: $PWD = this process's cwd.
transcript_display() {
  transcript_display_for "$PWD"
}

# In-pane banner / status: $PWD = session start dir (pane cwd at create).
transcript_display_in_session() {
  transcript_display_for "$START_DIR"
}

print_transcript_hint() {
  echo "Transcript: $TRANSCRIPT"
  echo "tmux:       $TMUX_SESSION"
}

# If a live tmux session already carries frozen paths, prefer those so attach
# from another cwd still targets the original transcript.
load_frozen_from_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    return 0
  fi
  if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    return 0
  fi
  local frozen_ts frozen_start
  frozen_ts="$(tmux show-options -t "$TMUX_SESSION" -qv @pair_transcript 2>/dev/null || true)"
  frozen_start="$(tmux show-options -t "$TMUX_SESSION" -qv @pair_start_dir 2>/dev/null || true)"
  if [[ -n "$frozen_ts" ]]; then
    TRANSCRIPT="$frozen_ts"
    LOG_DIR="$(dirname "$TRANSCRIPT")"
  fi
  if [[ -n "$frozen_start" ]]; then
    START_DIR="$frozen_start"
  fi
}

freeze_into_tmux() {
  tmux set-option -t "$TMUX_SESSION" @pair_transcript "$TRANSCRIPT"
  tmux set-option -t "$TMUX_SESSION" @pair_start_dir "$START_DIR"
  tmux set-option -t "$TMUX_SESSION" @pair_session_name "$SESSION_NAME"
}

ensure_transcript() {
  mkdir -p "$LOG_DIR"
  touch "$TRANSCRIPT"
}

start_logging_on_pane() {
  # Raw pane output, continuously appended. -o means "only if not already piping".
  tmux pipe-pane -t "$TMUX_SESSION" -o "cat >> $(printf %q "$TRANSCRIPT")"
  # Status is viewed inside the session; $PWD means the pane/start dir.
  tmux set-option -t "$TMUX_SESSION" status-right "LOG -> $(transcript_display_in_session) | %H:%M"
  tmux set-option -t "$TMUX_SESSION" status-style "bg=colour22,fg=white"
}

cmd_start() {
  ensure_transcript
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux not found; falling back to script(1)." >&2
    cmd_script
    return
  fi

  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    load_frozen_from_tmux
    ensure_transcript
    start_logging_on_pane
    echo "Attaching to existing pair-shell session '$SESSION_NAME'."
    attach_or_print_detached
    return
  fi

  tmux new-session -d -s "$TMUX_SESSION" -c "$START_DIR"
  freeze_into_tmux
  start_logging_on_pane
  # Banner inside the pane so it shows up in the transcript too.
  # printf %q keeps $PWD-literal display paths from expanding in the pane shell.
  tmux send-keys -t "$TMUX_SESSION" \
    "clear; printf '%s\n' $(printf %q "=== pair-shell: ${SESSION_NAME} ===") $(printf %q "Transcript: ${TRANSCRIPT}") $(printf %q "Detach: Ctrl-b then d") ''" C-m

  # Attach when we have a TTY. Do not exec: after first detach from a newly
  # created session, reprint the transcript path for the human/agent.
  if [[ -t 0 && -t 1 ]]; then
    tmux attach -t "$TMUX_SESSION"
    echo
    echo "Detached from pair-shell session '$SESSION_NAME'."
    print_transcript_hint
    echo "Point your agent at the transcript (read-only). Re-attach: $0 ${SESSION_NAME}"
  else
    echo "No TTY; left session detached. Attach: $0 ${SESSION_NAME}"
    print_transcript_hint
  fi
}

attach_or_print_detached() {
  if [[ -t 0 && -t 1 ]]; then
    exec tmux attach -t "$TMUX_SESSION"
  fi
  echo "No TTY; session is running detached. Attach: $0 ${SESSION_NAME}"
}

cmd_script() {
  ensure_transcript
  echo "Starting script(1) pair-shell session '$SESSION_NAME'."
  print_transcript_hint
  echo "Exit the shell to stop logging."
  cd "$START_DIR"
  # -f flush after each write so the agent can read live; -q quieter start/stop noise
  exec script -f -q "$TRANSCRIPT"
}

cmd_tail() {
  load_frozen_from_tmux
  ensure_transcript
  echo "Following $TRANSCRIPT (Ctrl-C stops following; session keeps running)"
  exec tail -n +1 -F "$TRANSCRIPT"
}

cmd_path() {
  load_frozen_from_tmux
  ensure_transcript
  # Machine-readable absolute path on stdout (agents/scripts).
  printf '%s\n' "$TRANSCRIPT"
}

cmd_clear() {
  load_frozen_from_tmux
  ensure_transcript
  : > "$TRANSCRIPT"
  echo "Cleared $TRANSCRIPT"
}

cmd_kill() {
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$TMUX_SESSION"
    echo "Killed tmux session '$TMUX_SESSION'."
  else
    echo "No tmux session named '$TMUX_SESSION'."
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
