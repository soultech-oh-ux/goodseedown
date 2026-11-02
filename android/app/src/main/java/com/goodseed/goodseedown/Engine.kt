package com.goodseed.goodseedown

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.Locale

/** yt-dlp 명령 인자를 만드는 곳과, 받은 파일을 Download/goodseedown 으로 옮기는 곳. */
object Engine {
    const val SAVE_DIR = "goodseedown"

    // 재생목록이면 하위 폴더(재생목록 제목) + 번호, 단일 영상이면 제목만. 한글·공백은 그대로 둔다.
    private const val OUT_TEMPLATE =
        "%(playlist_title|)s/%(playlist_index&{} - |)s%(title).120B.%(ext)s"

    fun videoFormat(cap: Int): String {
        val h = if (cap > 0) "[height<=$cap]" else ""
        // 폰에서 어디서나 재생되는 MP4(H.264+AAC) 우선 → 안 되면 다른 코덱으로 받아 MP4 로 합친다.
        return "bv*$h[vcodec^=avc1]+ba[ext=m4a]/bv*$h[ext=mp4]+ba[ext=m4a]/b$h[ext=mp4]/bv*$h+ba/b$h/b"
    }

    fun buildRequest(job: DlJob, workDir: File): YoutubeDLRequest {
        val o = job.opts
        val r = YoutubeDLRequest(job.url)
        r.addOption("-o", File(workDir, OUT_TEMPLATE).path.replace('\\', '/'))
        r.addOption("--windows-filenames")
        r.addOption("--no-mtime")
        r.addOption("--retries", 10)
        r.addOption("--fragment-retries", 10)
        r.addOption("--socket-timeout", 30)
        r.addOption(if (o.playlist) "--yes-playlist" else "--no-playlist")
        if (o.playlist) r.addOption("--ignore-errors")
        if (o.fastAria2c) {
            r.addOption("--downloader", "libaria2c.so")
        } else {
            r.addOption("-N", 4)
        }
        when (o.mode) {
            Mode.VIDEO -> {
                r.addOption("-f", videoFormat(o.heightCap))
                r.addOption("--merge-output-format", "mp4")
                if (o.subtitles) {
                    r.addOption("--write-subs")
                    r.addOption("--write-auto-subs")
                    r.addOption("--sub-langs", "ko,en,ko-orig,en-orig")
                    r.addOption("--convert-subs", "srt")
                }
            }
            Mode.MP3 -> {
                r.addOption("-f", "bestaudio/best")
                r.addOption("-x")
                r.addOption("--audio-format", "mp3")
                r.addOption("--audio-quality", "${o.mp3Bitrate}K")
                if (o.tags) {
                    r.addOption("--embed-metadata")
                    r.addOption("--embed-thumbnail")
                    r.addOption("--convert-thumbnails", "jpg")
                }
            }
        }
        return r
    }

    private val FINAL_EXT = setOf("mp4", "mkv", "webm", "mp3", "m4a", "srt")

    fun mimeOf(name: String): String = when (name.substringAfterLast('.').lowercase(Locale.ROOT)) {
        "mp4" -> "video/mp4"
        "mkv" -> "video/x-matroska"
        "webm" -> "video/webm"
        "mp3" -> "audio/mpeg"
        "m4a" -> "audio/mp4"
        "srt" -> "application/x-subrip"
        else -> "application/octet-stream"
    }

    /** 작업 폴더의 완성 파일만 골라 다운로드 폴더(MediaStore)로 옮긴다. 옮긴 파일 목록을 돌려준다. */
    fun saveToDownloads(ctx: Context, workDir: File): List<SavedFile> {
        val out = ArrayList<SavedFile>()
        val files = workDir.walkTopDown().filter { it.isFile }
            .filter { it.extension.lowercase(Locale.ROOT) in FINAL_EXT }
            .sortedBy { it.path }
            .toList()
        for (f in files) {
            val rel = f.parentFile!!.relativeTo(workDir).path.replace('\\', '/')
            val relPath = Environment.DIRECTORY_DOWNLOADS + "/" + SAVE_DIR + (if (rel.isEmpty()) "" else "/$rel")
            val mime = mimeOf(f.name)
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, f.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, relPath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val res = ctx.contentResolver
            val uri = res.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw java.io.IOException("저장 위치를 만들지 못했습니다: $relPath")
            try {
                res.openOutputStream(uri)!!.use { os -> f.inputStream().use { it.copyTo(os, 1 shl 16) } }
                val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                res.update(uri, done, null, null)
            } catch (e: Exception) {
                res.delete(uri, null, null)
                throw e
            }
            out.add(SavedFile(f.name, uri.toString(), mime))
            f.delete()
        }
        return out
    }

    // ---- 받기 엔진(yt-dlp) 버전·초기화 ----

    private const val YTDLP_PREFS = "youtubedl-android"   // 라이브러리가 업데이트한 버전을 적어 두는 곳

    /** 지금 실제로 실행되는 yt-dlp 파일(내장판 또는 [엔진 업데이트]로 바뀐 판). */
    fun ytdlpFile(ctx: Context): File =
        File(File(File(ctx.noBackupFilesDir, "youtubedl-android"), "yt-dlp"), "yt-dlp")

    /** yt-dlp 파일(zip 앱) 안의 yt_dlp/version.py 에서 실제 버전을 읽는다. 못 읽으면 null. */
    fun readYtdlpVersion(f: File): String? = try {
        java.util.zip.ZipFile(f).use { z ->
            val e = z.getEntry("yt_dlp/version.py") ?: return@use null
            val text = z.getInputStream(e).bufferedReader().use { it.readText() }
            Regex("""__version__\s*=\s*'([^']+)'""").find(text)?.groupValues?.get(1)
        }
    } catch (e: Exception) {
        null
    }

    fun isEngineUpdated(ctx: Context): Boolean =
        !ctx.getSharedPreferences(YTDLP_PREFS, Context.MODE_PRIVATE).getString("dlpVersion", null).isNullOrEmpty()

    fun engineLabel(ctx: Context): String {
        val v = readYtdlpVersion(ytdlpFile(ctx)) ?: "알 수 없음"
        return v + if (isEngineUpdated(ctx)) " (업데이트한 판)" else " (앱에 들어 있던 판)"
    }

    /** [엔진 초기화]: 업데이트한 yt-dlp 를 지우고 앱에 들어 있던 판으로 되돌린다. 되돌린 버전을 돌려준다. */
    fun resetEngine(ctx: Context): String? {
        val dir = ytdlpFile(ctx).parentFile!!
        dir.deleteRecursively()
        com.yausername.youtubedl_android.YoutubeDL.init_ytdlp(ctx, dir)
        ctx.getSharedPreferences(YTDLP_PREFS, Context.MODE_PRIVATE).edit().remove("dlpVersion").remove("dlpVersionName").apply()
        return readYtdlpVersion(ytdlpFile(ctx))
    }

    // ---- 오류 안내·진단 ----

    /** 진행률 줄은 빼고, 비어 있지 않은 마지막 n 줄만 남긴다. */
    fun tailLines(text: String?, n: Int): List<String> =
        (text ?: "").lineSequence().map { it.trimEnd() }
            .filter { it.isNotBlank() && !it.trimStart().matches(Regex("""\[download]\s+[\d.]+%.*""")) }
            .map { it.take(400) }
            .toList().takeLast(n)

    /** yt-dlp 오류 글을 한국어 안내로 바꾼다. 원문은 따로 카드에 그대로 보여 준다. */
    fun friendlyError(raw: String?): String {
        val msg = (raw ?: "").trim()
        val last = msg.lines().lastOrNull { it.contains("ERROR", true) } ?: msg.lines().lastOrNull().orEmpty()
        return when {
            last.contains("Sign in to confirm", true) || last.contains("not a bot", true) || last.contains("Please sign in", true) ->
                "유튜브가 로그인/로봇 확인을 요구하며 거절했습니다. 와이파이↔모바일 데이터를 바꾸거나 잠시 뒤 다시 시도해 보세요."
            last.contains("Requested format is not available", true) ->
                "받을 수 있는 형식을 찾지 못했습니다. [엔진 업데이트]를 해 보세요."
            last.contains("Private video", true) -> "비공개 영상이라 받을 수 없습니다."
            last.contains("members-only", true) || last.contains("Join this channel", true) ->
                "멤버십 전용 영상이라 받을 수 없습니다."
            last.contains("Video unavailable", true) || last.contains("not available", true) ->
                "영상을 볼 수 없는 상태입니다(삭제·지역 제한 등)."
            last.contains("429", true) -> "요청이 너무 많다고 거절됐습니다. 잠시 뒤 다시 시도하세요."
            last.contains("HTTP Error 403", true) -> "유튜브가 영상 데이터 받기를 거절했습니다(403). [엔진 업데이트] 후 다시 시도하세요."
            last.contains("Precondition check failed", true) || last.contains("HTTP Error 400", true) ->
                "유튜브가 요청을 거절했습니다(400). 잠시 뒤 다시 시도하거나 네트워크를 바꿔 보세요."
            last.contains("Unsupported URL", true) -> "지원하지 않는 주소입니다."
            last.contains("Unable to download webpage", true) || last.contains("urlopen error", true) ||
                last.contains("Temporary failure", true) || last.contains("timed out", true) ->
                "인터넷 연결을 확인해 주세요."
            last.contains("ffmpeg", true) -> "변환 도구(ffmpeg) 오류입니다."
            last.contains("Cannot run program", true) || last.contains("Permission denied", true) ->
                "받기 엔진을 실행하지 못했습니다. [엔진 초기화]를 해 보세요."
            else -> "받지 못했습니다. 아래 오류 원문을 확인하고 [오류 내용 복사]로 전달해 주세요."
        }
    }

    /** 복사용 진단 글: 앱·기기·엔진 버전, 옵션, 주소, 오류 원문, 작업 폴더에 남은 파일. */
    fun buildReport(ctx: Context, job: DlJob, headline: String, errLines: List<String>, outLines: List<String>, workFiles: List<String>?): String {
        val o = job.opts
        return buildString {
            appendLine("goodseedown ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine("기기: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} / 안드로이드 ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}) / ${android.os.Build.SUPPORTED_ABIS.joinToString()}")
            appendLine("받기 엔진 yt-dlp: ${engineLabel(ctx)}")
            appendLine("옵션: ${o.mode} 화질=${o.heightCap} mp3=${o.mp3Bitrate}k 태그=${o.tags} 자막=${o.subtitles} 재생목록=${o.playlist} aria2c=${o.fastAria2c}")
            appendLine("주소: ${job.url}")
            appendLine("요약: $headline")
            appendLine("--- 오류 원문(stderr 끝부분) ---")
            errLines.forEach { appendLine(it) }
            appendLine("--- 진행 로그(stdout 끝부분) ---")
            outLines.forEach { appendLine(it) }
            if (workFiles != null) {
                appendLine("--- 작업 폴더에 남은 파일 ---")
                if (workFiles.isEmpty()) appendLine("(없음)") else workFiles.forEach { appendLine(it) }
            }
        }
    }
}
