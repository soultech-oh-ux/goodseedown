package com.goodseed.goodseedown

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** 대기열. 사용자가 [받기]를 누른 링크만 들어온다 — 어떤 경로로도 자동으로 넣지 않는다. */
object DownloadCenter {
    private val _jobs = MutableStateFlow<List<DlJob>>(emptyList())
    val jobs: StateFlow<List<DlJob>> = _jobs.asStateFlow()
    private val cancelRequested = ConcurrentHashMap.newKeySet<String>()

    /** [받기] 버튼에서만 호출된다. */
    fun enqueue(ctx: Context, url: String, opts: Options): DlJob {
        val job = DlJob(id = UUID.randomUUID().toString().take(8), url = url, opts = opts)
        _jobs.update { it + job }
        ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadService::class.java))
        return job
    }

    fun nextQueued(): DlJob? = _jobs.value.firstOrNull { it.state == JobState.QUEUED }
    fun hasQueued(): Boolean = nextQueued() != null
    fun get(id: String): DlJob? = _jobs.value.firstOrNull { it.id == id }

    fun update(id: String, f: (DlJob) -> DlJob) {
        _jobs.update { list -> list.map { if (it.id == id) f(it) else it } }
    }

    fun isCancelRequested(id: String) = cancelRequested.contains(id)
    fun clearCancelFlag(id: String) { cancelRequested.remove(id) }

    fun cancel(id: String) {
        val j = get(id) ?: return
        when (j.state) {
            JobState.QUEUED -> update(id) { it.copy(state = JobState.CANCELED, detail = "취소됨") }
            JobState.RUNNING -> {
                cancelRequested.add(id)
                update(id) { it.copy(detail = "취소하는 중") }
                YoutubeDL.destroyProcessById(id)
            }
            else -> Unit
        }
    }

    fun remove(id: String) {
        _jobs.update { list -> list.filterNot { it.id == id && it.state != JobState.RUNNING } }
    }

    fun clearFinished() {
        _jobs.update { list -> list.filter { it.state == JobState.QUEUED || it.state == JobState.RUNNING } }
    }
}
