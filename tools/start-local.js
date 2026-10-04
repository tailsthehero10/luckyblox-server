'use strict';

const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const settingsDir = path.join(rootDir, 'Settings');

function readSetting(fileName) {
  try {
    return require('fs').readFileSync(path.join(settingsDir, fileName), 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error(`could not read Settings\\${fileName}: ${error.message}`);
  }
}

function configureLocalEnvironment(env = process.env) {
  const host = String(env.LUCKYBLOX_LOCAL_HOST || readSetting('ip.txt') || '127.0.0.1').trim();
  if (!['127.0.0.1', 'localhost'].includes(host.toLowerCase())) {
    throw new Error('Settings\\ip.txt must use 127.0.0.1 or localhost for local-only hosting.');
  }

  const port = Number.parseInt(
    String(env.LUCKYBLOX_LOCAL_PORT || readSetting('serverport.txt') || '3002'),
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3001) {
    throw new Error('LUCKYBLOX_LOCAL_PORT must be a valid port other than 3001.');
  }

  const gamePort = Number.parseInt(
    String(env.LUCKYBLOX_LOCAL_GAME_PORT || readSetting('HostPort.txt') || '53640'),
    10,
  );
  if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535 || gamePort === 3001) {
    throw new Error('Settings\\HostPort.txt must contain a valid local game-server port other than 3001.');
  }

  const dataDir = env.LUCKYBLOX_LOCAL_DATA_DIR
    || path.join(rootDir, '.tmp', 'local-site-data');
  Object.assign(env, {
    LUCKYBLOX_LOCAL_SERVER: '1',
    PORT: String(port),
    HOST: '127.0.0.1',
    LUCKYBLOX_BRIDGE_HOST: '127.0.0.1',
    LUCKYBLOX_BRIDGE_PORT: '3001',
    LUCKYBLOX_GAME_HOST: '127.0.0.1',
    LUCKYBLOX_GAME_PORT: String(gamePort),
    PUBLIC_URL: `http://localhost:${port}`,
    PUBLIC_HOST: `localhost:${port}`,
    PUBLIC_PROTOCOL: 'http',
    LUCKYBLOX_DATA_DIR: path.resolve(dataDir),
    LUCKYBLOX_SYNC: 'off',
    DATABASE_URL: ' ',
    RENDER: '',
    RENDER_EXTERNAL_URL: '',
    RENDER_EXTERNAL_HOSTNAME: '',
    RENDER_SERVICE_ID: '',
    RENDER_DISK_PATH: '',
  });

  return `http://localhost:${port}`;
}

if (require.main === module) {
  try {
    const url = configureLocalEnvironment();
    require(path.join(rootDir, 'server', 'envFile.js')).loadEnvFile(rootDir);
    console.log(`[luckyblox] starting local copy of the public site at ${url}`);
    console.log(`[luckyblox] local game-server address: ${process.env.LUCKYBLOX_GAME_HOST}:${process.env.LUCKYBLOX_GAME_PORT}`);
    console.log(`[luckyblox] local-only data: ${process.env.LUCKYBLOX_DATA_DIR}`);
    console.log('[luckyblox] public database and sync are disabled');
    require(path.join(rootDir, 'start.js'));
  } catch (error) {
    console.error(`[luckyblox] local server could not start: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { configureLocalEnvironment };
