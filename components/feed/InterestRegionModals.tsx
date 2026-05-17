import { GinitPressable } from '@/components/ui/GinitPressable';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { FeedInterestRegionControls } from '@/src/hooks/use-feed-interest-region-controls';
import { normalizeFeedRegionLabel } from '@/src/lib/feed-region-match';
import { FEED_REGISTERED_REGIONS_MAX } from '@/src/lib/feed-registered-regions';

export type InterestRegionModalsProps = {
  controls: FeedInterestRegionControls;
  safeAreaTop: number;
};

export function InterestRegionModals({ controls, safeAreaTop }: InterestRegionModalsProps) {
  const {
    registeredRegions,
    regionModalOpen,
    draftActiveRegionNorm,
    regionSearchModalOpen,
    regionSearchQuery,
    setRegionSearchQuery,
    regionSearchKeyboardVisible,
    draftRegisteredRegions,
    regionSearchResults,
    closeRegionModal,
    closeRegionSearchModal,
    openRegionSearchModal,
    removeDraftRegion,
    pickSearchResultDistrict,
    applyDraftRegisteredRegions,
    pickDraftActiveRegion,
    getInterestRegionDisplayLabel,
  } = controls;

  return (
    <>
      <Modal visible={regionModalOpen} animationType="fade" transparent onRequestClose={closeRegionModal}>
        <View style={styles.modalRoot}>
          <GinitPressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeRegionModal}
            accessibilityRole="button"
            accessibilityLabel="관심 지역 설정 닫기"
          />
          <View style={[styles.modalCard, styles.modalCardWide]}>
            <Text style={styles.modalTitle}>관심 지역 설정</Text>
            <Text style={styles.modalHint}>
              {registeredRegions.length === 0
                ? `탐색을 쓰려면 관심 지역을 최소 한 곳 등록한 뒤 「적용」을 눌러 주세요. `
                : ''}
              + 로 전국 행정구(자치구) 단위로 검색해 추가해요. 최대 {FEED_REGISTERED_REGIONS_MAX}곳까지예요. 체크한 지역이
              탐색·지도에 표시돼요.
            </Text>
            <Text style={styles.modalCurrentSummary} numberOfLines={1}>
              등록 {draftRegisteredRegions.length}/{FEED_REGISTERED_REGIONS_MAX}곳
            </Text>
            <ScrollView style={styles.feedSettingsScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {draftRegisteredRegions.length === 0 ? (
                <Text style={styles.interestRegionEmptyDraft}>추가된 관심 지역이 없어요.</Text>
              ) : (
                draftRegisteredRegions.map((r) => {
                  const norm = normalizeFeedRegionLabel(r);
                  const active =
                    draftActiveRegionNorm != null &&
                    normalizeFeedRegionLabel(draftActiveRegionNorm) === norm;
                  const blockLastDraftRemove =
                    registeredRegions.length >= 1 && draftRegisteredRegions.length <= 1;
                  return (
                    <GinitPressable
                      key={norm}
                      onPress={() => pickDraftActiveRegion(norm)}
                      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${getInterestRegionDisplayLabel(r)}${active ? ', 탐색 표시 중' : ''}`}>
                      <View style={styles.checkCol}>
                        {active ? (
                          <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                        ) : (
                          <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                        )}
                      </View>
                      <Text style={[styles.modalRowLabel, styles.modalRowLabelFlex]} numberOfLines={1}>
                        {getInterestRegionDisplayLabel(r)}
                      </Text>
                      {blockLastDraftRemove ? (
                        <View style={styles.trashPlaceholder} accessibilityElementsHidden />
                      ) : (
                        <GinitPressable
                          onPress={() => removeDraftRegion(r)}
                          accessibilityRole="button"
                          accessibilityLabel={`${getInterestRegionDisplayLabel(r)} 삭제`}
                          hitSlop={8}>
                          <GinitSymbolicIcon name="trash-outline" size={22} color="#94a3b8" />
                        </GinitPressable>
                      )}
                    </GinitPressable>
                  );
                })
              )}
              {draftRegisteredRegions.length < FEED_REGISTERED_REGIONS_MAX ? (
                <GinitPressable
                  onPress={openRegionSearchModal}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="관심 지역 추가">
                  <GinitSymbolicIcon name="add-circle-outline" size={24} color={GinitTheme.colors.primary} />
                  <Text style={[styles.modalRowLabel, styles.interestRegionAddLabel]}>관심 지역 추가</Text>
                  <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                </GinitPressable>
              ) : (
                <Text style={styles.interestRegionEmptyDraft}>
                  최대 {FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.
                </Text>
              )}
            </ScrollView>
            <GinitPressable onPress={applyDraftRegisteredRegions} style={styles.modalPrimaryBtn} accessibilityRole="button">
              <Text style={styles.modalPrimaryLabel}>적용</Text>
            </GinitPressable>
            {registeredRegions.length > 0 ? (
              <GinitPressable onPress={closeRegionModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </GinitPressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={regionSearchModalOpen} animationType="fade" transparent onRequestClose={closeRegionSearchModal}>
        <View
          style={[
            styles.modalRoot,
            styles.regionSearchModalRoot,
            regionSearchKeyboardVisible && styles.regionSearchModalRootKeyboardOpen,
            regionSearchKeyboardVisible && { paddingTop: safeAreaTop + GinitTheme.spacing.sm },
          ]}>
          <GinitPressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeRegionSearchModal}
            accessibilityRole="button"
            accessibilityLabel="지역 검색 닫기"
          />
          <View style={[styles.modalCard, styles.modalCardWide]}>
            <Text style={styles.modalTitle}>지역 검색</Text>
            <Text style={styles.modalHint}>
              시·도·시 이름 또는 구 이름으로 검색한 뒤, 목록에서 누르면 관심 지역에 추가돼요.
            </Text>
            <TextInput
              value={regionSearchQuery}
              onChangeText={setRegionSearchQuery}
              placeholder="예: 영등포구, 해운대구, 경기 수원"
              placeholderTextColor="#94a3b8"
              style={styles.regionSearchInput}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="구 이름 검색"
            />
            <ScrollView style={styles.regionSearchScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {regionSearchQuery.trim().length === 0 ? (
                <Text style={styles.interestRegionSearchEmpty}>검색어를 입력해 주세요.</Text>
              ) : regionSearchResults.length === 0 ? (
                <Text style={styles.interestRegionSearchEmpty}>검색 결과가 없어요.</Text>
              ) : (
                regionSearchResults.map((hit) => (
                  <GinitPressable
                    key={hit.key}
                    onPress={() => pickSearchResultDistrict(hit.key)}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button">
                    <Text style={styles.modalRowLabel}>{hit.label}</Text>
                    <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                  </GinitPressable>
                ))
              )}
            </ScrollView>
            <GinitPressable onPress={closeRegionSearchModal} style={styles.modalCloseBtn} accessibilityRole="button">
              <Text style={styles.modalCloseLabel}>닫기</Text>
            </GinitPressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  modalCardWide: {
    maxHeight: '92%',
  },
  feedSettingsScroll: {
    maxHeight: 400,
  },
  modalCurrentSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 16,
  },
  interestRegionEmptyDraft: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  interestRegionAddLabel: {
    flex: 1,
    marginLeft: 10,
  },
  regionSearchModalRoot: {
    zIndex: 50,
  },
  regionSearchModalRootKeyboardOpen: {
    justifyContent: 'flex-start',
  },
  regionSearchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
  },
  regionSearchScroll: {
    maxHeight: 640,
  },
  interestRegionSearchEmpty: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 8,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  modalRowPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.06)',
  },
  checkCol: {
    width: 28,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modalRowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  modalRowLabelFlex: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  trashPlaceholder: {
    width: 22,
    flexShrink: 0,
  },
  modalPrimaryBtn: {
    marginTop: 12,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
  },
  modalPrimaryLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalCloseBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  modalCloseLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.themeMainColor,
  },
});
