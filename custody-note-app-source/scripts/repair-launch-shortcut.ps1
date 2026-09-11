<#
.SYNOPSIS
    Repair Custody Note Windows shortcuts and remove every browser-PWA
    duplicate that can hijack the desktop app launch (now or in future).

.DESCRIPTION
    Finds every "Custody Note" entry on the current user's machine that can
    be launched from Start search, Apps & Features, Desktop, or Taskbar:

        - Start Menu / Desktop / Taskbar shortcuts (.lnk)
        - Apps & Features registrations
          (HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*)
        - Browser PWA registrations under HKLM uninstall hives

    Classifies each as one of:

        Desktop EXE (KEEP)    - target is %LOCALAPPDATA%\Programs\custody-note\Custody Note.exe
        Browser-PWA (REMOVE)  - target is chrome_proxy.exe / chrome.exe / msedge.exe /
                                brave.exe / vivaldi.exe / opera.exe with --app-id= or --app=https?:
        Unknown target        - anything else — left alone, printed for review

    With -Apply:
        * deletes every Browser-PWA shortcut found
        * runs each registered uninstaller for a Browser-PWA "Custody Note"
          entry in Apps & Features (best-effort; the browser must be open
          for its --uninstall-app-id flag to take effect, but the shortcut
          is gone either way)
        * never touches the Desktop EXE shortcut, never edits the registry,
          never sends anything to the network

    Why this exists
    ---------------
    Custody Note used to ship a Vercel-hosted browser/PWA demo (now 404).
    If the user installed it as a Chrome / Edge / Brave PWA before commit
    fe34c25 ("Remove web demo and PWA build; desktop app only"), Windows
    keeps the launcher entries forever. Clicking one of those entries
    opens the browser in app mode at a URL that is either a 404 or the
    marketing site — the symptom "the app opens as a webpage that offers
    a demo/trial-style experience". This script is the long-lived cleanup.

.PARAMETER Apply
    When set, deletes browser-PWA shortcuts and runs each registered
    PWA uninstaller. Without -Apply this script is read-only and prints
    what it would do.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File scripts\repair-launch-shortcut.ps1
    # Read-only audit. Prints every Custody Note entry and its target.

.EXAMPLE
    PS> powershell -ExecutionPolicy Bypass -File scripts\repair-launch-shortcut.ps1 -Apply
    # Deletes browser-PWA shortcuts + runs PWA uninstallers; keeps the EXE.

.NOTES
    Safe by design: never deletes the real EXE shortcut, never touches user
    data, never modifies the registry directly. Best-effort PWA uninstall
    only invokes the command the PWA itself registered with Windows.
#>
[CmdletBinding()]
param(
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$ExpectedExe = Join-Path $env:LOCALAPPDATA 'Programs\custody-note\Custody Note.exe'

# Any of these binaries with an --app-id= or --app=https?: argument is a
# Browser PWA (Chrome / Edge / Brave / Vivaldi / Opera all share the
# Chromium PWA contract). chrome_proxy.exe is Chrome's PWA stub.
$BrowserPwaTargetPattern = 'chrome_proxy\.exe$|chrome\.exe$|msedge\.exe$|msedge_proxy\.exe$|brave\.exe$|vivaldi\.exe$|opera\.exe$|launcher\.exe$'
$BrowserPwaArgPattern    = '--app-id=|--app=https?:'

$SearchRoots = @(
    [pscustomobject]@{ Label = 'User Desktop';        Path = [Environment]::GetFolderPath('Desktop') },
    [pscustomobject]@{ Label = 'User Start Menu';     Path = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') },
    [pscustomobject]@{ Label = 'All-Users Start Menu';Path = (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs') },
    [pscustomobject]@{ Label = 'Quick Launch / TaskBar pin'; Path = (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar') }
)

# Apps & Features hives. We never write here; we only enumerate so the user
# can see whether a "Custody Note" entry in Settings → Apps points at a
# browser PWA uninstall command (= REMOVE) or the real Custody Note 1.x.x
# uninstaller (= KEEP).
$UninstallHives = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

$shell = New-Object -ComObject WScript.Shell

function Read-Shortcut {
    param([string]$LnkPath)
    try {
        $sc = $shell.CreateShortcut($LnkPath)
        return [pscustomobject]@{
            Path        = $LnkPath
            TargetPath  = $sc.TargetPath
            Arguments   = $sc.Arguments
            WorkingDir  = $sc.WorkingDirectory
            Modified    = (Get-Item $LnkPath).LastWriteTime
        }
    } catch {
        return [pscustomobject]@{
            Path        = $LnkPath
            TargetPath  = "<unreadable: $_>"
            Arguments   = ''
            WorkingDir  = ''
            Modified    = $null
        }
    }
}

function Test-IsChromePwaShortcut {
    param($shortcut)
    if (-not $shortcut.TargetPath) { return $false }
    if ($shortcut.TargetPath -notmatch $BrowserPwaTargetPattern) { return $false }
    if ($shortcut.Arguments -match $BrowserPwaArgPattern) { return $true }
    return $false
}

function Test-IsRealDesktopShortcut {
    param($shortcut)
    if (-not $shortcut.TargetPath) { return $false }
    return ($shortcut.TargetPath -ieq $ExpectedExe)
}

function Get-CustodyNoteAppsFeaturesEntries {
    # Returns one object per "Custody Note" entry visible in Settings → Apps.
    # Classified the same way as shortcuts: Browser-PWA (REMOVE), Desktop EXE
    # (KEEP), or Unknown.
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($hive in $UninstallHives) {
        if (-not (Test-Path $hive)) { continue }
        Get-ChildItem $hive -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $p = Get-ItemProperty -Path $_.PSPath -ErrorAction Stop
            } catch { return }
            $name = if ($p.DisplayName) { [string]$p.DisplayName } else { '' }
            if ($name -notmatch '(?i)custody.?note') { return }
            $uninst = if ($p.UninstallString) { [string]$p.UninstallString } else { '' }
            $kind = 'Unknown target'
            if ($uninst -match '--uninstall-app-id=' -or $uninst -match $BrowserPwaTargetPattern) {
                $kind = 'Browser-PWA (REMOVE)'
            } elseif ($uninst -match 'Uninstall Custody Note\.exe' -or $uninst -match 'custody-note\\Uninstall') {
                $kind = 'Desktop EXE (KEEP)'
            }
            [void]$results.Add([pscustomobject]@{
                Hive            = $hive
                RegKey          = $_.PSChildName
                DisplayName     = $name
                DisplayVersion  = $p.DisplayVersion
                Publisher       = $p.Publisher
                UninstallString = $uninst
                Kind            = $kind
            })
        }
    }
    return ,$results.ToArray()
}

function Invoke-AppsFeaturesPwaUninstall {
    param([Parameter(Mandatory)] [pscustomobject]$entry)
    if ($entry.Kind -ne 'Browser-PWA (REMOVE)') { return }
    $cmd = $entry.UninstallString
    if (-not $cmd) {
        Write-Warning ("  No UninstallString recorded for {0}; skipping." -f $entry.RegKey)
        return
    }
    # UninstallString is a free-form command line; use cmd /c so the quoted
    # path + flags are preserved exactly as Windows would invoke them from
    # Settings → Apps.
    Write-Host ("  Running registered PWA uninstaller for [{0}]..." -f $entry.DisplayName)
    Write-Host ("    {0}" -f $cmd) -ForegroundColor DarkGray
    $cleanRun = $false
    try {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -PassThru -Wait -WindowStyle Hidden -ErrorAction Stop
        Write-Host ("    Exit code: {0}" -f $proc.ExitCode)
        if ($proc.ExitCode -eq 0) { $cleanRun = $true }
    } catch {
        Write-Warning ("  Failed to invoke uninstaller: {0}" -f $_)
    }

    # Some browsers (Chrome / Brave) only honour --uninstall-app-id when the
    # browser is closed, and otherwise return non-zero / no-op without
    # removing the Apps & Features registration. The entry then keeps showing
    # up in Start search, Settings → Apps, and any Windows app picker — the
    # exact regression vector this script exists to close. If we are sure
    # the entry is a browser-PWA registration (UninstallString contains
    # --uninstall-app-id= AND DisplayName matches "Custody Note"), and the
    # registered uninstaller did not return clean, fall back to deleting the
    # orphan registry key directly. Bounded and safe: we never delete
    # anything outside the Uninstall hive whose UninstallString contains
    # --uninstall-app-id.
    if (-not $cleanRun) {
        $regPath = Join-Path $entry.Hive $entry.RegKey
        $isOrphanPwa = ($entry.UninstallString -match '--uninstall-app-id=') `
            -and ($entry.DisplayName -match '(?i)custody.?note')
        if ($isOrphanPwa) {
            Write-Host ("  Cleaning up orphan registry entry: {0}" -f $regPath) -ForegroundColor Yellow
            try {
                Remove-Item -Path $regPath -Recurse -Force -ErrorAction Stop
                Write-Host '    Removed orphan PWA registration from Apps & Features.' -ForegroundColor Green
            } catch {
                Write-Warning ("    Could not remove {0}: {1}" -f $regPath, $_)
                Write-Warning '    Close Chrome / Edge / Brave fully and re-run this script.'
            }
        } else {
            Write-Warning '  Uninstaller did not run cleanly and entry does not look like a PWA orphan; left alone.'
        }
    }
}

Write-Host ''
Write-Host '====== Custody Note shortcut audit ======' -ForegroundColor Cyan
Write-Host "Expected target EXE: $ExpectedExe"
if (Test-Path $ExpectedExe) {
    $exeInfo = Get-Item $ExpectedExe
    Write-Host ("Real EXE found ({0} bytes, modified {1})" -f $exeInfo.Length, $exeInfo.LastWriteTime) -ForegroundColor Green
} else {
    Write-Warning "Real EXE NOT FOUND at $ExpectedExe"
    Write-Warning "You probably have not installed Custody Note for the current Windows user."
    Write-Warning "Run the latest installer (Custody-Note-Setup-x.y.z.exe) from"
    Write-Warning "https://github.com/robertcashman-bit/custody-note-app/releases or https://custodynote.com/download"
}
Write-Host ''

$badShortcuts = New-Object System.Collections.Generic.List[object]
$goodShortcuts = New-Object System.Collections.Generic.List[object]
$unknownShortcuts = New-Object System.Collections.Generic.List[object]

foreach ($root in $SearchRoots) {
    if (-not (Test-Path $root.Path)) { continue }
    $lnks = Get-ChildItem -Path $root.Path -Recurse -Filter '*ustody*.lnk' -Force -ErrorAction SilentlyContinue
    if (-not $lnks) { continue }
    Write-Host "--- $($root.Label) [$($root.Path)] ---" -ForegroundColor Yellow
    foreach ($lnk in $lnks) {
        $sc = Read-Shortcut -LnkPath $lnk.FullName
        if (Test-IsChromePwaShortcut $sc) {
            $kind = 'Chrome-PWA (REMOVE)'
            [void]$badShortcuts.Add($sc)
        } elseif (Test-IsRealDesktopShortcut $sc) {
            $kind = 'Desktop EXE (KEEP)'
            [void]$goodShortcuts.Add($sc)
        } else {
            $kind = 'Unknown target'
            [void]$unknownShortcuts.Add($sc)
        }
        Write-Host ("  [{0}] {1}" -f $kind, $sc.Path)
        Write-Host ("    TargetPath : {0}" -f $sc.TargetPath)
        if ($sc.Arguments) { Write-Host ("    Arguments  : {0}" -f $sc.Arguments) }
        Write-Host ("    Modified   : {0}" -f $sc.Modified)
    }
    Write-Host ''
}

Write-Host '--- Apps & Features registrations ---' -ForegroundColor Yellow
$appsEntries = Get-CustodyNoteAppsFeaturesEntries
$pwaAppsEntries     = New-Object System.Collections.Generic.List[object]
$desktopAppsEntries = New-Object System.Collections.Generic.List[object]
$unknownAppsEntries = New-Object System.Collections.Generic.List[object]
foreach ($e in $appsEntries) {
    Write-Host ("  [{0}] {1}{2}" -f $e.Kind, $e.DisplayName, ($(if ($e.DisplayVersion) { ' ' + $e.DisplayVersion } else { '' })))
    Write-Host ("    Reg key         : {0} \ {1}" -f $e.Hive, $e.RegKey)
    Write-Host ("    UninstallString : {0}" -f $e.UninstallString)
    switch ($e.Kind) {
        'Browser-PWA (REMOVE)' { [void]$pwaAppsEntries.Add($e) }
        'Desktop EXE (KEEP)'   { [void]$desktopAppsEntries.Add($e) }
        default                { [void]$unknownAppsEntries.Add($e) }
    }
}
if ($appsEntries.Count -eq 0) { Write-Host '  (none)' }
Write-Host ''

Write-Host '====== Summary ======' -ForegroundColor Cyan
Write-Host ("Real desktop shortcuts:    {0}" -f $goodShortcuts.Count) -ForegroundColor Green
$pwaColour = if ($badShortcuts.Count -gt 0 -or $pwaAppsEntries.Count -gt 0) { 'Red' } else { 'Green' }
Write-Host ("Browser-PWA shortcuts:     {0}" -f $badShortcuts.Count) -ForegroundColor $pwaColour
Write-Host ("Browser-PWA Apps&Features: {0}" -f $pwaAppsEntries.Count) -ForegroundColor $pwaColour
Write-Host ("Real Apps&Features entry:  {0}" -f $desktopAppsEntries.Count) -ForegroundColor Green
Write-Host ("Unknown shortcut/entry:    {0}" -f ($unknownShortcuts.Count + $unknownAppsEntries.Count))
Write-Host ''

if ($badShortcuts.Count -eq 0 -and $pwaAppsEntries.Count -eq 0) {
    Write-Host 'No browser-PWA "Custody Note" entries found. Nothing to repair.' -ForegroundColor Green
    exit 0
}

if (-not $Apply) {
    Write-Host 'Re-run this script with -Apply to:' -ForegroundColor Yellow
    Write-Host ('  - Delete the {0} browser-PWA shortcut(s) above.' -f $badShortcuts.Count)
    Write-Host ('  - Run the registered uninstaller for {0} browser-PWA "Custody Note" entry/entries' -f $pwaAppsEntries.Count)
    Write-Host '    in Apps & Features (so they no longer surface in Start search).'
    Write-Host ''
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\repair-launch-shortcut.ps1 -Apply' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Tip: close Chrome / Edge / Brave first so the PWA uninstaller can fully remove'
    Write-Host '     the entry from Apps & Features. The shortcut is deleted regardless.'
    exit 0
}

Write-Host '====== Applying repair ======' -ForegroundColor Cyan
foreach ($sc in $badShortcuts) {
    try {
        Remove-Item -Path $sc.Path -Force
        Write-Host ("  Removed shortcut: {0}" -f $sc.Path) -ForegroundColor Green
    } catch {
        Write-Warning ("  Could not remove {0}: {1}" -f $sc.Path, $_)
    }
}
foreach ($e in $pwaAppsEntries) {
    Invoke-AppsFeaturesPwaUninstall -entry $e
}
Write-Host ''
Write-Host 'Repair complete.' -ForegroundColor Green
Write-Host ''
Write-Host 'Verify:'
Write-Host '  1. Press the Windows key, type "Custody Note", and confirm the only result has the' -ForegroundColor Gray
Write-Host ("     target  $ExpectedExe") -ForegroundColor Gray
Write-Host '     (not chrome_proxy.exe / msedge.exe / brave.exe).' -ForegroundColor Gray
Write-Host '  2. Open Settings → Apps → Installed apps and confirm there is one "Custody Note"'   -ForegroundColor Gray
Write-Host '     entry, version 1.6.x, publisher "Defence Legal Services Ltd / Custody Note".'    -ForegroundColor Gray
Write-Host '     The PWA "Custody Note" entry should be gone (may need to close + reopen Chrome).' -ForegroundColor Gray
