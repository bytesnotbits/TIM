# TIM Two-Device Smoke Test

Validates the multi-device machinery against the **real** GitHub data repo. Two systems have
shipped without ever being exercised on two real devices:

- **Session checkpoint + write lease** (v2.57.00–v2.57.05) — counting survives one device, and a
  count can be carried from one of your devices to another.
- **Union auto-merge + conflict resolution** (v2.06.00–v2.08.00) — only ever stub-tested.

Phase A is the newer and riskier half; run it first. **You can stop after Phase A** and still have
validated everything shipped this cycle. Phase B is the older backlog item.

Deploy branch is `TIM-2.0` (push = deploy). Confirm the live build at
`https://bytesnotbits.github.io/TIM/app.js` (first lines, `APP_VERSION`).

---

## Before you start

**Devices.** `A` = the warehouse iPad (the counting device). `B` = your PC or laptop. Two browser
profiles or PWA installs work if you only have one machine, but two physical devices is the real
test.

**Prerequisites**

- [ ] Both devices on the **same live version** (Check for Updates → Reload), and it matches what
      GitHub Pages is serving.
- [ ] Both configured to the **same private data repo**, each with a PAT scoped
      **Contents: read & write**.
- [ ] **Distinct device labels** (GitHub panel → Configure → Device Label), e.g. `iPad-A` /
      `Laptop-B`. The test is meaningless if both say the same thing.
- [ ] **Testing mode OFF on both.** The amber banner must be absent and Push must not be greyed.
      Nothing in this test can work with testing mode on.
- [ ] Same username (`Joe`) on both — except where a step says otherwise.
- [ ] Both Sync to an identical starting state: matching product and history counts.

**Record the rollback point**

- [ ] Note the data repo's current commit SHA. Everything below is recoverable with a revert:
      `git -C <data-repo> log -1 --format=%H`

### Two warnings that matter

> **1. This writes to live shared data.** Testing mode must be off, so the test's sessions and
> events land in the real repo. **Use real items at a real location** — count 2–3 things that
> genuinely are where you say they are. Then the data you finalize is legitimate and there is
> nothing to clean up. Don't invent fake item numbers.

> **2. Always finalize what you start.** A checkpointed session that is *abandoned* while still
> `active` cannot currently be removed — there is no tombstone for sessions, so it will reappear on
> every device's **Counts In Progress** list after each sync, forever. Finalizing closes it and it
> drops off the list. (Known gap; a deliberate "discard session" needs building.)

---

## Phase A — checkpoint + write lease

### A1. A count appears on the other device without being finalized

1. On **A**: Inventory → Count → **Start New**. Name it `smoketest`.
2. Scan a location, then scan/enter **2 real items**.
3. Wait ~30 seconds (the checkpoint coalescing window), then watch the GitHub panel status.
4. On **B**: click **Sync Now**, then go to Inventory → **In Progress**.

**Expect on B:** A's session listed — Counted By `joe`, Counting On `iPad-A`, Events `2`, a Last
Checkpoint timestamp from moments ago, Status **"Your count, elsewhere"**, Action **"Continue
here"**. Clicking the session name shows a read-only per-item rollup.

**If it fails:** nothing listed → check testing mode on A, and that A's status bar showed a push.
Session listed with 0 events → checkpoint pushed the session but not the events; stop and report.

---

### A2. Someone else's count is read-only

1. On **B**: change the username in the sidebar from `joe` to `tester`.
2. Re-enter Inventory → **In Progress** (switch sub-views to force a re-render).

**Expect on B:** the same session now shows Status **"Read-only"** and the Action column reads
**"Read-only"** — *no button*. The rollup is still viewable.

3. **Change the username back to `joe`** before continuing. (It stamps `countedBy` on every event.)

**If it fails:** a "Continue here" button appearing under a different username is a permission
failure — stop and report. Everything after this assumes ownership is enforced.

---

### A3. The handoff

1. On **B** (username back to `joe`): **In Progress** → **Continue here** → confirm both prompts.

**Expect on B:** lands on the Count view; the session name matches A's; the alert reports the
events carried over and the sequence number; those events are visible in the Event Log.

2. On **B**: scan **1 more real item** (3 total now).

**If it fails:** events missing after the claim → stop, do not finalize, report the counts.

---

### A4. The old device finds out — *the race this test was built to catch*

This is the step that found a bug during preparation (fixed in v2.57.05). A's checkpoint must not
be able to take the session back, because a checkpoint is not a claim.

1. On **A** — *without syncing first* — scan **1 more real item** (4 total across both devices).
2. Wait for A's checkpoint (~30s), or click **Sync Now** on A to force the issue.

**Expect on A:** a red banner — *"Counting moved to Laptop-B at HH:MM"* — and scanning is blocked
with a message naming the other device. A's 4th scan is **not** lost: it still reaches the repo.

3. On **B**: **Sync Now**.

**Expect on B:** still holds the lease (no red banner), and the event count is now **4** — A's last
scan merged in.

**If it fails:** if A keeps counting normally and B gets the banner instead, the lease ping-ponged —
that is the v2.57.05 bug resurfacing. Stop and report which device ended up holding it.

---

### A5. Taking it back

1. On **A**: click **Take it back** in the red banner → confirm.

**Expect on A:** banner clears, scanning works again (subject to the usual location-first rule).

2. On **B**: **Sync Now**.

**Expect on B:** red banner appears naming `iPad-A`; B's scanning is now blocked.

**If it fails:** both devices scanning with no banner on either = no lease is being honoured. Stop.

---

### A6. Finalize closes it everywhere

1. On **A**: **Finalize & Merge** → confirm. Let the push complete.
2. On **B**: **Sync Now** → Inventory → **In Progress**.

**Expect on B:** the session is **gone from the In Progress list** (closed sessions don't appear).
Its counts are in the master data — check the item's history in Products → Serial/Item lookup.

**Expect on B** if it still had the session open: a banner saying it was finalized elsewhere.

**If it fails:** a finalized session still listed as in-progress means "closed beats active" isn't
holding in the merge. Stop and report.

---

## Phase B — union auto-merge (older backlog)

Both devices Sync to a common state before **each** test.

| # | Do | Expect |
|---|---|---|
| B1 | A edits product X; B edits a *different* product Y. Both push, both Sync. | Both edits present on both devices. No Conflicts badge. |
| B2 | A edits one field of serial S (e.g. `fsan`); B edits a *different* field of the same S (e.g. `mac`). Both push, both Sync. | S shows **both** edits merged. No conflict. |
| B3 | A sets `S.mac = AAA`; B sets `S.mac = BBB`. A pushes first, then B. | B **rebases** (doesn't block or overwrite). Conflicts badge on both. Review shows both candidates with who/when. Resolve on one → auto-push, badge clears; other device Syncs → badge clears, chosen value present. |
| B4 | A goes offline, does **Mark as Imported**. Re-enable network. | Status says saved locally / will push on reconnect. It auto-pushes on reconnect. B sees it after Sync. |
| B5 | Create 2 conflicts. Resolve 1, leave 1. **Push resolved now**. | The resolved one publishes; badge still shows 1 unresolved. |
| B6 | A deletes a catalog product; B doesn't touch it. Both push/Sync. | The product stays **deleted** — not resurrected. |

---

## Stop immediately if

- Any record, product or **count event disappears**. That's data loss — stop and capture the state.
- Status stuck on "Syncing…" or "Pushing…" — the in-flight lock didn't release (`ghSyncInFlight`).
- A real same-field conflict **not** detected, or the badge not clearing after Sync on both devices.
- A conflict silently overwriting one side instead of logging to `data/conflicts.json`.
- **Both devices** able to scan into the same session with no banner on either.

## Rollback

The data repo is git — revert to the starting SHA noted above, or delete the test records and clear
test entries from `data/conflicts.json`. Then Sync both devices.

---

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| A1 checkpoint visible | | |
| A2 read-only for others | | |
| A3 handoff | | |
| A4 old holder stands down | | |
| A5 take it back | | |
| A6 finalize closes everywhere | | |
| B1 disjoint adds | | |
| B2 disjoint fields | | |
| B3 same-field conflict | | |
| B4 offline defer | | |
| B5 partial resolve | | |
| B6 delete honored | | |

Run date: ______________  Live version: ______________  Rollback SHA: ______________
