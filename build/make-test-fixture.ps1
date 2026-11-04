<#
.SYNOPSIS
  자동 업데이트 시험용 '가짜 다음 버전(기본 1.2.2)' exe 를 만든다 — 직전 빌드와 같은 절차(build-exe.ps1)로, 실제 다음 버전처럼 바뀌는 부분만 바꾼다
  (앱 코드 묶음(app.asar)의 package.json 버전, Electron 본체의 PE 버전 표기, 런처 어셈블리 버전·PackageId).
  결과: launcher\test-fixtures\goodseedown-<NewVersion>-Windows-x64.exe — 배포용이 아니며 dist 에 넣지 않는다.
  차등 업데이트 패치 크기를 실제 다음 버전과 비슷한 조건에서 재려면 반드시 build-exe.ps1 과 같은 압축(make_bundle_zip.py)으로 만들어야 한다.
#>
param([string]$NewVersion = '1.2.2')
$ErrorActionPreference = 'Stop'
$b = Split-Path -Parent $MyInvocation.MyCommand.Path
$w = Join-Path $env:TEMP 'gd-fixture'
Remove-Item $w -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $w | Out-Null
try {
  Copy-Item (Join-Path $b 'src') (Join-Path $w 'src') -Recurse
  $pj = Join-Path $w 'src\package.json'
  $txt = Get-Content $pj -Raw -Encoding UTF8
  $new = [regex]::Replace($txt, '"version":\s*"[^"]*"', "`"version`": `"$NewVersion`"")
  [IO.File]::WriteAllText($pj, $new, (New-Object Text.UTF8Encoding($false)))
  if (-not (Select-String -Path $pj -Pattern "`"version`": `"$NewVersion`"" -Quiet)) { throw 'package.json 버전 치환 실패' }
  $out = Join-Path $b 'launcher\test-fixtures'
  New-Item -ItemType Directory -Force $out | Out-Null
  $stage = Join-Path $w 'stage'
  & (Join-Path $b 'build-exe.ps1') -Version $NewVersion -NoDist -OutDir $out -SrcDir (Join-Path $w 'src') -StageDir $stage
} finally { Remove-Item $w -Recurse -Force -ErrorAction SilentlyContinue }
