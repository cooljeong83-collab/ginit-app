import { StyleSheet } from 'react-native';

const TRUST_BLUE = '#0052CC';
const INPUT_PLACEHOLDER = 'rgba(255, 255, 255, 0.4)';

export const wizardSpecialtyStyles = StyleSheet.create({
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(248, 250, 252, 0.75)',
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.5)',
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  resultsBox: {
    marginTop: 10,
    maxHeight: 200,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    overflow: 'hidden',
  },
  resultRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: 'rgba(248, 250, 252, 0.95)',
  },
  resultMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(147, 197, 253, 0.85)',
  },
  pickedBlock: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 82, 204, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.45)',
  },
  pickedTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#F8FAFC',
  },
  pickedSub: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.72)',
    lineHeight: 19,
  },
  clearLink: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  clearLinkText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(147, 197, 253, 0.95)',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  glassChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  glassChipOn: {
    backgroundColor: 'rgba(0, 82, 204, 0.28)',
    borderColor: 'rgba(147, 197, 253, 0.55)',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  glassChipPressed: {
    opacity: 0.88,
  },
  glassChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(248, 250, 252, 0.92)',
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginTop: 4,
  },
  segmentThird: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  segmentThirdOn: {
    backgroundColor: 'rgba(0, 82, 204, 0.35)',
  },
  segmentTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(248, 250, 252, 0.55)',
    textAlign: 'center',
  },
  segmentTitleOn: {
    color: '#F8FAFC',
  },
  segmentSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.45)',
    textAlign: 'center',
  },
});

export { INPUT_PLACEHOLDER };
