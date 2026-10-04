'use strict';

const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function configureLocalEnvironment(env = process.env) {
  const port = Number.parseInt(String(env.LUCKYBLOX_LOCAL_PORT || '3002'), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3001) {
    throw new Error('LUCKYBLOX_LOCAL_PORT must be a valid port other than 3001.');
  }

  Object.assign(env, {
    LUCKYBLOX_LOCAL_SERVER: '1',
    PORT: String(port),
    HOST: '127.0.0.1',
    LUCKYBLOX_BRIDGE_HOST: '127.0.0.1',
    LUCKYBLOX_BRIDGE_PORT: '3001',
    LUCKYBLOX_GAME_HOST: '127.0.0.1',
    PUBLIC_URL: `http://localhost:${port}`,
    PUBLIC_HOST: `localhost:${port}`,
    PUBLIC_PROTOCOL: 'http',
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
    console.log('[luckyblox] local-only storage enabled; public database and sync are disabled');
    require(path.join(rootDir, 'start.js'));
  } catch (error) {
    console.error(`[luckyblox] local server could not start: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { configureLocalEnvironment };
