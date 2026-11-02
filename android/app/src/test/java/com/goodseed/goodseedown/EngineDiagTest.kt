package com.goodseed.goodseedown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class EngineDiagTest {
    @Test fun friendlyMapsKnownYoutubeFailures() {
        // 실제 사례의 오류 글(PC 재현·Seal 이슈 2678/2674)을 그대로 넣는다.
        assertTrue(Engine.friendlyError("ERROR: unable to download video data: HTTP Error 403: Forbidden").contains("403"))
        assertTrue(Engine.friendlyError("WARNING: x\nERROR: [youtube] I0-IiiVgvyU: Please sign in").contains("로그인"))
        assertTrue(Engine.friendlyError("ERROR: [youtube] E8Aewrf7o58: Sign in to confirm you’re not a bot").contains("로그인"))
        assertTrue(Engine.friendlyError("WARNING: [youtube] HTTP Error 400: Bad Request. Retrying (3/3)...").contains("400"))
        // 'Requested format is not available' 가 '영상 없음'으로 잘못 분류되지 않는다.
        assertTrue(Engine.friendlyError("ERROR: [youtube] abc: Requested format is not available").contains("형식"))
        assertTrue(Engine.friendlyError("ERROR: [youtube] abc: Video unavailable").contains("볼 수 없는"))
    }

    @Test fun unknownErrorNoLongerBlamesTheEngine() {
        val m = Engine.friendlyError("ERROR: something odd")
        assertTrue(m.contains("오류 내용 복사"))
        assertTrue(!m.contains("엔진 업데이트 후"))
    }

    @Test fun tailLinesDropsProgressAndBlank() {
        val raw = "[download]  12.3% of 2.32MiB at 1MiB/s ETA 00:01\n\nWARNING: a\n[download] 100% of 2.32MiB in 00:00:00\nERROR: b\n"
        assertEquals(listOf("WARNING: a", "ERROR: b"), Engine.tailLines(raw, 10))
        assertEquals(listOf("ERROR: b"), Engine.tailLines(raw, 1))
        assertTrue(Engine.tailLines(null, 5).isEmpty())
    }

    // 진짜 yt-dlp zip 앱(앞에 셔뱅 23바이트가 붙은 파일)에서 버전을 읽는지. PC 에 받아 둔 파일이 있을 때만 돈다.
    @Test fun readsVersionFromRealYtdlpZipapp() {
        val dir = File(System.getProperty("ytdlp.test.dir") ?: "C:/Users/USER/AppData/Local/Temp/ydl2")
        val latest = File(dir, "yt-dlp"); val bundled = File(dir, "ytdlp_bundled")
        assumeTrue(latest.exists() && bundled.exists())
        assertEquals("2026.10.26", Engine.readYtdlpVersion(latest))
        assertEquals("2025.11.12", Engine.readYtdlpVersion(bundled))
    }

    @Test fun readVersionOfBrokenFileIsNull() {
        val f = File.createTempFile("notzip", ".bin"); f.writeText("not a zip")
        assertNull(Engine.readYtdlpVersion(f))
        assertNull(Engine.readYtdlpVersion(File("/no/such/file")))
        f.delete()
    }
}
