'use strict';

/**
 * Prints the server's response body for one path, so a 500 can be diagnosed
 * instead of guessed at.
 *
 * Usage: node tools/probe-page.js /download [port]
 */

const http = require('http');

const target = process.argv[2] || '/';
const port = Number(process.argv[3]) || 3099;

http.get({ host: '127.0.0.1', port, path: target }, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => {
    console.log(`HTTP ${res.status}  ${target}`);
    console.log(`bytes: ${body.length}`);
    console.log('---');
    console.log(body.slice(0, 1600));
  });
}).on('error', (e) => {
  console.log(`request failed: ${e.message}`);
});