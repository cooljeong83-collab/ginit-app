package expo.modules.navermobileplacescrape

import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Connection
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element

/**
 * 네이버 모바일 통합검색 HTML 스크래핑.
 * 플레이스 블록: `li.UEzoS`(통합검색) · `li.z_rc6`(예: 새로 오픈) — 2025~2026 m.search 응답 기준.
 */
class NaverMobilePlaceScrapeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NaverMobilePlaceScrape")

    AsyncFunction("searchMobilePlaces") { query: String ->
      val q = query.trim()
      if (q.isEmpty()) {
        return@AsyncFunction emptyList<Map<String, String?>>()
      }
      val encoded = URLEncoder.encode(q, StandardCharsets.UTF_8.toString())
      val url =
        "https://m.search.naver.com/search.naver?sm=mtp_hty.top&where=m&query=$encoded"

      val doc =
        try {
          Jsoup.connect(url)
            .userAgent(NAVER_SCRAPE_UA)
            .timeout(5000)
            .header(
              "Accept",
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            )
            .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
            // br(Brotli) 응답 시 Jsoup이 본문을 제대로 풀지 못해 DOM이 비는 경우가 있어 gzip·deflate만 허용
            .header("Accept-Encoding", "gzip, deflate")
            .header("Cache-Control", "max-age=0")
            .header("Pragma", "no-cache")
            .header("Upgrade-Insecure-Requests", "1")
            .header("Sec-Fetch-Site", "none")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Dest", "document")
            .header("Sec-Fetch-User", "?1")
            .header("Sec-Ch-Ua", "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"")
            .header("Sec-Ch-Ua-Mobile", "?1")
            .header("Sec-Ch-Ua-Platform", "\"Android\"")
            .followRedirects(true)
            .get()
        } catch (e: Exception) {
          if (BuildConfig.DEBUG) {
            Log.e(TAG, "Jsoup 실패 query=$q url=$url err=${e.javaClass.simpleName}: ${e.message}", e)
          }
          throw CodedException(
            "NAVER_MOBILE_SCRAPE_FAILED",
            e.message ?: "네이버 모바일 검색 요청에 실패했습니다.",
            e,
          )
        }

      parsePlaceRows(doc, q, url)
    }

    /**
     * `m.place.naver.com` 등 **플레이스 상세** HTML에서 대표 이미지·주소 한 줄 추출.
     * (SSR·인라인 JSON·메타 병행 — SPA 단독 셸이면 빈 값 가능)
     */
    AsyncFunction("scrapePlaceDetailPage") { rawUrl: String ->
      val urlIn = rawUrl.trim()
      if (urlIn.isEmpty()) {
        return@AsyncFunction emptyMap<String, String?>()
      }
      val normalized =
        try {
          val u = URI(urlIn.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: "https://$urlIn").normalize()
          val scheme = u.scheme?.lowercase()
          if (scheme != "http" && scheme != "https") {
            return@AsyncFunction emptyMap<String, String?>()
          }
          u.toString()
        } catch (_: Exception) {
          return@AsyncFunction emptyMap<String, String?>()
        }
      val host = try {
        URI(normalized).host?.lowercase()
      } catch (_: Exception) {
        null
      }
      if (host.isNullOrBlank() || !isAllowedPlaceDetailHost(host)) {
        return@AsyncFunction emptyMap<String, String?>()
      }

      val doc =
        try {
          newNaverMobileJsoupConnection(normalized).timeout(8000).get()
        } catch (e: Exception) {
          if (BuildConfig.DEBUG) {
            Log.e(TAG, "상세 Jsoup 실패 url=$normalized err=${e.javaClass.simpleName}: ${e.message}", e)
          }
          throw CodedException(
            "NAVER_PLACE_DETAIL_SCRAPE_FAILED",
            e.message ?: "플레이스 상세 페이지 요청에 실패했습니다.",
            e,
          )
        }

      val html = doc.outerHtml()
      if (html.contains("서비스 이용이 제한") || html.contains("과도한 접근")) {
        if (BuildConfig.DEBUG) {
          Log.w(TAG, "상세 페이지 제한/차단 응답 — url=$normalized")
        }
        return@AsyncFunction emptyMap<String, String?>()
      }

      val out = mutableMapOf<String, String?>()
      val thumb = extractPlaceDetailThumbnail(doc, html)
      if (!thumb.isNullOrBlank()) out["thumbnailUrl"] = thumb
      val addr = extractPlaceDetailAddress(doc, html)
      if (!addr.isNullOrBlank()) {
        out["address"] = addr
        out["roadAddress"] = addr
      }
      return@AsyncFunction out
    }
  }

  companion object {
    private const val TAG = "NaverMobilePlaceScrape"

    private const val NAVER_SCRAPE_UA =
      "Mozilla/5.0 (Linux; Android 14; SM-S948N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"

    private fun isAllowedPlaceDetailHost(host: String): Boolean {
      val h = host.lowercase()
      return h == "m.place.naver.com" || h == "place.naver.com" || h.endsWith(".place.naver.com")
    }

    private fun newNaverMobileJsoupConnection(url: String): Connection {
      return Jsoup.connect(url)
        .userAgent(NAVER_SCRAPE_UA)
        .header(
          "Accept",
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        )
        .header("Accept-Language", "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Accept-Encoding", "gzip, deflate")
        .header("Cache-Control", "max-age=0")
        .header("Pragma", "no-cache")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-User", "?1")
        .header("Sec-Ch-Ua", "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"")
        .header("Sec-Ch-Ua-Mobile", "?1")
        .header("Sec-Ch-Ua-Platform", "\"Android\"")
        .followRedirects(true)
    }

    private fun extractPlaceDetailThumbnail(doc: Document, rawHtml: String): String? {
      val og = doc.selectFirst("meta[property=og:image]")?.attr("content")?.trim()
      if (!og.isNullOrBlank() && og.startsWith("http") && !shouldSkipDetailImageUrl(og)) return og
      val tw = doc.selectFirst("meta[name=twitter:image],meta[property=twitter:image]")?.attr("content")?.trim()
      if (!tw.isNullOrBlank() && tw.startsWith("http") && !shouldSkipDetailImageUrl(tw)) return tw
      val linkImg = doc.selectFirst("link[rel=image_src]")?.attr("href")?.trim()
      if (!linkImg.isNullOrBlank() && linkImg.startsWith("http") && !shouldSkipDetailImageUrl(linkImg)) return linkImg
      val body = doc.body() ?: return firstDetailImageFromHtmlString(rawHtml)
      for (img in body.select("img")) {
        for (attr in listOf("data-src", "data-lazy-src", "src")) {
          val raw = img.attr(attr).trim()
          if (raw.isEmpty() || raw.startsWith("data:")) continue
          val abs = img.absUrl(attr).trim()
          if (abs.isEmpty() || !abs.startsWith("http")) continue
          if (shouldSkipDetailImageUrl(abs)) continue
          return abs
        }
      }
      return firstDetailImageFromHtmlString(rawHtml)
    }

    private fun firstDetailImageFromHtmlString(rawHtml: String): String? {
      val re = Regex("""(https://[^"'\s<>]+pstatic\.net[^"'\s<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?)""", RegexOption.IGNORE_CASE)
      for (m in re.findAll(rawHtml)) {
        val u = m.groupValues[1].trim()
        if (u.isNotEmpty() && !shouldSkipDetailImageUrl(u)) return u
      }
      return null
    }

    private fun shouldSkipDetailImageUrl(url: String): Boolean {
      val u = url.lowercase()
      if (u.contains("favicon")) return true
      if (u.endsWith(".svg")) return true
      if (u.contains("static.map.naver.net")) return true
      if (u.contains("searchad-phinf.pstatic.net")) return true
      return false
    }

    private val regionPrefixesForAddressLine =
      listOf(
        "서울특별시",
        "부산광역시",
        "대구광역시",
        "인천광역시",
        "광주광역시",
        "대전광역시",
        "울산광역시",
        "세종특별자치시",
        "경기도",
        "강원특별자치도",
        "강원도",
        "충청북도",
        "충청남도",
        "전북특별자치도",
        "전라북도",
        "전라남도",
        "경상북도",
        "경상남도",
        "제주특별자치도",
        "서울",
        "부산",
        "대구",
        "인천",
        "광주",
        "대전",
        "울산",
        "세종",
        "경기",
        "강원",
        "충북",
        "충남",
        "전북",
        "전남",
        "경북",
        "경남",
        "제주",
      )

    /** UI 한 줄: 위치 아이콘·`[…]` 뒤 본문, `지도/내비게이션/거리뷰` 링크 문구 앞까지가 주소. */
    private fun normalizeNaverPlaceAddressUiText(raw: String): String {
      var t = raw.replace('\u00a0', ' ').trim()
      if (t.isEmpty()) return t
      t = t.trimStart { it <= ' ' || it == '\uFEFF' || it == '\u200B' }
      // `[라벨]` 접두(접근성·아이콘 설명)
      while (t.startsWith("[")) {
        val close = t.indexOf(']')
        if (close in 1 until t.length) {
          t = t.substring(close + 1).trim()
        } else {
          break
        }
      }
      t = trimLeadingToFirstRegionPrefix(t)
      t = trimTrailingNaverPlaceLinkLabels(t)
      return t.trim()
    }

    private fun trimLeadingToFirstRegionPrefix(s: String): String {
      var best = -1
      for (p in regionPrefixesForAddressLine) {
        val i = s.indexOf(p)
        if (i >= 0 && (best < 0 || i < best)) best = i
      }
      return if (best > 0) s.substring(best).trim() else s.trim()
    }

    private fun trimTrailingNaverPlaceLinkLabels(s: String): String {
      var t = s.trimEnd()
      if (t.isEmpty()) return t
      val gluedTails =
        listOf(
          "지도내비게이션거리뷰",
          "지도내비게이션",
          "내비게이션거리뷰",
        )
      for (tail in gluedTails) {
        val i = t.indexOf(tail)
        if (i >= 0) {
          t = t.substring(0, i).trimEnd()
        }
      }
      // 공백 있는 경우: "…호 지도 내비게이션"
      val spaced = Regex("""\s+지도(?:\s+내비게이션)?(?:\s+거리뷰)?\s*$""")
      t = spaced.replace(t, "").trimEnd()
      // 번지·호 뒤에 붙은 단독 "지도" (링크 라벨)
      if (t.endsWith("지도") && t.length > 6) {
        val before = t.dropLast(2).trimEnd()
        if (before.lastOrNull()?.isDigit() == true || before.endsWith("호") || before.endsWith("층")) {
          t = before
        }
      }
      return t.trimEnd()
    }

    private fun extractPlaceDetailAddress(doc: Document, rawHtml: String): String? {
      val cands = mutableListOf<String>()
      extractAddressStringsFromEmbeddedJson(rawHtml, cands)
      for (script in doc.select("script[type=application/ld+json]")) {
        collectAddressesFromLdJsonRoot(script.data(), cands)
      }
      doc.selectFirst("[itemprop=streetAddress]")?.text()?.trim()?.let { cands.add(it) }
      for (el in doc.select("span.LDgIH, span.PIunv, div.PIunv")) {
        val t = el.text().trim()
        if (t.isNotEmpty()) cands.add(t)
      }
      // 주소+지도·내비·거리뷰 링크가 한 `text()`로 붙는 블록
      for (el in doc.select("div.place_section_content span, div.place_section_content div")) {
        val t = el.text().trim()
        if (t.length < 10) continue
        if (!regionPrefixesForAddressLine.any { t.contains(it) }) continue
        cands.add(t)
      }
      val ogDesc = doc.selectFirst("meta[property=og:description]")?.attr("content")?.trim()
      if (!ogDesc.isNullOrBlank()) {
        ogDesc.lines().map { it.trim() }.filter { it.isNotEmpty() }.forEach { cands.add(it) }
      }
      return pickBestKrAddressLine(cands)
    }

    private fun collectAddressesFromLdJsonRoot(jsonStr: String, out: MutableList<String>) {
      val data = jsonStr.trim()
      if (data.isEmpty()) return
      try {
        collectAddressesFromJsonObject(JSONObject(data), 0, out)
        return
      } catch (_: Exception) { }
      try {
        val arr = JSONArray(data)
        for (i in 0 until arr.length()) {
          val o = arr.optJSONObject(i) ?: continue
          collectAddressesFromJsonObject(o, 0, out)
        }
      } catch (_: Exception) { }
    }

    /** 네이버·schema.org 혼재 JSON에서 주소 문자열 후보를 모은다(짧은 동 단위만 있는 값은 나중에 pick에서 탈락). */
    private fun collectAddressesFromJsonObject(node: JSONObject, depth: Int, out: MutableList<String>) {
      if (depth > 18) return
      val directKeys =
        listOf(
          "fullAddress",
          "reprVisitorAddress",
          "reprAddress",
          "newAddress",
          "roadAddress",
          "baseAddress",
          "landAddress",
          "jibunAddress",
          "visitorAddress",
          "displayAddress",
          "formattedAddress",
          "detailAddress",
          "reprGeolocTitle",
          "addressTitle",
          "streetAddress",
        )
      for (k in directKeys) {
        val s = node.optString(k).trim()
        if (s.isNotEmpty()) out.add(s)
      }
      if (node.has("address")) {
        when (val a = node.opt("address")) {
          is String -> {
            val s = a.trim()
            if (s.isNotEmpty()) out.add(s)
          }
          is JSONObject -> {
            for (k in directKeys) {
              val s = a.optString(k).trim()
              if (s.isNotEmpty()) out.add(s)
            }
            collectAddressesFromJsonObject(a, depth + 1, out)
          }
        }
      }
      val keyIter = node.keys()
      while (keyIter.hasNext()) {
        val k = keyIter.next()
        when (val v = node.opt(k)) {
          is JSONObject -> collectAddressesFromJsonObject(v, depth + 1, out)
          is JSONArray -> {
            for (i in 0 until v.length()) {
              val o = v.optJSONObject(i) ?: continue
              collectAddressesFromJsonObject(o, depth + 1, out)
            }
          }
          else -> Unit
        }
      }
    }

    private val addressJsonRegexes =
      listOf(
        Regex(""""fullAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""reprVisitorAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""reprAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""newAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""roadAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""baseAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""landAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""jibunAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""visitorAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""displayAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""formattedAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""detailAddress"\s*:\s*"((?:\\.|[^"\\])*)""""),
        Regex(""""reprGeolocTitle"\s*:\s*"((?:\\.|[^"\\])*)""""),
      )

    private fun extractAddressStringsFromEmbeddedJson(html: String, out: MutableList<String>) {
      for (re in addressJsonRegexes) {
        for (m in re.findAll(html)) {
          val raw = m.groupValues.getOrNull(1) ?: continue
          val decoded = unescapeJsonStringFragment(raw)
          if (decoded.isNotBlank()) out.add(decoded)
        }
      }
    }

    private fun unescapeJsonStringFragment(s: String): String {
      var r = s.replace("\\\"", "\"").replace("\\\\", "\\").replace("\\n", " ")
      r = Regex("""\\u([0-9a-fA-F]{4})""").replace(r) { mv ->
        val cp = mv.groupValues[1].toIntOrNull(16) ?: return@replace mv.value
        if (cp in 32..0x10FFFF) String(Character.toChars(cp)) else mv.value
      }
      return r.trim()
    }

    /** 길이 + 도로명·번지·층호 포함 여부로 가장 지도에 쓰기 좋은 한 줄을 고른다. */
    private fun pickBestKrAddressLine(candidates: Iterable<String>): String? {
      val normalized =
        candidates
          .map { normalizeNaverPlaceAddressUiText(it.replace('\u00a0', ' ')) }
          .filter { it.isNotEmpty() }
          .distinct()
      val valid = normalized.filter { looksLikeKrAddressLine(it) }
      if (valid.isEmpty()) return null
      return valid.maxWithOrNull(
        compareByDescending<String> { it.length }
          .thenByDescending { addressDetailScore(it) },
      )
    }

    private fun addressDetailScore(s: String): Int {
      var sc = 0
      if (Regex("""\d""").containsMatchIn(s)) sc += 40
      if (s.contains("로") || s.contains("길")) sc += 25
      if (s.contains("번길")) sc += 10
      if (s.contains("층") || s.contains("호") || s.contains("지하") || s.contains("B1") || s.contains("B2")) sc += 20
      if (s.contains("우편")) sc -= 15
      return sc
    }

    private fun looksLikeKrAddressLine(s: String): Boolean {
      val t = s.replace('\u00a0', ' ').trim()
      if (t.length < 8 || t.length > 320) return false
      val regions =
        listOf(
          "서울",
          "부산",
          "대구",
          "인천",
          "광주",
          "대전",
          "울산",
          "세종",
          "경기",
          "강원",
          "충북",
          "충남",
          "전북",
          "전남",
          "경북",
          "경남",
          "제주",
        )
      if (!regions.any { t.contains(it) }) return false
      if (!t.any { ch -> ch in "시군구읍면동리로길번층호" }) return false
      return true
    }

    private fun parsePlaceRows(doc: Document, query: String, requestUrl: String): List<Map<String, String?>> {
      val out = mutableListOf<Map<String, String?>>()
      val seenIds = linkedSetOf<String>()

      for (node in doc.select("li.UEzoS")) {
        val row = parseUeZoRow(node) ?: continue
        val idKey = row["placeId"] ?: (row["title"] + "\u0000" + (row["link"] ?: ""))
        if (!seenIds.add(idKey)) continue
        out.add(row.filterKeys { it != "placeId" })
      }

      for (node in doc.select("li.z_rc6[data-nop_res-doc-id]")) {
        val row = parseZRc6Row(node) ?: continue
        val idKey = row["placeId"] ?: (row["title"] + "\u0000" + (row["link"] ?: ""))
        if (!seenIds.add(idKey)) continue
        out.add(row.filterKeys { it != "placeId" })
      }

      if (out.isEmpty()) {
        for (a in doc.select("a.place_bluelink[href]")) {
          val item = a.closest("li") ?: a.parent() ?: continue
          val row = extractLegacyPlaceBluelinkRow(item, a) ?: continue
          val idKey = row["title"] + "\u0000" + (row["link"] ?: "")
          if (!seenIds.add(idKey)) continue
          out.add(row)
        }
      }

      if (BuildConfig.DEBUG) {
        val nUe = doc.select("li.UEzoS").size
        val nZr = doc.select("li.z_rc6[data-nop_res-doc-id]").size
        val nBlue = doc.select("a.place_bluelink[href]").size
        val docTitle = doc.title().orEmpty().take(160)
        val htmlLen = doc.outerHtml().length
        val titlesPreview = out.take(5).mapNotNull { it["title"]?.take(40) }
        Log.d(
          TAG,
          "parsed query=$query out=${out.size} li.UEzoS=$nUe li.z_rc6=$nZr place_bluelink=$nBlue htmlLen=$htmlLen docTitle=$docTitle titles=$titlesPreview",
        )
        if (out.isEmpty()) {
          Log.w(
            TAG,
            "결과 0건 — DOM 변경·차단·로딩 전용 페이지 가능. url=$requestUrl htmlLen=$htmlLen (logcat 필터: adb logcat -s $TAG:D)",
          )
        }
      }

      return out
    }

    /** `li.UEzoS` — 통합검색 플레이스 카드 (광고·자연결과 혼재). */
    private fun parseUeZoRow(node: Element): Map<String, String?>? {
      val title = node.selectFirst("span.TYaxT")?.let { cleanText(it) }?.takeIf { it.isNotEmpty() } ?: return null
      val category = node.selectFirst("span.KCMnt")?.let { cleanText(it) } ?: ""
      val placeId = extractNmbPlaceId(node)
      var link = resolvePlaceListLink(node)
      if (link == null && placeId != null) {
        link = "https://m.place.naver.com/restaurant/$placeId?entry=pll"
      }
      val address = guessAddressFromUeZo(node, title)
      val thumb = firstImageUrlInRow(node)
      return buildRowMap(title, category, address, link, placeId, thumb)
    }

    /** `li.z_rc6` — 섹션 보조 목록(예: 새로 오픈). */
    private fun parseZRc6Row(node: Element): Map<String, String?>? {
      val title = node.selectFirst("div.LGJdP span")?.let { cleanText(it) }?.takeIf { it.isNotEmpty() } ?: return null
      val nk = node.select("div.qI_q5 span.NOJeK")
      val category = nk.getOrNull(0)?.let { cleanText(it) } ?: ""
      val address = nk.getOrNull(1)?.let { cleanText(it) } ?: ""
      val placeId = node.attr("data-nop_res-doc-id").trim().takeIf { it.isNotEmpty() }
      val link =
        node.selectFirst("a.rrLpu[href*='m.place.naver.com']")?.absUrl("href")
          ?: placeId?.let { "https://m.place.naver.com/restaurant/$it?entry=pll" }
      val thumb = firstImageUrlInRow(node)
      return buildRowMap(title, category, address, link, placeId, thumb)
    }

    private fun buildRowMap(
      title: String,
      category: String,
      address: String,
      link: String?,
      placeId: String?,
      thumbnailUrl: String? = null,
    ): Map<String, String?> {
      val m = mutableMapOf<String, String?>("title" to title)
      if (category.isNotEmpty()) m["category"] = category
      if (address.isNotEmpty()) m["address"] = address
      if (link != null) m["link"] = link
      if (placeId != null) m["placeId"] = placeId
      if (!thumbnailUrl.isNullOrBlank()) m["thumbnailUrl"] = thumbnailUrl
      return m
    }

    /**
     * 목록 행(`li` 블록) 안에서 첫 번째 사진 URL.
     * 네이버 모바일 검색은 `data-src` 지연 로딩과 `src` 혼용.
     */
    private fun firstImageUrlInRow(container: Element): String? {
      val attrPriority = listOf("data-src", "data-lazy-src", "data-original", "src")
      for (img in container.select("img")) {
        for (attr in attrPriority) {
          val raw = img.attr(attr).trim()
          if (raw.isEmpty() || raw.startsWith("data:")) continue
          val abs = img.absUrl(attr).trim()
          if (abs.isEmpty() || !abs.startsWith("http")) continue
          if (shouldSkipListImageUrl(abs)) continue
          return abs
        }
      }
      return null
    }

    private fun shouldSkipListImageUrl(url: String): Boolean {
      val u = url.lowercase()
      if (u.contains("favicon")) return true
      if (u.endsWith(".svg")) return true
      if (u.contains("static.map.naver.net")) return true
      /** 통합검색 광고 카드의 `searchad-phinf` 배너 — 업체 대표 사진이 아님 */
      if (u.contains("searchad-phinf.pstatic.net")) return true
      return false
    }

    private fun extractNmbPlaceId(node: Element): String? {
      val res = node.attr("data-nmb_res-doc-id").trim()
      if (res.isNotEmpty()) return res
      val rese = node.attr("data-nmb_rese-doc-id").trim()
      if (rese.isNotEmpty()) {
        val head = rese.substringBefore("_")
        return head.takeIf { it.all { ch -> ch.isDigit() } }
      }
      return null
    }

    private fun resolvePlaceListLink(node: Element): String? {
      val direct = node.selectFirst("div.SgjqM a[href*='m.place.naver.com']")?.absUrl("href")
      if (direct != null && direct.startsWith("http")) return direct
      val ader = node.selectFirst("div.SgjqM a[href*='ader.naver.com']")?.absUrl("href")
      if (ader != null) {
        val decoded = extractFuParamFromAder(ader)
        if (decoded != null && decoded.contains("m.place.naver.com")) return decoded
      }
      return null
    }

    private fun extractFuParamFromAder(url: String): String? {
      val q = url.substringAfter('?', "")
      for (part in q.split('&')) {
        if (part.startsWith("fu=")) {
          val enc = part.removePrefix("fu=")
          return URLDecoder.decode(enc, StandardCharsets.UTF_8.name())
        }
      }
      return null
    }

    /** 통합검색 카드(`li.UEzoS`) 안에서 행정·도로주소 후보를 모아 가장 그럴듯한 한 줄을 고른다. */
    private fun guessAddressFromUeZo(node: Element, title: String): String {
      val titleT = title.trim()
      val cands = linkedSetOf<String>()
      for (sel in listOf("span.h69bs", "span.Uv4Eo", "span.vV_z_", "span.ZUdf_", "span.lWwy_", "a.JtuZ6", "span.JhQh")) {
        node.select(sel).forEach {
          val t = cleanText(it)
          if (t.length in 6..160) cands.add(t)
        }
      }
      for (el in node.select("span")) {
        if (el.hasClass("TYaxT") || el.hasClass("KCMnt")) continue
        val t = cleanText(el)
        if (t.length !in 8..160) continue
        if (looksLikeListAddressSnippet(t)) cands.add(t)
      }
      return pickBestListAddressCandidate(cands, titleT)
    }

    private fun looksLikeListAddressSnippet(s: String): Boolean {
      val t = s.replace('\u00a0', ' ').trim()
      if (t.length < 8) return false
      val regions =
        listOf(
          "서울",
          "부산",
          "대구",
          "인천",
          "광주",
          "대전",
          "울산",
          "세종",
          "경기",
          "강원",
          "충북",
          "충남",
          "전북",
          "전남",
          "경북",
          "경남",
          "제주",
          "충청",
          "전라",
          "경상",
        )
      if (!regions.any { t.contains(it) }) return false
      if (t.startsWith("영업") || t.startsWith("리뷰")) return false
      if (t.contains("⭐")) return false
      if (Regex("""\d+\s*km""", RegexOption.IGNORE_CASE).containsMatchIn(t)) return false
      return t.any { ch -> ch in "구동읍면리로길번층호시군0123456789" }
    }

    private fun listAddressDetailScore(s: String): Int {
      var sc = 0
      if (Regex("""\d""").containsMatchIn(s)) sc += 35
      if (s.contains("로") || s.contains("길")) sc += 30
      if (s.contains("구") && s.contains("동")) sc += 15
      if (s.contains("층") || s.contains("호") || s.contains("지하")) sc += 12
      return sc
    }

    private fun pickBestListAddressCandidate(cands: Collection<String>, title: String): String {
      val titleT = title.trim()
      val cleaned =
        cands
          .map { it.replace('\u00a0', ' ').trim() }
          .filter { it.isNotEmpty() && it != titleT && !titleT.equals(it, ignoreCase = true) }
          .filter { !it.startsWith("영업") && !it.startsWith("리뷰") }
          .filter { looksLikeListAddressSnippet(it) }
          .distinct()
      if (cleaned.isEmpty()) return ""
      return cleaned.maxWithOrNull(
        compareByDescending<String> { it.length }
          .thenByDescending { listAddressDetailScore(it) },
      ) ?: ""
    }

    private fun extractLegacyPlaceBluelinkRow(block: Element, titleLink: Element): Map<String, String?>? {
      val title = cleanText(titleLink).ifEmpty { return null }
      val link = titleLink.absUrl("href").takeIf { it.startsWith("http") }
      val category =
        block.selectFirst("span.category, .b8l__")?.let { cleanText(it) } ?: ""
      val address =
        block.selectFirst("span.addr, .addr, .LDgIH")?.let { cleanText(it) } ?: ""
      val thumb = firstImageUrlInRow(block)
      val m = mutableMapOf<String, String?>(
        "title" to title,
        "category" to category.ifEmpty { null },
        "address" to address.ifEmpty { null },
        "link" to link,
      )
      if (!thumb.isNullOrBlank()) m["thumbnailUrl"] = thumb
      return m
    }

    private fun cleanText(el: Element): String {
      return el.text().replace('\u00a0', ' ').trim()
    }
  }
}
