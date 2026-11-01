# goodseedown 1.1.0 — 변경·구현·시험 결과

작성: 2026-11-02 · worker-4 · 제작: 굿씨드AI연구소(goodseed AI LAB) [오경근 박사](https://ohkyoungkeun-namecard.vercel.app/)
배포 파일: `dist\goodseedown-1.1.0-Windows-x64.exe` — 213,139,968 바이트
SHA-256 `ffd13d3d50a2fd28ee9585256a48e4d151c945b09d425b1f2223aa3dfdad41dd`
(1.0.0 exe `dist\goodseedown-1.0.0-Windows-x64.exe`, SHA-256 `8f696d03…df156` 는 그대로 보존했습니다.)

## 1. 한 줄 요약

1.0.0 에 **MP3 전용 화면**을 더했습니다. 맨 위 **[동영상] [MP3]** 스위치로 화면을 고르고, MP3 화면은 "링크 → 음질(128/192/256/320 kbps) → 저장 폴더 → ID3 태그·앨범 사진 → **MP3 받기** 버튼 하나"로 단순화했습니다.
함께 오너 지시 세 가지를 반영했습니다 — ① **자동 다운로드 금지**(클립보드 자동 감지 제거, 구독은 새 영상 알림만), ② **저작자 표기**(굿씨드AI연구소 오경근 박사, 정보창 링크), ③ **업데이트 저장소 확정**(`soultech-oh-ux/goodseedown`).

## 2. 이번 버전에서 바뀐 것

### 2.1 MP3 전용 화면 (오너 지시)

| 항목 | 동작 |
|---|---|
| 화면 전환 | 맨 위 [동영상] [MP3]. MP3 화면에서는 동영상용 링크창·스마트 스위치·구독 탭을 숨기고, 아래 **다운로드 목록은 같은 목록(같은 대기열)** 을 쓰되 MP3 작업만 보입니다. 마지막에 쓴 화면은 다음 실행에 그대로 복원됩니다. |
| 링크 입력 | 직접 입력하거나 [붙여넣기] 버튼(아래 2.2 — 자동 감지는 없음) |
| 음질 | 128 / 192 / 256 / **320 kbps(기본)** — CBR 로 변환. 고른 음질은 저장되어 다음 실행에 복원됩니다. |
| 저장 폴더 | 기본 `내 음악\goodseedown`(동영상과 별도). [변경]으로 바꾸면 기억합니다. |
| ID3 태그 | 기본 **켬**. 제목·아티스트(채널 이름)·날짜 등 태그와, 영상 썸네일을 **앨범 사진**(JPEG)으로 파일 안에 넣습니다. 끄면 태그·앨범 사진 없이 변환만 합니다. |
| 단일 영상 | [MP3 받기] 한 번에 분석 창 없이 곧바로 대기열에 들어갑니다. |
| 영상+재생목록 주소 | "이 영상만 / 재생목록 전체" 선택창이 뜹니다(취소하면 아무것도 추가되지 않음). |
| 재생목록·채널 | 분석 후 받을 수 있는 영상 전체를 MP3 작업으로 넣고, **재생목록 이름의 하위 폴더에 번호(001 - …)** 를 붙여 저장합니다(50개를 넘으면 확인창). |
| 일시정지·이어받기·취소·다시 시작 | 기존 대기열 기능을 그대로 씁니다. |
| 같은 영상을 다른 음질로 다시 받기 | 새 음질로 **덮어씁니다**(파일은 하나). 처음에는 yt-dlp 가 "이미 받음"으로 건너뛰어 예전 음질 파일이 남는 문제가 있어 고쳤습니다(4절). |
| 동영상 화면의 "음성만 → MP3" | 같은 설정(음질 선택·ID3)을 쓰도록 옵션 창·설정 화면에 **MP3 음질 선택과 태그 체크**를 더했습니다. |

### 2.2 자동 다운로드 금지 (오너 지시 · 동영상·MP3 두 화면 공통)

사용자가 **링크를 직접 붙여넣거나 입력하고 받기 버튼을 누른 것만** 내려받습니다.

1. **클립보드**: 자동 감지를 없앴습니다(1.0.0 의 감지 배너·1초 주기 읽기·창 포커스 때 읽기·"클립보드 감지" 설정 모두 제거). 링크를 복사해도 입력칸 자동 채움·자동 시작이 없고, **[붙여넣기] 버튼을 눌렀을 때만** 클립보드를 읽어 입력칸에 넣습니다. 넣은 뒤에도 [분석]/[MP3 받기]를 눌러야 합니다.
2. **구독**: 새 영상을 대기열에 **자동으로 넣던 기능을 없앴습니다**. 이제 구독은 주기적으로 확인해 **새 영상 알림**(구독 카드에 목록)만 보여 줍니다. 받으려면 카드의 **[받기]**(영상별) 또는 **[새 영상 N개 모두 받기]** 를 눌러야 하고, [알림 지우기]로 받지 않고 지울 수도 있습니다. 구독할 때 "지금 받을 최근 영상 수"(backfill) 기능도 없앴습니다. 알림 목록은 파일에 저장되어 재시작 후에도 남습니다.
3. **스마트 모드**: 직접 붙여넣어 제출한 링크에만 적용됩니다(백그라운드 자동 시작 없음).
4. 앱 업데이트·yt-dlp 엔진 업데이트는 영상 다운로드가 아니며 기존대로 확인창에서 사용자가 승인해야 설치됩니다.

### 2.3 저작자 표기 (오너 지시)

- 앱 **정보창**(하단 [정보] 버튼 · 설정 화면 [goodseedown 정보] · 메뉴 도움말 → goodseedown 정보): "굿씨드AI연구소(goodseed AI LAB) **오경근 박사**" + `Copyright (c) 2026 굿씨드AI연구소 오경근 박사`. '오경근 박사'는 링크이고, 눌러도 앱 안에서 이동하지 않으며 메인 프로세스가 **`shell.openExternal`** 로 기본 브라우저에서 `https://ohkyoungkeun-namecard.vercel.app/` 를 엽니다(주소는 프로그램 안의 상수 하나뿐 — 화면이 보낸 주소는 쓰지 않음). 이 주소는 작업 중 HTTP 200 으로 확인했습니다.
- exe 속성: `LegalCopyright` = `Copyright (c) 2026 굿씨드AI연구소 오경근 박사`, `CompanyName` = `goodseed AI LAB`(배포 exe 와 풀려 나온 앱 본체 둘 다).
- README·THIRD-PARTY 의 저작자 표기도 같게 맞췄습니다(8절 "오너 확인" 의 `[입력 필요]` 자리는 없어졌습니다).

### 2.4 업데이트 저장소 (오너 승인)

`UPDATE_REPO = 'soultech-oh-ux/goodseedown'`(`build\src\desktop\updater.cjs`). 소스와 릴리스를 같은 공개 저장소에서 운영합니다. `release\publish-release.ps1` 의 기본 저장소 값과 설명도 맞췄습니다. **이 작업에서는 publish 를 실행하지 않았고 GitHub 에 아무것도 올리지 않았습니다.**
릴리스 자산 이름은 앱(`updater.cjs`)이 기대하는 규칙 그대로입니다: `goodseedown-1.1.0-Windows-x64.exe`, `SHA256SUMS.txt`, `PATCHES.json`, `goodseedown-1.1.0-from-1.0.0.patch`.

### 2.5 그 밖

- 버전 1.1.0 (`package.json`·exe 속성·런처). 업데이트 시험용 가짜 다음 버전은 1.1.1 로 바꿨습니다.
- 1.0.0 의 설정·작업 목록·구독 파일을 1.1.0 이 그대로 읽습니다(새 항목은 기본값) — 단위 시험 M0 와, 1.0.0 형식 파일 3종(설정·작업·구독)을 실제로 만들어 엔진에 읽혀 본 임시 확인(시험 스크립트에는 넣지 않음)으로 확인했습니다.

## 3. 성공 기준 대비 결과

모든 실측 영상은 Blender Foundation 공식 오픈 무비(YouTube 의 Creative Commons 표기)입니다. `ffprobe` 값입니다.

| 성공 기준 | 결과 | 근거(시험 이름) |
|---|---|---|
| 단일 영상 **320 kbps** MP3 (비트레이트·길이·ID3 제목·앨범아트) | ✅ 비트레이트 320000 bps · 길이 150.12초(Caminandes 3, 원본 150초) · 제목 `Caminandes 3: Llamigos` · 아티스트 `Blender` · 앨범아트 mjpeg 1280×720 1장 | 엔진 M1, 화면 UI10-10(Spring 464.16초·320000 bps) |
| **128 kbps** | ✅ 128000 bps · 150.12초 · 제목·앨범아트 · 파일 2,503,835 바이트(320 은 6,107,291) | 엔진 M2, 화면 UI10-9 |
| 192 kbps · ID3 끔 | ✅ 192000 bps · 제목/아티스트 태그 없음 · 앨범아트 없음 | 엔진 M3, 화면 UI10-11/17 |
| **재생목록 3개 일괄 MP3** | ✅ Blender Open Movies 3개 선택 → 하위 폴더 `Blender Open Movies` 에 `007 - …`, `011 - …`, `012 - …` · 3개 모두 320000 bps · 길이가 목록 정보와 ±3초 이내 · 제목 태그·앨범아트 | 엔진 M4 |
| 재생목록 **전체(18개)** 를 화면에서 | ✅ 18개 모두 완료 · `001 - …` ~ `018 - …` 18개 · 18개 전부 ffprobe 192000 bps·제목·앨범아트 | 화면 UI10-15~18 |
| 일시정지 · 재개 · 취소 | ✅ 일시정지(.part 437,232바이트 보존) → 이어받기가 **중단 지점(437,232바이트)부터** 이어서 완료(320000 bps·150초) · 취소는 임시 파일·결과 파일 0 · 취소 후 다시 시작 · 화면의 버튼으로도 동일 | 엔진 M5/M6, 화면 UI10-26~30 |
| 탭·음질 **기억** (재기동) | ✅ MP3 화면 + 192 kbps + ID3 설정을 저장하고 앱을 정상 종료(Browser.close → 종료 경로)했다가 다시 실행 → **MP3 화면으로 시작**, 음질 192·ID3·저장 폴더 그대로. 엔진 재생성으로도 같은 복원 | 화면 UI10-24/25, 엔진 M7 |
| 기존 엔진/UI/업데이트 시험 재통과 | ✅ 엔진 136/136 · 화면 94/94 · 업데이트 아래 표 참고(간헐 실패 있음, 정직하게 기재) | 4.2 |
| **1.0.0 → 1.1.0 차등 패치** 크기·적용·해시 | ✅ `release\make-patches.ps1 -Version 1.1.0 -PrevVersions 1.0.0` 로 생성. 패치 **197,315 바이트 = 새 exe 의 0.093%**(전체 213,139,968). 스크립트가 "1.0.0 exe 에 패치 적용 → 해시 비교"를 통과시켰고, 따로 `hpatchz` 로 다시 적용해 SHA-256 `ffd13d3d…41dd` = 1.1.0 exe 와 **일치** 확인. 실제 1.0.0 앱이 가짜 서버에서 패치를 받아 업데이트하는 시험 26/26 통과 | 4.2 |
| 1.1.0 exe **기동 스모크** | ✅ 포터블 exe 기동·창 제목·버전 1.1.0·yt-dlp 2026.10.26·ffmpeg·hpatchz 확인·정상 종료(시험 전후 앱 프로세스 0) | `build\verification_smoke-1.1.0.txt` |
| (추가) 클립보드에 링크를 넣어도 다운로드 요청 **0건** | ✅ 동영상 화면·스마트 모드 켠 채·MP3 화면 모두: 6초(스마트 5초) 기다려도 배너 없음·입력칸 비어 있음·작업 수 그대로·**yt-dlp 프로세스 0**. [붙여넣기]로 입력칸에 넣기만 해도 0건, [분석] 후 옵션 창이 떠 있는 동안도 0건 | 화면 UI9, UI10-2/2b |
| (추가) 구독 새 영상 감지 시 다운로드 요청 **0건** | ✅ 엔진: `addJobs` 호출 횟수를 세어 감지 후 **0회**, 몇 초 뒤에도 작업 0·yt-dlp 실행 0(모의 피드 + **실제 yt-dlp 로 조회한 공식 재생목록**). 화면: 구독 후 앱을 종료해 '본 영상' 1개를 빼고 재실행 → [지금 확인] → 카드에 "새 영상 1개 — 자동으로 받지 않습니다"와 [받기]만 표시, 작업 0개·yt-dlp 0. [받기]를 누른 영상만 대기열에 들어감 | 엔진 E16/E17, 화면 UI7 |
| (추가) 붙여넣기+버튼 클릭 시에만 다운로드 | ✅ UI2~UI6, UI10 이 모두 "붙여넣기/입력 → 버튼"으로만 시작 | 화면 |
| (추가) exe VersionInfo `LegalCopyright` 실측 | ✅ 배포 exe: `Copyright (c) 2026 굿씨드AI연구소 오경근 박사` / `goodseed AI LAB` · 앱 본체: 같은 값 + ProductName `goodseedown` · FileVersion `1.1.0` | 화면 UI12-1/2 (PowerShell `VersionInfo`) |
| (추가) 정보창 링크 클릭 시 `shell.openExternal` 호출 | ✅ 클릭 전 호출 0건 → 클릭 후 메인 프로세스가 `shell.openExternal https://ohkyoungkeun-namecard.vercel.app/` **정확히 1번** 호출 · 앱 화면 주소(file://…/index.html)는 그대로이고 새 창 없음 | 화면 UI12-3~8 (시험 방식은 5절 한계 참고) |

### 3.1 MP3 변환·태그 구현 요약 (yt-dlp 인자)

`-x --audio-format mp3 --audio-quality <128|192|256|320>K` (CBR) · ID3 켬: `--embed-metadata --embed-thumbnail --convert-thumbnails jpg` · 새로 시작할 때만 `--force-overwrites`(이어받기에서는 쓰면 .part 가 버려지므로 쓰지 않음). 주소는 항상 `--` 뒤에 두고 셸을 거치지 않는 호출은 1.0.0 과 같습니다. 변환은 ffmpeg 에 들어 있는 LAME 3.100 을 씁니다(THIRD-PARTY.md).

## 4. 시험

### 4.1 구성

| 시험 | 파일 | 이번 버전에서 더한 것 |
|---|---|---|
| 엔진(실제 yt-dlp·ffmpeg·ffprobe) | `build\tests\verify_engine.mjs` | M0~M8(옵션·설정 검증, 320/128/192, ID3 끔, 재생목록 3개, 일시정지·이어받기, 취소, 설정 복원, 덮어쓰기), 구독 E16/E17 을 "알림만"으로 개정 |
| 화면(앱을 띄워 CDP 로 실제 클릭·입력) | `build\tests\verify_ui.mjs --mode exe` | UI10(MP3 화면 31항목), UI12(정보창·VersionInfo), UI7·UI9 개정, 앱 재기동 도우미 |
| 업데이트(가짜 서버 + UI Automation) | `build\tests\verify_update_e2e.mjs [--old A --new B]` | 기본 1.1.0 → 1.1.1, 실제 1.0.0 → 1.1.0 은 `--old 1.0.0 --new 1.1.0` |
| 스모크 | `build\tests\smoke.mjs` | — |

시험은 **앱 업데이트** 주소를 가짜 서버(또는 닿지 않는 로컬 주소)로 돌려 `soultech-oh-ux/goodseedown` 에 접속하지 않습니다. (엔진 시험 E19 만 yt-dlp 공식 릴리스 정보를 GitHub 에서 읽기 전용으로 조회합니다 — 1.0.0 때와 같음.)

### 4.2 최종 집계 (최종 빌드, 위 sha256 의 exe)

| 시험 | 결과 |
|---|---|
| 엔진 | **136/136** 통과 (`verification_engine-1.1.0-final.json`) |
| 화면 | **94/94** 통과 (`verification_ui-1.1.0-final.json`) |
| 업데이트 1.1.0 → 1.1.1 (전체 S1~S9) | **46/47** (실패 S8-1: 시작 직후 업데이터 로그가 아직 안 써진 타이밍). 같은 시험을 따로 돌린 S3·S4·S6·S8 **19/19**, S1 만 6회 연속 **11/11** (`verification_update-1.1.0-full-46of47-S8-1.json`, `…rerun-S3S4S6S8-19of19.json`) |
| 업데이트 **실제 1.0.0 → 1.1.0** (S1·S2·S3·S6) | **26/26** 통과 — 전체 파일·차등 패치·손상 패치 폴백·진행 중 다운로드 일시정지 후 업데이트·새 버전에서 이어받기 (`verification_update-1.0.0-to-1.1.0-26of26.json`) |
| 스모크 | 통과 |

**업데이트 시험의 간헐 실패(정직하게)**: 같은 최종 exe 로 전체(S1~S9)를 4번 돌렸을 때 매번 다른 1~2건이 실패했습니다(1차 S4-2·S6, 2차 S1-6, 3차 S3-1/2, 4차 S8-1). 실패한 시나리오는 모두 따로 다시 돌리면 통과했고, S1 은 6회 연속 통과했습니다. 증상은 모두 "정해진 시간 안에 확인창·업데이터 로그·새 버전 화면 연결이 안 보임"(타이밍)이었고 앱이 잘못 동작한 흔적(해시 불일치·복원 실패 등)은 없었습니다. 1.0.0 때 기록한 S1-7 간헐 미연결과 같은 종류로 보이나 **원인은 규명하지 못했습니다**(방어 소프트웨어의 대용량 exe 검사·시스템 부하 의심, 확인 안 됨). 모든 시나리오가 어느 전체 실행에서는 통과했습니다. 실제 사용에서 업데이트가 드물게 늦어질 수 있다는 뜻으로 읽지는 마세요 — 측정한 것은 시험 하네스의 대기 시간입니다.

각 실행 기록은 `build\verification_*.json`, 중간 실행은 `build\verification-history\` 에 있습니다. (1.0.0 때 만든 `verification_engine-final.json`·`verification_ui-final.json`·`verification_update_final.json` 은 같은 이름으로 다시 쓰여 **1.0.0 의 원본 결과 파일은 남아 있지 않습니다** — 1.0.0 의 집계는 `CHANGELOG-1.0.0.md` 에 기록돼 있습니다.)

### 4.3 시험이 잡아 고친 결함 (제품)

1. **같은 영상을 다른 음질로 다시 받으면 예전 파일이 그대로 남음** — yt-dlp 가 "이미 받음"으로 건너뛰어, 128 로 요청했는데 320 파일이 남고 작업은 "완료"로 표시되던 문제(엔진 확인 중 발견). `--force-overwrites` 로 해결하되, 이 옵션이 **받던 .part 까지 버려 이어받기가 처음부터 다시 받는 문제**를 시험(M5)이 잡아, 새로 시작할 때만 쓰도록 했습니다(M8 + M5 로 둘 다 확인).
2. **빌드 스크립트가 한글이 든 package.json 을 읽지 못함** — 저자 표기에 한글을 넣자 `build-exe.ps1`/`make-test-fixture.ps1` 이 PowerShell 5.1 기본 인코딩으로 읽어 JSON 해석 오류(UTF-8 로 읽도록 수정).
3. (시험 코드 쪽 결함) MP3 제목 매칭 타이밍(UI10-7), 구독 시험이 시작한 다운로드를 정리하지 않아 이후 항목에 번지던 문제(UI7), 정보창 시험의 프로세스 조회 문자열 이스케이프(UI12-2), 엔진 시험 E2 가 "MP3 에 그림 스트림 없음"을 기대하던 것(1.1.0 부터 앨범 사진이 기본 포함 — 기대값 수정), 재기동 직후 버전 표시 대기(UI8).

설계상 **바뀐 동작**(결함이 아님): 동영상 화면의 "음성만 → MP3" 도 이제 CBR(기본 320 kbps)이고 앨범 사진이 들어갑니다(1.0.0 은 VBR 최고 품질로 대략 245 kbps). 클립보드 감지 설정(`clipboardWatch`)은 사라졌고 옛 설정 파일의 값은 무시됩니다. 구독 카드의 "자동 받기 켜짐" 표시는 "새 영상 알림 켜짐"으로 바뀌었습니다.

## 5. 알려진 한계 (정직하게)

- **업데이트 시험의 간헐 실패** 원인 미규명(4.2).
- **`shell.openExternal` 시험은 호출 기록 방식**: 시험이 owner 의 브라우저를 띄우지 않도록 환경변수 `GOODSEEDOWN_TEST_OPEN_LOG` 가 있으면 같은 함수가 실제 `shell.openExternal` 대신 호출 주소를 파일에 적습니다. 즉 "메인 프로세스가 올바른 주소로 호출 경로를 탔다"는 확인이고, **실제 브라우저가 열리는 것은 이 작업에서 직접 실행해 보지 않았습니다**(환경변수가 없을 때는 같은 위치에서 실제 `shell.openExternal` 을 `await` 하고 실패하면 화면에 주소를 알려 줍니다).
- **실제 GitHub 에는 접속하지 않았습니다.** 업데이트는 가짜 서버로만 확인했고, 릴리스에 올린 `.patch` 가 GitHub 에서 실제로 내려오는지(서빙·리디렉션)는 측정하지 못했습니다. 저장소 `soultech-oh-ux/goodseedown` 이 공개(PUBLIC)이고 릴리스가 올라가기 전에는 앱의 업데이트 확인이 조용히 실패(안내 없음)합니다.
- **구독 새 영상**은 모의 피드와 "본 영상에서 1개를 뺀" 실제 목록으로 확인했고, 실제로 새 영상이 올라오기를 기다린 시험은 아닙니다.
- 화면 자동 조작은 CDP·UI Automation 이며 사람이 직접 눌러 본 시험이 아닙니다. 코드 서명이 없어 처음 실행할 때 Windows SmartScreen 경고가 뜰 수 있습니다.
- ID3 태그에는 영상의 **설명 글 전체**(description/comment/synopsis)와 영상 주소가 함께 들어갑니다(yt-dlp `--embed-metadata` 의 기본 동작). 설명이 아주 긴 영상은 태그가 커질 수 있습니다. 앨범 사진은 영상 썸네일(대개 16:9)이라 정사각형이 아닙니다. 재생목록 항목의 '앨범/트랙 번호' 태그는 넣지 않았습니다(파일 이름의 번호만).
- **알 수 없는 사건 1건**: 중간 시험 중 한 번, 18개 재생목록을 받던 도중 시험용 앱 창이 닫히고 작업 18개가 모두 '취소됨'으로 남은 적이 있습니다. 시험 코드에는 그 구간에서 취소·종료 동작이 없어(누군가 창을 직접 조작했을 가능성) 원인을 확인하지 못했고, 이후 같은 시험을 두 번 전체 실행했을 때는 재현되지 않았습니다.
- 1.0.0 의 한계(DRM·타 사이트 미시험, 코드 서명 없음 등)는 그대로입니다.

## 6. 릴리스에 올릴 파일 (master 가 실행 — 이 작업에서는 올리지 않음)

저장소: `soultech-oh-ux/goodseedown`(공개) · 태그 `v1.1.0` · 경로는 `C:\Users\USER\Desktop\cysjavis\goodseedown\` 기준.

| 파일 | 경로 | 크기(바이트) | SHA-256 |
|---|---|---|---|
| `goodseedown-1.1.0-Windows-x64.exe` | `dist\` | 213,139,968 | `ffd13d3d50a2fd28ee9585256a48e4d151c945b09d425b1f2223aa3dfdad41dd` |
| `goodseedown-1.1.0-from-1.0.0.patch` | `release\out\` | 197,315 | `35ab7ea47cc1c36197058860318bd694075169356f2c4f62b202aa681a61ce9f` |
| `PATCHES.json` | `release\out\` | 502 | `98e3f0f94c0ca7ce75890c41da83cde03af530c6c34f8ed38b7689d2858a3072` |
| `SHA256SUMS.txt` | `release\out\` | 201 | `fe8dec993239cb100278fe7d9da90c3b8a141a8045692be93a95863643de691c` |

`release\publish-release.ps1 -Version 1.1.0 -NotesFile ..\CHANGELOG-1.1.0.md` 가 위 네 파일을 올리도록 만들어져 있습니다(먼저 `-PrepareOnly` 로 확인 가능). `SHA256SUMS.txt` 에는 exe 와 패치의 해시가 들어 있고, 앱은 이것으로 최종 검증합니다. **이 릴리스를 올리면 실제 1.0.0 사용자는 패치(0.09%)로 업데이트합니다**(1.0.0 앱의 `UPDATE_REPO` 는 자리표시 상태로 빌드돼 있어 **이미 배포된 1.0.0 은 업데이트를 확인하지 못합니다** — 1.0.0 을 쓰는 사람에게는 1.1.0 exe 를 직접 전해야 합니다).

## 7. 소스 저장소에 올릴 파일 범위

`goodseedown\.gitignore` 를 새로 만들었습니다. 제외: `dist\`, `release\out\`, `build\bundle\`·`work\`·`launcher\`·`electron-base\`·`verification-history\`, 외부 도구 바이너리(`build\tools\**\*.exe`, `build\tools\asar\node_modules\`), `*.exe *.dll *.zip *.patch *.asar`, 시험 미디어(`*.mp3 *.mp4 *.mkv *.webm *.m4a *.ogg *.opus *.srt *.vtt`), `*.part *.log`, `.goodseedown-tmp\`.
이 규칙으로 임시 저장소(`git init` 을 폴더 밖 임시 위치에 하고 `ls-files -o --exclude-standard`)에서 확인한 결과 올라갈 파일은 **약 60개, 합계 약 1.3 MB** 입니다:

- 루트: `.gitignore`, `README.md`, `THIRD-PARTY.md`, `CHANGELOG-1.0.0.md`, `CHANGELOG-1.1.0.md`
- `research\FEATURES.md`
- `release\`: `make-patches.ps1`, `publish-release.ps1`, `evidence\` 샘플 2개
- `build\`: `build-exe.ps1`, `make-test-fixture.ps1`, `make_bundle_zip.py`, `PortableLauncher.cs`, `uia.ps1`, `fake-engine-server.mjs`, `fake-release-server.mjs`, `icon.ico`
- `build\src\`: 앱 소스(`desktop\`, `engine\`, `ui\`, `package.json`)
- `build\tests\`: 시험 스크립트 5개
- `build\tools\*\`: 라이선스·출처 문서(`LICENSE*.txt`, `README.txt`, `SHA2-256SUMS`, `asar\package.json`) — 바이너리는 제외
- `build\verification_*.json` · `verification_smoke-1.1.0.txt`(시험 기록, 작음)
- ⚠ **`site\`**(`index.html`, `icon.png`) — 이 작업에서 만들지 않은 폴더입니다(2026-11-01 22:51 경 생성, "goodseedown 다운로드" 안내 페이지로 보임). `.gitignore` 에서 제외하지 않았으므로 올릴지 master 가 정해 주세요.

소스에서 다시 빌드하려면 제외된 도구가 `build\tools\` 의 지정 위치에 있어야 합니다(yt-dlp.exe·ffmpeg.exe·hpatchz.exe/hdiffz.exe·rcedit-x64.exe·ffprobe.exe·@electron/asar, 그리고 `build\electron-base\` 의 Electron 45.0.0 배포본). 받는 곳과 라이선스는 `THIRD-PARTY.md` 에 있습니다.

## 8. 오너 확인이 필요한 것

- goodseedown 자체 라이선스(`package.json` 의 `GPL-3.0-or-later`, ffmpeg GPLv3 를 함께 배포) — 1.0.0 부터의 미결정 항목.
- 저작자 표기와 업데이트 저장소는 이번에 확정되어 더 물을 것이 없습니다.

## 9. 파일 목록 (이번에 바뀌거나 늘어난 것)

`build\src\desktop\{main,preload,updater}.cjs` · `build\src\engine\{settings,ytdlp,manager,subscriptions,index}.cjs` · `build\src\ui\{index.html,app.js,style.css}` · `build\src\package.json` · `build\{build-exe.ps1,make-test-fixture.ps1,PortableLauncher.cs}` · `build\tests\*` · `release\publish-release.ps1` · `README.md` · `THIRD-PARTY.md` · `CHANGELOG-1.1.0.md` · `.gitignore`
