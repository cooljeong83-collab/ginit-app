import type { MeetingReviewKeywordCategory } from '@/src/lib/meeting-review/meeting-review-keywords';

/** 네이버 업종·상호 텍스트를 소문자·공백 정규화 */
function normalizeCategoryText(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function matchCategory(t: string): MeetingReviewKeywordCategory | null {
  if (!t) return null;

  if (/카페|커피|디저트|베이커리|브런치|티룸|tea|북카페/.test(t)) {
    return 'cafe';
  }
  if (/술|바|포차|이자카야|호프|펍|와인|맥주|주점|라운지|클럽|칵테일/.test(t)) {
    return 'bar';
  }
  if (
    /영화|시네마|극장|멀티플렉스|cgv|megabox|메가박스|롯데시네마|무비|상영/.test(t)
  ) {
    return 'movie';
  }
  if (/스터디|독서실|도서관|코워킹|북클럽|학원|강의|세미나|토론|카공/.test(t)) {
    return 'knowledge';
  }
  if (/전시|미술|박물관|갤러리|공연|뮤지컬|문화센터|아트/.test(t)) {
    return 'culture';
  }
  if (
    /스크린골프|골프연습|골프장|파크골프|드라이빙레인지|골프존|프렌즈스크린|sg골프|퍼블릭골프/.test(
      t,
    )
  ) {
    return 'sports';
  }
  if (
    /헬스|피트니스|요가|필라테스|크로스핏|수영|클라이밍|암장|체육관|운동장|풋살|축구장|배드민턴|테니스|볼링장|당구장|탁구|스포츠|트레이닝|짐\b|gym/.test(
      t,
    )
  ) {
    return 'sports';
  }
  if (
    /pc방|pc카페|피시방|피씨방|오락실|아케이드|게임장|e스포츠|esports|보드게임|방탈출|vr체험|vr카페|노래방|코인노래|게임카페|콘솔|닌텐도|플스방|오락|놀이터|키즈카페/.test(
      t,
    )
  ) {
    return 'entertainment';
  }
  if (/볼링|당구|포켓볼|오락|놀이|테마파크|놀이공원/.test(t)) {
    return 'entertainment';
  }
  if (/음식|식당|한식|중식|일식|양식|분식|뷔페|고기|회|치킨|피자|햄버거|맛집|레스토랑|요리/.test(t)) {
    return 'restaurant';
  }

  return null;
}

/**
 * 네이버 업종 라벨(한식·스크린골프장 등) → 리뷰 키워드 카테고리.
 * 업종이 비어 있거나 매칭 실패 시 상호명(`placeName`)으로 한 번 더 시도합니다.
 * 둘 다 실패하면 common(공통 키워드만) — 음식점으로 추정하지 않습니다.
 */
export function mapNaverCategoryToReviewCategory(
  rawCategory: string | null | undefined,
  placeName?: string | null,
): MeetingReviewKeywordCategory {
  const fromCategory = matchCategory(normalizeCategoryText(rawCategory));
  if (fromCategory) return fromCategory;

  const fromName = matchCategory(normalizeCategoryText(placeName));
  if (fromName) return fromName;

  return 'common';
}
