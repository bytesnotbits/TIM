<#
.SYNOPSIS
  Refresh the GitLab copy of TIM from GitHub.

.DESCRIPTION
  Interim tooling for the GitHub -> HCTC GitLab migration. GitHub is still the
  source of truth and the deploy path (GitHub Pages serves the warehouse
  iPads); the GitLab project is a delivery copy that goes stale every time you
  push to GitHub. This script re-syncs it.

  Flow:   GitHub  --fetch-->  local bare mirror  --push-->  GitLab

  NO TOKEN LIVES IN THIS FILE. The GitLab URL is credential-free on purpose so
  Git Credential Manager prompts once and stores it in Windows Credential
  Manager. Never put a token on the command line: it lands in
  ConsoleHost_history.txt and in anything you paste.

  Retire this script once TELCOR/TIM is live and origin points there.

.PARAMETER WhatIf
  Report what would change without pushing.

.EXAMPLE
  .\scripts\gitlab-refresh.ps1
.EXAMPLE
  .\scripts\gitlab-refresh.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$MirrorPath = "C:\Users\jherring\CLAUDEworkspace\tim-mirror",
    [string]$GitHubUrl  = "https://github.com/bytesnotbits/TIM.git",
    [string]$GitLabUrl  = "https://gitlab.hctc.coop/jherring/tim.git"
)

$ErrorActionPreference = "Stop"

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }

Say ""
Say "TIM -> GitLab refresh" "Cyan"
Say "  source : $GitHubUrl"
Say "  target : $GitLabUrl"
Say "  mirror : $MirrorPath"
Say ""

# --- 1. Make sure the bare mirror exists -----------------------------------
if (-not (Test-Path (Join-Path $MirrorPath "HEAD"))) {
    Say "No mirror found. Cloning from GitHub (this is a bare repo - no working files)..." "Yellow"
    $parent = Split-Path $MirrorPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    git clone --mirror $GitHubUrl $MirrorPath
    if ($LASTEXITCODE -ne 0) { throw "Clone failed." }
    Say "Mirror created." "Green"
}

# --- 2. Record where GitLab is now, then fetch GitHub ----------------------
Say "Current GitLab state:" "Cyan"
$before = git ls-remote --heads $GitLabUrl 2>&1
if ($LASTEXITCODE -ne 0) {
    Say "Could not reach GitLab. If this is a certificate error, run:" "Red"
    Say '  git config --global http.https://gitlab.hctc.coop/.sslVerify false' "Red"
    throw "GitLab unreachable."
}
if ([string]::IsNullOrWhiteSpace($before)) { Say "  (empty repository)" } else { $before | ForEach-Object { Say "  $_" } }

Say ""
Say "Fetching latest from GitHub..." "Cyan"
git --git-dir="$MirrorPath" remote update --prune
if ($LASTEXITCODE -ne 0) { throw "Fetch from GitHub failed." }

$heads = git --git-dir="$MirrorPath" show-ref --heads
Say "Mirror now holds:" "Cyan"
$heads | ForEach-Object { Say "  $_" }

# --- 3. Push ---------------------------------------------------------------
Say ""
Say "NOTE: --mirror makes GitLab match GitHub EXACTLY." "Yellow"
Say "      A branch that exists only on GitLab will be DELETED." "Yellow"
Say ""

if ($PSCmdlet.ShouldProcess($GitLabUrl, "git push --mirror")) {
    git --git-dir="$MirrorPath" push --mirror $GitLabUrl
    if ($LASTEXITCODE -ne 0) {
        Say "" "Red"
        Say "Push failed. Two usual causes:" "Red"
        Say "  * A protected branch on GitLab - unprotect it, or ask an admin." "Red"
        Say "  * A default branch the mirror wants to delete - GitLab forbids that." "Red"
        Say "Do NOT retry with force flags." "Red"
        throw "Push failed."
    }

    # --- 4. Verify ---------------------------------------------------------
    Say ""
    Say "Verifying..." "Cyan"
    $after = git ls-remote --heads $GitLabUrl
    $after | ForEach-Object { Say "  $_" }

    $localRefs  = (git --git-dir="$MirrorPath" show-ref --heads | ForEach-Object { ($_ -split '\s+')[0] }) | Sort-Object
    $remoteRefs = ($after | ForEach-Object { ($_ -split '\s+')[0] }) | Sort-Object
    if (($localRefs -join ',') -eq ($remoteRefs -join ',')) {
        Say ""
        Say "GitLab is current - every branch matches GitHub." "Green"
    } else {
        Say ""
        Say "Refs still differ. Compare the two listings above." "Yellow"
    }
} else {
    Say "WhatIf: nothing pushed." "Yellow"
}

Say ""
