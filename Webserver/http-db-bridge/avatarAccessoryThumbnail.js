'use strict';

const robloxApi = require('./robloxApi');

const ASSET_TYPE_NAMES = {
  8: 'Hat',
  41: 'HairAccessory',
  46: 'BackAccessory',
};

function isAllowedThumbnailUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'rbxcdn.com' || url.hostname.endsWith('.rbxcdn.com'));
  } catch (error) {
    return false;
  }
}

async function getAvatarAccessoryThumbnail(id, storedAsset, api = robloxApi) {
  let details = null;
  let thumbnailUrl = storedAsset
    && (storedAsset.thumbnail || storedAsset.image || storedAsset.thumbnailSource);
  if (!isAllowedThumbnailUrl(thumbnailUrl)) {
    if (!storedAsset) details = await api.getAssetDetails(id);
    thumbnailUrl = await api.getAssetThumbnailUrl(id, '420x420');
  }
  if (!isAllowedThumbnailUrl(thumbnailUrl)) return null;

  const typeId = Number((storedAsset && storedAsset.assetTypeId) || (details && details.assetTypeId));
  return {
    name: (storedAsset && storedAsset.name) || (details && details.name) || `Asset ${id}`,
    assetType: (storedAsset && (storedAsset.assetType || storedAsset.className))
      || ASSET_TYPE_NAMES[typeId]
      || (typeId ? `Asset type ${typeId}` : 'Accessory'),
    thumbnailUrl,
  };
}

module.exports = { getAvatarAccessoryThumbnail };
