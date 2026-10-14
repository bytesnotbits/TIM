# TIM Backend Spec — moving off the GitHub-repo database

**Status:** DRAFT v0.2 — 2026-10-14. Not agreed with anyone. Written to be argued with.
**Blocked:** see §1a — the warehouse iPads cannot reach internal servers. Nothing below can be scheduled until that is resolved.
**Owner:** Joe Herring
**Purpose:** define what HCTC needs to build so TIM can stop using a private GitHub
repository as its database, and define how TIM migrates onto it without interrupting
warehouse operations.

---

## 1. One-paragraph summary

TIM is a vanilla-JS PWA used on iPads on the warehouse floor. Its shared state lives in a
private GitHub repository that the browser reads and writes through `api.github.com`. That
has to be replaced with a coop-hosted database. This document proposes that TIM be
onboarded onto **AppStack** — the internal application platform HCTC already runs — rather
than having a bespoke backend designed for it, and that the migration be done behind a
code seam so the existing GitHub path keeps working untouched until the new one is proven.

---

## 1a. BLOCKER — the warehouse iPads cannot reach internal servers at all

**Tested 2026-10-14 on a floor iPad:** `https://telcor.hctc.coop:3012` returns *"Safari
cannot open the page because the server cannot be found."* That is a **DNS failure**, not a
certificate problem. The warehouse iPads are on the **guest wifi**, which does not resolve
internal hostnames. Laptops reach internal resources over a **VPN**; the iPads have none.

**TIM works today because its backend is on the public internet.** GitHub Pages serves the
app and `api.github.com` holds the data — both reachable from guest wifi. That was not a
deliberate architectural choice, but it is now load-bearing: *any* move to an
internally-hosted service breaks not only data sync but the loading of the app itself.

This supersedes the certificate question as the gating issue. Trust does not matter if the
hostname does not resolve. **Everything below in §2.1, §5 and §7 assumes a network path
that does not currently exist.**

### Options, each with a real cost — this is an IT/security decision, not Joe's

| Option | Cost / risk |
|---|---|
| **A. Move the iPads to an internal SSID** | Cleanest technically. Shared, mobile, warehouse-floor devices on the internal network is a security conversation. Needs IT. |
| **B. VPN on the iPads** (always-on, via MDM) | Requires MDM enrolment. A dropped VPN mid-count stalls sync silently — the exact failure TIM's offline design exists to tolerate, but harder to detect. |
| **C. Expose the TIM service publicly**, authenticated | Preserves the current topology and asks nothing of the devices — this is effectively what GitHub does today. Largest security review. |
| **D. Do not migrate the runtime** | Keep data on an external service; use the coop DB only for reporting/integration. Honest option, should not be dismissed by default. |

### A solved path already exists somewhere in the coop

**Other HCTC users already have iPad access to coop services that are not on the public
internet** (Joe, 2026-10-14 — mechanism unknown). So this is not a request to build
something new; it is a request to apply an existing arrangement to the warehouse devices.
That reframes the ask from infrastructure to precedent, and it is why Option A or B is
more likely than it first appeared.

**The question to ask — a precedent question, not an infrastructure one:**

> Some of our iPads already reach coop services that aren't on the public internet. How is
> that set up, and can the warehouse iPads be put on the same footing?

Whoever runs the network can answer that from memory. It needs no estimate, no design, and
no decision from Eric beyond pointing at the right person.

**Second question, needed either way:** *are the warehouse iPads MDM-managed, and by
which MDM?* That determines whether a CA profile, a VPN profile, or an SSID change can be
pushed to them at all. Check: **Settings → General → VPN & Device Management** on the
device — a listed Mobile Device Management profile names the managing organisation.

---

## 2. What already exists at HCTC (evidence, not assumption)

Read out of the live FinalSpan checkout (`stack/stack.config.json`,
`docs/stack-operations-runbook.md`, `stack/routes.js`), pinned at `0477a89`.

| Capability | What it is |
|---|---|
| **AppStack** | Central control plane at `https://telcor.hctc.coop:3006`. Restarts/stops a registered app, tails its logs, pushes self-updates. |
| **Per-app identity** | Each app gets a `stack.config.json` declaring its name, port, site URL, log path, scheduled task, and **its GitLab project + branch**. |
| **Hosting** | Apps are served over HTTPS from `telcor.hctc.coop:<port>` (FinalSpan is `:3012`). |
| **TLS** | A **wildcard certificate** for `*.hctc.coop` (`fullchain.pem` + `wildcard.hctc.coop.key`). |
| **SSO** | HCTC SSO issues **JWTs** signed with a shared secret; apps verify with `jsonwebtoken` and read claims (`isAdmin`, `siteAdmins`, `ssoRole`). Portal at `https://telcor.hctc.coop`. |
| **Database** | PostgreSQL on `omnivore-prod`, with per-app schemas (FinalSpan uses `finalspan_app.*`). |
| **Stack pack** | A portable admin/diagnostics module *"embedded into Finalspan (and other HCTC apps)"* — i.e. designed for reuse. |

**Why this matters more than any schema discussion:** three of the four things that were
blocking TIM already exist and are in production use. TIM does not need a backend designed
from nothing; it needs to be onboarded.

### 2.1 What would replace GitHub Pages — conditional on §1a

`stack.config.json` carries `gitlabProject` and `gitlabBranch`, and AppStack can push
self-updates. So the GitLab-side deploy target TIM has been missing *would* be **AppStack
pulling `TELCOR/TIM` `main`**: GitHub Pages retires, GitLab becomes canonical, and the
deploy becomes a platform function rather than a side effect of a push.

**This is blocked by §1a and must not be treated as the plan until the network question is
answered.** AppStack serves on `telcor.hctc.coop`, which the floor iPads cannot resolve.
Under today's topology, moving the app there would leave the warehouse unable to load TIM
at all — a strictly worse outcome than the status quo. GitHub Pages stays until a device
on guest wifi can reach the replacement.

---

## 3. Lessons taken from FinalSpan (what NOT to repeat)

FinalSpan made this exact transition. These are drawn from its own incident record.

1. **Do not end up with two codebases.** FinalSpan has a dev repo (Supabase) and a
   separate live codebase the dev team reimplements against Postgres. Most of its recorded
   pain descends from that split: schema divergence found by accident, a fix merged but not
   deployed that blanked every item list on live, a server restarted on a new commit still
   serving the old frontend bundle, and three handoffs for one data-loss bug sitting open
   2–4 months. **TIM must stay one codebase that Joe owns, talking to a service.**
2. **Writes must be acknowledged.** FinalSpan shipped nine fire-and-forget write functions
   with no user-visible failure path, and lost a three-person accounting session's work.
3. **No whole-blob overwrites.** `syncAssetState` replaced a whole record, so two users
   erased each other.
4. **No empty stubs left wired up.** Three no-op functions were still being called; they
   looked implemented. This is the direct argument for *removing* the GitHub path at
   cutover rather than leaving it in place "just in case."
5. **Schema change and the code that depends on it ship together.** A dropped column with
   the app still selecting it took live down.

---

## 4. Non-negotiable constraints

These are the parts most likely to be designed away by someone unfamiliar with TIM.

### 4.1 The server is a sync target, not a live dependency
TIM is used where wifi drops mid-scan. It holds all state locally in IndexedDB and works
fully offline; the shared copy is reconciled afterwards. **A conventional CRUD API where
the UI blocks on the server is a regression** and would reproduce FinalSpan's data-loss
shape on day one.

### 4.2 Conflict semantics are union + last-write-wins, not overwrite
TIM already implements this client-side: records carry `updatedAt`, deletions are
tombstones with a TTL (a hard delete cannot win in a union model — it simply re-unions
back). **The server must accept and preserve these semantics**, including tombstones.

### 4.3 Scanning cannot be interrupted by authentication
Warehouse iPads are shared and in constant use during a count. A session expiry that drops
a login wall mid-count is an operational failure, not an inconvenience. Session lifetime
and re-auth behaviour are a design requirement, not a detail.

### 4.4 It must still install and run as a PWA
Home-screen install, service worker, offline load. iOS requires absolute `start_url`/`scope`
in `manifest.json`; an iOS home-screen PWA has isolated storage.

---

## 5. Proposed target architecture

```
  iPad (PWA, IndexedDB, service worker)
      |  HTTPS, *.hctc.coop wildcard cert, HCTC SSO JWT cookie
      v
  TIM app on AppStack  (telcor.hctc.coop:<port>, from TELCOR/TIM main)
      |  serves the static PWA  +  a small sync API
      v
  PostgreSQL on omnivore-prod   (schema: tim_app.*)
```

TIM becomes a small Node service that serves the existing PWA unchanged and exposes a sync
API. The frontend stays exactly what it is today — this is explicitly **not** a rewrite.

---

## 6. API surface (the contract; tables are the builder's business)

The contract is deliberately tiny, because the client already does the hard part.

| Endpoint | Purpose |
|---|---|
| `GET /api/sync?since=<cursor>` | Return all records changed since the cursor, per collection. |
| `POST /api/sync` | Accept a batch of changed records; server unions them by key, keeping the higher `updatedAt`. Returns the new cursor **and the merged result**. |
| `GET /api/health` | Readiness + schema version. |

Rules:
- **Every write is acknowledged.** The response states what was accepted. No fire-and-forget.
- **Idempotent.** The same batch posted twice produces the same state.
- **No partial-success silence.** If a record is rejected, it is named in the response.
- **Tombstones are records**, not deletions.

### 6.1 Collections to carry
Shapes already documented in TIM's data dictionary; field-level detail to be attached as
an appendix rather than restated here.

`product_map` · `history` · `inventory_sessions` · `inventory_events` · `recount_sessions`
· `recount_movements` · `boxes` · `pallets` · `reels` · `barcode_map` · `odoo_quants`

---

## 7. Migration approach — a seam, not a rewrite

1. **Extract the sync layer.** Replace direct GitHub calls with one internal interface
   (`syncPull()` / `syncPush()`), with the existing GitHub implementation behind it. No
   behaviour change; this is shippable on its own and is the one refactor that pays for
   itself immediately.
2. **Add a second implementation** for the coop API, selected by a flag. Build and test it
   against a local mock while the real service is still being written.
3. **Run one device on the new backend** while everyone else stays on GitHub.
4. **Move devices across** as confidence builds.
5. **Delete the GitHub implementation** — see cutover criteria below.

At no point is the working system removed before its replacement is proven.

### 7.1 Cutover criteria (write it down now or it never happens)
The GitHub implementation is deleted — not disabled, deleted — when **all** hold:
- every device has run on the coop backend for **30 consecutive days**;
- **zero** fallback events logged in that window;
- one full physical count cycle completed on the new backend;
- an export/import round-trip verified against the new backend.

---

## 8. Open questions — these need answers before anyone estimates

**For Eric / Alex / whoever owns the network:**
1. **ANSWERED, AND IT IS THE BLOCKER — see §1a.** The floor iPads are on guest wifi and
   cannot resolve internal hostnames at all (`telcor.hctc.coop:3012` → "server cannot be
   found"). The real question is now: *what is the intended path for an internal
   application to reach devices on the guest network* — move the devices, VPN them, or
   expose the service? Nothing else in this document can be scheduled until this is
   settled.
2. **Are the warehouse iPads MDM-managed?** Determines whether a CA profile, a VPN
   profile, or an SSID change is deployable at all.
3. Is the `*.hctc.coop` wildcard certificate publicly trusted, or issued by an internal
   CA? Still needed, but **downstream of #1** — trust is irrelevant while DNS fails.
   (Weak prior evidence it is CA-issued: `telcor` is configured with a `fullchain.pem`,
   unlike `gitlab.hctc.coop`, which is self-signed.)
4. **How does a user actually authenticate?** Browser session cookie from the portal? How
   long does it last, and what happens on expiry mid-use? (See 4.3.)
5. Can TIM be onboarded onto AppStack the way FinalSpan is — its own port, its own
   `stack.config.json`, pulling `TELCOR/TIM` `main`?
6. Is a **non-production instance** (dev API + dev database) included? Requesting it now,
   with the build, rather than as a second ask later.
7. Who builds and owns the service — and does it live in `TELCOR/TIM` alongside the
   frontend, or a separate project? (Section 3.1: strong preference for one repo.)

**For Joe to decide:**
8. Per-user identity or per-device? TIM currently tracks a username in `localStorage` only.
9. Does SSO replace that username, or sit alongside it?

---

## 9. Explicitly out of scope for this phase

- Refactoring `app.js` beyond extracting the sync layer. A general refactor concurrently
  with a backend migration is two risky changes at once on a tool running live counts,
  with no automated tests to catch regressions.
- Retiring GitHub Pages. That happens only once AppStack serves the iPads.
- Field-tech serialized tracking, and anything Odoo-side.

---

## 10. Appendix — source of each claim about HCTC infrastructure

| Claim | Source |
|---|---|
| AppStack URL, ports, cert paths, GitLab project/branch | `live-readonly/stack/stack.config.json` |
| AppStack responsibilities, Stack module reuse | `live-readonly/docs/stack-operations-runbook.md` |
| SSO via shared-secret JWT, admin claim shapes | `live-readonly/stack/routes.js` |
| Postgres on omnivore-prod, per-app schema | FinalSpan `INDEX.md`, item 6 |
| FinalSpan failure modes | FinalSpan `INDEX.md`, items 0h/0k |

All read-only, from the pinned live checkout at `0477a89` (2026-09-01). **Anything here may
have changed since**; confirm before building.
