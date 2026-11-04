<#
.SYNOPSIS
  goodseedown 포터블 exe 를 만든다(번들 조립 → asar → Electron 본체 표기(아이콘·버전) → 번들 zip → .NET 런처 컴파일 → dist 복사).

.DESCRIPTION
  차등 업데이트 패치가 작게 나오려면 번들이 '같은 입력 → 같은 바이트'여야 한다.
   - 번들은 매번 electron-base 에서 새로 조립한다(rcedit 를 같은 파일에 되풀이해 돌리면 결과가 조금씩 커진다).
   - 번들 zip 은 make_bundle_zip.py(압축 level 6·큰 파일은 256KB 마다 끊어 압축)로만 만든다. 다른 방식으로 다시 압축하면 패치가 사실상 전체 크기가 된다.
  외부 도구는 모두 build\tools\ 안에 있다(asar·rcedit·yt-dlp·ffmpeg·HDiffPatch).

.PARAMETER Version     X.Y.Z. src\package.json 의 version 과 같아야 한다(-ReplaceInZip 시험 빌드는 예외).
.PARAMETER NoDist      dist 로 복사하지 않고 OutDir 에만 만든다.
.PARAMETER OutDir      exe 를 둘 폴더(기본 launcher).
.PARAMETER LauncherSource  컴파일할 런처 소스(기본 PortableLauncher.cs). 시험 빌드는 버전·PackageId 만 바꾼 사본을 넘긴다.

.PARAMETER SrcDir         앱 코드 폴더(기본 src). 시험용 가짜 다음 버전은 버전만 바꾼 사본을 넘긴다.
.PARAMETER ReplaceInZip    make_bundle_zip.py 의 --replace 값('zip안경로=파일'). 가짜 다음 버전을 만들 때만 쓴다.
#>
[CmdletBinding()]
param(
  [string]$Version = '1.2.1',
  [switch]$NoDist,
  [string]$OutDir = '',
  [string]$LauncherSource = '',
  [string[]]$ReplaceInZip = @(),
  [string]$StageDir = '',
  [string]$SrcDir = ''
)
$ErrorActionPreference = 'Stop'
$b = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $b
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "버전 형식 오류: $Version" }
if (-not $OutDir) { $OutDir = Join-Path $b 'launcher' }
if (-not $LauncherSource) { $LauncherSource = Join-Path $b 'PortableLauncher.cs' }
if (-not $StageDir) { $StageDir = Join-Path $b 'bundle' }
if (-not $SrcDir) { $SrcDir = Join-Path $b 'src' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pkgVer = (Get-Content (Join-Path $SrcDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($pkgVer -ne $Version -and -not $ReplaceInZip) { throw "src\package.json 버전($pkgVer)이 -Version($Version)과 다릅니다." }

# 1) 번들 조립: Electron 기본 틀(electron-base) + 도구(yt-dlp·ffmpeg·hpatchz·라이선스)
$base = Join-Path $b 'electron-base'
Remove-Item $StageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir 'resources\tools') | Out-Null
Get-ChildItem $base -Force | Where-Object { $_.Name -ne 'resources' -and $_.Name -ne 'electron.exe' } | ForEach-Object { Copy-Item $_.FullName (Join-Path $StageDir $_.Name) -Recurse -Force }
Copy-Item (Join-Path $base 'resources\elevate.exe') (Join-Path $StageDir 'resources\elevate.exe') -Force
$innerExe = Join-Path $StageDir 'goodseedown.exe'
Copy-Item (Join-Path $base 'electron.exe') $innerExe -Force
$tools = Join-Path $StageDir 'resources\tools'
Copy-Item (Join-Path $b 'tools\yt-dlp\yt-dlp.exe') $tools -Force
Copy-Item (Join-Path $b 'tools\ffmpeg\ffmpeg.exe') $tools -Force
Copy-Item (Join-Path $b 'tools\HDiffPatch\hpatchz.exe') $tools -Force
Copy-Item (Join-Path $b 'tools\ffmpeg\LICENSE-GPLv3.txt') (Join-Path $tools 'LICENSE-ffmpeg-GPLv3.txt') -Force
Copy-Item (Join-Path $b 'tools\ffmpeg\README.txt') (Join-Path $tools 'ffmpeg-BUILD-INFO.txt') -Force
Copy-Item (Join-Path $b 'tools\HDiffPatch\LICENSE.txt') (Join-Path $tools 'LICENSE-HDiffPatch.txt') -Force
Copy-Item (Join-Path $b '..\THIRD-PARTY.md') (Join-Path $tools 'THIRD-PARTY.md') -Force
Copy-Item (Join-Path $b 'tools\yt-dlp\LICENSE-Unlicense.txt') (Join-Path $tools 'LICENSE-yt-dlp-Unlicense.txt') -Force
Copy-Item (Join-Path $b 'tools\yt-dlp\THIRD_PARTY_LICENSES.txt') (Join-Path $tools 'LICENSE-yt-dlp-bundled-components.txt') -Force

# 2) asar (src → resources\app.asar)
$asar = Join-Path $b 'tools\asar\node_modules\@electron\asar\bin\asar.mjs'
Push-Location $SrcDir
& node $asar pack . (Join-Path $StageDir 'resources\app.asar') | Out-Null
$rcAsar = $LASTEXITCODE
Pop-Location
if ($rcAsar -ne 0) { throw "asar pack 실패($rcAsar)" }

# 3) Electron 본체 표기(아이콘·버전·제품명) — 작업 관리자·속성 창에 보인다. 방금 복사한 파일을 백신이 훑는 중이면 한 번 실패할 수 있어 재시도한다.
if (-not $ReplaceInZip) {
  $rc = Join-Path $b 'tools\rcedit\rcedit-x64.exe'
  $ok = $false
  $savedEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'  # rcedit 가 실패하면 stderr 를 내므로(그 자체로 중단되지 않게) 종료 코드로 판단한다
  for ($try = 1; $try -le 4 -and -not $ok; $try++) {
    & $rc $innerExe --set-icon (Join-Path $b 'icon.ico') --set-file-version $Version --set-product-version $Version `
      --set-version-string FileDescription 'goodseedown' --set-version-string ProductName 'goodseedown' --set-version-string InternalName 'goodseedown' `
      --set-version-string OriginalFilename 'goodseedown.exe' --set-version-string CompanyName 'goodseed AI LAB' --set-version-string LegalCopyright 'Copyright (c) 2026 굿씨드AI연구소 오경근 박사' `
      --set-version-string FileVersion $Version --set-version-string ProductVersion $Version
    if ($LASTEXITCODE -eq 0) { $ok = $true } else { Start-Sleep -Seconds 3 }
  }
  $ErrorActionPreference = $savedEap
  if (-not $ok) { throw "rcedit 실패($LASTEXITCODE)" }
}

# 4) 번들 zip(결정적)
$zip = Join-Path $OutDir 'bundle.zip'
$py = (Get-Command python).Source
$zipArgs = @('-I', (Join-Path $b 'make_bundle_zip.py'), $StageDir, $zip)
foreach ($r in $ReplaceInZip) { $zipArgs += @('--replace', $r) }
& $py @zipArgs
if ($LASTEXITCODE -ne 0) { throw 'make_bundle_zip.py 실패' }

# 5) 런처 컴파일(번들 zip 을 리소스로 내장)
#    포터블 exe 는 첫 실행 때 번들을 %LOCALAPPDATA%\goodseedownin\<PackageId> 로 풀고 이미 풀려 있으면 재사용한다. 그래서 내용이 바뀌면 PackageId 도 반드시 바뀌어야 한다 —
#    사람이 올리는 대신 번들 zip 의 해시 앞 8자리를 붙여 자동으로 만든다(같은 입력 → 같은 PackageId). 어셈블리 버전도 -Version 에 맞춘다.
$zipSha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower().Substring(0, 8)
$srcText = [IO.File]::ReadAllText($LauncherSource, [Text.Encoding]::UTF8)
$srcText = [regex]::Replace($srcText, 'PackageId = "[^"]*"', "PackageId = `"$Version-$zipSha`"")
$srcText = [regex]::Replace($srcText, 'Assembly(File)?Version\("[^"]*"\)', { param($m) "Assembly$($m.Groups[1].Value)Version(`"$Version.0`")" })
$buildSrc = Join-Path $OutDir 'PortableLauncher.build.cs'
[IO.File]::WriteAllText($buildSrc, $srcText, (New-Object Text.UTF8Encoding($true)))
$exeName = "goodseedown-$Version-Windows-x64.exe"
$out = Join-Path $OutDir $exeName
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$ico = Join-Path $b 'icon.ico'
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$ico" "/resource:$zip,goodseedown.Bundle" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/out:$out" $buildSrc
if ($LASTEXITCODE -ne 0) { throw "csc 실패($LASTEXITCODE)" }
Remove-Item $zip, $buildSrc -Force -ErrorAction SilentlyContinue
if (-not $NoDist) { New-Item -ItemType Directory -Force (Join-Path $b '..\dist') | Out-Null; Copy-Item $out (Join-Path $b "..\dist\$exeName") -Force }
$h = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
"$exeName $((Get-Item $out).Length) bytes sha256=$h"
