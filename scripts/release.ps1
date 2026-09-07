# Macro release: bump version -> commit -> push -> publish Setup
# Preferred: npm run release
# Also: release.bat
# Never paste tokens into PROJECT.md or tracked files.

param(
  [string]$ReleaseVersion = '',
  [string]$CommitMessage = '',
  [switch]$Yes,
  [switch]$RepairOnly
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Green
}

function Write-WarnLine([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Yellow
}

function Write-ErrLine([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Red
}

function Get-PackageVersion {
  $pkg = Get-Content -Raw -Path 'package.json' | ConvertFrom-Json
  return [string]$pkg.version
}

function Set-PackageVersion([string]$SemVer) {
  $raw = Get-Content -Raw -Path 'package.json'
  $pattern = '("version"\s*:\s*")([^"]+)(")'
  $updated = [regex]::Replace($raw, $pattern, ('${1}' + $SemVer + '${3}'), 1)
  if ($updated -eq $raw) {
    throw 'Could not update version in package.json'
  }
  # Preserve final newline for editors/git
  if (-not $updated.EndsWith("`n")) {
    $updated = $updated + "`n"
  }
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) 'package.json'), $updated)
}

function Get-NextPatchVersion([string]$SemVer) {
  $parts = $SemVer.Split('.')
  while ($parts.Count -lt 3) { $parts += '0' }
  $parts[2] = [string](([int]$parts[2]) + 1)
  return ($parts[0..2] -join '.')
}

function Test-SecretLeak {
  $patterns = @(
    'ghp_[A-Za-z0-9]{20,}',
    'gho_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'ghu_[A-Za-z0-9]{20,}',
    'ghs_[A-Za-z0-9]{20,}'
  )
  $scanRoots = @(
    'PROJECT.md', 'index.html', 'styles.css', 'main.js', 'preload.js',
    'package.json', 'src', 'settings', 'scripts'
  )
  $hits = New-Object System.Collections.Generic.List[string]
  foreach ($root in $scanRoots) {
    if (-not (Test-Path $root)) { continue }
    $files = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\\.git\\' }
    foreach ($file in $files) {
      $text = Get-Content -Raw -LiteralPath $file.FullName -ErrorAction SilentlyContinue
      if (-not $text) { continue }
      foreach ($pat in $patterns) {
        if ($text -match $pat) {
          $rel = Resolve-Path -Relative $file.FullName
          $hits.Add("$rel")
          break
        }
      }
    }
  }
  return $hits
}

function Ensure-GitRepo {
  git rev-parse --is-inside-work-tree 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Not inside a git repository.'
  }
}

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs)
  & git @GitArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("git " + ($GitArgs -join ' ') + " failed (exit $LASTEXITCODE)")
  }
}

function Ensure-ReleaseTag([string]$SemVer) {
  $tag = "v$SemVer"
  $remoteTag = git ls-remote --tags origin "refs/tags/$tag" 2>$null
  if ($remoteTag) {
    Write-Ok "Remote tag $tag already exists"
    return
  }

  $localTag = git tag -l $tag
  if (-not $localTag) {
    Write-Step "Creating git tag $tag"
    Invoke-Git -GitArgs @('tag', $tag)
  }

  Write-Step "Pushing tag $tag"
  Invoke-Git -GitArgs @('push', 'origin', $tag)
}

function Get-ReleaseJson([string]$SemVer, [string]$Token) {
  $tag = "v$SemVer"
  $headers = @{
    Authorization = "Bearer $Token"
    Accept        = 'application/vnd.github+json'
    'User-Agent'  = 'Macro-Release-Script'
  }
  try {
    return Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/CodingForLife123/Macro/releases/tags/$tag" -Headers $headers
  } catch {
    return $null
  }
}

function Remove-ReleaseAsset([int]$AssetId, [string]$Token, [string]$Name) {
  $headers = @{
    Authorization = "Bearer $Token"
    Accept        = 'application/vnd.github+json'
    'User-Agent'  = 'Macro-Release-Script'
  }
  Write-Step "Removing old release asset: $Name"
  Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/CodingForLife123/Macro/releases/assets/$AssetId" -Headers $headers | Out-Null
  Write-Ok "Removed $Name"
}

function Upload-ReleaseAsset([string]$UploadUrlTemplate, [string]$FilePath, [string]$Token) {
  $name = [IO.Path]::GetFileName($FilePath)
  $base = $UploadUrlTemplate -replace '\{\?name,label\}', ''
  $uploadUrl = $base + '?name=' + [uri]::EscapeDataString($name)
  $bytes = [IO.File]::ReadAllBytes($FilePath)
  $headers = @{
    Authorization  = "Bearer $Token"
    Accept         = 'application/vnd.github+json'
    'User-Agent'   = 'Macro-Release-Script'
    'Content-Type' = 'application/octet-stream'
  }
  Write-Step "Uploading asset: $name"
  Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -Body $bytes | Out-Null
  Write-Ok "Uploaded $name"
}

function Ensure-LocalSetupBuild([string]$SemVer) {
  $exePath = Join-Path 'dist' ("Macro-Setup-" + $SemVer + '.exe')
  $ymlPath = Join-Path 'dist' 'latest.yml'
  $mapPath = Join-Path 'dist' ("Macro-Setup-" + $SemVer + '.exe.blockmap')

  $needsBuild = $false
  if (-not (Test-Path $exePath) -or -not (Test-Path $ymlPath) -or -not (Test-Path $mapPath)) {
    $needsBuild = $true
  } else {
    $yml = Get-Content -Raw $ymlPath
    if ($yml -notmatch [regex]::Escape('version: ' + $SemVer)) {
      $needsBuild = $true
    } else {
      # latest.yml size must match the local exe or checksums will fail for users
      $exeSize = (Get-Item $exePath).Length
      if ($yml -notmatch ('size:\s*' + $exeSize)) {
        Write-WarnLine 'dist latest.yml size does not match local Setup.exe - rebuilding one coherent set...'
        $needsBuild = $true
      }
    }
  }

  if ($needsBuild) {
    Write-Step ("Building Setup " + $SemVer + ' (single coherent exe + latest.yml + blockmap)')
    & npx electron-builder --win
    if ($LASTEXITCODE -ne 0) {
      throw 'electron-builder failed while preparing release assets'
    }
  }

  foreach ($path in @($exePath, $ymlPath, $mapPath)) {
    if (-not (Test-Path $path)) {
      throw ("Missing required dist file after build: " + $path)
    }
  }
}

function Repair-ReleaseAssets([string]$SemVer, [string]$Token) {
  # Always replace exe + blockmap + latest.yml together from ONE local build.
  # Uploading a new latest.yml while keeping an older Setup.exe causes sha512 mismatch.
  Ensure-LocalSetupBuild -SemVer $SemVer

  $release = Get-ReleaseJson -SemVer $SemVer -Token $Token
  if (-not $release) {
    Write-WarnLine "Release v$SemVer not found yet - cannot repair assets."
    return $false
  }

  $needed = @(
    ("Macro-Setup-" + $SemVer + '.exe'),
    ("Macro-Setup-" + $SemVer + '.exe.blockmap'),
    'latest.yml'
  )

  foreach ($asset in @($release.assets)) {
    if ($needed -contains $asset.name) {
      try {
        Remove-ReleaseAsset -AssetId ([int]$asset.id) -Token $Token -Name $asset.name
      } catch {
        Write-ErrLine ("Failed to remove " + $asset.name + ' : ' + $_.Exception.Message)
        return $false
      }
    }
  }

  # Refresh release metadata after deletes
  $release = Get-ReleaseJson -SemVer $SemVer -Token $Token
  if (-not $release) {
    return $false
  }

  $ok = $true
  foreach ($name in $needed) {
    $path = Join-Path 'dist' $name
    try {
      Upload-ReleaseAsset -UploadUrlTemplate $release.upload_url -FilePath $path -Token $Token
    } catch {
      Write-ErrLine ("Failed to upload " + $name + ' : ' + $_.Exception.Message)
      $ok = $false
    }
  }
  return $ok
}

function Clear-Token {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}

try {
  Ensure-GitRepo

  Write-Host ''
  Write-Host 'Macro release helper' -ForegroundColor White
  Write-Host 'Token is only kept for this session - never commit it.' -ForegroundColor DarkGray

  $token = ''
  if (-not [string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
    $token = $env:GH_TOKEN.Trim()
    Write-Ok 'Using GH_TOKEN already set in this environment'
  } elseif (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $token = $env:GITHUB_TOKEN.Trim()
    Write-Ok 'Using GITHUB_TOKEN already set in this environment'
  } else {
    Write-Host ''
    Write-Host 'Paste tip: right-click the terminal, or Ctrl+Shift+V (Ctrl+V often fails here).' -ForegroundColor DarkGray
    Write-Host 'Or set it first:  $env:GH_TOKEN = "your_token"   then rerun npm run release' -ForegroundColor DarkGray
    $token = Read-Host 'Paste GH_TOKEN (repo scope)'
  }

  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'GH_TOKEN is required. Set $env:GH_TOKEN or paste when prompted.'
  }
  if ($token -notmatch '^(ghp_|github_pat_)') {
    Write-WarnLine 'Token does not look like a classic/fine-grained GitHub PAT. Continuing anyway...'
  }

  $env:GH_TOKEN = $token.Trim()
  $env:GITHUB_TOKEN = $env:GH_TOKEN

  if ($RepairOnly) {
    $current = Get-PackageVersion
    $fixVer = $current
    if (-not [string]::IsNullOrWhiteSpace($ReleaseVersion)) {
      $fixVer = $ReleaseVersion.Trim().TrimStart([char[]]@('v', 'V'))
    }
    Write-Step ("Repairing release assets for v" + $fixVer + ' (replace exe + blockmap + latest.yml together)')
    $repaired = Repair-ReleaseAssets -SemVer $fixVer -Token $env:GH_TOKEN
    if (-not $repaired) {
      throw ("Could not repair v" + $fixVer)
    }
    Write-Host ''
    Write-Host ("Fixed: https://github.com/CodingForLife123/Macro/releases/tag/v" + $fixVer) -ForegroundColor Green
    exit 0
  }

  $current = Get-PackageVersion
  $suggested = Get-NextPatchVersion $current
  Write-Host ''
  Write-Host ("Current version: " + $current)
  Write-Host 'Tip: type the current version (or "same") to republish without bumping.' -ForegroundColor DarkGray
  Write-Host 'Note: users already on that version will NOT get an in-app update — bump for that.' -ForegroundColor DarkGray

  if (-not [string]::IsNullOrWhiteSpace($ReleaseVersion)) {
    $rawVersion = $ReleaseVersion.Trim()
    if ($rawVersion -match '^(same|current|\.)$') {
      $newVersion = $current
    } else {
      $newVersion = $rawVersion.TrimStart([char[]]@('v', 'V'))
    }
    Write-Ok ("Using version from -ReleaseVersion: " + $newVersion)
  } elseif ($Yes) {
    $newVersion = $suggested
    Write-Ok ("Auto patch bump (-Yes): " + $newVersion)
  } else {
    $versionInput = Read-Host ("Version to publish [bump $suggested] (Enter=bump, or type $current / same)")
    if ([string]::IsNullOrWhiteSpace($versionInput)) {
      $newVersion = $suggested
    } elseif ($versionInput.Trim() -match '^(same|current|\.)$') {
      $newVersion = $current
    } else {
      $newVersion = $versionInput.Trim().TrimStart([char[]]@('v', 'V'))
    }
  }

  if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw ("Invalid version '" + $newVersion + "'. Use semver like 0.0.3")
  }

  $defaultMsg = 'Release ' + $newVersion
  if (-not [string]::IsNullOrWhiteSpace($CommitMessage)) {
    $commitMsg = $CommitMessage.Trim()
  } elseif ($Yes) {
    $commitMsg = $defaultMsg
  } else {
    $commitMsgInput = Read-Host ("Commit message [" + $defaultMsg + "]")
    if ([string]::IsNullOrWhiteSpace($commitMsgInput)) {
      $commitMsg = $defaultMsg
    } else {
      $commitMsg = $commitMsgInput.Trim()
    }
  }

  Write-Step 'Scanning project files for accidental GitHub tokens'
  $leaks = @(Test-SecretLeak)
  if ($leaks.Count -gt 0) {
    Write-ErrLine 'Refusing to continue - secret-like strings found:'
    foreach ($hit in $leaks) {
      Write-ErrLine (" - " + $hit)
    }
    throw 'Remove the token from those files (use your_token in docs), revoke it on GitHub, then rerun.'
  }
  Write-Ok 'No token patterns found in project files'

  if ($newVersion -ne $current) {
    Write-Step ("Bumping package.json " + $current + ' -> ' + $newVersion)
    Set-PackageVersion $newVersion
  } else {
    Write-WarnLine ("Publishing same version " + $newVersion + ' (make sure GitHub release assets are OK)')
  }

  Write-Step 'git add .'
  Invoke-Git -GitArgs @('add', '.')

  $status = git status --porcelain
  if ([string]::IsNullOrWhiteSpace($status)) {
    Write-WarnLine 'Nothing new to commit'
  } else {
    Write-Host $status
    Write-Step 'git commit'
    Invoke-Git -GitArgs @('commit', '-m', $commitMsg)
    Write-Ok 'Committed'
  }

  Write-Step 'git push'
  try {
    Invoke-Git -GitArgs @('push', '-u', 'origin', 'HEAD')
    Write-Ok 'Pushed branch'
  } catch {
    Write-ErrLine $_.Exception.Message
    Write-ErrLine 'Push failed. If GitHub mentions a secret, remove it from the commit history, revoke the token, and rerun.'
    throw
  }

  Ensure-ReleaseTag -SemVer $newVersion

  Write-Step 'npm run publish (build Setup + upload release)'
  & npm run publish
  $publishCode = $LASTEXITCODE

  if ($publishCode -ne 0) {
    Write-WarnLine ("npm run publish exited with code " + $publishCode + ' - trying to repair release assets...')
    $repaired = Repair-ReleaseAssets -SemVer $newVersion -Token $env:GH_TOKEN
    if (-not $repaired) {
      throw ("Publish incomplete. Open https://github.com/CodingForLife123/Macro/releases/tag/v" + $newVersion + ' and ensure Setup.exe, .blockmap, and latest.yml are present.')
    }
  } else {
    Write-Ok 'Publish command finished'
    [void](Repair-ReleaseAssets -SemVer $newVersion -Token $env:GH_TOKEN)
  }

  $final = Get-ReleaseJson -SemVer $newVersion -Token $env:GH_TOKEN
  if ($final) {
    Write-Step ("Release check for v" + $newVersion)
    $names = @($final.assets | ForEach-Object { $_.name })
    foreach ($need in @(
        ("Macro-Setup-" + $newVersion + '.exe'),
        ("Macro-Setup-" + $newVersion + '.exe.blockmap'),
        'latest.yml'
      )) {
      if ($names -contains $need) {
        Write-Ok $need
      } else {
        Write-ErrLine ("MISSING: " + $need)
      }
    }
    Write-Host ''
    Write-Host ("Done: https://github.com/CodingForLife123/Macro/releases/tag/v" + $newVersion) -ForegroundColor Green
  } else {
    Write-WarnLine ("Could not load release v" + $newVersion + ' from GitHub API - check the Releases page manually.')
  }
} catch {
  Write-Host ''
  Write-ErrLine ('FAILED: ' + $_.Exception.Message)
  exit 1
} finally {
  Clear-Token
  Write-Host ''
  Write-Host 'GH_TOKEN cleared from this session.' -ForegroundColor DarkGray
}
