import { edt, getFlickrId } from './time.js';

function healEscapes(value) {
  if (typeof value === 'string') {
    return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }

  if (Array.isArray(value)) {
    return value.map(healEscapes);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, healEscapes(entryValue)]));
  }

  return value;
}

function parsePhotosScript(text) {
  const jsonText = text
    .replace(/^const\s+PHOTO_DATA\s*=\s*/, '')
    .replace(/;\s*$/, '');

  return healEscapes(JSON.parse(jsonText));
}

function normalizePhoto(photo) {
  const entry = {
    t: edt(photo.time),
    f: photo.file,
    p: photo.photographer,
    loc: photo.location,
    cam: photo.camera,
    set: photo.settings,
    sc: !!photo.spacecraft,
    b: photo.batch || 0,
    desc: photo.desc || '',
    exterior: !!photo.exterior,
    ext: !!photo.external,
    v: !!photo.video,
  };

  if (photo.camera_id) {
    entry.cid = photo.camera_id;
  } else {
    const upperCamera = (photo.camera || '').toUpperCase();
    if (upperCamera.includes('Z 9') || upperCamera.includes('Z9')) entry.cid = 'z9';
    else if (upperCamera.includes('HERO')) entry.cid = 'gopro';
    else if (upperCamera.includes('IPHONE')) entry.cid = 'iphone';
  }

  if ((photo.camera || '').includes('HERO') || photo.exterior) {
    entry.exterior = true;
  }

  return entry;
}

export async function loadViewerData() {
  const response = await fetch('/photos.js');
  if (!response.ok) {
    throw new Error(`Failed to load photos.js: ${response.status} ${response.statusText}`);
  }

  const rawText = await response.text();
  const data = parsePhotosScript(rawText);
  const titleMap = {};
  const descriptionMap = {};
  const photos = [];
  const audio = [];

  for (const photo of data.photos.filter((entry) => entry.enabled !== false)) {
    photos.push(normalizePhoto(photo));
    const flickrId = getFlickrId(photo.file);
    if (flickrId && photo.title) titleMap[flickrId] = photo.title;
    if (flickrId && photo.flickr_desc) descriptionMap[flickrId] = photo.flickr_desc;
  }

  for (const clip of (data.audio || []).filter((entry) => entry.enabled !== false)) {
    audio.push({
      t: edt(clip.time),
      f: clip.file,
      desc: clip.desc,
    });
  }

  return {
    photos,
    audio,
    titleMap,
    descriptionMap,
  };
}