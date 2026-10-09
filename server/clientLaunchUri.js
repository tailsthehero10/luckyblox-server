'use strict';

function createClientLaunchUri({ ticket, placeId, userId, port, jobId, baseUrl }) {
  if (!ticket || !Number.isFinite(Number(placeId)) || Number(placeId) <= 0
    || !Number.isFinite(Number(userId)) || Number(userId) <= 0 || !baseUrl) {
    throw new Error('A launch ticket, valid place ID, valid user ID, and server URL are required.');
  }

  let serverUrl;
  try {
    const parsed = new URL(String(baseUrl));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('unsupported server URL');
    }
    serverUrl = parsed.origin;
  } catch (error) {
    throw new Error('A valid LuckyBlox server URL is required.');
  }

  const safeJobId = String(jobId || 'local-job').replace(/[+:]/g, '');
  const safePort = Number(port);
  return `luckyblox-player:1+launchmode:play+gameinfo:${encodeURIComponent(String(ticket))}`
    + `+placeId:${Number(placeId)}`
    + `+userId:${Number(userId)}`
    + (Number.isInteger(safePort) && safePort > 0 ? `+serverPort:${safePort}` : '')
    + `+jobId:${encodeURIComponent(safeJobId)}`
    + `+baseUrl:${encodeURIComponent(serverUrl)}`;
}

function createDevPlayLaunchUri({
  ticket, placeId, userId, jobId, baseUrl, gameMetadata, playerMetadata,
}) {
  if (!ticket || !Number.isSafeInteger(Number(placeId)) || Number(placeId) <= 0
    || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0 || !jobId || !baseUrl) {
    throw new Error('A launch ticket, valid place ID, valid user ID, job ID, and server URL are required.');
  }

  let serverUrl;
  try {
    const parsed = new URL(String(baseUrl));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('unsupported server URL');
    }
    serverUrl = parsed.origin;
  } catch {
    throw new Error('A valid LuckyBlox server URL is required.');
  }

  const metadataFields = [
    ['gameTitle', 'title', 160],
    ['gameOwner', 'creatorName', 120],
    ['gameOwnerId', 'creatorId', 24],
    ['gameUniverseId', 'universeId', 24],
    ['gameCreatorType', 'creatorType', 16],
    ['gameThumbnail', 'thumbnailUrl', 2048],
    ['gameIcon', 'iconUrl', 2048],
    ['gameDescription', 'description', 1200],
    ['gameGenre', 'genre', 100],
  ];
  const encodedMetadata = metadataFields.map(([field, key, maxLength]) => {
    const raw = gameMetadata && gameMetadata[key];
    if (raw == null || raw === '') return '';
    const value = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
    return value ? `+${field}:${encodeURIComponent(value)}` : '';
  }).join('');
  const playerFields = [
    ['playerName', 'username', 50],
    ['playerDisplayName', 'displayName', 50],
    ['playerMembership', 'membershipType', 32],
    ['playerAccountAge', 'accountAge', 8],
  ];
  const encodedPlayer = playerFields.map(([field, key, maxLength]) => {
    const raw = playerMetadata && playerMetadata[key];
    if (raw == null || raw === '') return '';
    const value = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
    return value ? `+${field}:${encodeURIComponent(value)}` : '';
  }).join('');

  return `luckyblox-devplay:1+placeId:${Number(placeId)}`
    + `+userId:${Number(userId)}`
    + `+gameinfo:${encodeURIComponent(String(ticket))}`
    + `+jobId:${encodeURIComponent(String(jobId))}`
    + encodedMetadata
    + encodedPlayer
    + `+baseUrl:${encodeURIComponent(serverUrl)}`;
}

module.exports = { createClientLaunchUri, createDevPlayLaunchUri };
