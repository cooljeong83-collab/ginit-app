import { Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingReviewKeywordChips } from '@/components/meeting-review/MeetingReviewKeywordChips';
import { meetingReviewStyles as s } from '@/components/meeting-review/meeting-review-styles';
import { MeetingReviewStarRating } from '@/components/meeting-review/MeetingReviewStarRating';
import { MeetingReviewTopSummary } from '@/components/meeting-review/MeetingReviewTopSummary';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { getKeywordsForCategory, MAX_MEETING_REVIEW_KEYWORDS } from '@/src/lib/meeting-review/meeting-review-keywords';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { Meeting } from '@/src/lib/meetings';

export type ReviewFormProps = {
  meeting: Meeting;
  place: MeetingReviewPlaceContext;
  categories: readonly Category[];
  onOpenPlaceUrl: (url: string, title: string) => void;
  receiptPlaceVerified?: boolean;
  rating: number;
  onRatingChange: (rating: number) => void;
  selectedKeywords: string[];
  onToggleKeyword: (keyword: string) => void;
  onKeywordMaxReached?: () => void;
  comment: string;
  onCommentChange: (text: string) => void;
};

export function ReviewForm({
  meeting,
  place,
  categories,
  onOpenPlaceUrl,
  receiptPlaceVerified,
  rating,
  onRatingChange,
  selectedKeywords,
  onToggleKeyword,
  onKeywordMaxReached,
  comment,
  onCommentChange,
}: ReviewFormProps) {
  const keywords = getKeywordsForCategory(place.keywordCategory);
  const insets = useSafeAreaInsets();
  /** 화면 하단 고정 제출 버튼 영역(패딩·버튼 높이) */
  const footerBarHeight = 10 + 14 * 2 + 22;
  const footerInset = footerBarHeight + Math.max(insets.bottom, 12);

  return (
    <KeyboardAwareScreenScroll
      style={s.scroll}
      contentContainerStyle={[s.scrollContent, { paddingBottom: footerInset + 16 }]}
      extraScrollHeight={20}
      extraHeight={footerInset + 20}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
        <MeetingReviewTopSummary
          meeting={meeting}
          place={place}
          categories={categories}
          onOpenPlaceUrl={onOpenPlaceUrl}
          receiptPlaceVerified={receiptPlaceVerified}
        />

        <View style={s.formBlock}>
          <Text style={s.sectionLabel}>만족도</Text>
          <MeetingReviewStarRating value={rating} onChange={onRatingChange} />

          <View style={s.divider} />

          <Text style={s.sectionLabel}>키워드 (최대 {MAX_MEETING_REVIEW_KEYWORDS}개)</Text>
          <Text style={s.sectionHint}>
            {selectedKeywords.length}/{MAX_MEETING_REVIEW_KEYWORDS} 선택
          </Text>
          <MeetingReviewKeywordChips
            keywords={keywords}
            selected={selectedKeywords}
            onToggle={onToggleKeyword}
            onMaxReached={onKeywordMaxReached}
          />

          <View style={s.divider} />

          <Text style={s.sectionLabel}>코멘트 (선택)</Text>
          <TextInput
            style={s.input}
            placeholder="한 줄로 남겨 보세요"
            placeholderTextColor={GinitTheme.colors.textMuted}
            value={comment}
            onChangeText={onCommentChange}
            maxLength={200}
            multiline
            textAlignVertical="top"
            returnKeyType="done"
          />
        </View>
    </KeyboardAwareScreenScroll>
  );
}
