---
name: evidence-verification
description: Requires fresh, verifiable evidence before any completion claim. Covers evidence types (tests, build, type/lint, regression, behavioral), freshness rules, checklists by task kind, evidence storage under `.pi/evidence/`, architect sign-off, tier-appropriate depth, anti-patterns, and role integration (Ralph, reviewer, architect, orchestrator). Use whenever claiming work is done, verifying a fix or feature, collecting proof for gates, or reviewing whether evidence is sufficient.
---

# Evidence Verification Protocol

**No promises. Only proof.**

## Core Principle

An agent cannot claim completion without **fresh, verifiable evidence** that the work succeeds.

- "It should work" is not evidence
- "Looks good to me" is not evidence
- "I tested it earlier" is not evidence
- Fresh command output showing success **is** evidence

## Evidence Types

### 1. Test Evidence

**Required:**
- Command run within last 5 minutes
- Full output captured (no truncation)
- Clear success indicator ("X passed, 0 failed")
- Relevant to the changed code

**Good Example:**
```
Command: npm test
Timestamp: 2026-04-02T09:14:23Z
Output:
  Test Suites: 5 passed, 5 total
  Tests:       42 passed, 42 total
  Snapshots:   0 total
  Time:        3.521 s
```

**Bad Example:**
```
"I ran the tests and they all passed."
```
Why bad: No output, no timestamp, no proof.

**Bad Example:**
```
Command: npm test
Timestamp: 2026-04-01T14:00:00Z  ← Yesterday!
Output: [...]
```
Why bad: Stale evidence (>5 min old).

### 2. Build Evidence

**Required:**
- Build command appropriate to project
- Full output showing success
- No errors (warnings documented if present)
- Recent (< 5 min)

**Good Example:**
```
Command: npm run build
Timestamp: 2026-04-02T09:15:00Z
Output:
  vite v4.3.9 building for production...
  ✓ 234 modules transformed.
  dist/index.html   0.45 kB │ gzip: 0.30 kB
  dist/assets/...   142.33 kB │ gzip: 45.12 kB
  ✓ built in 2.14s
```

**Examples by project type:**
```bash
# Node.js
npm run build

# Python
python -m build

# Rust
cargo build --release

# Go
go build ./...

# Java
mvn package

# C/C++
make
```

### 3. Type/Lint Evidence

**Required:**
- Type checker or linter run
- Zero errors on modified files
- Warnings acceptable if pre-existing and documented

**Good Example:**
```
Command: npm run typecheck
Timestamp: 2026-04-02T09:15:30Z
Output:
  No errors found.
```

**Good Example (LSP):**
```
LSP Diagnostics for src/auth.ts:
  Errors: 0
  Warnings: 1 (line 45: unused import - pre-existing)
  Info: 0
```

**Bad Example:**
```
Command: npm run typecheck
Output:
  src/auth.ts:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.
  Found 1 error.
```
Why bad: Error present, cannot claim completion.

### 4. Regression Evidence

**Required when:**
- Modifying existing functionality
- Refactoring code
- Changing APIs

**Good Example:**
```
Command: git diff main..HEAD --stat
Output:
  src/auth.ts           | 12 ++++----
  src/middleware/session.ts | 8 ++---
  tests/session.test.ts | 15 ++++++++++
  3 files changed, 28 insertions(+), 7 deletions(-)

Pre-existing test run (before changes):
  Tests: 41 passed, 41 total

Post-change test run (after changes):
  Tests: 42 passed, 42 total  ← Added 1 test, all still pass

Regression check: ✓ No pre-existing tests broken
```

### 5. Behavioral Evidence

**Required when:**
- Fixing a bug
- Adding a feature visible to users
- Changing runtime behavior

**Good Example (Bug Fix):**
```
Before fix:
  Command: curl http://localhost:3000/api/session
  Output: {"expires_in": 900}  ← Wrong (15 min)

After fix:
  Command: curl http://localhost:3000/api/session
  Output: {"expires_in": 1800}  ← Correct (30 min)
```

**Good Example (Feature):**
```
New feature: User can export data as JSON

Test:
  1. Login as test user
  2. Navigate to /export
  3. Click "Export as JSON"
  4. Verify download: user-data.json
  5. Verify contents: valid JSON, contains expected fields

Evidence: Screenshot of download + file contents
```

## Verification Checklist

Use this checklist before claiming completion:

### For Every Task
- [ ] Tests run and pass (fresh output < 5 min)
- [ ] Build succeeds (fresh output < 5 min)
- [ ] Type checker clean (0 errors on modified files)
- [ ] No pre-existing tests broken
- [ ] No debug leftovers (console.logs, commented code, TODOs)

### For Bug Fixes
- [ ] Bug is reproducible before fix
- [ ] Bug is NOT reproducible after fix
- [ ] Added regression test to prevent recurrence

### For New Features
- [ ] Feature works as specified
- [ ] Added tests for new code
- [ ] Documentation updated (if applicable)
- [ ] Error handling in place

### For Refactoring
- [ ] All tests still pass
- [ ] Public API unchanged (or changes documented)
- [ ] Performance not degraded (or improvement documented)

### For Security-Sensitive Changes
- [ ] No secrets in code
- [ ] Input validation present
- [ ] Error messages don't leak sensitive info
- [ ] Security-reviewer approved (THOROUGH tier)

## Evidence Storage

### In State Files
Store **references** to evidence, not full output:

```json
{
  "evidence": {
    "tests_passed": true,
    "tests_output_summary": "42 passed, 0 failed",
    "tests_timestamp": "2026-04-02T09:14:23Z",
    "tests_full_output": ".pi/evidence/fix-auth-bug/iteration-3-tests.txt"
  }
}
```

### Evidence Archive (Optional)
For long-running sessions, store full output:

```
.pi/evidence/
└── fix-auth-bug/
    ├── iteration-1-investigation.md
    ├── iteration-2-implementation.md
    ├── iteration-3-tests.txt
    ├── iteration-3-build.txt
    ├── iteration-3-typecheck.txt
    └── iteration-4-architect-review.md
```

## Architect Verification

After collecting technical evidence, require architect sign-off.

**Architect is asked to verify:**
1. All requirements met (completeness)
2. Edge cases handled (robustness)
3. Error contracts clear (reliability)
4. Module boundaries respected (design)
5. Tests adequate (quality)
6. No obvious performance issues (efficiency)
7. Documentation matches behavior (maintainability)

**Architect provides:**
- **Verdict:** APPROVED / REJECTED
- **Comments:** Specific feedback
- **Tier used:** LOW / STANDARD / THOROUGH

**If REJECTED:**
- Address ALL issues raised
- Re-collect evidence
- Re-submit to architect at same tier
- Max 3 rejection cycles before escalation

## Tier-Appropriate Verification

Evidence depth should match task complexity:

### LOW Tier Tasks
- Quick fixes, simple additions
- **Evidence:** Tests pass, build succeeds
- **Architect:** STANDARD tier OK

### STANDARD Tier Tasks
- Normal features, typical bugs
- **Evidence:** Full checklist
- **Architect:** STANDARD tier minimum

### THOROUGH Tier Tasks
- Complex changes, security-sensitive, architectural
- **Evidence:** Full checklist + regression suite + performance check
- **Architect:** THOROUGH tier required

## Freshness Requirements

**All evidence must be fresh:**
- **Default:** < 5 minutes old
- **For long builds:** < 10 minutes OK if build itself is slow
- **Rationale:** Code may have changed since last run

**How to ensure freshness:**
1. Run command
2. Capture timestamp immediately
3. Store both output and timestamp
4. Before using evidence, check age

**Example:**
```python
import datetime

def is_evidence_fresh(timestamp_str: str, max_age_minutes: int = 5) -> bool:
    evidence_time = datetime.datetime.fromisoformat(timestamp_str.replace("Z", ""))
    now = datetime.datetime.utcnow()
    age_minutes = (now - evidence_time).total_seconds() / 60
    return age_minutes < max_age_minutes

# Usage
if not is_evidence_fresh(evidence["tests_timestamp"]):
    # Evidence is stale, re-run tests
    run_tests()
```

## Anti-Patterns

### ❌ Claiming Success Without Running Verification

```
"I fixed the bug in auth.ts. The session timeout should now work correctly."
```

**Problem:** "Should" is not evidence. Run the tests.

### ❌ Using Stale Evidence

```
"I ran tests yesterday and they passed, so the code is good."
```

**Problem:** Code has changed since yesterday. Re-run tests.

### ❌ Accepting Partial Output

```
Command: npm test
Output:
  Test Suites: 5 passed, 5 total
  Tests:       42 passed, 42 total
  [... output truncated ...]
```

**Problem:** Truncation may hide failures. Capture full output.

### ❌ Skipping Architect Review

```
"The change is small, no need for architect review."
```

**Problem:** Ralph mode ALWAYS requires architect verification, regardless of size.

### ❌ Manual Testing Only

```
"I manually tested the login flow and it works."
```

**Problem:** Manual testing is not reproducible. Add automated test.

## Good Patterns

### ✅ Complete Evidence Package

```
Task: Fix session timeout bug
Iteration: 4/10
Phase: Verification complete

Evidence collected:

1. Tests (fresh)
   - Command: npm test
   - Timestamp: 2026-04-02T09:14:23Z
   - Result: 42 passed, 0 failed
   - Added: 1 new test (session duration match)
   - Output saved: .pi/evidence/fix-auth-bug/iter-4-tests.txt

2. Build (fresh)
   - Command: npm run build
   - Timestamp: 2026-04-02T09:14:45Z
   - Result: Build completed successfully in 2.1s
   - Output saved: .pi/evidence/fix-auth-bug/iter-4-build.txt

3. Type Check (fresh)
   - Command: npm run typecheck
   - Timestamp: 2026-04-02T09:15:00Z
   - Result: 0 errors, 0 warnings
   - Files checked: src/auth.ts, src/middleware/session.ts

4. Regression Check
   - Pre-existing tests: 41 (all still pass)
   - New tests: 1
   - Total: 42 passed
   - No tests broken ✓

5. Behavioral Verification
   - Before: session timeout at 900s
   - After: session timeout at 1800s
   - Matches config ✓

6. Architect Review
   - Tier: STANDARD
   - Reviewer: architect role
   - Verdict: APPROVED
   - Comments: "Code change correct, test coverage adequate, no concerns."
   - Review saved: .pi/evidence/fix-auth-bug/iter-4-architect.md

All gates passed ✓
Ready for completion.
```

### ✅ Failure Documentation

```
Task: Fix session timeout bug
Iteration: 3/10
Phase: Verification failed

Evidence collected:

1. Tests (fresh)
   - Command: npm test
   - Timestamp: 2026-04-02T09:10:15Z
   - Result: 41 passed, 1 failed ✗
   - Failure: tests/session.test.ts:23
     - Test: "session duration matches config"
     - Expected: 1800000
     - Received: 1800
     - Cause: Used seconds instead of milliseconds

2. Action: Fixing
   - Root cause identified: cookie.maxAge = config.sessionDuration (in seconds)
   - Fix: cookie.maxAge = config.sessionDuration * 1000
   - Proceeding to iteration 4...
```

## Integration with Roles

### Ralph Role
- Ralph **enforces** this protocol
- Cannot exit without all evidence green
- Tracks evidence in state file
- Escalates if evidence collection fails 3 times

### Reviewer Role
- Reviewer **validates** evidence
- Checks freshness, completeness
- Can reject if evidence is weak

### Architect Role
- Architect **signs off** after evidence collection
- Assumes technical evidence (tests/build) already passed
- Focuses on design quality, completeness, edge cases

### Orchestrator Role
- Orchestrator **aggregates** evidence from workers
- Ensures all workers provide evidence for their tasks
- Final sign-off requires evidence from all workers

## Summary

**Evidence is the forcing function for completion discipline.**

Without it:
- Agents claim "done" prematurely
- Bugs slip through
- Regressions go unnoticed
- Trust erodes

With it:
- Completion is provable
- Quality is measurable
- Progress is trackable
- Autonomous operation is possible

**Rule:** If you can't prove it with fresh evidence, you haven't finished.

## References
- Ralph role: `agents/skills/workflows/ralph/SKILL.md`
- Reviewer role: `agents/skills/roles/reviewer/SKILL.md`
- Architect role: `agents/skills/roles/architect/SKILL.md`
- State management: `agents/skills/workflows/state-management/SKILL.md`
