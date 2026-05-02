export const MEDIA_BASE = 'https://pub-6f67061aecce4413aa83975cba06595d.r2.dev/';
export const PREORDER_URL = 'https://store.dftba.com/products/artemis-ii-2027-calendar';
export const PREORDER_DEADLINE = new Date('2026-05-12T23:59:59-04:00').getTime();

export function mediaUrl(relativePath) {
  return `${MEDIA_BASE}${relativePath}`;
}

export function webMediaUrl(fileName) {
  return mediaUrl(`web/${encodeURIComponent(fileName)}`);
}

export function audioMediaUrl(fileName) {
  return mediaUrl(fileName.replace(/ /g, '%20'));
}