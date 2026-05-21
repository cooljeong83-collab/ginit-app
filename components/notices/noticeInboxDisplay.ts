import { StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

export type NoticeTextFields = {
  content: string;
  title: string;
  isImageOnly: boolean;
};

/** 목록·상세 헤드라인(일반 공지: 본문 → 제목 우선) */
export function noticeHeadlineText(params: NoticeTextFields): string {
  if (params.isImageOnly) {
    const title = params.title.trim();
    if (title) return title;
    const content = params.content.trim();
    if (content) return content;
    return '이미지 공지';
  }
  const content = params.content.trim();
  if (content) return content;
  const title = params.title.trim();
  if (title) return title;
  return '공지';
}

export const noticeInboxDisplayStyles = StyleSheet.create({
  date: {
    fontSize: 11,
    fontWeight: '500',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
    lineHeight: 14,
  },
  headline: {
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.25,
    lineHeight: 24,
    color: GinitTheme.colors.text,
  },
  headlineUnread: {
    fontWeight: '500',
  },
  headerBlock: {
    gap: 6,
    marginBottom: 14,
  },
});
