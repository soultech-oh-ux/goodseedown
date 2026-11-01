<#
.SYNOPSIS
  새 버전 exe 와 이전 버전 exe(직전 1~2개) 사이의 차등 업데이트 패치, PATCHES.json, SHA256SUMS.txt 를 release\out\ 에 만든다.
  GitHub 에는 아무것도 올리지 않는다(로컬 파일 생성 전용). publish-release.ps1 이 이 스크립트를 호출한다.

.DESCRIPTION
  앱(1.0.0 이상)은 지금 실행 중인 exe 의 SHA-256 이 PATCHES.json 의 fromSha256 과 같으면 패치(.patch)만 받아
  번들된 hpatchz.exe 로 새 exe 를 만들고, 결과를 SHA256SUMS.txt 의 전체 exe 해시와 대조한다.
  패치 도구: HDiffPatch(MIT) — build\tools\HDiffPatch\hdiffz.exe (-s-64 스트림 모드·단일 압축 zstd). 449MB exe 도 수 초에 만든다.

  만든 패치는 반드시 '이전 exe 에 실제로 적용해 새 exe 와 해시가 같은지' 검증한 뒤에만 채택한다.
  패치가 전체 exe 의 50% 이상이면(이득이 적으면) 그 패치는 올리지 않는다(앱은 별도로 90% 이상이면 패치를 쓰지 않고 전체를 받는다).

.PARAMETER Version
  새 버전 X.Y.Z (dist\goodseedown-X.Y.Z-Windows-x64.exe 가 있어야 한다).

.PARAMETER PrevVersions
  패치의 기준이 될 이전 버전들. 생략하면 dist\ 에서 Version 보다 낮은 버전 중 가장 높은 2개를 쓴다.
  (자동 업데이트 기능이 처음 들어간 1.0.0 보다 낮은 버전은 앱이 업데이트를 못 하므로 자동 선택에서 제외)

.PARAMETER OutDir
  산출물 폴더(기본 release\out).

.EXAMPLE
  .\make-patches.ps1 -Version 1.0.1
  .\make-patches.ps1 -Version 1.1.0 -PrevVersions 1.0.1,1.0.0
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string[]]$PrevVersions = @(),
  [string]$ExePath = '',
  [string]$OutDir = '',
  [switch]$NoPatches
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $here '..\dist'
$tools = Join-Path $here '..\build\tools\HDiffPatch'
if (-not $OutDir) { $OutDir = Join-Path $here 'out' }
if ($Version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$') { throw "버전은 X.Y.Z 형식이어야 합니다: $Version" }
$minFrom = [version]'1.0.0'
# powershell -File 로 부르면 '1.0.0,1.1.1' 이 한 문자열로 들어오므로 쉼표로 나눈다.
$PrevVersions = @($PrevVersions | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$exeName = { param($v) "goodseedown-$v-Windows-x64.exe" }
if (-not $ExePath) { $ExePath = Join-Path $dist (& $exeName $Version) }
if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { throw "새 버전 exe 가 없습니다: $ExePath" }
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
# 이전 실행 산출물 정리(이 스크립트가 만드는 이름만)
Get-ChildItem -LiteralPath $OutDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "goodseedown-$Version-from-*.patch" -or $_.Name -in @('PATCHES.json', 'SHA256SUMS.txt') } | Remove-Item -Force

function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
$newName = & $exeName $Version
$newSha = Sha $ExePath
$newSize = (Get-Item -LiteralPath $ExePath).Length
$sums = New-Object System.Collections.Generic.List[string]
$sums.Add("$newSha  $newName")
$patches = @()

if (-not $NoPatches) {
  $hdiffz = Join-Path $tools 'hdiffz.exe'; $hpatchz = Join-Path $tools 'hpatchz.exe'
  foreach ($t in @($hdiffz, $hpatchz)) { if (-not (Test-Path -LiteralPath $t)) { throw "패치 도구가 없습니다: $t (build\tools\HDiffPatch\ — HDiffPatch v5.1.3 windows64 에서 가져온 것)" } }
  if (-not $PrevVersions -or $PrevVersions.Count -eq 0) {
    $found = Get-ChildItem -LiteralPath $dist -Filter 'goodseedown-*-Windows-x64.exe' -File | ForEach-Object {
      if ($_.Name -match '^goodseedown-(\d+\.\d+\.\d+)-Windows-x64\.exe$') { [version]$Matches[1] }
    } | Where-Object { $_ -lt [version]$Version -and $_ -ge $minFrom } | Sort-Object -Descending | Select-Object -First 2
    $PrevVersions = @($found | ForEach-Object { $_.ToString() })
  }
  if ($PrevVersions.Count -eq 0) { Write-Host '[알림] 패치 기준이 될 이전 버전(1.0.0 이상)이 dist\ 에 없어 패치를 만들지 않습니다(SHA256SUMS 만 생성).' -ForegroundColor Yellow }
  $tmp = Join-Path $env:TEMP ("gs-patchcheck-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    foreach ($pv in $PrevVersions) {
      if ($pv -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$') { throw "이전 버전 형식 오류: $pv" }
      if ([version]$pv -ge [version]$Version) { throw "이전 버전($pv)은 새 버전($Version)보다 낮아야 합니다." }
      $oldExe = Join-Path $dist (& $exeName $pv)
      if (-not (Test-Path -LiteralPath $oldExe)) { Write-Host "[건너뜀] 이전 버전 exe 가 없습니다: $oldExe" -ForegroundColor Yellow; continue }
      $patchName = "goodseedown-$Version-from-$pv.patch"
      $patchPath = Join-Path $OutDir $patchName
      & $hdiffz -s-64 -SD-256k -c-zstd-19-27 -f $oldExe $ExePath $patchPath | Out-Null
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $patchPath)) { throw "hdiffz 실패($pv → $Version)" }
      # 검증: 이전 exe 에 패치를 적용해 새 exe 와 정확히 같은 파일이 나오는지
      $check = Join-Path $tmp "check-$pv.exe"
      & $hpatchz -f $oldExe $patchPath $check | Out-Null
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $check)) { Remove-Item $patchPath -Force; throw "패치 적용 검증 실패($pv → $Version): hpatchz 오류" }
      if ((Sha $check) -ne $newSha) { Remove-Item $patchPath -Force; throw "패치 적용 결과가 새 exe 와 다릅니다($pv → $Version). 패치를 폐기했습니다." }
      Remove-Item $check -Force
      $psize = (Get-Item -LiteralPath $patchPath).Length
      if ($psize -ge $newSize * 0.5) { Remove-Item $patchPath -Force; Write-Host "[건너뜀] $pv → $Version 패치가 전체의 50% 이상($([math]::Round($psize / 1MB, 1)) MB)이라 이득이 적어 올리지 않습니다." -ForegroundColor Yellow; continue }
      $psha = Sha $patchPath
      $patches += [ordered]@{ from = $pv; fromSha256 = (Sha $oldExe); name = $patchName; size = [int64]$psize; sha256 = $psha }
      $sums.Add("$psha  $patchName")
      Write-Host "[패치] $pv → $Version : $([math]::Round($psize / 1MB, 2)) MB (전체 $([math]::Round($newSize / 1MB, 1)) MB) · 적용 검증 통과" -ForegroundColor Cyan
    }
  } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS.txt'), (($sums -join "`n") + "`n"), $utf8)
$files = @($newName, 'SHA256SUMS.txt')
if ($patches.Count -gt 0) {
  $manifest = [ordered]@{ schema = 1; version = $Version; patches = @($patches | ForEach-Object { [pscustomobject]$_ }) }
  [System.IO.File]::WriteAllText((Join-Path $OutDir 'PATCHES.json'), ((ConvertTo-Json -InputObject $manifest -Depth 5) + "`n"), $utf8)
  $files += 'PATCHES.json'; $files += @($patches | ForEach-Object { $_.name })
}
Write-Host "[완료] 산출물 폴더: $((Resolve-Path $OutDir).Path)" -ForegroundColor Green
Get-Content -LiteralPath (Join-Path $OutDir 'SHA256SUMS.txt') | ForEach-Object { Write-Host "        $_" }
# 호출한 쪽(publish-release.ps1)이 올릴 파일 이름 목록을 받을 수 있게 반환(exe 는 dist 에 있으므로 이름만)
[pscustomobject]@{ Files = $files; Patches = $patches; OutDir = (Resolve-Path $OutDir).Path; ExeName = $newName }
