const fs = require('fs');
const path = require('path');

const STUDIO_BUILD_ID = '0ab9886ca1232bdb0cd19736a3605065fba61d05';
const DEFAULT_BASE_URL = 'http://localhost/LuckBlox.site.tk/';
const STUDIO_EXECUTABLE_PATH = 'E:/LuckyBloxLauncher/NEW LKL/Release/Clients/2022M/RobloxStudioBeta.exe';

function getStudioBuildInfo() {
  return {
    buildId: STUDIO_BUILD_ID,
    channel: 'production',
    buildType: 'Release',
    executablePath: STUDIO_EXECUTABLE_PATH,
    baseUrl: DEFAULT_BASE_URL,
    qtVersion: '5.12.9',
    arguments: '',
    updatedAt: new Date().toISOString(),
    source: 'roblox-like-local-studio',
  };
}

function getStudioUpdateManifest() {
  return {
    ok: true,
    channel: 'production',
    buildId: STUDIO_BUILD_ID,
    baseUrl: DEFAULT_BASE_URL,
    version: '2022.09.13',
    builds: [
      {
        id: STUDIO_BUILD_ID,
        channel: 'production',
        buildType: 'Release',
        executablePath: STUDIO_EXECUTABLE_PATH,
        baseUrl: DEFAULT_BASE_URL,
        updatedAt: new Date().toISOString(),
      },
    ],
    updates: [
      {
        id: STUDIO_BUILD_ID,
        type: 'studio-build',
        channel: 'production',
        title: 'LuckyBlox Studio Release',
        notes: 'Roblox-style local Studio build with live update metadata and the local LuckyBlox site configured as the base URL.',
        baseUrl: DEFAULT_BASE_URL,
      },
    ],
  };
}

module.exports = {
  STUDIO_BUILD_ID,
  DEFAULT_BASE_URL,
  STUDIO_EXECUTABLE_PATH,
  getStudioBuildInfo,
  getStudioUpdateManifest,
};
