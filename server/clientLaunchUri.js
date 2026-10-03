'use strict';

function createClientLaunchUri({ ticket, placeId, port, jobId }) {
  if (!ticket || !Number.isFinite(Number(placeId)) || Number(placeId) <= 0) {
    throw new Error('A launch ticket and valid place ID are required.');
  }

  const safeJobId = String(jobId || 'local-job').replace(/[+:]/g, '');
  const safePort = Number(port);
  return `luckyblox-player:1+launchmode:play+gameinfo:${encodeURIComponent(String(ticket))}`
    + `+placeId:${Number(placeId)}`
    + (Number.isInteger(safePort) && safePort > 0 ? `+serverPort:${safePort}` : '')
    + `+jobId:${encodeURIComponent(safeJobId)}`;
}

module.exports = { createClientLaunchUri };
