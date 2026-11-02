package com.goodseed.goodseedown

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.io.File

/** 대기열을 차례로 처리하는 포그라운드 서비스. 화면을 꺼도 받기가 이어진다. */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private var running = false
    private var lastStartId = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private var doneCounter = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat(buildOngoing(null))
        if (intent?.action == ACTION_CANCEL) {
            intent.getStringExtra(EXTRA_ID)?.let { DownloadCenter.cancel(it) }
        }
        synchronized(lock) {
            lastStartId = startId
            if (!running) {
                running = true
                scope.launch { loop() }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private suspend fun loop() {
        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "goodseedown:download").apply {
            setReferenceCounted(false)
            acquire(6 * 60 * 60 * 1000L)
        }
        // 엔진(파이썬·ffmpeg)을 처음 풀 때는 끝날 때까지 기다린다.
        GoodseedownApp.engine.first { it !is EngineState.Initializing }
        while (true) {
            val job = DownloadCenter.nextQueued()
            if (job == null) {
                synchronized(lock) {
                    if (DownloadCenter.hasQueued()) return@synchronized
                    running = false
                    wakeLock?.let { if (it.isHeld) it.release() }
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(lastStartId)
                }
                if (!running) return
                continue
            }
            runJob(job)
        }
    }

    private fun runJob(job: DlJob) {
        val engine = GoodseedownApp.engine.value
        if (engine is EngineState.Failed) {
            DownloadCenter.update(job.id) {
                it.copy(state = JobState.FAILED, detail = "실패", error = "받기 엔진을 시작하지 못했습니다: ${engine.message}")
            }
            notifyDone(DownloadCenter.get(job.id)!!)
            return
        }
        DownloadCenter.update(job.id) { it.copy(state = JobState.RUNNING, detail = "시작하는 중", progress = -1f) }
        refreshOngoing(job.id)
        val base = getExternalFilesDir(null) ?: filesDir
        val work = File(base, "work/${job.id}")
        work.deleteRecursively()
        work.mkdirs()
        try {
            val req = Engine.buildRequest(job, work)
            var lastTick = 0L
            YoutubeDL.execute(req, job.id, false) { p, eta, line ->
                onLine(job.id, p, eta, line)
                val now = System.currentTimeMillis()
                if (now - lastTick > 800) {
                    lastTick = now
                    refreshOngoing(job.id)
                }
            }
            finishSuccess(job, work, null)
        } catch (e: YoutubeDL.CanceledException) {
            markCanceled(job, work)
        } catch (e: InterruptedException) {
            markCanceled(job, work)
        } catch (e: YoutubeDLException) {
            if (DownloadCenter.isCancelRequested(job.id)) {
                markCanceled(job, work)
            } else if (job.opts.playlist && work.walkTopDown().any { it.isFile && it.extension.lowercase() in setOf("mp4", "mp3", "mkv", "webm", "m4a") }) {
                // 재생목록에서 일부만 실패한 경우 — 받은 것은 저장하고 경고로 알린다.
                finishSuccess(job, work, Engine.friendlyError(e.message))
            } else {
                DownloadCenter.update(job.id) { it.copy(state = JobState.FAILED, detail = "실패", error = Engine.friendlyError(e.message)) }
                work.deleteRecursively()
            }
        } catch (e: Exception) {
            DownloadCenter.update(job.id) { it.copy(state = JobState.FAILED, detail = "실패", error = Engine.friendlyError(e.message ?: e.javaClass.simpleName)) }
            work.deleteRecursively()
        } finally {
            DownloadCenter.clearCancelFlag(job.id)
        }
        DownloadCenter.get(job.id)?.let { notifyDone(it) }
    }

    private fun finishSuccess(job: DlJob, work: File, warning: String?) {
        try {
            val saved = Engine.saveToDownloads(this, work)
            if (saved.isEmpty()) {
                DownloadCenter.update(job.id) {
                    it.copy(state = JobState.FAILED, detail = "실패", error = "받은 파일을 찾지 못했습니다. [엔진 업데이트] 후 다시 시도해 보세요.")
                }
            } else {
                DownloadCenter.update(job.id) {
                    it.copy(state = JobState.DONE, detail = "완료", progress = 1f, saved = saved, warning = warning)
                }
            }
        } catch (e: Exception) {
            DownloadCenter.update(job.id) {
                it.copy(state = JobState.FAILED, detail = "저장 실패", error = "다운로드 폴더에 저장하지 못했습니다: ${e.message}")
            }
        } finally {
            work.deleteRecursively()
        }
    }

    private fun markCanceled(job: DlJob, work: File) {
        DownloadCenter.update(job.id) { it.copy(state = JobState.CANCELED, detail = "취소됨") }
        work.deleteRecursively()
    }

    private val reItem = Regex("""Downloading (?:item|video) (\d+) of (\d+)""")
    private val reDest = Regex("""\[download] Destination: (.+)""")

    private fun onLine(id: String, p: Float, eta: Long, line: String) {
        DownloadCenter.update(id) { j ->
            var t = j
            reItem.find(line)?.let { t = t.copy(itemIndex = it.groupValues[1].toInt(), itemTotal = it.groupValues[2].toInt()) }
            reDest.find(line)?.let { m ->
                val name = File(m.groupValues[1].trim()).name
                // 번호 앞붙이·확장자·조각 표시를 떼어 제목만 보여 준다.
                val title = name.replace(Regex("""\.f\d+\.\w+$"""), "").substringBeforeLast('.')
                t = t.copy(title = title)
            }
            when {
                line.startsWith("[ExtractAudio]") -> t = t.copy(detail = "MP3로 바꾸는 중", progress = -1f)
                line.startsWith("[Merger]") || line.startsWith("[VideoRemuxer]") -> t = t.copy(detail = "영상·소리를 합치는 중", progress = -1f)
                line.startsWith("[EmbedThumbnail]") || line.startsWith("[Metadata]") || line.startsWith("[ThumbnailsConvertor]") ->
                    t = t.copy(detail = "태그·앨범아트를 넣는 중", progress = -1f)
                line.startsWith("[info]") && t.progress < 0 -> t = t.copy(detail = "정보를 읽는 중")
                p >= 0f -> {
                    val frac = p / 100f
                    val overall = if (t.itemTotal > 1) ((t.itemIndex - 1).coerceAtLeast(0) + frac) / t.itemTotal else frac
                    t = t.copy(progress = overall.coerceIn(0f, 1f), etaSec = eta, detail = "받는 중")
                }
            }
            t
        }
    }

    // ---- 알림 ----

    private fun startForegroundCompat(n: Notification) {
        startForeground(NOTI_ONGOING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private fun openAppIntent(): PendingIntent =
        PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun buildOngoing(job: DlJob?): Notification {
        val b = NotificationCompat.Builder(this, GoodseedownApp.CH_PROGRESS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("goodseedown")
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (job == null) {
            b.setContentText("준비 중")
            b.setProgress(0, 0, true)
        } else {
            val name = job.title.ifBlank { "링크를 읽는 중" }
            val item = if (job.itemTotal > 1) " (${job.itemIndex}/${job.itemTotal})" else ""
            b.setContentTitle("받는 중$item")
            b.setContentText(name)
            if (job.progress >= 0f) b.setProgress(100, (job.progress * 100).toInt(), false) else b.setProgress(0, 0, true)
            val cancel = PendingIntent.getService(
                this, job.id.hashCode(),
                Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, job.id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            b.addAction(0, "취소", cancel)
        }
        return b.build()
    }

    private fun refreshOngoing(id: String) {
        val job = DownloadCenter.get(id) ?: return
        getSystemService(NotificationManager::class.java).notify(NOTI_ONGOING, buildOngoing(job))
    }

    private fun notifyDone(job: DlJob) {
        if (job.state == JobState.CANCELED) return
        val ok = job.state == JobState.DONE
        val text = if (ok) {
            val n = job.saved.size
            (job.saved.firstOrNull()?.name ?: job.title) + if (n > 1) " 외 ${n - 1}개" else ""
        } else {
            (job.error ?: "받지 못했습니다").lineSequence().first()
        }
        val n = NotificationCompat.Builder(this, GoodseedownApp.CH_DONE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (ok) "받기 완료 — 다운로드/goodseedown" else "받기 실패")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openAppIntent())
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTI_DONE_BASE + (doneCounter++ % 50), n)
    }

    companion object {
        const val ACTION_CANCEL = "com.goodseed.goodseedown.CANCEL"
        const val EXTRA_ID = "id"
        private const val NOTI_ONGOING = 1
        private const val NOTI_DONE_BASE = 100

        @Suppress("unused")
        fun context(ctx: Context) = ctx.applicationContext
    }
}
