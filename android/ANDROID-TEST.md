# goodseedown 안드로이드 1.0.0 — 시험 기록 (`ANDROID-TEST.md`)

작업일 2026-11-02 · 담당 worker-4 · 지시: master 위임 티켓 "goodseedown 안드로이드 앱(APK) 제작"
외부 발행(git push·GitHub 릴리스·Vercel 배포)은 하지 않았습니다.

## 0. 먼저 읽을 결론

| 항목 | 결과 |
|---|---|
| APK 빌드·서명 | **됨** — `dist\goodseedown-android-1.0.0.apk`, 138,421,968 바이트, SHA-256 `d90e83468089b8f1c82e9f0da452f43d7ae0c14609bc6b8b8e6f0b5a51af5897` (`.sha256` 파일 동봉) |
| `apksigner verify` | **통과**(v2 서명, 서명자 1명, 인증서 SHA-256 `ffe38ced…7880`) |
| **에뮬레이터 설치·실행·MP4 1건·MP3 1건 실측** | **못 함 — 실측 불가**(사유 §2). 따라서 **폰 안에서 앱이 실제로 뜨고 받는지는 이번에 확인하지 못했습니다.** |
| 공유메뉴로 받은 링크가 자동 시작되지 않음 | **코드·단위 시험으로만 확인**(§4). 기기에서 실제 공유 동작은 미실측 |
| yt-dlp 인자(앱이 만드는 것과 같은 인자) | **PC 에서 실제 영상으로 확인**(§3) — 안드로이드 런타임(내장 파이썬·ffmpeg)에서의 동작은 미확인 |

## 1. 만든 것

- 위치: `goodseedown\android\` (Kotlin + Jetpack Compose, Gradle 8.9, AGP 8.7.3, Kotlin 2.0.21, compileSdk/targetSdk 35, **minSdk 29**=안드로이드 10 이상)
- `applicationId com.goodseed.goodseedown`, versionName `1.0.0`(versionCode 1), ABI `arm64-v8a`·`x86_64`
- 받기 엔진: `io.github.junkfood02.youtubedl-android` `library`·`ffmpeg`·`aria2c` 0.18.1 (GPL-3.0, Maven Central 에서 버전 확인)
- 기능: ①링크 붙여넣기 → 동영상 MP4(화질 최고/1080/720/480/360, H.264+AAC 우선) ②MP3 128/192/256/320(기본 320k, 제목·아티스트 태그+앨범아트 켜고 끌 수 있음) ③재생목록 전체(스위치 켬: 재생목록 제목 하위 폴더+번호) ④자막(.srt, 한국어·영어) ⑤진행률·남은 시간·취소·완료 알림(포그라운드 서비스) ⑥저장 위치 `Download/goodseedown`(MediaStore 로 저장) ⑦공유메뉴 수신(입력칸 채우기만) ⑧yt-dlp 엔진 업데이트 버튼(받는 중에는 막음) ⑨정보 화면(`굿씨드AI연구소(goodseed AI LAB) 오경근 박사`, https://ohkyoungkeun-namecard.vercel.app/ 열기 버튼, 앱 버전, 엔진 버전, GPL-3.0 고지와 전문, 오픈소스 목록) ⑩한국어 UI
- 서명 키: `android\keystore\goodseedown-release.jks`, 비밀번호는 `android\keystore\KEY_INFO.txt`. `android\keystore.properties`(빌드가 읽음)와 함께 `android\.gitignore` 로 git 제외. **키를 잃으면 같은 앱으로 업데이트 배포가 불가능하니 백업이 필요합니다.**
- 빌드 도구는 `%LOCALAPPDATA%\Android\` 아래(JDK 17 zip·cmdline-tools·SDK platform 35·build-tools 35.0.0·Gradle 8.9)에 설치했습니다. winget 의 JDK 설치는 관리자 권한 창에서 멈춰 중단하고 Microsoft 공식 zip 으로 대신했습니다.

## 2. 에뮬레이터 실측을 못 한 사유 (사실)

- `emulator -accel-check` → **"Android Emulator hypervisor driver is not installed on this machine"**. 이 PC 는 CPU 가상화는 켜져 있으나(펌웨어 VirtualizationFirmwareEnabled=True) 에뮬레이터용 가속 드라이버(AEHD) 또는 Windows 하이퍼바이저 플랫폼이 없습니다.
- x86_64 이미지(`system-images;android-34;google_apis;x86_64`)를 만들어 기동 → **"x86_64 emulation currently requires hardware acceleration!"** 로 종료(소프트웨어 에뮬레이션 불가).
- arm64 이미지(`android-30;default;arm64-v8a`)를 시도 → **"Avd's CPU Architecture 'arm64' is not supported by the QEMU2 emulator on x86_64 host"**.
- 연결된 실제 안드로이드 기기 없음(`adb devices` 비어 있음).
- 드라이버 설치·Windows 기능 켜기는 관리자 권한과 커널 드라이버·재부팅이 필요한 시스템 변경이라, master 지시("오너 결정 대기 — 임의 설치 금지")에 따라 하지 않았습니다. 설치 후 이어서 할 시험은 §6 에 적었습니다.

## 3. PC 에서 한 인자 검증 (실제 영상, 앱과 같은 인자)

대상은 모두 Blender Foundation 공식 채널의 공개(CC-BY) 영상입니다(Caminandes 3: Llamigos 150초, Spring, Blender Open Movies 재생목록). PC 의 `build\tools\yt-dlp\yt-dlp.exe`·`ffmpeg.exe`(PC 판 번들)로 `Engine.kt` 가 만드는 것과 같은 옵션을 돌렸습니다. **같은 인자일 뿐 안드로이드용 내장 파이썬·ffmpeg 빌드에서 돌린 것은 아닙니다.**

| 시험 | 인자 요지 | 결과(실측) |
|---|---|---|
| MP4 720p | `-f bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/… --merge-output-format mp4` | `Caminandes 3： Llamigos.mp4` — 영상 **h264 (Main) 1280x720**, 소리 **aac (LC) 44.1kHz**, 길이 2:30.14. (**처음에는 `[ext=mp4]` 만 지정했더니 AV1(f398)이 골라져서 `vcodec^=avc1` 우선 조건을 넣었습니다** — 폰에서 AV1 은 구형 기기에서 재생이 안 될 수 있어서입니다.) |
| MP3 320k + 태그 | `-x --audio-format mp3 --audio-quality 320K --embed-metadata --embed-thumbnail --convert-thumbnails jpg` | mp3, **320 kb/s**, 길이 2:30.12, 제목 `Caminandes 3: Llamigos`, 아티스트 `Blender`, 앨범아트 삽입 단계(`[EmbedThumbnail]`) 수행 |
| 자막 | `--write-subs --write-auto-subs --sub-langs ko,en,ko-orig,en-orig --convert-subs srt` | `Spring - Blender Open Movie.en.srt` 803바이트 생성(이 영상에는 한국어 자막 없음) |
| 재생목록 | `--yes-playlist --ignore-errors --playlist-items 1-2 … --audio-quality 128K` | `Blender Open Movies/1 - OVERGROWN….mp3`, `…/2 - SINGULARITY….mp3` 하위 폴더+번호로 저장. (**처음 템플릿은 폴더 구분 `/` 가 `⧸` 로 바뀌어 폴더가 안 만들어졌습니다 — 템플릿을 `%(playlist_title\|)s/%(playlist_index&{} - \|)s%(title).120B.%(ext)s` 로 고쳐 재확인.**) |
| 영상 주소+목록 주소, 재생목록 스위치 끔(`--no-playlist`) | 같은 템플릿 | 하위 폴더 없이 그 영상 한 개만 저장 |

## 4. 코드·정적 검증

- **단위 시험 5건 통과**(`ExtractUrlsTest`, `gradlew testDebugUnitTest`): 유튜브 공유 글(제목+링크)에서 링크만 추출 / 끝 문장부호·중복 제거 / 링크 없음·`file:`·`javascript:`·`ftp:` 거름 / `--exec calc.exe` 같은 옵션 주입 글은 링크가 아니라서 걸러짐 / 화질 선택식이 H.264 우선.
- **자동 시작 없음(코드 확인)**: `DownloadCenter.enqueue(` 호출은 `MainActivity.kt` 의 `start()` 한 곳뿐이고, `start()` 는 [받기] 버튼(또는 그 버튼이 띄운 알림 권한 창의 결과 콜백)에서만 불립니다. 공유 수신(`handleShare`)은 `UiState.url` 에 글을 넣고 안내 토스트를 띄울 뿐입니다. 클립보드 읽기는 [붙여넣기] 버튼에서만, 구독 기능은 없습니다. ※ 이는 코드 확인이며 기기에서 공유 동작을 직접 눌러 본 것은 아닙니다.
- `aapt2 dump badging`: 패키지 `com.goodseed.goodseedown`, versionName `1.0.0`, minSdk 29, targetSdk 35, 권한 INTERNET·FOREGROUND_SERVICE(+DATA_SYNC)·POST_NOTIFICATIONS·WAKE_LOCK, `launchable-activity MainActivity`, native-code `arm64-v8a`·`x86_64`, 공유 필터 `android.intent.action.SEND` + `text/plain`, 서비스 `exported=false`·`foregroundServiceType=dataSync`.
- APK 안에 파이썬(`libpython.zip.so`)·ffmpeg(`libffmpeg.zip.so`)·aria2c·quickjs 가 ABI 별로 들어 있음을 `unzip -l` 로 확인.

## 5. 한계·주의 (정직하게)

1. **안드로이드 기기/에뮬레이터에서 한 번도 실행하지 못했습니다.** 설치되는지, 시작 시 엔진 초기화(파이썬 풀기)가 되는지, 실제 받기, MediaStore 저장, 알림, 공유 수신 동작은 모두 미확인입니다. 컴파일과 서명, 단위 시험, PC 인자 검증까지만 했습니다.
2. 용량 **약 132MB**(138,421,968바이트): arm64 와 x86_64 두 ABI 가 모두 들어 있어서입니다. 실제 폰은 arm64 이므로 x86_64 를 빼면 절반 안팎으로 줄 것으로 예상합니다(미측정).
3. 32비트 전용 폰(armeabi-v7a)과 안드로이드 9 이하(minSdk 29 미만)는 지원하지 않습니다.
4. 유튜브가 로그인 확인(봇 확인)을 요구하거나 사이트가 바뀌면 받기가 실패할 수 있습니다 — 앱의 [엔진 업데이트]는 GitHub 에서 최신 yt-dlp 를 받아 바꾸지만 그 동작도 기기에서 확인하지 못했습니다.
5. 대기열은 앱 메모리에만 있어 앱 프로세스가 죽으면 목록이 사라집니다(받은 파일은 `Download/goodseedown` 에 남음). 이어받기·일시정지는 없습니다(요구 범위 밖).
6. 코드 서명 인증서는 자체 서명입니다(플레이스토어 배포용 아님). 설치 시 "출처를 알 수 없는 앱" 허용이 필요합니다. v1(JAR) 서명 없이 v2 만 있습니다(안드로이드 10+ 에서는 문제 없음).
7. 저작자 표기·GPL 고지는 앱 정보 화면에 넣었고 GPL-3.0 전문(`assets\LICENSE-GPL-3.0.txt`, PC 판 LICENSE 복사)을 앱 안에서 볼 수 있습니다. 소스 제공 위치(공개 저장소 링크)는 master 가 저장소를 정하면 정보 화면에 적어야 합니다 — 현재는 구성요소 저장소 주소만 적혀 있습니다. goodseedown 자체 라이선스는 PC 판과 같이 오너 결정 대기입니다.

## 6. 드라이버/기기가 생기면 이어서 할 시험

`adb install dist\goodseedown-android-1.0.0.apk` → 앱 실행(엔진 준비 문구 사라짐) → 짧은 공개 영상 MP4 1건·MP3 1건 [받기] → `Download/goodseedown` 에 저장·재생 확인 → 다른 앱(브라우저/유튜브) 공유로 링크 보내기 → 입력칸만 채워지고 받기 목록에 아무것도 생기지 않는지 확인 → [엔진 업데이트] → 취소 버튼.

## 7. 재현 방법

```
set JAVA_HOME=%LOCALAPPDATA%\Android\jdk17
cd goodseedown\android
gradlew.bat testDebugUnitTest assembleRelease
%LOCALAPPDATA%\Android\Sdk\build-tools\35.0.0\apksigner.bat verify --verbose app\build\outputs\apk\release\app-release.apk
```
(서명하려면 `android\keystore.properties` 가 있어야 합니다.)
