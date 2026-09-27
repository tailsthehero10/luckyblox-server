const http = require('http');
const https = require('https');

const TARGET_HOST = 'luckyblox-server.onrender.com';
const PORT = 80; // Standard HTTP port

http.createServer((clientReq, clientRes) => {
    const options = {
        hostname: TARGET_HOST,
        port: 443,
        path: clientReq.url,
        method: clientReq.method,
        headers: {
            ...clientReq.headers,
            host: TARGET_HOST // Overwrite host header for Render routing
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes, { end: true });
    });

    clientReq.pipe(proxyReq, { end: true });

    proxyReq.on('error', (err) => {
        console.error('Proxy Error:', err.message);
        clientRes.writeHead(500);
        clientRes.end('Proxy Error');
    });
}).listen(PORT, () => {
    console.log(`Local gateway active. Listening on http://localhost:${PORT}`);
});
