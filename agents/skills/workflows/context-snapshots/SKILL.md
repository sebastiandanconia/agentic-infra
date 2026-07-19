---
name: context-snapshots
description: Persistent task context snapshots under `.pi/context/` that ground agents in shared understanding across sessions and roles. Covers snapshot templates (task statement, desired outcome, facts, constraints, success criteria, non-goals, decision boundaries), when to create or update vs reuse, lifecycle from clarifier through execution, and handoffs between roles. Use whenever starting a task, clarifying ambiguous work, planning, resuming after interruption, or preventing re-discovery and ambiguity drift across agents.
---

# Context Snapshots

Persistent task context that grounds all agents in shared understanding.

## Purpose

Context snapshots prevent:
- **Re-discovering the same facts** across multiple sessions
- **Ambiguity drift** (each agent interprets differently)
- **Lost context** after interruptions
- **Duplicate exploration** of codebase

Context snapshots enable:
- **Shared grounding** across agents and sessions
- **Resume capability** with full context intact
- **Handoffs** between workflow phases (clarifier → planner → implementer)
- **Audit trail** of what was known when

## File Structure

**Location:** `.pi/context/{task-slug}-{timestamp}.md`

**Timestamp format:** UTC ISO 8601: `YYYYMMDDTHHMMSSZ`

**Example:**
```
.pi/context/fix-auth-timeout-20260402T090000Z.md
.pi/context/add-caching-layer-20260402T100000Z.md
.pi/context/refactor-api-routes-20260402T110000Z.md
```

## Snapshot Template

```markdown
# Task: [Short title]
Snapshot: [Timestamp]
Created by: [Role/agent that created this]
Status: [active | complete | cancelled]

## Task Statement

[One paragraph: What needs to be done]

Example:
Users are experiencing session timeouts after 15 minutes instead of the configured 30 minutes.
The session timeout duration needs to match the configured value in all environments.

## Desired Outcome

[Concrete, verifiable end state]

Example:
- Session timeout matches `config.sessionDuration` value (1800 seconds)
- Verified in development, staging, and production
- No user sessions terminated prematurely
- All existing sessions continue to work during deployment

## Probable Intent

[Hypothesis: Why does the user want this?]

Example:
User frustration with forced re-login interrupting workflow. Business requirement for
30-minute sessions was documented but not enforced in production. This is a compliance
issue as well as UX issue.

## Stated Solution (Optional)

[What the user asked for initially - may not be the root cause fix]

Example:
User said: "Increase the session timeout in production to match config."
This suggests they believe config is correct but not applied. Need to verify.

## Known Facts / Evidence

[Concrete, verified information - not assumptions]

Example:
- Config file: `config/auth.ts` line 12: `sessionDuration: 1800000` (30 min in ms)
- Observed behavior: Sessions expire at ~900 seconds (15 min)
- Affects: Production environment only (dev and staging work correctly)
- No errors in application logs during session expiration
- Middleware: `src/middleware/session.ts` handles session creation
- Cookie name: `session_id`
- Database: Sessions table has `expires_at` column

Codebase findings:
- Found: `middleware/session.ts:45` - cookie `maxAge` hardcoded to `900000` (15 min)
- Found: `config/auth.ts:12` - `sessionDuration: 1800000` (30 min)
- Hypothesis: Cookie expires before session, causing premature logout

## Constraints

[Hard limits, must-preserve requirements]

Example:
- **Must not break existing sessions:** Rolling deployment, no forced logout
- **Security:** Preserve all existing auth security measures
- **Timeline:** Production deployment window: Saturday 2am-4am only
- **Backward compatibility:** Must work with existing client code
- **No schema changes:** Cannot modify database schema
- **Performance:** No additional latency on session check

## Success Criteria

[How we know when this is complete - testable]

Example:
- [ ] Cookie `maxAge` matches `config.sessionDuration`
- [ ] Sessions expire at configured duration (verified via test)
- [ ] No pre-existing tests broken
- [ ] New regression test added for duration match
- [ ] Dev, staging, and production all behave identically
- [ ] Manual verification: Leave session idle for 20 min → still active
- [ ] Manual verification: Leave session idle for 35 min → expired

## Non-Goals

[Explicitly out of scope for this task]

Example:
- NOT changing the session duration value itself (30 min is correct)
- NOT adding "remember me" functionality (different feature)
- NOT implementing session refresh/extension (future work)
- NOT changing session storage backend (Redis is fine)
- NOT adding session activity tracking (separate feature request)

## Decision Boundaries

[Decisions the agent can make vs. must ask about]

**Agent can decide:**
- Whether to fix cookie maxAge vs session duration (both are valid approaches)
- How to structure the test (as long as it validates duration)
- Whether to use milliseconds or seconds internally (as long as consistent)

**Must ask user:**
- Whether to add session refresh on activity (scope expansion)
- Whether to change production deployment window (constraint change)
- Whether to log session expirations (new feature, privacy concern)

## Unknowns / Open Questions

[Things we don't know yet - to be investigated or clarified]

Example:
- Q: Is there middleware or load balancer that might override cookie maxAge?
  - Investigation: Check nginx config, check AWS ALB settings
  - Status: To be checked
- Q: Are there other places where session duration is hardcoded?
  - Investigation: Search codebase for "900000" and "maxAge"
  - Status: Checked - only one instance in middleware/session.ts
- Q: How are sessions cleaned up from database?
  - Investigation: Look for cron job or TTL setting
  - Status: Found - cron job runs hourly, uses `expires_at` column (correct)

## Likely Codebase Touchpoints

[Files/modules that will probably need changes]

Example:
- `src/middleware/session.ts` - Cookie maxAge setting (HIGH confidence)
- `config/auth.ts` - Session duration config (read-only, maybe add comment)
- `tests/session.test.ts` - Add regression test for duration match (NEW)
- Possibly: `src/server/app.ts` - If config loading is broken (LOW confidence)

## History / Updates

[Track how understanding evolved]

Example:
- 2026-04-02 09:00Z - Initial snapshot created by clarifier
- 2026-04-02 09:10Z - Added codebase findings after exploration
- 2026-04-02 09:20Z - Narrowed touchpoints after investigation
- 2026-04-02 09:30Z - Removed UNKNOWN status from middleware question
```

## When to Create a Snapshot

### Always Create for:
1. **New tasks** - Before any execution work begins
2. **After clarification** - Clarifier role outputs a snapshot
3. **Before ralplan** - Planning requires grounded context
4. **Before autopilot** - Full pipeline needs complete picture

### Update Existing Snapshot:
1. **After investigation** - New facts discovered
2. **After user clarification** - Questions answered
3. **After scope change** - Requirements updated
4. **After blocker resolution** - Unknowns become known

### Don't Create New Snapshot:
1. **Minor iterations** - Ralph mode uses same snapshot across iterations
2. **Within same session** - Update existing instead

## Snapshot Lifecycle

```
┌─────────────────┐
│ User requests   │
│ unclear task    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Clarifier       │ Creates initial snapshot
│ role activated  │ Status: active
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Investigation/  │ Updates snapshot
│ exploration     │ Fills unknowns
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execution       │ References snapshot
│ (Ralph/team)    │ (read-only)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Completion      │ Updates snapshot
│                 │ Status: complete
└─────────────────┘
```

## Snapshot Operations

### Create Snapshot

```python
def create_context_snapshot(task_description: str, created_by: str) -> str:
    """
    Create a new context snapshot.
    Returns path to snapshot file.
    """
    import re
    from pathlib import Path
    from datetime import datetime

    # Generate task slug
    slug = re.sub(r'[^a-z0-9]+', '-', task_description.lower())[:50]
    slug = slug.strip('-')

    # Generate timestamp
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    # Create filename
    filename = f"{slug}-{timestamp}.md"
    snapshot_path = Path.home() / ".pi" / "context" / filename
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)

    # Create initial snapshot
    content = f"""# Task: {task_description}
Snapshot: {timestamp}
Created by: {created_by}
Status: active

## Task Statement

{task_description}

## Desired Outcome

[To be filled]

## Probable Intent

[To be filled]

## Known Facts / Evidence

[To be filled]

## Constraints

[To be filled]

## Success Criteria

[To be filled]

## Non-Goals

[To be filled]

## Decision Boundaries

**Agent can decide:**
[To be filled]

**Must ask user:**
[To be filled]

## Unknowns / Open Questions

[To be filled]

## Likely Codebase Touchpoints

[To be filled]

## History / Updates

- {timestamp} - Initial snapshot created by {created_by}
"""

    with snapshot_path.open("w") as f:
        f.write(content)

    return str(snapshot_path)
```

### Load Snapshot

```python
def load_context_snapshot(snapshot_path: str) -> str:
    """Load snapshot content."""
    from pathlib import Path

    path = Path(snapshot_path)
    if not path.exists():
        raise FileNotFoundError(f"Snapshot not found: {snapshot_path}")

    return path.read_text()
```

### Update Snapshot

```python
def update_context_snapshot(snapshot_path: str, section: str, content: str):
    """
    Update a specific section of the snapshot.
    Appends to history.
    """
    from pathlib import Path
    from datetime import datetime
    import re

    path = Path(snapshot_path)
    current = path.read_text()
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    # Find section and update
    pattern = f"## {section}\n\n.*?(?=\n## |\Z)"
    replacement = f"## {section}\n\n{content}\n"
    updated = re.sub(pattern, replacement, current, flags=re.DOTALL)

    # Append to history
    history_entry = f"\n- {timestamp} - Updated {section}"
    updated = updated.replace("\n## History / Updates\n",
                             f"\n## History / Updates\n{history_entry}\n")

    path.write_text(updated)
```

### Find Latest Snapshot for Task

```python
def find_latest_snapshot(task_slug: str) -> str | None:
    """Find the most recent snapshot for a task slug."""
    from pathlib import Path

    context_dir = Path.home() / ".pi" / "context"
    if not context_dir.exists():
        return None

    # Find all snapshots matching slug
    snapshots = list(context_dir.glob(f"{task_slug}-*.md"))

    if not snapshots:
        return None

    # Sort by timestamp (embedded in filename)
    snapshots.sort(reverse=True)

    return str(snapshots[0])
```

## Integration with Roles

### Clarifier Role
**Responsibility:** Create and populate snapshot
- Start with initial snapshot (mostly unknowns)
- Ask questions to fill sections
- Update snapshot after each answer
- Final snapshot has all sections filled, ambiguity < threshold

### Planner Role
**Responsibility:** Load snapshot as context
- Load existing snapshot (from clarifier or prior session)
- Use as grounding for plan creation
- Add "Likely Codebase Touchpoints" if missing

### Ralph Role
**Responsibility:** Reference snapshot throughout execution
- Load snapshot on start
- Store snapshot path in state
- Reference throughout iterations (read-only)
- Update "Known Facts" if new discoveries emerge

### Orchestrator Role
**Responsibility:** Share snapshot across workers
- Load snapshot once
- Pass snapshot path to all workers
- Workers reference same snapshot (shared context)
- Prevents duplicate exploration

## Snapshot Quality Checklist

A good snapshot has:
- [ ] Clear task statement (one sentence)
- [ ] Concrete desired outcome (testable)
- [ ] Explicit non-goals (prevents scope creep)
- [ ] Decision boundaries (what agent can/can't decide)
- [ ] Known facts with evidence (not assumptions)
- [ ] Success criteria (verifiable)
- [ ] Constraints (hard limits)
- [ ] Likely touchpoints (file paths)
- [ ] History of updates (audit trail)

## Examples

### Example 1: Well-Grounded Snapshot (After Clarification)

```markdown
# Task: Fix authentication timeout bug
Snapshot: 20260402T090000Z
Created by: clarifier
Status: active

## Task Statement
Users experience session timeouts after 15 minutes instead of configured 30 minutes.

## Desired Outcome
- Session timeout matches config.sessionDuration (1800 seconds)
- Verified in all environments
- No forced logout during deployment

## Probable Intent
User frustration with interrupted workflows. Compliance requirement for 30-min sessions.

## Known Facts / Evidence
- Config: config/auth.ts:12 = sessionDuration: 1800000
- Observed: ~900 seconds actual timeout
- Affects: Production only
- Codebase: middleware/session.ts:45 has hardcoded maxAge: 900000

## Constraints
- Must not break existing sessions (rolling deploy)
- Production deploy window: Sat 2am-4am only
- Preserve all auth security measures

## Success Criteria
- [ ] Cookie maxAge matches config.sessionDuration
- [ ] Test verifies duration match
- [ ] All environments behave identically
- [ ] Manual test: 20 min idle → still active

## Non-Goals
- NOT changing session duration value (30 min is correct)
- NOT adding "remember me" feature
- NOT changing session storage backend

## Decision Boundaries
Agent can decide: Fix approach (cookie maxAge vs session duration)
Must ask: Whether to add session refresh on activity (scope change)

## Unknowns / Open Questions
(None - all resolved during clarification)

## Likely Codebase Touchpoints
- src/middleware/session.ts (HIGH) - Fix cookie maxAge
- tests/session.test.ts (NEW) - Add regression test
- config/auth.ts (read-only) - Maybe add comment

## History / Updates
- 2026-04-02 09:00Z - Created by clarifier
- 2026-04-02 09:05Z - Filled after exploration
- 2026-04-02 09:10Z - Resolved all unknowns
```

### Example 2: Initial Snapshot (Before Clarification)

```markdown
# Task: Make the app faster
Snapshot: 20260402T110000Z
Created by: clarifier
Status: active

## Task Statement
User wants the app to be faster.

## Desired Outcome
[UNKNOWN - needs clarification]
- Faster in what scenario? (page load, API response, build time?)
- How much faster? (50%? 2x? "noticeably"?)
- What is acceptable tradeoff? (complexity, cost, features?)

## Probable Intent
[HYPOTHESIS - to be validated]
User experiencing slowness that impacts their workflow. Likely specific pages or operations.

## Known Facts / Evidence
(None yet - needs investigation)

## Constraints
[UNKNOWN - needs clarification]

## Success Criteria
[UNKNOWN - needs clarification]

## Non-Goals
[UNKNOWN - needs clarification]

## Decision Boundaries
(Too early to determine)

## Unknowns / Open Questions
- Q: What specifically is slow? (pages, API, builds, tests?)
- Q: How is slowness measured? (perceived, metric-based?)
- Q: What is the current baseline? (load time, response time?)
- Q: What is the target? (specific number or "faster"?)
- Q: What is acceptable to change? (code, infrastructure, architecture?)

## Likely Codebase Touchpoints
(Cannot determine without more context)

## History / Updates
- 2026-04-02 11:00Z - Created by clarifier
- Next: Run clarification interview to resolve unknowns
```

## Best Practices

### 1. Be Specific with Evidence
❌ "The session timeout is wrong"
✅ "Config says 1800s, observed behavior is 900s (source: user report + logs)"

### 2. Distinguish Facts from Hypotheses
❌ "The cookie expiration causes the issue"
✅ "HYPOTHESIS: Cookie maxAge (900s) expires before session duration (1800s)"

### 3. Make Success Criteria Testable
❌ "Sessions work correctly"
✅ "Manual test: idle for 20 min → session active; idle for 35 min → session expired"

### 4. Capture Decision Boundaries Early
Prevents agents from:
- Asking redundant questions
- Making unauthorized scope changes
- Blocking on trivial decisions

### 5. Update History
Every update should add a history entry with timestamp and what changed.

## Troubleshooting

**Snapshot too vague:**
→ Run clarifier role to fill unknowns

**Multiple snapshots for same task:**
→ Use latest (sorted by timestamp)

**Snapshot outdated after code changes:**
→ Create new snapshot with new timestamp, mark old as "superseded"

**Snapshot conflict between agents:**
→ Last write wins (timestamp determines winner)

## Summary

**Context snapshots are the shared memory of autonomous coding.**

Without them:
- Each agent rediscovers the same facts
- Context is lost after interruptions
- Ambiguity causes misalignment

With them:
- Shared grounding across agents and sessions
- Resume capability with full context
- Audit trail of what was known when
- Foundation for autonomous operation

**Rule:** Every task starts with a context snapshot. Every agent loads it first.

## References
- Clarifier role: `agents/skills/roles/deep-interview/SKILL.md`
- Ralph role: `agents/skills/workflows/ralph/SKILL.md`
- Orchestrator role: `agents/skills/roles/orchestrator/SKILL.md`
- State management: `agents/skills/workflows/state-management/SKILL.md`
