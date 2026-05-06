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
     * 네이버 지도 모바일 검색(`m.map.naver.com/search?query=...`) 기반 스크래핑.
     * - 일반 업체/시설(스크린골프/헬스장/학원 등)에서 통합검색(m.search)보다 결과 풀을 더 안정적으로 확보하는 용도.
     * - 반환 스키마는 `searchMobilePlaces`와 동일(`title/category/address/link/thumbnailUrl/placeId`).
     */
    AsyncFunction("searchMobileMapPlaces") { query: String ->
      val q = query.trim()
      if (q.isEmpty()) {
        return@AsyncFunction emptyList<Map<String, String?>>()
      }
      val encoded = URLEncoder.encode(q, StandardCharsets.UTF_8.toString())
      val url = "https://m.map.naver.com/search?query=$encoded"

      val doc =
        try {
          Jsoup.connect(url)
            .userAgent(NAVER_SCRAPE_UA)
            .timeout(7000)
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
            .get()
        } catch (e: Exception) {
          if (BuildConfig.DEBUG) {
            Log.e(TAG, "지도 Jsoup 실패 query=$q url=$url err=${e.javaClass.simpleName}: ${e.message}", e)
          }
          throw CodedException(
            "NAVER_MOBILE_MAP_SCRAPE_FAILED",
            e.message ?: "네이버 지도 모바일 검색 요청에 실패했습니다.",
            e,
          )
        }

      parseMapSearchRows(doc, q, url)
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
      out.putAll(extractPlaceDetailAddresses(doc, html).filterValues { !it.isNullOrBlank() })
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

    private fun extractPlaceDetailAddresses(doc: Document, rawHtml: String): Map<String, String?> {
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
      val road = pickBestKrRoadAddressLine(cands)
      val jibun = pickBestKrJibunAddressLine(cands)
      // address=지번, roadAddress=도로명 (둘 다 없으면 빈 맵)
      val out = mutableMapOf<String, String?>()
      if (!jibun.isNullOrBlank()) out["address"] = jibun
      if (!road.isNullOrBlank()) out["roadAddress"] = road
      // 지번만/도로명만 있는 케이스에서 기존 로직(한 줄 주소)과 호환: 최소 한 쪽은 채운다
      if (out.isEmpty()) {
        val any = pickBestKrAddressLine(cands)
        if (!any.isNullOrBlank()) {
          out["address"] = any
          out["roadAddress"] = any
        }
      }
      return out
    }

    private fun pickBestKrRoadAddressLine(candidates: Iterable<String>): String? {
      val normalized =
        candidates
          .map { normalizeNaverPlaceAddressUiText(it.replace('\u00a0', ' ')) }
          .filter { it.isNotEmpty() }
          .distinct()
      val valid = normalized.filter { looksLikeKrAddressLine(it) }
      val road = valid.filter { it.contains("로") || it.contains("길") }
      if (road.isEmpty()) return null
      return road.maxWithOrNull(
        compareByDescending<String> { it.length }
          .thenByDescending { addressDetailScore(it) },
      )
    }

    private fun pickBestKrJibunAddressLine(candidates: Iterable<String>): String? {
      val normalized =
        candidates
          .map { normalizeNaverPlaceAddressUiText(it.replace('\u00a0', ' ')) }
          .filter { it.isNotEmpty() }
          .distinct()
      val valid = normalized.filter { looksLikeKrAddressLine(it) }
      // 지번은 보통 "…동 123-4"처럼 로/길이 없고 숫자 포함
      val jibun =
        valid.filter {
          Regex("""\d""").containsMatchIn(it) &&
            !(it.contains("로") || it.contains("길")) &&
            (it.contains("동") || it.contains("리") || it.contains("가") || it.contains("읍") || it.contains("면"))
        }
      if (jibun.isEmpty()) return null
      return jibun.maxWithOrNull(
        compareByDescending<String> { it.length }
          .thenByDescending { addressDetailScore(it) },
      )
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
        out.add(row)
      }

      for (node in doc.select("li.z_rc6[data-nop_res-doc-id]")) {
        val row = parseZRc6Row(node) ?: continue
        val idKey = row["placeId"] ?: (row["title"] + "\u0000" + (row["link"] ?: ""))
        if (!seenIds.add(idKey)) continue
        out.add(row)
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

      // 일반 업종/시설 검색(예: 스크린골프/헬스장 등)은 플레이스 블록 DOM이 달라지는 케이스가 있어
      // `m.place.naver.com/...` 링크를 중심으로 추가 후보를 수집합니다.
      // - out이 적당히 잡혔더라도(예: 5개) 화면에는 20개+가 보이는 케이스가 있어,
      //   일정 임계치 미만이면 `#place-main-section-root`를 기준으로 추가 수집합니다.
      if (out.size < 20) {
        val anchorScope =
          doc.selectFirst("#place-main-section-root") ?: doc.body()
        val anchors =
          (anchorScope ?: doc).select("a[href*='m.place.naver.com/'][href]")
        for (a in anchors) {
          val row = extractGenericMobilePlaceLinkRow(a) ?: continue
          val idKey = row["title"] + "\u0000" + (row["link"] ?: "")
          if (!seenIds.add(idKey)) continue
          out.add(row)
          // 화면에 20개+가 노출되는 쿼리는 앵커가 충분히 많아 여기서 풀을 넓혀야 합니다.
          if (out.size >= 40) break
        }
      }

      // 일부 쿼리(스터디카페/헬스장 등)는 통합검색 HTML에 5~6개만 있고,
      // "목록(list)" 페이지로 들어가야 20개+가 노출됩니다.
      // 통합검색에 노출된 list URL을 1~2개 따라가서 상세 링크를 추가로 수집합니다.
      if (out.size < 20) {
        val listUrlsFromAnchors =
          doc.select("a[href][href*='m.place.naver.com/']")
            .mapNotNull {
              it.absUrl("href").trim().takeIf { u ->
                u.startsWith("http") &&
                  (u.contains("/list?") || u.contains("/list/") || u.contains("/attraction/list") || u.contains("/restaurant/list"))
              }
            }
            .distinct()
        val html = try { doc.outerHtml() } catch (_: Exception) { "" }
        val listUrlsFromHtml =
          if (html.isBlank()) {
            emptyList()
          } else {
            Regex("""https?://m\.place\.naver\.com/[^"'\s<>]+/(?:list\?|attraction/list\?|restaurant/list\?)[^"'\s<>]+""")
              .findAll(html)
              .map { it.value.trim() }
              .filter { it.startsWith("http") }
              .distinct()
              .toList()
          }
        val listUrls =
          (listUrlsFromAnchors + listUrlsFromHtml)
            .distinct()
            .take(2)
        for (u in listUrls) {
          try {
            val listDoc = newNaverMobileJsoupConnection(u).timeout(6000).get()
            val scope =
              listDoc.selectFirst("#_list_scroll_container")
                ?: listDoc.selectFirst("#place-main-section-root")
                ?: listDoc.body()
            val anchors =
              (scope ?: listDoc).select("a[href][href*='m.place.naver.com/']")
            for (a in anchors) {
              val row = extractGenericMobilePlaceLinkRow(a) ?: continue
              val idKey = row["title"] + "\u0000" + (row["link"] ?: "")
              if (!seenIds.add(idKey)) continue
              out.add(row)
              if (out.size >= 40) break
            }
          } catch (_: Exception) {
            // list 폴백 실패 시 무시하고 기존 out 유지
          }
          if (out.size >= 40) break
        }
      }

      if (BuildConfig.DEBUG) {
        val nUe = doc.select("li.UEzoS").size
        val nZr = doc.select("li.z_rc6[data-nop_res-doc-id]").size
        val nBlue = doc.select("a.place_bluelink[href]").size
        val nPlaceHref = doc.select("a[href*='m.place.naver.com/'][href]").size
        val docTitle = doc.title().orEmpty().take(160)
        val htmlLen = doc.outerHtml().length
        val titlesPreview = out.take(5).mapNotNull { it["title"]?.take(40) }
        Log.d(
          TAG,
          "parsed query=$query out=${out.size} li.UEzoS=$nUe li.z_rc6=$nZr place_bluelink=$nBlue place_href=$nPlaceHref htmlLen=$htmlLen docTitle=$docTitle titles=$titlesPreview",
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

    /**
     * 네이버 지도 모바일 검색 HTML에서 업체 리스트를 최대한 보수적으로 파싱합니다.
     * - 우선 `m.place.naver.com` 직링크가 있으면 그대로 사용
     * - 지도 내부 링크(`m.map.naver.com/.../place/<id>` 또는 `.../entry/place/<id>`)는 place 숫자 ID만 뽑아
     *   `https://m.place.naver.com/place/<id>`로 정규화하여 반환
     */
    private fun parseMapSearchRows(doc: Document, query: String, requestUrl: String): List<Map<String, String?>> {
      val html = try { doc.outerHtml() } catch (_: Exception) { "" }
      val loginHint = html.isNotBlank() && html.contains("로그인이 필요합니다")
      val out = mutableListOf<Map<String, String?>>()
      val seenIds = linkedSetOf<String>()

      // 1) place host 직접 링크 우선
      for (a in doc.select("a[href*='m.place.naver.com/'][href]")) {
        val row = extractGenericMobilePlaceLinkRow(a) ?: continue
        val idKey = row["placeId"] ?: (row["title"] + "\u0000" + (row["link"] ?: ""))
        if (!seenIds.add(idKey)) continue
        out.add(row)
        if (out.size >= 40) break
      }

      // 2) map host 링크에서 placeId 추출(지도 UI는 내부 라우팅 URL이 많음)
      if (out.size < 20) {
        for (a in doc.select("a[href][href*='m.map.naver.com']")) {
          val row = extractMapHostPlaceLinkRow(a) ?: continue
          val idKey = row["placeId"] ?: (row["title"] + "\u0000" + (row["link"] ?: ""))
          if (!seenIds.add(idKey)) continue
          out.add(row)
          if (out.size >= 40) break
        }
      }

      if (BuildConfig.DEBUG) {
        val nAPlace = doc.select("a[href*='m.place.naver.com/'][href]").size
        val nAMap = doc.select("a[href][href*='m.map.naver.com']").size
        val docTitle = doc.title().orEmpty().take(160)
        val htmlLen = doc.outerHtml().length
        val titlesPreview = out.take(5).mapNotNull { it["title"]?.take(40) }
        Log.d(
          TAG,
          "map_parsed query=$query out=${out.size} a_place=$nAPlace a_map=$nAMap htmlLen=$htmlLen docTitle=$docTitle titles=$titlesPreview",
        )
        if (loginHint) {
          Log.w(TAG, "지도 HTML에 로그인 문구가 포함되어 있습니다(헤더/메뉴 오탐 가능). query=$query url=$requestUrl")
        }
        if (out.isEmpty()) {
          Log.w(TAG, "지도 결과 0건 — DOM 변경·로그인 요구·차단 가능. url=$requestUrl htmlLen=$htmlLen")
        }
      }

      // 헤더/메뉴에 로그인 문구가 들어가는 경우가 있어, 결과가 정말 0건일 때만 로그인 게이트로 취급합니다.
      if (out.isEmpty() && loginHint) {
        if (BuildConfig.DEBUG) {
          Log.w(TAG, "지도 검색이 로그인 요구 페이지로 보입니다(결과 0건). query=$query url=$requestUrl")
        }
        return emptyList()
      }

      return out
    }

    private fun isMapActionLikeText(t: String): Boolean {
      val s = t.trim()
      if (s.isEmpty()) return true
      // 지도 결과 행 안의 액션 버튼/라벨(업체명이 아님)
      return s == "주소보기" ||
        s == "공유" ||
        s == "지도" ||
        s == "길찾기" ||
        s == "전화" ||
        s == "가격" ||
        s == "예약" ||
        s == "앱 열기" ||
        s == "앱 열기메뉴" ||
        s == "메뉴" ||
        s == "검색결과"
    }

    private fun looksLikeCategoryLabel(t: String): Boolean {
      val s = t.trim()
      if (s.length !in 2..24) return false
      if (isMapActionLikeText(s)) return false
      if (Regex("""\d""").containsMatchIn(s)) return false
      // 주소처럼 보이면 제외
      if (regionPrefixesForAddressLine.any { s.contains(it) }) return false
      if (looksLikeKrAddressLine(s)) return false
      // 너무 일반 상태/메타는 제외
      if (isStatusLikeTitle(s)) return false
      return true
    }

    private fun extractMapHostPlaceIdFromUrl(urlString: String): String? {
      val s = urlString.trim()
      if (s.isEmpty()) return null
      // 흔한 패턴: /p/entry/place/<id> , /place/<id>
      val m1 = Regex("""/entry/place/(\d{4,})\b""").find(s)
      if (m1?.groupValues?.getOrNull(1)?.isNotBlank() == true) return m1.groupValues[1]
      val m2 = Regex("""/place/(\d{4,})\b""").find(s)
      if (m2?.groupValues?.getOrNull(1)?.isNotBlank() == true) return m2.groupValues[1]
      // 쿼리 파라미터 pinId/businessId 등으로 붙는 경우도 있으니 전체에서 숫자 ID를 보수적으로 탐색
      val m3 = Regex("""(?:pinId|businessId|placeId|code)=(\d{4,})\b""").find(s)
      if (m3?.groupValues?.getOrNull(1)?.isNotBlank() == true) return m3.groupValues[1]
      return null
    }

    private fun extractMapHostPlaceLinkRow(a: Element): Map<String, String?>? {
      val hrefAbs = a.absUrl("href").trim().takeIf { it.startsWith("http") } ?: return null
      if (!hrefAbs.contains("m.map.naver.com")) return null
      val placeId = extractMapHostPlaceIdFromUrl(hrefAbs) ?: return null
      val block = a.closest("li") ?: a.closest("div") ?: a.parent() ?: return null

      var title = cleanText(a).ifEmpty { a.attr("aria-label").trim() }
      if (title.isEmpty()) {
        title = block.selectFirst("strong, b, span")?.let { cleanText(it) }?.trim().orEmpty()
      }
      title = title.trim()
      if (title.length !in 2..80) return null
      if (isMapActionLikeText(title)) return null
      if (isStatusLikeTitle(title)) return null

      // 카테고리는 짧고 주소/액션이 아닌 라벨만 후보로
      val category =
        block.select("span, em, i")
          .map { cleanText(it).trim() }
          .firstOrNull { looksLikeCategoryLabel(it) }
          .orEmpty()

      val address = pickBestListAddressCandidate(
        linkedSetOf<String>().also { set ->
          for (el in block.select("span, div")) {
            val t = cleanText(el)
            // m.map 행에서는 주소 줄에 액션 라벨(공유/가격 등)이 같이 붙어 후보 필터가 탈락할 수 있어
            // 먼저 블록 텍스트에서 주소 부분만 잘라 후보로 넣습니다.
            val addr = extractKrAddressFromBlockText(t)
            if (addr.isNotEmpty()) {
              set.add(addr)
              continue
            }
            if (t.length in 8..240 && looksLikeListAddressSnippet(t)) set.add(t)
          }
        },
        title,
      )
      val address2 =
        if (address.isNotEmpty()) {
          address
        } else {
          extractKrAddressFromBlockText(cleanText(block))
        }
      val thumb = firstImageUrlInRow(block)

      val out = mutableMapOf<String, String?>(
        "title" to title,
        "link" to "https://m.place.naver.com/place/$placeId",
        "placeId" to placeId,
      )
      if (category.isNotEmpty() && category.length <= 40 && !isStatusLikeTitle(category)) out["category"] = category
      if (address2.isNotEmpty()) out["address"] = address2
      if (!thumb.isNullOrBlank()) out["thumbnailUrl"] = thumb
      return out
    }

    /**
     * 지도(m.map) 결과 블록 전체 텍스트에서 주소를 폴백 추출합니다.
     * - "주소보기" 라벨 뒤에 바로 주소가 붙는 케이스가 많아, 가장 이른 지역 접두부터 잡고 액션 라벨 앞에서 자릅니다.
     */
    private fun extractKrAddressFromBlockText(rawText: String): String {
      var t = rawText.replace('\u00a0', ' ').trim()
      if (t.isEmpty()) return ""
      t = t.replace("주소보기", " ").replace(Regex("""\s+"""), " ").trim()
      var best = -1
      for (p in regionPrefixesForAddressLine) {
        val i = t.indexOf(p)
        if (i >= 0 && (best < 0 || i < best)) best = i
      }
      if (best < 0) return ""
      var tail = t.substring(best).trim()
      // 액션 라벨(공유/지도/길찾기/전화/예약/가격 등) 앞에서 잘라 주소만 남김
      for (cut in listOf("공유", "지도", "길찾기", "전화", "예약", "가격", "메뉴", "앱 열기", "로그인")) {
        val i = tail.indexOf(cut)
        if (i > 0) {
          tail = tail.substring(0, i).trimEnd()
        }
      }
      // 너무 길면 마지막 방어(주소는 보통 10~80자)
      if (tail.length > 160) tail = tail.substring(0, 160).trimEnd()
      return tail.takeIf { looksLikeListAddressSnippet(it) } ?: ""
    }

    /**
     * 일반 업체/시설 결과 레이아웃용 폴백 파서.
     * - `m.place.naver.com/...` 링크를 기준으로, 가장 가까운 블록에서 제목/카테고리/주소/썸네일을 추출합니다.
     */
    private fun extractGenericMobilePlaceLinkRow(a: Element): Map<String, String?>? {
      val href = a.absUrl("href").trim().takeIf { it.startsWith("http") } ?: return null
      // 쿼리 링크/공유 링크 등 비-상세 링크는 제외
      if (!href.contains("m.place.naver.com")) return null
      // 내 페이지/리뷰/홈/목록(list)/필터 전용 링크(운영중/예약 등)는 업체 후보가 아니므로 제외
      if (href.contains("/home?") || href.contains("/my?") || href.contains("/my/") || href.contains("/review/")) return null
      if (href.contains("/list?") || href.contains("/list/")) return null
      // 메뉴/가격/예약 탭 등은 업체 행이 아니라 액션/탭 링크로 섞여 들어오므로 제외
      if (href.contains("/menu/") || href.contains("/booking/") || href.contains("/tickets/")) return null
      // 통합검색 "필터/정렬" 칩이 업체로 오탐되는 케이스 방지
      if (href.contains("filterOpentime") || href.contains("filterBooking") || href.contains("filterCoupon") || href.contains("filterWheelchair")) return null

      // 상세 페이지 형태만 허용:
      // - /{type}/{id} (예: /restaurant/123..., /attraction/123...)
      // - /place/{id} 또는 /place/{id}/home 등 (지도 검색에서 흔함)
      val typedDetailRe = Regex("""https?://m\.place\.naver\.com/([a-zA-Z_-]+)/(\d+)(?:[/?].*)?$""")
      val placeDetailRe = Regex("""https?://m\.place\.naver\.com/place/(\d+)(?:[/?].*)?$""")
      if (!typedDetailRe.containsMatchIn(href) && !placeDetailRe.containsMatchIn(href)) return null

      val block = a.closest("li") ?: a.closest("div") ?: a.parent() ?: return null

      // 제목 후보: 링크 내 텍스트가 비면 aria-label, 혹은 블록 내 첫 strong/span
      var title = cleanText(a).ifEmpty { a.attr("aria-label").trim() }
      if (title.isEmpty()) {
        title =
          block.selectFirst("strong, b, span")?.let { cleanText(it) }?.trim().orEmpty()
      }
      title = title.trim()
      if (title.length !in 2..80) return null
      // 필터/탭 라벨 오탐 방지
      if (title == "MY" || title == "운영중" || title == "예약") return null
      if (isStatusLikeTitle(title)) return null

      // 카테고리 후보: 블록 내 짧은 라벨
      val category =
        block.selectFirst("span.KCMnt, span.NOJeK, span.category, em, i")?.let { cleanText(it) }?.trim().orEmpty()

      // 주소 후보: 기존 휴리스틱 재사용(블록 전체 span 훑기)
      val address = pickBestListAddressCandidate(
        linkedSetOf<String>().also { set ->
          for (el in block.select("span")) {
            val t = cleanText(el)
            if (t.length in 8..160 && looksLikeListAddressSnippet(t)) set.add(t)
          }
        },
        title,
      )
      val address2 =
        if (address.isNotEmpty()) {
          address
        } else {
          // m.map 결과는 주소 줄에 액션 라벨이 붙거나 span이 잘게 쪼개지지 않는 케이스가 있어 블록 텍스트 폴백
          extractKrAddressFromBlockText(cleanText(block))
        }

      val thumb = firstImageUrlInRow(block)
      val out = mutableMapOf<String, String?>(
        "title" to title,
        "link" to href,
      )
      // placeId가 링크에서 바로 잡히면 함께 내려 중복 제거(key) 안정화
      val pid = placeDetailRe.find(href)?.groupValues?.getOrNull(1)?.trim().orEmpty()
      if (pid.isNotEmpty()) out["placeId"] = pid
      if (category.isNotEmpty()) out["category"] = category
      if (address2.isNotEmpty()) out["address"] = address2
      if (!thumb.isNullOrBlank()) out["thumbnailUrl"] = thumb
      return out
    }

    /** `li.UEzoS` — 통합검색 플레이스 카드 (광고·자연결과 혼재). */
    private fun parseUeZoRow(node: Element): Map<String, String?>? {
      val rawTitle = node.selectFirst("span.TYaxT")?.let { cleanText(it) }?.takeIf { it.isNotEmpty() } ?: return null
      if (isStatusLikeTitle(rawTitle)) return null
      val (title, gluedCat) = splitGluedTitleCategory(rawTitle)
      var category = node.selectFirst("span.KCMnt")?.let { cleanText(it) } ?: ""
      if (category.isEmpty() && !gluedCat.isNullOrBlank()) category = gluedCat
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
      val rawTitle = node.selectFirst("div.LGJdP span")?.let { cleanText(it) }?.takeIf { it.isNotEmpty() } ?: return null
      if (isStatusLikeTitle(rawTitle)) return null
      val (title, gluedCat) = splitGluedTitleCategory(rawTitle)
      val nk = node.select("div.qI_q5 span.NOJeK")
      var category = nk.getOrNull(0)?.let { cleanText(it) } ?: ""
      if (category.isEmpty() && !gluedCat.isNullOrBlank()) category = gluedCat
      val address = nk.getOrNull(1)?.let { cleanText(it) } ?: ""
      val placeId = node.attr("data-nop_res-doc-id").trim().takeIf { it.isNotEmpty() }
      val link =
        node.selectFirst("a.rrLpu[href*='m.place.naver.com']")?.absUrl("href")
          ?: placeId?.let { "https://m.place.naver.com/restaurant/$it?entry=pll" }
      val thumb = firstImageUrlInRow(node)
      return buildRowMap(title, category, address, link, placeId, thumb)
    }

    /**
     * 스크린샷처럼 상호명 오른쪽에 업종 라벨(예: "스크린골프장")이 붙어 표시되는데,
     * DOM 변화로 인해 텍스트가 붙여쓰기 형태로 들어오는 케이스가 있어 분리합니다.
     */
    private fun splitGluedTitleCategory(rawTitle: String): Pair<String, String?> {
      val t = rawTitle.replace('\u00a0', ' ').trim()
      if (t.isEmpty()) return Pair(t, null)
      val suffixes =
        listOf(
          "스크린골프장",
          "스크린골프",
          "헬스장",
          "피트니스",
          "요가",
          "필라테스",
          "골프연습장",
          "골프 연습장",
          "볼링장",
          "당구장",
          "노래방",
          "영화관",
          "공원",
        )
      for (suf in suffixes) {
        if (t.length > suf.length + 1 && t.endsWith(suf)) {
          val base = t.dropLast(suf.length).trimEnd()
          if (base.isNotEmpty()) return Pair(base, suf)
        }
        // 공백으로 분리된 형태
        val spaced = " $suf"
        if (t.length > spaced.length + 1 && t.endsWith(spaced)) {
          val base = t.dropLast(spaced.length).trimEnd()
          if (base.isNotEmpty()) return Pair(base, suf)
        }
      }
      return Pair(t, null)
    }

    private fun isStatusLikeTitle(title: String): Boolean {
      val t = title.replace('\u00a0', ' ').trim()
      if (t.isEmpty()) return true
      // 통합검색 카드에서 "리뷰 167..." 같은 보조 텍스트가 제목으로 오탐되는 케이스 방지
      if (t.startsWith("리뷰")) return true
      // "이미지수38" 같은 사진 카운트 라벨 오탐 방지
      if (t.startsWith("이미지수")) return true
      if (Regex("""^이미지\s*수?\s*\d+""").containsMatchIn(t)) return true
      // 운영 상태 라벨(업체명이 아님)
      if (t.startsWith("24시간")) return true
      if (t.contains("연중무휴")) return true
      if (t.startsWith("영업")) return true
      if (t.contains("영업 종료")) return true
      if (t.contains("영업중")) return true
      return false
    }

    private fun buildRowMap(
      title: String,
      category: String,
      address: String,
      link: String?,
      placeId: String?,
      thumbnailUrl: String? = null,
    ): Map<String, String?> {
      val normalizedLink = normalizePlaceDetailLink(link)
      val derivedId = placeId ?: extractPlaceIdFromLink(normalizedLink)
      val m = mutableMapOf<String, String?>("title" to title)
      if (category.isNotEmpty()) m["category"] = category
      if (address.isNotEmpty()) m["address"] = address
      if (normalizedLink != null) m["link"] = normalizedLink
      if (derivedId != null) m["placeId"] = derivedId
      if (!thumbnailUrl.isNullOrBlank()) m["thumbnailUrl"] = thumbnailUrl
      return m
    }

    private fun extractPlaceIdFromLink(link: String?): String? {
      val u = link?.trim().orEmpty()
      if (u.isEmpty()) return null
      val m = Regex("""/place/(\d+)""").find(u) ?: return null
      val id = m.groupValues.getOrNull(1)?.trim().orEmpty()
      return id.takeIf { it.isNotEmpty() }
    }

    private fun normalizePlaceDetailLink(link: String?): String? {
      val u0 = link?.trim().orEmpty()
      if (u0.isEmpty()) return null
      val m = Regex("""(https?://m\.place\.naver\.com/place/\d+)""").find(u0)
      if (m != null) {
        return m.groupValues[1]
      }
      return u0
    }

    /**
     * 목록 행(`li` 블록) 안에서 첫 번째 사진 URL.
     * 네이버 모바일 검색은 `data-src` 지연 로딩과 `src` 혼용.
     */
    private fun firstImageUrlInRow(container: Element): String? {
      // m.map 결과는 img src가 비어 있고 srcset(data-srcset)로만 내려오는 케이스가 있어 함께 파싱합니다.
      val attrPriority =
        listOf(
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-srcset",
          "data-lazy-srcset",
          "srcset",
          "src",
        )
      for (img in container.select("img")) {
        for (attr in attrPriority) {
          val raw = img.attr(attr).trim()
          if (raw.isEmpty() || raw.startsWith("data:")) continue
          val fromSet = if (attr.endsWith("srcset", ignoreCase = true)) extractFirstUrlFromSrcset(raw) else null
          val picked = (fromSet ?: raw).trim()
          if (picked.isEmpty() || picked.startsWith("data:")) continue
          val abs = img.absUrl(attr).trim().ifEmpty { picked }
          val normalized = normalizeMaybeProtocolRelativeImageUrl(abs)
          if (normalized.isEmpty() || !normalized.startsWith("http")) continue
          if (shouldSkipListImageUrl(normalized)) continue
          return normalized
        }
      }
      // m.map 결과는 썸네일이 img가 아니라 background-image로 내려오는 경우가 있어 폴백으로 파싱합니다.
      for (el in container.select("[style*='background']")) {
        val style = el.attr("style").orEmpty()
        val url = extractBackgroundImageUrl(style) ?: continue
        if (!url.startsWith("http")) continue
        if (shouldSkipListImageUrl(url)) continue
        return url
      }
      return null
    }

    private fun normalizeMaybeProtocolRelativeImageUrl(url: String): String {
      var u = url.trim()
      if (u.isEmpty()) return ""
      u = u.trim('\"', '\'')
      if (u.startsWith("//")) u = "https:$u"
      if (u.startsWith("http://")) u = "https://" + u.removePrefix("http://")
      return u.trim()
    }

    private fun extractFirstUrlFromSrcset(srcsetRaw: String): String? {
      val s = srcsetRaw.trim()
      if (s.isEmpty()) return null
      // "url1 1x, url2 2x" 형태에서 첫 URL만 사용
      val first = s.split(',').firstOrNull()?.trim().orEmpty()
      if (first.isEmpty()) return null
      val url = first.split(Regex("""\s+""")).firstOrNull()?.trim().orEmpty()
      return url.takeIf { it.isNotEmpty() }
    }

    private fun extractBackgroundImageUrl(style: String): String? {
      val s = style.trim()
      if (s.isEmpty()) return null
      val m = Regex("""background-image\s*:\s*url\(([^)]+)\)""", RegexOption.IGNORE_CASE).find(s)
        ?: Regex("""url\(([^)]+)\)""", RegexOption.IGNORE_CASE).find(s)
      if (m == null) return null
      var u = m.groupValues.getOrNull(1)?.trim().orEmpty()
      u = u.trim('\"', '\'')
      if (u.startsWith("//")) u = "https:$u"
      if (u.startsWith("http://")) u = "https://" + u.removePrefix("http://")
      return u.trim()
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
      // 지도(m.map)에서는 "주소보기" 라벨이 주소 앞에 붙어 내려오는 경우가 많아 제거합니다.
      val t = s.replace('\u00a0', ' ').replace("주소보기", "").trim()
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
          .map { it.replace('\u00a0', ' ').replace("주소보기", "").trim() }
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
