<#
.SYNOPSIS
  goodseedown 새 버전 exe 와 SHA256SUMS.txt 를 GitHub 릴리스(공개 저장소)로 올린다.

.DESCRIPTION
  ★ 이 스크립트는 작성만 되어 있으며, 작성자(worker-4)는 실행하지 않았다. 실행하면 GitHub 에 공개 릴리스가 만들어진다.
  릴리스 저장소는 soultech-oh-ux/goodseedown (앱의 UPDATE_REPO 와 같아야 한다). master 가 직접 실행한다.

  하는 일
   1) 입력 검증: 버전 형식(X.Y.Z), exe 파일 이름(goodseedown-X.Y.Z-Windows-x64.exe)·존재·MZ 헤더·PE 파일 버전 일치
   2) make-patches.ps1 호출 — 직전 1~2개 버전(1.0.0 이상, dist\ 에 exe 가 있는 것)과의 차등 패치(.patch)를 만들고
      '이전 exe 에 적용 → 새 exe 와 해시 동일' 을 검증한 뒤 PATCHES.json·SHA256SUMS.txt(sha256sum 형식 "<해시>  <파일명>", LF)를 만든다.
      앱은 SHA256SUMS.txt 의 전체 exe 해시로 최종 검증하며, 패치를 쓸 수 없으면 전체 exe 를 받는다.
   3) 사전 점검: gh(GitHub CLI) 설치·로그인, 저장소 접근, 같은 태그가 이미 있는지
   4) (확인 후) gh release create vX.Y.Z <exe> <SHA256SUMS.txt> [PATCHES.json] [*.patch] --repo <repo> --title ... --notes-file ... --latest
   5) 올린 뒤 점검: 릴리스에 모든 자산이 있는지, 크기가 로컬 파일과 같은지

  앱이 기대하는 릴리스 형식(updater.cjs 와 일치해야 함)
   - 태그: vX.Y.Z (semver 3자리, 예: v1.0.1) · 사전 릴리스/초안은 앱이 무시한다
   - 자산 이름: goodseedown-X.Y.Z-Windows-x64.exe, SHA256SUMS.txt
     (선택·차등 업데이트) PATCHES.json, goodseedown-X.Y.Z-from-<이전버전>.patch
   - 릴리스 노트: 릴리스 본문(body) — 앱의 확인창에 표시된다

.PARAMETER Repo
  'owner/repo' 형식의 공개 저장소. 기본값 soultech-oh-ux/goodseedown (앱의 UPDATE_REPO 와 같은 값이어야 앱이 이 릴리스를 찾는다).

.PARAMETER Version
  올릴 버전(예: 1.0.1). 태그는 v 가 붙은 vX.Y.Z 로 만든다.

.PARAMETER ExePath
  올릴 exe 경로. 생략하면 ..\dist\goodseedown-<Version>-Windows-x64.exe

.PARAMETER NotesFile
  릴리스 노트(마크다운) 파일. 생략하면 -Notes 문자열을 쓰고, 둘 다 없으면 중단한다.

.PARAMETER Notes
  릴리스 노트 문자열(짧은 경우).

.PARAMETER Yes
  최종 확인 질문을 건너뛴다.

.PARAMETER PrepareOnly
  패치·PATCHES.json·SHA256SUMS.txt 만 만들고(release\out\) GitHub 에는 아무것도 올리지 않는다(점검용).

.PARAMETER PrevVersions
  차등 패치의 기준 이전 버전들(예: 1.0.0,1.1.1). 생략하면 dist\ 에서 1.0.0 이상 중 새 버전보다 낮은 가장 높은 2개.

.PARAMETER NoPatches
  차등 패치를 만들지 않는다(전체 exe 와 SHA256SUMS.txt 만 올림).

.EXAMPLE
  # 점검만(올리지 않음)
  .\publish-release.ps1 -Version 1.1.0 -NotesFile ..\CHANGELOG-1.1.0.md -PrepareOnly

.EXAMPLE
  # 실제 게시(공개!)
  .\publish-release.ps1 -Version 1.1.0 -NotesFile ..\CHANGELOG-1.1.0.md
#>
[CmdletBinding()]
param(
  [string]$Repo = 'soultech-oh-ux/goodseedown',
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ExePath = '',
  [string]$NotesFile = '',
  [string]$Notes = '',
  [switch]$Yes,
  [switch]$PrepareOnly,
  [string[]]$PrevVersions = @(),
  [switch]$NoPatches
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$msg) { Write-Host "[중단] $msg" -ForegroundColor Red; exit 1 }
function Info([string]$msg) { Write-Host "[확인] $msg" -ForegroundColor Cyan }

# ---------- 1) 입력 검증 ----------
if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { Fail "저장소 형식이 올바르지 않습니다: '$Repo' (예: soultech-oh-ux/goodseedown)" }
if ($Repo -match '<|>') { Fail "저장소에 <owner> 같은 자리 표시가 남아 있습니다." }
if ($Version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$') { Fail "버전은 X.Y.Z 형식이어야 합니다(예: 1.0.1). 사전 릴리스 표기(-beta 등)는 앱이 인식하지 않습니다: '$Version'" }
$tag = "v$Version"
$exeName = "goodseedown-$Version-Windows-x64.exe"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ExePath) { $ExePath = Join-Path $here "..\dist\$exeName" }
if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { Fail "exe 파일이 없습니다: $ExePath" }
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
if ((Split-Path -Leaf $ExePath) -ne $exeName) { Fail "파일 이름이 '$exeName' 이어야 합니다(앱이 이 이름으로 자산을 찾습니다). 현재: $(Split-Path -Leaf $ExePath)" }

$fs = [System.IO.File]::OpenRead($ExePath)
try { $b = New-Object byte[] 2; [void]$fs.Read($b, 0, 2) } finally { $fs.Dispose() }
if ($b[0] -ne 0x4D -or $b[1] -ne 0x5A) { Fail "실행 파일(MZ) 형식이 아닙니다: $ExePath" }

$fileVer = (Get-Item -LiteralPath $ExePath).VersionInfo.FileVersion
if ($fileVer -and ($fileVer -notmatch "^$([regex]::Escape($Version))(\.0)?$")) { Fail "exe 의 파일 버전($fileVer)이 올리려는 버전($Version)과 다릅니다. 올바른 빌드인지 확인하세요." }
Info "exe: $ExePath ($([math]::Round((Get-Item -LiteralPath $ExePath).Length / 1MB, 1)) MB, 파일 버전 $fileVer)"

$notesPath = ''
if ($NotesFile) {
  if (-not (Test-Path -LiteralPath $NotesFile -PathType Leaf)) { Fail "릴리스 노트 파일이 없습니다: $NotesFile" }
  $notesPath = (Resolve-Path -LiteralPath $NotesFile).Path
} elseif ($Notes) {
  $outTmp = Join-Path $here 'out'; New-Item -ItemType Directory -Force -Path $outTmp | Out-Null
  $notesPath = Join-Path $outTmp "notes-$Version.md"
  [System.IO.File]::WriteAllText($notesPath, $Notes, (New-Object System.Text.UTF8Encoding($false)))
} else { Fail "릴리스 노트가 필요합니다(-NotesFile 또는 -Notes). 앱의 업데이트 확인창에 표시됩니다." }

# ---------- 2) 차등 패치 · PATCHES.json · SHA256SUMS.txt ----------
$outDir = Join-Path $here 'out'; New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$mp = @{ Version = $Version; ExePath = $ExePath; OutDir = $outDir }
$PrevVersions = @($PrevVersions | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($PrevVersions.Count -gt 0) { $mp.PrevVersions = $PrevVersions }
if ($NoPatches) { $mp.NoPatches = $true }
$made = & (Join-Path $here 'make-patches.ps1') @mp | Select-Object -Last 1
if (-not $made -or -not $made.Files) { Fail 'make-patches.ps1 가 산출물 목록을 돌려주지 않았습니다.' }
$sumsPath = Join-Path $outDir 'SHA256SUMS.txt'
$uploadFiles = @($ExePath) + @($made.Files | Where-Object { $_ -ne $exeName } | ForEach-Object { Join-Path $outDir $_ })
foreach ($f in $uploadFiles) { if (-not (Test-Path -LiteralPath $f)) { Fail "올릴 파일이 없습니다: $f" } }
if ($PrepareOnly) { Info '-PrepareOnly: GitHub 에는 아무것도 올리지 않았습니다.'; exit 0 }

# ---------- 3) 사전 점검 ----------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI(gh)가 설치되어 있지 않습니다. https://cli.github.com/ 에서 설치 후 `gh auth login` 하세요.' }
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'gh 로그인이 필요합니다: gh auth login' }
& gh repo view $Repo --json visibility,name 2>&1 | Tee-Object -Variable repoInfo | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "저장소에 접근할 수 없습니다: $Repo`n$repoInfo" }
if (($repoInfo -join '') -notmatch '"visibility"\s*:\s*"PUBLIC"') { Fail "저장소가 공개(PUBLIC)가 아닙니다. 앱은 인증 없이 릴리스를 조회하므로 공개 저장소여야 합니다. ($Repo)" }
& gh release view $tag --repo $Repo 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Fail "릴리스 $tag 가 이미 있습니다. 덮어쓰지 않습니다(버전을 올리거나 GitHub 에서 직접 정리하세요)." }

# ---------- 4) 게시 ----------
Write-Host ''
Write-Host "다음 내용으로 공개 릴리스를 만듭니다." -ForegroundColor Yellow
Write-Host "  저장소 : $Repo"
Write-Host "  태그   : $tag"
Write-Host "  자산   : $(($uploadFiles | ForEach-Object { Split-Path -Leaf $_ }) -join ', ')"
Write-Host "  노트   : $notesPath"
if (-not $Yes) {
  $ans = Read-Host '정말 올릴까요? (yes 입력 시 진행)'
  if ($ans -ne 'yes') { Fail '사용자가 취소했습니다.' }
}
& gh release create $tag @uploadFiles --repo $Repo --title "goodseedown $Version" --notes-file $notesPath --latest
if ($LASTEXITCODE -ne 0) { Fail "gh release create 가 실패했습니다(종료 코드 $LASTEXITCODE). 부분적으로 만들어진 릴리스가 있으면 GitHub 에서 확인하세요." }

# ---------- 5) 올린 뒤 점검 ----------
$json = & gh release view $tag --repo $Repo --json assets,tagName,isDraft,isPrerelease | ConvertFrom-Json
$names = @($json.assets | ForEach-Object { $_.name })
foreach ($f in $uploadFiles) {
  $need = Split-Path -Leaf $f
  if ($names -notcontains $need) { Fail "릴리스에 자산 '$need' 가 없습니다. 올라온 자산: $($names -join ', ')" }
  $remote = $json.assets | Where-Object { $_.name -eq $need } | Select-Object -First 1
  if ([int64]$remote.size -ne (Get-Item -LiteralPath $f).Length) { Fail "올라간 '$need' 크기($($remote.size))가 로컬 파일 크기와 다릅니다. 다시 확인하세요." }
}
if ($json.isDraft -or $json.isPrerelease) { Fail '릴리스가 초안/사전 릴리스 상태입니다. 앱은 이런 릴리스를 무시합니다. GitHub 에서 일반 릴리스로 바꿔 주세요.' }
Info "완료: https://github.com/$Repo/releases/tag/$tag"
Info '앱의 UPDATE_REPO 상수(desktop\updater.cjs)가 이 저장소를 가리키는지 확인하세요.'
