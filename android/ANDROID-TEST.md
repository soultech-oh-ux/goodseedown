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

---

# 1.0.1 — 실기기 MP3 320k 실패 조사·수정 (2026-11-02)

지시: 오너 폰에서 MP3 320k 받기가 실패하고 "…[엔진 업데이트] 후 다시 시도해 보세요"가 뜸(오너는 엔진 업데이트 후에도 실패). 이 문구는 1.0.0 의 두 곳에서 나옴: ①`DownloadService.kt` "받은 파일을 찾지 못했습니다"(저장할 파일 0건) ②`Engine.kt` `friendlyError` 의 else(다른 어떤 오류도 아닐 때).

## A. 결론 먼저 (정직하게)

- **오너 폰의 실패 원인은 특정하지 못했습니다.** 1.0.0 은 yt-dlp 오류 원문을 화면에 남기지 않았고, 실패한 링크·원문을 받지 못했으며, 이 PC 에서는 기기 실행이 불가능합니다. 아래는 PC 재현에서 **확인된 사실**과 **남은 후보**입니다.
- **PC 에서 앱과 같은 인자로 재현한 MP3 320k 는 최신 yt-dlp(2026.10.26) 로 성공**했습니다(JS 런타임 없이도). 따라서 "최신 yt-dlp 가 JS 런타임이 없으면 MP3 추출이 막힌다"는 유력 가설은 **이 PC·이 영상에서는 사실이 아니었습니다.**
- 오너 폰 실패는 PC 와 다른 조건(폰의 네트워크/IP, 폰용 내장 파이썬·ffmpeg·quickjs)에서 생긴 것으로 보입니다. 이번 1.0.1 은 **다음 실패 때 원인이 화면에 그대로 보이게** 하는 것(요구 c)을 핵심으로 하고, 근거가 확인된 부분만 고쳤습니다.

## B. PC 재현 기록 (모두 이번에 실제 실행)

공통: 대상 Caminandes 3(Blender CC-BY 공개 영상, `SkVqJ1SGeL0`), 앱이 만드는 인자 그대로(`--no-cache-dir --windows-filenames --no-mtime --retries 10 --fragment-retries 10 --socket-timeout 30 --no-playlist -N 4 -f bestaudio/best -x --audio-format mp3 --audio-quality 320K --embed-metadata --embed-thumbnail --convert-thumbnails jpg --ffmpeg-location …`), PC 의 Python 3.12.10(앱 내장 파이썬도 3.12 — `libpython.zip.so` 안 `python3.12` 확인), 앱이 쓰는 것과 같은 zip 앱 형태의 yt-dlp.

| 번호 | 조건 | 결과 |
|---|---|---|
| R1 | **최신 stable 2026.10.26**, JS 런타임 없음(경고만 출력: "No supported JavaScript runtime…") | **exit 0, `Caminandes 3： Llamigos.mp3` 6,107,291바이트 생성** — 320k 성공 |
| R2 | 앱에 처음부터 들어 있던 **내장판 2025.11.12**(라이브러리 `library-0.18.1.aar` 의 `res/raw/ytdlp` 에서 꺼냄), 같은 인자 | **exit 1** — `WARNING: Your yt-dlp version (2025.11.12) is older than 90 days!`, web/web_safari "SABR" 경고, **`ERROR: unable to download video data: HTTP Error 403: Forbidden`**. 결과물은 앨범 사진 jpg 뿐, mp3 없음 |
| R3 | 최신판 + `--ffmpeg-location` 을 **파일 하나(`libffmpeg.so` 이름, ffprobe 없음)** 로 지정(폰에서 라이브러리가 하는 방식 재현) | **성공**, mp3 6,107,291바이트 |
| R4 | 최신판 + `--js-runtimes quickjs:/data/nope/libqjs.so`(존재하지 않는 경로) | **성공**(경고만) — 잘못된 JS 런타임 경로가 있어도 이 영상은 받아짐 |
| R5 | 최신판 `-F`(형식 목록)로 오디오 형식 존재 확인: Sintel(`eRsGyueVLvQ`), `gdZLi9oWNZg`, `dQw4w9WgXcQ` 각각 JS 런타임 **없음/node 있음** 비교 | 세 영상 모두 두 조건에서 **같은 오디오 형식 목록**(m4a 139/140, opus 249/250/251 등). 목록만 조회했고 받지 않았음 |

이 표에서 **사실로 확인된 것**:
1. 이 앱에 들어 있는 **내장 엔진(2025.11.12)은 지금 YouTube 에서 403 으로 실패**합니다(R2). 즉 엔진을 업데이트하지 않았거나 업데이트가 적용되지 않았다면 정확히 이런 실패가 납니다. 반대로 **[엔진 초기화](내장판으로 되돌리기)는 지금 시점에서는 해로울 수 있습니다**(되돌리면 403 엔진). 그래서 버튼 설명에 "업데이트 후 더 안 될 때만 쓰세요"를 적었습니다.
2. **최신 yt-dlp + JS 런타임 없음 = 실패**라는 가설은 R1·R5 로 **기각**(이 영상들 기준).
3. 앱 인자·`--ffmpeg-location` 파일 지정 방식(R3)·mp3 변환·태그·앨범아트 단계는 PC 에서 이상 없음.

**남은 후보(근거 수준 표시)**
- (실제 보고 있음) 폰/모바일 IP 에서 유튜브가 막는 경우. 같은 주 JunkFood02/Seal 이슈(공개 GitHub): #2678 `Precondition check failed … HTTP Error 400 … ERROR: Please sign in`, #2674 `Sign in to confirm you're not a bot`, #2681 `This video is not available` — 모두 최신 yt-dlp(2026.10.2x) 사용 중이며, **1.0.0 의 `friendlyError` 는 이 중 "Please sign in"·400 을 알아보지 못해 else("엔진 업데이트 후 다시 시도")로 떨어졌을 것**입니다. 오너 증상(문구)과 정합하지만 오너 폰의 실제 원문을 못 봤으므로 **확정 아님**.
- (미확인) 폰용 quickjs 가 yt-dlp 와 맞지 않는 경우, 폰용 ffmpeg 의 MP3 인코더·썸네일 변환 문제, 엔진 파일 실행 권한 문제. PC 에서 재현 불가, 기기 실행 불가.
- ①(저장 0건) 경로: PC 에서 mp3 는 `.mp3` 확장자로 생겨 `saveToDownloads` 수집 조건(mp4·mkv·webm·mp3·m4a·srt)과 어긋나지 않음을 R1 결과로 확인. 이 경로가 났다면 폰에서 yt-dlp 가 오류 없이 끝났는데 파일이 없다는 뜻이라 원문이 필요합니다 → 아래 수정으로 작업 폴더에 남은 파일 목록까지 진단 글에 담습니다.

## C. 1.0.1 에서 바꾼 것

1. **실패 카드에 원인 노출(요구 c)**: yt-dlp 오류 원문(stderr 끝 8줄, 진행률 줄 제외)을 카드에 그대로 표시, [오류 내용 복사] 버튼 추가. 복사되는 진단 글에는 앱 버전·기기 모델·안드로이드/API·ABI·**실제 yt-dlp 버전과 내장/업데이트 구분**·받기 옵션·주소·오류 원문 30줄·진행 로그 20줄·작업 폴더에 남은 파일 목록이 들어 있습니다. "저장할 파일 0건"(①)일 때도 같은 진단이 붙고, 요약 문구는 "받기는 끝났다고 나왔지만 저장할 파일이 없습니다."로 바꿨습니다.
2. **문구 정정**: else 문구에서 "엔진 업데이트 후 다시 시도"를 빼고 "아래 오류 원문을 확인하고 [오류 내용 복사]로 전달해 주세요"로 바꿈. 이미 업데이트한 사용자에게 같은 말을 되풀이하지 않기 위함. `Please sign in`, `HTTP Error 400/Precondition check failed`, `HTTP Error 403`, `Requested format is not available`, `Cannot run program`(엔진 실행 불가)를 각각 알아보게 추가(근거: B 의 R2 와 Seal 이슈 원문). `Requested format is not available` 가 "영상 없음"으로 잘못 분류되지 않도록 순서 조정(단위 시험으로 확인).
3. **엔진 버전 표시를 실제 파일 기준으로**: 1.0.0 은 업데이트 전에 "내장 버전"이라고만 보였습니다. 이제 실행되는 yt-dlp 파일 안의 `yt_dlp/version.py` 를 읽어 `2025.11.12 (앱에 들어 있던 판)` / `2026.10.26 (업데이트한 판)` 처럼 엔진 카드·정보 화면·진단 글에 표시합니다. 실제 yt-dlp zip 앱(셔뱅 23바이트가 앞에 붙은 형태) 두 개로 버전 읽기를 단위 시험했습니다.
4. **[엔진 초기화] 버튼**: 업데이트한 yt-dlp 를 지우고 내장판으로 되돌림(받는 중에는 비활성). B-1 의 이유로 설명문에 주의를 적음.
5. **용량**: arm64-v8a 만 포함(x86_64 제외). 138,421,968 → **80,097,465바이트**(약 42% 감소).
6. 버전 `versionCode 2` / `versionName 1.0.1`, **같은 키**로 서명.
7. (오너 추가 지시) **메인 화면 제목 `goodseedown` 바로 아래에 `굿씨드AI연구소`** 부제를 굵게 표시. **정보 화면**에서 GitHub 주소·긴 GPL 설명·'함께 쓰는 오픈소스' 목록·GPL 웹 버튼을 뺐고, 화면 맨 아래에 작은 회색 글씨 `오픈소스 고지` 한 줄만 두었습니다. 누르면 별도 화면에서 GPL-3.0 안내문 + 구성요소 목록(주소 포함) + GPL-3.0 전문이 나옵니다. 오경근 박사 표기·소개 페이지 링크·사용 안내는 그대로입니다.

## D. 1.0.1 검증 결과

- 단위 시험 **10/10 통과**(1.0.0 의 5 + 오류 안내 분류·진행률 줄 제거·실제 zip 앱 버전 읽기·깨진 파일은 null).
- 산출: `dist\goodseedown-android-1.0.1.apk` **80,097,465바이트**, SHA-256 `4712ac06dd01716afebdd04ef233562d4b4fb3c8693b0d3a9c85750465bd17c3`(`.sha256` 동봉).
- `apksigner verify` 통과(v2). 서명자 인증서 SHA-256 `ffe38ced0639ef34fa2a43d33d6322c8f4ecc25f2e54673bb6771c1d49ab7880` = 1.0.0 과 **동일**(1.0.0 apk 로도 재확인) → 1.0.0 위에 덮어 설치(업데이트) 가능. `aapt2`: versionCode 2, versionName 1.0.1, minSdk 29, native-code `arm64-v8a` 만.
- 1.0.0 의 `dist\goodseedown-android-1.0.0.apk` 는 그대로 보존했습니다.

## E. 한계

- **기기에서 실행해 보지 못했습니다**(에뮬레이터 불가 사유 위와 동일). 새 실패 카드·복사 버튼·부제·정보/고지 화면·엔진 초기화·엔진 버전 표시는 컴파일과 단위 시험만 거쳤고 화면으로는 못 봤습니다.
- 오너 폰 실패의 **근본 원인은 미특정**입니다. 1.0.1 로 설치해 같은 MP3 를 다시 받아 보고, 실패하면 카드의 [오류 내용 복사] 내용을 받으면 특정할 수 있습니다.
- 수정 인자(자동 재시도·player_client 지정 등)는 넣지 않았습니다 — PC 에서 실패가 재현되지 않아 효과를 뒷받침할 근거가 없습니다.
