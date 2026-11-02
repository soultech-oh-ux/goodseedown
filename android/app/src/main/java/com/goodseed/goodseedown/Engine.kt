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

    /** yt-dlp 오류 글을 한국어 안내로 바꾼다(원문 끝줄은 뒤에 붙인다). */
    fun friendlyError(raw: String?): String {
        val msg = (raw ?: "").trim()
        val last = msg.lines().lastOrNull { it.contains("ERROR", true) } ?: msg.lines().lastOrNull().orEmpty()
        val hint = when {
            last.contains("Sign in to confirm", true) || last.contains("not a bot", true) ->
                "유튜브가 로그인 확인을 요구합니다. 잠시 뒤 다시 시도하거나 [엔진 업데이트]를 해 보세요."
            last.contains("Private video", true) -> "비공개 영상이라 받을 수 없습니다."
            last.contains("members-only", true) || last.contains("Join this channel", true) ->
                "멤버십 전용 영상이라 받을 수 없습니다."
            last.contains("Video unavailable", true) || last.contains("not available", true) ->
                "영상을 볼 수 없는 상태입니다(삭제·지역 제한 등)."
            last.contains("429", true) -> "요청이 너무 많다고 거절됐습니다. 잠시 뒤 다시 시도하세요."
            last.contains("Unsupported URL", true) -> "지원하지 않는 주소입니다."
            last.contains("Unable to download webpage", true) || last.contains("urlopen error", true) ||
                last.contains("Temporary failure", true) || last.contains("timed out", true) ->
                "인터넷 연결을 확인해 주세요."
            last.contains("ffmpeg", true) -> "변환 도구 오류입니다."
            else -> "받지 못했습니다. [엔진 업데이트] 후 다시 시도해 보세요."
        }
        val tail = last.take(300)
        return if (tail.isBlank()) hint else "$hint\n($tail)"
    }
}
