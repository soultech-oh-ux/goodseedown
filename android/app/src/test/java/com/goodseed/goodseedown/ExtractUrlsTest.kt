package com.goodseed.goodseedown

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExtractUrlsTest {
    @Test fun sharedTextWithTitle() {
        // 유튜브 앱 '공유'는 제목과 링크를 같이 보낸다.
        val t = "Caminandes 3: Llamigos - YouTube\nhttps://youtu.be/SkVqJ1SGeL0?si=abc"
        assertEquals(listOf("https://youtu.be/SkVqJ1SGeL0?si=abc"), extractUrls(t))
    }

    @Test fun trailingPunctuationAndDuplicates() {
        val t = "보세요 https://youtu.be/abc123. 그리고 (https://www.youtube.com/watch?v=x1), https://youtu.be/abc123"
        assertEquals(listOf("https://youtu.be/abc123", "https://www.youtube.com/watch?v=x1"), extractUrls(t))
    }

    @Test fun noLinkOrNonHttp() {
        assertTrue(extractUrls(null).isEmpty())
        assertTrue(extractUrls("그냥 글입니다").isEmpty())
        assertTrue(extractUrls("file:///sdcard/a.mp4 javascript:alert(1) ftp://a.b/c").isEmpty())
    }

    @Test fun optionLikeInputIsNotALink() {
        // '--exec ...' 같은 yt-dlp 옵션 주입 시도는 http(s) 링크가 아니므로 걸러진다.
        assertTrue(extractUrls("--exec calc.exe").isEmpty())
        assertEquals(listOf("https://a.com/x"), extractUrls("--exec calc https://a.com/x"))
    }

    @Test fun formatSelectorPrefersH264() {
        assertTrue(Engine.videoFormat(720).startsWith("bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]"))
        assertTrue(Engine.videoFormat(0).startsWith("bv*[vcodec^=avc1]+ba[ext=m4a]"))
    }
}
