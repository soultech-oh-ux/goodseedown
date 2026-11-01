# goodseedown 1.1.0 — 제3자(오픈소스) 구성요소와 라이선스

goodseedown 은 아래 구성요소를 **별도 실행 파일 또는 라이브러리로 함께 배포**합니다. 각 라이선스 전문은 설치된 폴더의 `resources\tools\` 안(또는 아래 표의 '전문 위치')에 들어 있습니다.
앱 안에서는 **도움말 → 오픈소스 라이선스**로 그 폴더를 열 수 있습니다.

> 이 문서는 사실 확인된 내용만 적습니다. 오너가 정해야 하는 항목은 맨 아래 "오너 확인 필요"에 따로 모았습니다.

## 1. 한눈에 보기

| 구성요소 | 버전 | 라이선스 | 역할 | 배포 형태 |
|---|---|---|---|---|
| yt-dlp | 2026.10.26 | Unlicense(공개 도메인) | 영상 정보 조회·다운로드 엔진 | `resources\tools\yt-dlp.exe` (공식 릴리스 그대로) |
| ffmpeg | 6.1.1 (gyan.dev essentials 빌드) | GPL v3 | 영상·음성 합치기, MP3/M4A/OGG 변환, 자막 변환·합침 | `resources\tools\ffmpeg.exe` (같은 빌드를 goodseed Studio 도 사용) |
| HDiffPatch (hpatchz) | v5.1.3 | MIT | 차등 업데이트 패치 적용 | `resources\tools\hpatchz.exe` |
| Electron | 45.0.0 | MIT | 앱 껍데기(창·메뉴) | 실행 파일 본체 |
| Chromium·Node.js 등 Electron 에 포함된 구성요소 | Electron 45.0.0 에 포함된 버전 | BSD 등 여러 라이선스 | 화면 표시 | 앱 폴더의 `LICENSES.chromium.html`, `LICENSE.electron.txt` |
| rcedit | 5.0.2 | MIT | (빌드 때만) exe 아이콘·버전 표기 | 배포물에 포함되지 않음 |
| @electron/asar | 4.3.1 | MIT | (빌드 때만) 앱 코드 묶음 | 배포물에 포함되지 않음 |

## 2. yt-dlp — Unlicense

- 출처: https://github.com/yt-dlp/yt-dlp (릴리스 2026.10.26 의 `yt-dlp.exe`)
- 무결성: 릴리스의 `SHA2-256SUMS` 에 적힌 값과 같음 — `f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d` (직접 계산해 대조함)
- 라이선스 전문: `resources\tools\LICENSE-yt-dlp-Unlicense.txt`
- yt-dlp.exe 는 Python(PSF-2.0) 등 여러 구성요소를 한 파일로 묶은 것입니다. 그 구성요소별 라이선스 모음은 yt-dlp 저장소의 `THIRD_PARTY_LICENSES.txt` 이며 `resources\tools\LICENSE-yt-dlp-bundled-components.txt` 로 함께 넣었습니다. 해당 구성요소의 소스는 각 원 프로젝트에서 받을 수 있고, 구하기 어려우면 yt-dlp 관리자가 제공한다고 그 파일에 적혀 있습니다.
- goodseedown 은 yt-dlp 를 **수정하지 않고** 실행 파일 그대로 호출합니다. 앱 안의 **yt-dlp 엔진 업데이트**는 위 저장소의 공식 릴리스에서 새 `yt-dlp.exe` 를 받아 공식 해시로 검증한 뒤 사용자 폴더에 따로 설치합니다(설치된 번들은 건드리지 않음).

## 3. ffmpeg — GPL v3

- 사용한 빌드: ffmpeg 6.1.1 `essentials` 빌드, https://www.gyan.dev/ffmpeg/builds/ (빌드 설정 전문: `resources\tools\ffmpeg-BUILD-INFO.txt`)
- 이 빌드는 `--enable-gpl --enable-version3` 으로 만들어져 **GPL v3** 가 적용됩니다. 라이선스 전문: `resources\tools\LICENSE-ffmpeg-GPLv3.txt`
- 소스 코드: 해당 빌드 정보에 적힌 커밋 https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 , 또는 https://ffmpeg.org/releases/ 의 ffmpeg-6.1.1 소스. 이 빌드를 만든 쪽의 소스 안내는 https://www.gyan.dev/ffmpeg/builds/ 에 있습니다.
- MP3 변환(1.1.0 의 MP3 화면 포함)은 이 ffmpeg 빌드에 들어 있는 LAME 3.100(libmp3lame) 인코더를 씁니다(빌드 정보 `ffmpeg-BUILD-INFO.txt` 의 라이브러리 목록에 `lame 3.100` 으로 적혀 있음). ID3 태그와 앨범 사진도 ffmpeg 가 파일에 기록합니다.
- goodseedown 은 ffmpeg 를 **독립 실행 파일로 호출**만 하며 수정하지 않았습니다.

## 4. HDiffPatch — MIT

- 출처: https://github.com/sisong/HDiffPatch (v5.1.3, windows64 배포본의 `hpatchz.exe`)
- 라이선스 전문: `resources\tools\LICENSE-HDiffPatch.txt`
- 앱은 패치 **적용**(`hpatchz.exe`)만 합니다. 이 파일은 제작자가 배포한 그대로이며 **코드 서명이 없습니다**.

## 5. Electron / Chromium

- Electron 45.0.0 — MIT. 전문: 앱 폴더의 `LICENSE.electron.txt`
- Chromium 및 그 구성요소의 라이선스 목록: 앱 폴더의 `LICENSES.chromium.html`

## 6. 빌드 도구(배포물에 포함되지 않음)

- rcedit 5.0.2 (MIT) — 전문: 소스 폴더 `build\tools\rcedit\LICENSE.txt`
- @electron/asar 4.3.1 (MIT) — 전문: `build\tools\asar\node_modules\@electron\asar\LICENSE.md`. 이 도구가 쓰는 하위 라이브러리(glob·minimatch·minipass·path-scurry·lru-cache 는 BlueOak-1.0.0, brace-expansion·balanced-match 는 MIT)도 같은 폴더(`build\tools\asar\node_modules\`)에 있으며 각 라이선스는 해당 폴더의 package.json 에 적혀 있습니다.
- HDiffPatch 의 `hdiffz.exe`(패치 만들기) — 릴리스를 만들 때만 사용(MIT)

## 7. 클린룸 원칙

기능 목록은 제조사가 **공식 웹사이트·도움말에 공개한 내용만** 조사해 `research\FEATURES.md` 에 출처 URL 과 함께 정리했습니다. 다른 다운로더 제품의 설치 파일은 실행·설치·분해·디컴파일하지 않았고, 그 제품의 이름·로고·디자인·문구를 쓰지 않았습니다. 앱 아이콘(새싹 + 내려받기 화살표)과 화면은 goodseed 의 새싹 아이콘 계열로 새로 만들었습니다.

## 8. 오너 확인 필요

- **goodseedown 자체의 라이선스**: 지금은 goodseed Studio 와 같은 표기(`GPL-3.0-or-later`, `src\package.json`)를 따랐습니다. ffmpeg(GPL v3) 를 함께 배포하므로 배포 형태와 맞는지 오너가 최종 결정해 주세요(코드는 ffmpeg 를 별도 프로그램으로 호출합니다).
- 저작자 표기(오너 지정): **굿씨드AI연구소(goodseed AI LAB) 오경근 박사** — 앱 정보창에 표시하고 '오경근 박사'는 https://ohkyoungkeun-namecard.vercel.app/ 로 연결됩니다(기본 브라우저로 엽니다). 런처·exe 속성(LegalCopyright)은 `Copyright (c) 2026 굿씨드AI연구소 오경근 박사`, 회사 이름(CompanyName)은 `goodseed AI LAB` 입니다.
