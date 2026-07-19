---
name: state-management
description: Durable agent state for persistence, resume, and multi-agent coordination. Covers `.pi/state/` layouts (ralph/orchestrator/clarifier JSON, task queues, worker heartbeats, mailbox), claim-safe task ownership, heartbeat and mailbox protocols, and resume-after-interruption. Use whenever an agent must survive crashes, share progress across sessions or workers, claim tasks safely, or clear state on successful completion.
---

# State Management for Autonomous Agents

Durable state enables persistence, resume capability, and coordination between agents.

## Purpose

State management allows:
- **Resume after interruption**: Crash, disconnect, or user cancellation → resume where you left off
- **Coordination**: Multiple agents share state (task queues, claim tokens, mailbox)
- **Progress tracking**: See iteration count, current phase, evidence collected
- **Clean shutdown**: Clear state on successful completion
- **Debugging**: Inspect what the agent was doing when it failed

## State Directory Structure

```
.pi/
├── state/
│   ├── ralph.json              ← Ralph mode state
│   ├── orchestrator.json       ← Orchestrator/team mode state
│   ├── clarifier.json          ← Clarifier mode state
│   ├── tasks/                  ← Task queue (for multi-agent)
│   │   ├── task-001.json
│   │   ├── task-002.json
│   │   └── ...
│   ├── workers/                ← Worker heartbeats (for multi-agent)
│   │   ├── worker-1.json
│   │   ├── worker-2.json
│   │   └── ...
│   └── mailbox/                ← Message passing (for multi-agent)
│       ├── worker-1/
│       │   ├── msg-001.json
│       │   └── msg-002.json
│       └── worker-2/
│           └── msg-001.json
├── context/                    ← Task context snapshots
│   ├── fix-auth-bug-20260402T090000Z.md
│   └── add-caching-20260402T100000Z.md
└── evidence/                   ← Optional: evidence archives
    └── fix-auth-bug/
        ├── iteration-1-tests.txt
        ├── iteration-2-tests.txt
        └── iteration-3-build.txt
```

## State Schema

### Ralph Mode State

**File:** `.pi/state/ralph.json`

```json
{
  "schema_version": "1.0",
  "mode": "ralph",
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "current_phase": "verifying",
  "started_at": "2026-04-02T09:00:00Z",
  "updated_at": "2026-04-02T09:15:00Z",
  "task": {
    "id": "fix-auth-timeout",
    "description": "Fix authentication timeout bug",
    "context_snapshot": ".pi/context/fix-auth-timeout-20260402T090000Z.md"
  },
  "evidence": {
    "tests_passed": false,
    "tests_output": "42 passed, 1 failed",
    "tests_timestamp": "2026-04-02T09:14:00Z",
    "build_succeeded": true,
    "build_output": "Build completed in 2.1s",
    "build_timestamp": "2026-04-02T09:14:30Z",
    "lsp_clean": true,
    "architect_approved": false
  },
  "iterations": [
    {
      "iteration": 1,
      "phase": "investigating",
      "started_at": "2026-04-02T09:00:00Z",
      "completed_at": "2026-04-02T09:05:00Z",
      "outcome": "Found root cause in middleware/session.ts"
    },
    {
      "iteration": 2,
      "phase": "implementing",
      "started_at": "2026-04-02T09:05:00Z",
      "completed_at": "2026-04-02T09:10:00Z",
      "outcome": "Fixed cookie MaxAge, added test"
    },
    {
      "iteration": 3,
      "phase": "verifying",
      "started_at": "2026-04-02T09:10:00Z",
      "completed_at": null,
      "outcome": "In progress - 1 test failing"
    }
  ],
  "errors": [
    {
      "iteration": 3,
      "error": "Test 'session duration match' failed: expected 1800000, got 1800",
      "count": 1,
      "first_seen": "2026-04-02T09:14:00Z"
    }
  ]
}
```

### Orchestrator Mode State

**File:** `.pi/state/orchestrator.json`

```json
{
  "schema_version": "1.0",
  "mode": "orchestrator",
  "active": true,
  "started_at": "2026-04-02T10:00:00Z",
  "updated_at": "2026-04-02T10:15:00Z",
  "task": {
    "id": "implement-caching-layer",
    "description": "Implement caching layer for API",
    "context_snapshot": ".pi/context/implement-caching-20260402T100000Z.md"
  },
  "workers": [
    {
      "id": "worker-1",
      "role": "executor",
      "status": "active",
      "current_task": "task-001",
      "last_heartbeat": "2026-04-02T10:14:30Z"
    },
    {
      "id": "worker-2",
      "role": "executor",
      "status": "active",
      "current_task": "task-002",
      "last_heartbeat": "2026-04-02T10:14:45Z"
    },
    {
      "id": "worker-3",
      "role": "executor",
      "status": "idle",
      "current_task": null,
      "last_heartbeat": "2026-04-02T10:15:00Z"
    }
  ],
  "task_queue": {
    "pending": ["task-003", "task-004"],
    "in_progress": ["task-001", "task-002"],
    "completed": [],
    "failed": []
  }
}
```

### Task State

**File:** `.pi/state/tasks/task-001.json`

```json
{
  "schema_version": "1.0",
  "id": "task-001",
  "status": "in_progress",
  "subject": "Implement Redis cache client",
  "description": "Create a Redis cache client with get/set/delete operations",
  "owner": "worker-1",
  "created_at": "2026-04-02T10:00:00Z",
  "claimed_at": "2026-04-02T10:01:00Z",
  "claim_token": "claim-abc123",
  "version": 2,
  "files": ["src/cache/redis.ts"],
  "dependencies": [],
  "acceptance_criteria": [
    "Redis client connects successfully",
    "get/set/delete operations work",
    "Tests pass"
  ]
}
```

### Worker Heartbeat

**File:** `.pi/state/workers/worker-1.json`

```json
{
  "schema_version": "1.0",
  "worker_id": "worker-1",
  "role": "executor",
  "status": "active",
  "current_task": "task-001",
  "current_phase": "implementing",
  "pid": 12345,
  "turn_count": 42,
  "last_heartbeat": "2026-04-02T10:14:30Z",
  "alive": true
}
```

### Mailbox Message

**File:** `.pi/state/mailbox/worker-1/msg-001.json`

```json
{
  "schema_version": "1.0",
  "message_id": "msg-001",
  "from_worker": "orchestrator",
  "to_worker": "worker-1",
  "type": "task_assignment",
  "body": "Proceed with task-001: Implement Redis cache client",
  "created_at": "2026-04-02T10:01:00Z",
  "delivered": true,
  "delivered_at": "2026-04-02T10:01:15Z"
}
```

## State Operations

### Write State

```python
def state_write(mode: str, data: dict):
    """Write state for a mode."""
    import json
    from pathlib import Path

    state_file = Path.home() / ".pi" / "state" / f"{mode}.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)

    # Add metadata
    data["schema_version"] = "1.0"
    data["updated_at"] = datetime.utcnow().isoformat() + "Z"

    with state_file.open("w") as f:
        json.dump(data, f, indent=2)
```

### Read State

```python
def state_read(mode: str) -> dict:
    """Read state for a mode."""
    import json
    from pathlib import Path

    state_file = Path.home() / ".pi" / "state" / f"{mode}.json"

    if not state_file.exists():
        return {"active": False}

    with state_file.open("r") as f:
        return json.load(f)
```

### Clear State

```python
def state_clear(mode: str):
    """Clear state for a mode (on successful completion)."""
    from pathlib import Path

    state_file = Path.home() / ".pi" / "state" / f"{mode}.json"

    if state_file.exists():
        state_file.unlink()
```

### Check Active Modes

```python
def state_active_modes() -> list[str]:
    """List all active modes."""
    import json
    from pathlib import Path

    state_dir = Path.home() / ".pi" / "state"
    if not state_dir.exists():
        return []

    active = []
    for state_file in state_dir.glob("*.json"):
        with state_file.open("r") as f:
            data = json.load(f)
            if data.get("active", False):
                active.append(state_file.stem)

    return active
```

## Claim-Safe Task Ownership

For multi-agent coordination, prevent race conditions with versioned claims:

### Claim a Task

```python
def claim_task(task_id: str, worker_id: str, expected_version: int) -> str:
    """
    Claim a task atomically.
    Returns claim_token if successful, raises if already claimed.
    """
    import json
    from pathlib import Path
    import uuid

    task_file = Path.home() / ".pi" / "state" / "tasks" / f"{task_id}.json"

    # Read current state
    with task_file.open("r") as f:
        task = json.load(f)

    # Check version (prevent race)
    if task["version"] != expected_version:
        raise ValueError(f"Version mismatch: expected {expected_version}, got {task['version']}")

    # Check if already claimed
    if task["status"] != "pending":
        raise ValueError(f"Task {task_id} is already {task['status']}")

    # Claim it
    claim_token = f"claim-{uuid.uuid4().hex[:8]}"
    task["status"] = "in_progress"
    task["owner"] = worker_id
    task["claimed_at"] = datetime.utcnow().isoformat() + "Z"
    task["claim_token"] = claim_token
    task["version"] += 1

    # Write back atomically
    with task_file.open("w") as f:
        json.dump(task, f, indent=2)

    return claim_token
```

### Release a Task Claim

```python
def release_claim(task_id: str, claim_token: str, worker_id: str):
    """Release a task claim (if stuck or cancelled)."""
    import json
    from pathlib import Path

    task_file = Path.home() / ".pi" / "state" / "tasks" / f"{task_id}.json"

    with task_file.open("r") as f:
        task = json.load(f)

    # Verify claim token
    if task["claim_token"] != claim_token:
        raise ValueError("Invalid claim token")

    if task["owner"] != worker_id:
        raise ValueError("Not the task owner")

    # Release
    task["status"] = "pending"
    task["owner"] = None
    task["claimed_at"] = None
    task["claim_token"] = None
    task["version"] += 1

    with task_file.open("w") as f:
        json.dump(task, f, indent=2)
```

## Resume Protocol

### On Crash/Interruption

When Pi restarts:
1. Check for active modes: `state_active_modes()`
2. If found, offer resume: "Found active ralph session, resume? (y/n)"
3. If yes: Load state, continue from current iteration
4. If no: Offer to clear state

### Resume Command

```bash
pi resume ralph
# or
pi resume orchestrator
```

Loads state, announces where it left off, continues execution.

## Heartbeat Protocol (Multi-Agent)

### Worker Heartbeat

Every worker updates heartbeat every N turns (default: 5):

```python
def update_heartbeat(worker_id: str):
    """Update worker heartbeat."""
    import json
    from pathlib import Path
    import os

    worker_file = Path.home() / ".pi" / "state" / "workers" / f"{worker_id}.json"
    worker_file.parent.mkdir(parents=True, exist_ok=True)

    if worker_file.exists():
        with worker_file.open("r") as f:
            worker = json.load(f)
    else:
        worker = {
            "worker_id": worker_id,
            "role": "executor",
            "pid": os.getpid(),
            "turn_count": 0
        }

    worker["last_heartbeat"] = datetime.utcnow().isoformat() + "Z"
    worker["alive"] = True
    worker["turn_count"] += 1

    with worker_file.open("w") as f:
        json.dump(worker, f, indent=2)
```

### Orchestrator Monitors Heartbeats

```python
def check_worker_health(worker_id: str, timeout_seconds: int = 300) -> bool:
    """Check if worker is still alive."""
    import json
    from pathlib import Path
    from datetime import datetime, timedelta

    worker_file = Path.home() / ".pi" / "state" / "workers" / f"{worker_id}.json"

    if not worker_file.exists():
        return False

    with worker_file.open("r") as f:
        worker = json.load(f)

    last_heartbeat = datetime.fromisoformat(worker["last_heartbeat"].replace("Z", ""))
    now = datetime.utcnow()

    return (now - last_heartbeat).total_seconds() < timeout_seconds
```

## Mailbox Protocol (Multi-Agent)

### Send Message

```python
def send_message(from_worker: str, to_worker: str, body: str, msg_type: str = "info"):
    """Send a message to another worker's mailbox."""
    import json
    from pathlib import Path
    import uuid

    message_id = f"msg-{uuid.uuid4().hex[:8]}"
    mailbox_dir = Path.home() / ".pi" / "state" / "mailbox" / to_worker
    mailbox_dir.mkdir(parents=True, exist_ok=True)

    message_file = mailbox_dir / f"{message_id}.json"

    message = {
        "schema_version": "1.0",
        "message_id": message_id,
        "from_worker": from_worker,
        "to_worker": to_worker,
        "type": msg_type,
        "body": body,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "delivered": False
    }

    with message_file.open("w") as f:
        json.dump(message, f, indent=2)
```

### Read Mailbox

```python
def read_mailbox(worker_id: str) -> list[dict]:
    """Read undelivered messages from mailbox."""
    import json
    from pathlib import Path

    mailbox_dir = Path.home() / ".pi" / "state" / "mailbox" / worker_id

    if not mailbox_dir.exists():
        return []

    messages = []
    for msg_file in mailbox_dir.glob("*.json"):
        with msg_file.open("r") as f:
            msg = json.load(f)
            if not msg.get("delivered", False):
                messages.append(msg)

    return messages
```

### Mark Message Delivered

```python
def mark_delivered(worker_id: str, message_id: str):
    """Mark a message as delivered."""
    import json
    from pathlib import Path

    message_file = Path.home() / ".pi" / "state" / "mailbox" / worker_id / f"{message_id}.json"

    with message_file.open("r") as f:
        msg = json.load(f)

    msg["delivered"] = True
    msg["delivered_at"] = datetime.utcnow().isoformat() + "Z"

    with message_file.open("w") as f:
        json.dump(msg, f, indent=2)
```

## Best Practices

### 1. Update State Frequently
- After each phase transition
- After collecting evidence
- After errors occur
- After iteration completes

### 2. Keep State Minimal
- Don't store large outputs (save to evidence files instead)
- Store paths/references, not full content
- Version bumps for claim-safety

### 3. Clean State on Success
- Always run `state_clear(mode)` on successful completion
- Leave state intact on failure (for resume)

### 4. Timestamp Everything
- Use UTC ISO format: `2026-04-02T09:00:00Z`
- Always include `created_at`, `updated_at`

### 5. Schema Versioning
- Include `schema_version` in all state files
- Allow for schema evolution

## Troubleshooting

**State file corrupted:**
```bash
# Backup and clear
mv .pi/state/ralph.json .pi/state/ralph.json.bak
# Start fresh
```

**Worker stuck:**
```bash
# Check heartbeat
cat .pi/state/workers/worker-1.json
# If last_heartbeat > 5 min ago, worker is dead
# Orchestrator should reassign its task
```

**Task claim conflicts:**
```bash
# Check task version
cat .pi/state/tasks/task-001.json
# If status="in_progress" but worker is dead, release claim
```

## References
- Ralph role: `agents/skills/workflows/ralph/SKILL.md`
- Orchestrator role: `agents/skills/roles/orchestrator/SKILL.md`
- Context snapshots: `agents/skills/workflows/context-snapshots/SKILL.md`
- Evidence verification: `agents/skills/workflows/evidence-verification/SKILL.md`
