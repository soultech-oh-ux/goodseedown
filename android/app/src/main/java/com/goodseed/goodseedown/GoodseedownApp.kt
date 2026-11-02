package com.goodseed.goodseedown

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.yausername.aria2c.Aria2c
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface EngineState {
    data object Initializing : EngineState
    data class Ready(val ytdlpVersion: String) : EngineState
    data class Failed(val message: String) : EngineState
}

class GoodseedownApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_PROGRESS, "받는 중", NotificationManager.IMPORTANCE_LOW).apply {
                description = "받는 동안 진행 상황을 보여 줍니다."
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DONE, "받기 완료", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "받기가 끝났거나 실패했을 때 알려 줍니다."
            }
        )
        // 파이썬·ffmpeg 를 처음 풀 때 시간이 걸리므로 화면을 막지 않게 따로 돌린다.
        Thread({
            try {
                YoutubeDL.getInstance().init(this)
                FFmpeg.getInstance().init(this)
                Aria2c.getInstance().init(this)
                _engine.value = EngineState.Ready(YoutubeDL.version(this) ?: "내장 버전")
            } catch (e: Throwable) {
                _engine.value = EngineState.Failed(e.message ?: e.javaClass.simpleName)
            }
        }, "engine-init").start()
    }

    companion object {
        const val CH_PROGRESS = "progress"
        const val CH_DONE = "done"
        lateinit var instance: GoodseedownApp
            private set
        private val _engine = MutableStateFlow<EngineState>(EngineState.Initializing)
        val engine: StateFlow<EngineState> = _engine.asStateFlow()

        fun setEngineVersion(v: String) {
            _engine.value = EngineState.Ready(v)
        }
    }
}
