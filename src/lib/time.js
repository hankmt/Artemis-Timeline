export function edt(value) {
  return new Date(value.replace(' ', 'T') + '-04:00').getTime();
}

export function edtParts(ts) {
  const date = new Date(ts - 4 * 3600000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hour24 = date.getUTCHours();

  return {
    mon: months[date.getUTCMonth()],
    day: String(date.getUTCDate()).padStart(2, '0'),
    dayNum: date.getUTCDate(),
    hr24: hour24,
    hr: hour24 % 12 || 12,
    min: String(date.getUTCMinutes()).padStart(2, '0'),
    sec: String(date.getUTCSeconds()).padStart(2, '0'),
    ampm: hour24 < 12 ? 'AM' : 'PM',
  };
}

export function formatTime(ts) {
  const parts = edtParts(ts);
  return `${parts.mon} ${parts.day}, ${parts.hr}:${parts.min}:${parts.sec} ${parts.ampm}`;
}

export function formatTimeShort(ts) {
  const parts = edtParts(ts);
  return `${parts.mon} ${parts.dayNum}, ${parts.hr}:${parts.min} ${parts.ampm}`;
}

export function getFlickrId(filename) {
  const flickrMatch = filename.match(/^(\d{11})[_-]/);
  if (flickrMatch) return flickrMatch[1];

  const dvidsMatch = filename.match(/^(\d{7})\.jpg$/);
  if (dvidsMatch) return dvidsMatch[1];

  const artMatch = filename.match(/^(art\d+e\d+)/);
  if (artMatch) return artMatch[1];

  const instagramMatch = filename.match(/^(ig-[a-z0-9-]+)\./);
  if (instagramMatch) return instagramMatch[1];

  const youtubeMatch = filename.match(/^(yt-[a-z0-9-]+)\./);
  if (youtubeMatch) return youtubeMatch[1];

  return filename.replace(/~(large|orig)/, '').replace(/\.[^.]+$/, '') || null;
}

export function photoSlug(photo, titleMap) {
  const flickrId = getFlickrId(photo.f);
  const title = flickrId ? titleMap[flickrId] : null;
  if (title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  return flickrId || photo.f.replace(/\.[^.]+$/, '');
}