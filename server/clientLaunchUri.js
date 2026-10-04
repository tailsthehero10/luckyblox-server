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

function createDevPlayLaunchUri({ ticket, placeId, userId, jobId, baseUrl }) {
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

  return `luckyblox-devplay:1+placeId:${Number(placeId)}`
    + `+userId:${Number(userId)}`
    + `+gameinfo:${encodeURIComponent(String(ticket))}`
    + `+jobId:${encodeURIComponent(String(jobId))}`
    + `+baseUrl:${encodeURIComponent(serverUrl)}`;
}

module.exports = { createClientLaunchUri, createDevPlayLaunchUri };
