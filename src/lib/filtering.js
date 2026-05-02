export function filterPhotos(photos, filterMode, activeCams) {
  if (activeCams.length) {
    return photos.filter((photo) => {
      for (const camera of activeCams) {
        if (camera === 'gopro' && photo.cam?.includes('HERO')) return true;
        if (camera === 'iphone' && photo.cam?.includes('iPhone')) return true;
        if (camera !== 'gopro' && camera !== 'iphone' && photo.cid === camera) return true;
      }

      return false;
    });
  }

  switch (filterMode) {
    case 'spacecraft':
      return photos.filter((photo) => photo.sc);
    case 'exterior':
      return photos.filter((photo) => photo.exterior);
    case 'videos':
      return photos.filter((photo) => photo.v);
    default:
      return photos;
  }
}