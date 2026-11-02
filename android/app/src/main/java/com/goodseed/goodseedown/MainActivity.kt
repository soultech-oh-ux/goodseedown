package com.goodseed.goodseedown

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 입력칸 값. 공유로 받은 링크는 여기에 채우기만 한다 — 시작은 사용자가 [받기]를 눌러야 한다. */
object UiState {
    var url by mutableStateOf("")
}

const val AUTHOR_URL = "https://ohkyoungkeun-namecard.vercel.app/"
const val AUTHOR_LINE = "굿씨드AI연구소(goodseed AI LAB) 오경근 박사"

private val urlRegex = Regex("""https?://[^\s<>"']+""")

/** 글에서 http(s) 링크만 뽑는다(공유 글에는 제목이 함께 붙어 오는 일이 많다). */
fun extractUrls(text: String?): List<String> =
    urlRegex.findAll(text ?: "").map { it.value.trimEnd('.', ',', ')', ']', '}', '、', '。') }.distinct().toList()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleShare(intent)
        setContent { GoodseedownTheme { Root() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    /** 공유(ACTION_SEND)로 받은 링크를 입력칸에 채울 뿐, 받기를 시작하지 않는다. */
    private fun handleShare(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val text = i.getStringExtra(Intent.EXTRA_TEXT)
        val urls = extractUrls(text)
        if (urls.isEmpty()) {
            Toast.makeText(this, "공유한 글에서 링크를 찾지 못했습니다.", Toast.LENGTH_LONG).show()
            return
        }
        UiState.url = urls.joinToString("\n")
        Toast.makeText(this, "링크를 입력칸에 넣었습니다. 확인하고 [받기]를 눌러 주세요.", Toast.LENGTH_LONG).show()
    }
}

@Composable
fun GoodseedownTheme(content: @Composable () -> Unit) {
    val scheme: ColorScheme = lightColorScheme(
        primary = Color(0xFF2E7D32),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFC8E6C9),
        onPrimaryContainer = Color(0xFF0D3B10),
        secondaryContainer = Color(0xFFC8E6C9),
        onSecondaryContainer = Color(0xFF0D3B10),
        error = Color(0xFFB3261E),
    )
    MaterialTheme(colorScheme = scheme) { Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFFFAFAF7)) { content() } }
}

@Composable
fun Root() {
    var showAbout by remember { mutableStateOf(false) }
    if (showAbout) {
        BackHandler { showAbout = false }
        AboutScreen(onBack = { showAbout = false })
    } else {
        MainScreen(onAbout = { showAbout = true })
    }
}

private fun Context.openLink(url: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(this, "브라우저를 열 수 없습니다. 주소: $url", Toast.LENGTH_LONG).show()
    }
}

private fun Context.openSaved(f: SavedFile) {
    try {
        startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(f.uri), f.mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(this, "이 파일을 열 앱이 없습니다. 파일은 다운로드/goodseedown 폴더에 있습니다.", Toast.LENGTH_LONG).show()
    }
}

@Composable
fun MainScreen(onAbout: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember { Prefs(ctx) }
    var mode by remember { mutableStateOf(prefs.mode) }
    var height by remember { mutableIntStateOf(prefs.heightCap) }
    var bitrate by remember { mutableIntStateOf(prefs.mp3Bitrate) }
    var tags by remember { mutableStateOf(prefs.tags) }
    var subs by remember { mutableStateOf(prefs.subtitles) }
    var fast by remember { mutableStateOf(prefs.fastAria2c) }
    var playlist by remember { mutableStateOf(false) }
    val jobs by DownloadCenter.jobs.collectAsState()
    val engine by GoodseedownApp.engine.collectAsState()
    val scope = rememberCoroutineScope()
    var updating by remember { mutableStateOf(false) }
    var updateMsg by remember { mutableStateOf<String?>(null) }

    fun start() {
        val urls = extractUrls(UiState.url)
        if (urls.isEmpty()) {
            Toast.makeText(ctx, "주소(http 로 시작하는 링크)를 넣어 주세요.", Toast.LENGTH_SHORT).show()
            return
        }
        prefs.mode = mode; prefs.heightCap = height; prefs.mp3Bitrate = bitrate
        prefs.tags = tags; prefs.subtitles = subs; prefs.fastAria2c = fast
        val opts = Options(mode, height, bitrate, tags, subs && mode == Mode.VIDEO, playlist, fast)
        urls.forEach { DownloadCenter.enqueue(ctx, it, opts) }
        UiState.url = ""
        Toast.makeText(ctx, "${urls.size}건을 받기 목록에 넣었습니다.", Toast.LENGTH_SHORT).show()
    }

    // 알림 권한(안드로이드 13+)은 [받기]를 누를 때 한 번 묻는다. 거절해도 받기는 진행된다.
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { start() }
    fun onStartClicked() {
        val need = Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (need && extractUrls(UiState.url).isNotEmpty()) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) else start()
    }

    val busy = jobs.any { it.state == JobState.RUNNING }

    LazyColumn(
        modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("goodseedown", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f))
                TextButton(onClick = onAbout) { Text("정보") }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = mode == Mode.VIDEO, onClick = { mode = Mode.VIDEO }, label = { Text("동영상") })
                FilterChip(selected = mode == Mode.MP3, onClick = { mode = Mode.MP3 }, label = { Text("MP3") })
            }
        }
        item {
            OutlinedTextField(
                value = UiState.url,
                onValueChange = { UiState.url = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("링크 (유튜브 등)") },
                placeholder = { Text("https://…") },
                minLines = 1,
                maxLines = 4,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                OutlinedButton(onClick = {
                    val cm = ctx.getSystemService(ClipboardManager::class.java)
                    val t = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString()
                    val u = extractUrls(t)
                    if (u.isEmpty()) Toast.makeText(ctx, "복사된 링크가 없습니다.", Toast.LENGTH_SHORT).show()
                    else UiState.url = u.joinToString("\n")
                }) { Text("붙여넣기") }
                OutlinedButton(onClick = { UiState.url = "" }, enabled = UiState.url.isNotEmpty()) { Text("지우기") }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (mode == Mode.VIDEO) {
                        Text("화질 (MP4)", fontWeight = FontWeight.Medium)
                        ChipRow(listOf(0 to "최고", 1080 to "1080p", 720 to "720p", 480 to "480p", 360 to "360p"), height) { height = it }
                        SwitchRow("자막도 받기 (한국어·영어 .srt)", subs) { subs = it }
                    } else {
                        Text("MP3 음질", fontWeight = FontWeight.Medium)
                        ChipRow(listOf(128 to "128k", 192 to "192k", 256 to "256k", 320 to "320k"), bitrate) { bitrate = it }
                        SwitchRow("제목·아티스트 태그와 앨범아트 넣기", tags) { tags = it }
                    }
                    SwitchRow("재생목록 전체 받기", playlist) { playlist = it }
                    Text(
                        if (playlist) "재생목록·채널 주소는 전체를 하위 폴더에 번호를 붙여 받습니다."
                        else "영상 주소에 재생목록이 같이 있어도 그 영상 한 개만 받습니다.",
                        fontSize = 12.sp, color = Color(0xFF666666)
                    )
                    SwitchRow("aria2c 가속 (실험)", fast) { fast = it }
                }
            }
        }
        item {
            Button(onClick = { onStartClicked() }, enabled = UiState.url.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(if (mode == Mode.MP3) "MP3 받기" else "동영상 받기", fontSize = 17.sp)
            }
            Text("저장 위치: 다운로드/goodseedown", fontSize = 12.sp, color = Color(0xFF666666), modifier = Modifier.padding(top = 4.dp))
        }
        item { HorizontalDivider() }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("받기 목록", fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f))
                if (jobs.any { it.state != JobState.QUEUED && it.state != JobState.RUNNING }) {
                    TextButton(onClick = { DownloadCenter.clearFinished() }) { Text("끝난 것 지우기") }
                }
            }
            if (jobs.isEmpty()) Text("아직 없습니다. 링크를 넣고 [받기]를 누르세요.", color = Color(0xFF666666), fontSize = 14.sp)
        }
        items(jobs.asReversed(), key = { it.id }) { JobCard(it) }
        item { HorizontalDivider() }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("받기 엔진 (yt-dlp)", fontWeight = FontWeight.Medium)
                    Text(
                        when (val e = engine) {
                            is EngineState.Initializing -> "엔진을 준비하는 중… (처음 한 번은 조금 걸립니다)"
                            is EngineState.Ready -> "버전: ${e.ytdlpVersion}"
                            is EngineState.Failed -> "엔진 시작 실패: ${e.message}"
                        }, fontSize = 13.sp
                    )
                    Text("사이트가 바뀌어 받기가 안 되면 엔진을 최신으로 바꿔 보세요.", fontSize = 12.sp, color = Color(0xFF666666))
                    OutlinedButton(
                        onClick = {
                            updating = true; updateMsg = null
                            scope.launch {
                                val msg = withContext(Dispatchers.IO) {
                                    try {
                                        val st = YoutubeDL.updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
                                        val v = YoutubeDL.version(ctx) ?: "?"
                                        GoodseedownApp.setEngineVersion(v)
                                        if (st == YoutubeDL.UpdateStatus.DONE) "엔진을 최신($v)으로 바꿨습니다." else "이미 최신입니다 ($v)."
                                    } catch (e: Exception) {
                                        "엔진 업데이트에 실패했습니다. 인터넷 연결을 확인하세요. (${e.message?.lineSequence()?.firstOrNull()?.take(120)})"
                                    }
                                }
                                updateMsg = msg; updating = false
                            }
                        },
                        enabled = !updating && !busy && engine is EngineState.Ready,
                    ) { Text(if (updating) "바꾸는 중…" else "엔진 업데이트") }
                    if (busy) Text("받는 중에는 엔진을 바꿀 수 없습니다.", fontSize = 12.sp, color = Color(0xFF666666))
                    updateMsg?.let { Text(it, fontSize = 13.sp) }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun ChipRow(options: List<Pair<Int, String>>, selected: Int, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        options.forEach { (v, label) ->
            FilterChip(selected = selected == v, onClick = { onSelect(v) }, label = { Text(label, fontSize = 13.sp) })
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun JobCard(job: DlJob) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val modeLabel = if (job.opts.mode == Mode.MP3) "MP3 ${job.opts.mp3Bitrate}k" else if (job.opts.heightCap == 0) "MP4 최고" else "MP4 ${job.opts.heightCap}p"
    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(job.title.ifBlank { job.url }, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, fontSize = 14.sp)
            val item = if (job.itemTotal > 1) " · ${job.itemIndex}/${job.itemTotal}번째" else ""
            val pct = if (job.state == JobState.RUNNING && job.progress >= 0f) " · ${(job.progress * 100).toInt()}%" else ""
            val eta = if (job.state == JobState.RUNNING && job.etaSec >= 0 && job.detail == "받는 중") " · 남은 시간 ${job.etaSec / 60}:${"%02d".format(job.etaSec % 60)}" else ""
            Text("$modeLabel · ${job.detail}$item$pct$eta", fontSize = 12.sp, color = Color(0xFF555555))
            if (job.state == JobState.RUNNING) {
                if (job.progress >= 0f) LinearProgressIndicator(progress = { job.progress }, modifier = Modifier.fillMaxWidth())
                else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            job.error?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error) }
            job.warning?.let { Text("일부는 받지 못했습니다: $it", fontSize = 12.sp, color = Color(0xFF8A5A00)) }
            if (job.state == JobState.DONE) {
                Text("저장됨: ${job.saved.size}개 (다운로드/goodseedown)", fontSize = 12.sp, color = Color(0xFF2E7D32))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (job.state == JobState.QUEUED || job.state == JobState.RUNNING) {
                    OutlinedButton(onClick = { DownloadCenter.cancel(job.id) }) { Text("취소") }
                }
                if (job.state == JobState.DONE) {
                    job.saved.firstOrNull { it.mime != "application/x-subrip" }?.let { f ->
                        OutlinedButton(onClick = { ctx.openSaved(f) }) { Text("열기") }
                    }
                }
                if (job.state == JobState.DONE || job.state == JobState.FAILED || job.state == JobState.CANCELED) {
                    TextButton(onClick = { DownloadCenter.remove(job.id) }) { Text("목록에서 지우기") }
                }
            }
        }
    }
}

@Composable
fun AboutScreen(onBack: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var showLicense by remember { mutableStateOf(false) }
    val licenseText = remember(showLicense) {
        if (!showLicense) "" else try {
            ctx.assets.open("LICENSE-GPL-3.0.txt").bufferedReader().use { it.readText() }
        } catch (e: Exception) { "라이선스 전문을 읽지 못했습니다. 전문: https://www.gnu.org/licenses/gpl-3.0.html" }
    }
    val engine by GoodseedownApp.engine.collectAsState()
    BackHandler(enabled = showLicense) { showLicense = false }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            TextButton(onClick = { if (showLicense) showLicense = false else onBack() }) { Text("← 뒤로") }
            Text(if (showLicense) "GPL-3.0 전문" else "정보", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        if (showLicense) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Text(licenseText, fontSize = 11.sp, lineHeight = 14.sp)
            }
        } else {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("goodseedown", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text("버전 ${BuildConfig.VERSION_NAME}", fontSize = 15.sp)
                Text(
                    when (val e = engine) {
                        is EngineState.Ready -> "받기 엔진(yt-dlp) ${e.ytdlpVersion}"
                        is EngineState.Initializing -> "받기 엔진 준비 중"
                        is EngineState.Failed -> "받기 엔진 시작 실패"
                    }, fontSize = 13.sp, color = Color(0xFF555555)
                )
                HorizontalDivider()
                Text("만든 곳", fontWeight = FontWeight.Medium)
                Text(AUTHOR_LINE)
                Text("Copyright (c) 2026 굿씨드AI연구소 오경근 박사", fontSize = 13.sp)
                OutlinedButton(onClick = { ctx.openLink(AUTHOR_URL) }) { Text("오경근 박사 소개 페이지 열기") }
                Text(AUTHOR_URL, fontSize = 12.sp, color = Color(0xFF555555))
                HorizontalDivider()
                Text("사용 안내", fontWeight = FontWeight.Medium)
                Text(
                    "링크를 직접 넣고 [받기]를 눌렀을 때만 받습니다. 다른 앱의 '공유'로 보낸 링크도 입력칸에 채워질 뿐, 자동으로 받지 않습니다. " +
                        "저작권이 있는 영상·음악은 권리자의 허락 범위 안에서만 받아 쓰세요. 받는 책임은 사용자에게 있습니다.",
                    fontSize = 13.sp
                )
                HorizontalDivider()
                Text("라이선스 (GPL-3.0)", fontWeight = FontWeight.Medium)
                Text(
                    "이 앱은 GNU General Public License v3.0(GPL-3.0) 조건으로 제공되며, 보증이 없습니다. " +
                        "앱이 포함하는 youtubedl-android(GPL-3.0), aria2(GPL-2.0 이상) 등 구성요소의 라이선스 조건도 따릅니다.",
                    fontSize = 13.sp
                )
                OutlinedButton(onClick = { showLicense = true }) { Text("GPL-3.0 전문 보기") }
                OutlinedButton(onClick = { ctx.openLink("https://www.gnu.org/licenses/gpl-3.0.html") }) { Text("GPL-3.0 웹 페이지 열기") }
                HorizontalDivider()
                Text("함께 쓰는 오픈소스", fontWeight = FontWeight.Medium)
                Text(
                    "· yt-dlp (Unlicense) — https://github.com/yt-dlp/yt-dlp\n" +
                        "· youtubedl-android (GPL-3.0) — https://github.com/junkfood02/youtubedl-android\n" +
                        "· FFmpeg (LGPL/GPL, youtubedl-android 에 포함된 빌드)\n" +
                        "· aria2 (GPL-2.0 이상)\n" +
                        "· Python (PSF 라이선스)\n" +
                        "· AndroidX / Jetpack Compose (Apache-2.0)",
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}
