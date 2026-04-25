export async function shareRemoteImageUrl(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  window.open(u, '_blank', 'noopener,noreferrer');
}

export async function saveRemoteImageUrlToLibrary(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  // 웹은 브라우저 다운로드로 처리
  const a = document.createElement('a');
  a.href = u;
  a.download = '';
  a.rel = 'noopener';
  a.target = '_blank';
  a.click();
}

