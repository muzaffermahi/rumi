# Installs Rumi on Windows: downloads the latest release (it carries its own Node), checks its checksum, unpacks it
# to %LOCALAPPDATA%\Programs\Rumi and adds the `rumi` command to your PATH. Rumi adds itself to the Start menu the
# first time it runs.
#   irm https://github.com/muzaffermahi/rumi/releases/latest/download/install.ps1 | iex
# Pin a version with $env:RUMI_VERSION = '0.5.0' before running it. RUMI_INSTALL_DIR changes where it goes;
# RUMI_DOWNLOAD_BASE and RUMI_NO_PATH are for testing the script.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'muzaffermahi/rumi'
$file = 'Rumi-windows-x64.zip'
$dir = if ($env:RUMI_INSTALL_DIR) { $env:RUMI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\Rumi' }
$base = if ($env:RUMI_DOWNLOAD_BASE) { $env:RUMI_DOWNLOAD_BASE } elseif ($env:RUMI_VERSION) { "https://github.com/$repo/releases/download/v$($env:RUMI_VERSION)" } else { "https://github.com/$repo/releases/latest/download" }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Rumi needs 64-bit Windows.' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("rumi-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $file..."
  Invoke-WebRequest "$base/$file" -OutFile "$tmp\$file" -UseBasicParsing
  Invoke-WebRequest "$base/$file.sha256" -OutFile "$tmp\$file.sha256" -UseBasicParsing
  $expected = ((Get-Content "$tmp\$file.sha256" -Raw) -split '\s+')[0].ToLower()
  $actual = (Get-FileHash "$tmp\$file" -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "Checksum mismatch for $file; the download may be damaged. Try again." }

  Write-Host "Installing to $dir..."
  # Windows 10+ ships tar.exe, which unpacks zips far faster than Expand-Archive.
  New-Item -ItemType Directory -Path "$tmp\out" | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) { & $tar -xf "$tmp\$file" -C "$tmp\out"; if ($LASTEXITCODE) { throw 'Could not unpack the download.' } }
  else { Expand-Archive "$tmp\$file" -DestinationPath "$tmp\out" -Force }
  # Stop a running Rumi before replacing it; your documents and settings in %USERPROFILE%\.rumi are kept.
  if (Test-Path "$dir\node\node.exe") { & "$dir\node\node.exe" "$dir\app\bin\rumi.mjs" stop *> $null }
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $dir) -Force | Out-Null
  Move-Item "$tmp\out\Rumi-windows-x64" $dir

  $bin = Join-Path $dir 'bin'
  New-Item -ItemType Directory -Path $bin -Force | Out-Null
  Set-Content -Path "$bin\rumi.cmd" -Encoding ASCII -Value "@echo off`r`n`"%~dp0..\node\node.exe`" `"%~dp0..\app\bin\rumi.mjs`" %*"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $env:RUMI_NO_PATH -and (($userPath -split ';') -notcontains $bin)) {
    [Environment]::SetEnvironmentVariable('Path', ($bin + ';' + $userPath).TrimEnd(';'), 'User')
    $env:Path = "$bin;$env:Path"
    Write-Host "Added $bin to your PATH. Open a new terminal to use rumi there."
  }
  Write-Host ''
  Write-Host "Rumi $(& "$bin\rumi.cmd" --version) is installed. Run: rumi"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
