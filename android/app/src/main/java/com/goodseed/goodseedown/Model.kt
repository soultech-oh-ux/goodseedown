package com.goodseed.goodseedown

import android.content.Context
import android.content.SharedPreferences

enum class Mode { VIDEO, MP3 }

/** 한 번의 받기에 쓰는 옵션. 화면 설정에서 만들어 그대로 대기열에 넣는다. */
data class Options(
    val mode: Mode,
    val heightCap: Int,        // 0 = 가능한 최고 화질, 그 외 = 이 세로 픽셀 이하
    val mp3Bitrate: Int,       // 128 / 192 / 256 / 320
    val tags: Boolean,         // MP3 제목·아티스트 태그 + 앨범아트
    val subtitles: Boolean,    // 영상 자막(.srt) 같이 받기
    val playlist: Boolean,     // 재생목록 전체 받기
    val fastAria2c: Boolean,   // aria2c 가속(실험)
)

enum class JobState { QUEUED, RUNNING, DONE, FAILED, CANCELED }

data class SavedFile(val name: String, val uri: String, val mime: String)

data class DlJob(
    val id: String,
    val url: String,
    val opts: Options,
    val state: JobState = JobState.QUEUED,
    val title: String = "",
    val progress: Float = -1f,      // 0..1, 음수 = 진행률 모름
    val etaSec: Long = -1,
    val detail: String = "대기 중",
    val itemIndex: Int = 0,
    val itemTotal: Int = 0,
    val saved: List<SavedFile> = emptyList(),
    val error: String? = null,
    val warning: String? = null,
)

/** 마지막으로 고른 값을 기억한다(값만 기억 — 자동으로 받기를 시작하지 않는다). */
class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)
    var mode: Mode
        get() = if (sp.getString("mode", "VIDEO") == "MP3") Mode.MP3 else Mode.VIDEO
        set(v) = sp.edit().putString("mode", v.name).apply()
    var heightCap: Int
        get() = sp.getInt("height", 0)
        set(v) = sp.edit().putInt("height", v).apply()
    var mp3Bitrate: Int
        get() = sp.getInt("mp3", 320)
        set(v) = sp.edit().putInt("mp3", v).apply()
    var tags: Boolean
        get() = sp.getBoolean("tags", true)
        set(v) = sp.edit().putBoolean("tags", v).apply()
    var subtitles: Boolean
        get() = sp.getBoolean("subs", false)
        set(v) = sp.edit().putBoolean("subs", v).apply()
    var fastAria2c: Boolean
        get() = sp.getBoolean("aria2c", false)
        set(v) = sp.edit().putBoolean("aria2c", v).apply()
}
