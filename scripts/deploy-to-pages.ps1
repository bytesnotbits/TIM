<#
.SYNOPSIS
  Deploy TIM to the warehouse iPads by fast-forwarding GitHub Pages from GitLab.

.DESCRIPTION
  Replaces scripts\gitlab-refresh.ps1, which pushed the other way
  (GitHub -> GitLab). That direction became wrong the moment GitLab started
  merging MRs: a merge commit on GitLab main has no counterpart on GitHub, so
  the two histories diverge and a mirror push can only resolve it by deleting
  somebody's work.

  Direction of travel:

      you --MR--> GitLab main  --fast-forward-->  GitHub main --> Pages --> iPads
                  (canonical)                     (delivery copy)

  GitLab is where code is reviewed and merged. GitHub is a dumb delivery copy:
  nothing is ever merged there, so its history can only ever be GitLab's
  history and nothing else. That is what makes this safe to run without
  thinking - the push is fast-forward only, never forced.

  If the push is NOT a fast-forward, commits exist on GitHub that GitLab has
  never seen - i.e. somebody (probably you, on a count day) pushed straight to
  GitHub to fix something burning. The script stops and shows you those
  commits rather than papering over them. Carry them into GitLab with an MR,
  then run this again.

  PREREQUISITES - this script is NOT yet in service as of 2026-10-13:
    * A `gitlab` remote pointing at TELCOR/TIM (added, credential-free).
    * A Developer token for gitlab.hctc.coop, so the fetch can authenticate.
    * Project membership for your user account, so you can open MRs at all.
    * Work actually happening on GitLab. Until then GitHub main IS canonical
      and you deploy the ordinary way: git push origin main

  Retire this script entirely once GitLab serves the iPads directly.

  NO TOKEN LIVES IN THIS FILE. Both remote URLs stay credential-free so Git
  Credential Manager prompts once and stores it. Never put a token on a
  command line: it lands in ConsoleHost_history.txt and in anything you paste.

.PARAMETER WhatIf
  Show exactly what would be deployed, push nothing.

.PARAMETER Yes
  Skip the "is a count running?" prompt. For unattended use only.

.EXAMPLE
  .\scripts\deploy-to-pages.ps1 -WhatIf
.EXAMPLE
  .\scripts\deploy-to-pages.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoPath      = "C:\Users\jherring\CLAUDEworkspace\TIM",
    [string]$SourceRemote  = "gitlab",
    [string]$SourceBranch  = "main",
    [string]$DeployRemote  = "origin",
    [string]$DeployBranch  = "main",
    [string]$LiveUrl       = "https://bytesnotbits.github.io/TIM/app.js",
    [switch]$Yes
)

$ErrorActionPreference = "Stop"
function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }

Set-Location $RepoPath

Say ""
Say "TIM deploy  ($SourceRemote/$SourceBranch  ->  $DeployRemote/$DeployBranch  ->  Pages)" "Cyan"
Say ""

# --- 1. Refuse to act on a dirty tree -------------------------------------
$dirty = git status --porcelain
if ($dirty) {
    Say "Working tree has uncommitted changes:" "Red"
    $dirty | ForEach-Object { Say "  $_" }
    Say ""
    Say "This script only moves published commits. Commit or stash first." "Red"
    throw "Dirty working tree."
}

# --- 2. Where is each side now? -------------------------------------------
Say "Fetching..." "Cyan"
git fetch $SourceRemote --prune
if ($LASTEXITCODE -ne 0) {
    Say "Could not reach $SourceRemote. If this is a certificate error, run:" "Red"
    Say '  git config --global http.https://gitlab.hctc.coop/.sslVerify false' "Red"
    throw "Source remote unreachable."
}
git fetch $DeployRemote --prune
if ($LASTEXITCODE -ne 0) { throw "Could not reach $DeployRemote." }

$src    = "$SourceRemote/$SourceBranch"
$deploy = "$DeployRemote/$DeployBranch"
$srcSha    = (git rev-parse $src).Trim()
$deploySha = (git rev-parse $deploy).Trim()

Say ""
Say "  GitLab $SourceBranch : $($srcSha.Substring(0,8))"
Say "  GitHub $DeployBranch : $($deploySha.Substring(0,8))"

if ($srcSha -eq $deploySha) {
    Say ""
    Say "Already current - nothing to deploy." "Green"
    Say ""
    return
}

# --- 3. Fast-forward check ------------------------------------------------
# Is the deployed commit an ancestor of what GitLab has? If not, GitHub holds
# commits GitLab never saw, and that is not ours to resolve automatically.
git merge-base --is-ancestor $deploySha $srcSha
if ($LASTEXITCODE -ne 0) {
    Say ""
    Say "STOP - GitHub has commits that GitLab does not:" "Red"
    git log --oneline "$src..$deploy" | ForEach-Object { Say "  $_" "Red" }
    Say ""
    Say "That is almost certainly a break-glass push made during a count." "Yellow"
    Say "Carry those commits into GitLab with an MR, then run this again." "Yellow"
    Say "Do NOT add --force: it would delete them from the live site." "Red"
    throw "Not a fast-forward."
}

# --- 4. Show exactly what is about to reach the floor ---------------------
Say ""
Say "Commits to deploy:" "Cyan"
git log --oneline --no-merges "$deploy..$src" | ForEach-Object { Say "  $_" }

$verPattern = 'APP_VERSION\s*=\s*["'']([^"'']+)'
$verLine = (git show "${src}:app.js" | Select-String -Pattern $verPattern | Select-Object -First 1)
if ($verLine) {
    Say ""
    Say "  APP_VERSION going live: $($verLine.Matches[0].Groups[1].Value)" "Green"
} else {
    Say ""
    Say "  Could not read APP_VERSION from app.js - check that it was bumped." "Yellow"
}

# --- 5. The count-day guard -----------------------------------------------
Say ""
Say "This push IS the deploy. Within about a minute the iPads will be" "Yellow"
Say "offered a reload prompt." "Yellow"
if (-not $Yes) {
    Say ""
    $ans = Read-Host "Is a physical count running right now? (y/N)"
    if ($ans -match '^(y|yes)$') {
        Say ""
        Say "Stopping. Deploy after the count, or get express go-ahead." "Yellow"
        Say ""
        return
    }
}

# --- 6. Push ---------------------------------------------------------------
# Pushes the fetched SHA straight across; nothing is checked out locally.
if ($PSCmdlet.ShouldProcess("$deploy", "fast-forward to $src")) {
    git push $DeployRemote "${srcSha}:refs/heads/$DeployBranch"
    if ($LASTEXITCODE -ne 0) {
        Say ""
        Say "Push rejected. Re-run - someone pushed to GitHub since the check above." "Red"
        throw "Push failed."
    }

    git fetch $DeployRemote --prune | Out-Null
    $after = (git rev-parse $deploy).Trim()
    Say ""
    if ($after -eq $srcSha) {
        Say "Deployed. GitHub $DeployBranch now matches GitLab $SourceBranch." "Green"
        Say ""
        Say "Pages rebuilds in ~1 min. Verify with:" "Cyan"
        Say "  $LiveUrl   (read APP_VERSION)" "Cyan"
        Say "Then 'Check for Updates' in the app offers 'Reload now'." "Cyan"
    } else {
        Say "Pushed, but $deploy reads $($after.Substring(0,8)) - investigate." "Yellow"
    }
} else {
    Say ""
    Say "WhatIf: nothing pushed." "Yellow"
}

Say ""
