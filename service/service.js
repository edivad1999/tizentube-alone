const dial = require('@patrickkfkan/peer-dial');
const express = require('express');
const cors = require('cors');
const https = require('https');
const zlib = require('zlib');
const path = require('path');

const app = express();

app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
}));

const PORT = 8085;
const YOUTUBE_HOST = 'www.youtube.com';
const APP_SUFFIX = 'TizenTubeStandalone';

app.get('/health', (req, res) => res.sendStatus(200));

app.get('/tt-userscript.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'userScript.js'));
});

const ytApp = {
    name: 'YouTube',
    state: 'stopped',
    allowStop: true,
    pid: null,
    additionalData: {},
    launch(launchData) {
        const pkgId = tizen.application.getAppInfo().packageId;
        tizen.application.launchAppControl(
            new tizen.ApplicationControl(
                'http://tizen.org/appcontrol/operation/view',
                null, null, null,
                [new tizen.ApplicationControlData('url', [
                    `http://127.0.0.1:${PORT}/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A${PORT}%2Fdial%2Fapps%2FYouTube`
                ])]
            ),
            `${pkgId}.${APP_SUFFIX}`
        );
    }
};

const dialServer = new dial.Server({
    expressApp: app,
    port: PORT,
    prefix: '/dial',
    manufacturer: 'TizenTube',
    modelName: 'TizenTubeStandalone',
    friendlyName: 'TizenTube',
    delegate: {
        getApp: (name) => name === 'YouTube' ? ytApp : null,
        launchApp(appName, launchData, callback) {
            if (appName !== 'YouTube') { callback(null); return; }
            const parsed = Object.fromEntries(
                launchData.split('&')
                    .map(p => p.split('='))
                    .filter(([k]) => k)
                    .map(([k, v]) => [k, v !== undefined ? v : ''])
            );
            if (parsed.yumi) {
                ytApp.additionalData = parsed;
                ytApp.state = 'running';
                callback('');
                return;
            }
            ytApp.pid = 'run';
            ytApp.state = 'starting';
            ytApp.launch(launchData);
            ytApp.state = 'running';
            callback(ytApp.pid);
        },
        stopApp(appName, pid, callback) {
            if (appName === 'YouTube' && ytApp.pid === pid) {
                ytApp.pid = null;
                ytApp.state = 'stopped';
                callback(true);
            } else {
                callback(false);
            }
        }
    }
});

setInterval(() => {
    tizen.application.getAppsContext((ctxList) => {
        const pkgId = tizen.application.getAppInfo().packageId;
        if (!ctxList.find(c => c.appId === `${pkgId}.${APP_SUFFIX}`)) {
            ytApp.state = 'stopped';
            ytApp.pid = null;
            ytApp.additionalData = {};
        }
    });
}, 5000);

// YouTube reverse proxy — registered after DIAL routes
app.use('/', (req, res) => {
    const proxyHeaders = Object.assign({}, req.headers, {
        host: YOUTUBE_HOST,
        'accept-encoding': 'gzip, deflate',
    });
    delete proxyHeaders['origin'];
    delete proxyHeaders['referer'];

    const options = {
        hostname: YOUTUBE_HOST,
        port: 443,
        path: req.url,
        method: req.method,
        headers: proxyHeaders,
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || '';
        const isHtml = contentType.includes('text/html');
        const encoding = proxyRes.headers['content-encoding'] || '';

        const outHeaders = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
            const lk = k.toLowerCase();
            if (lk === 'content-security-policy') continue;
            if (lk === 'content-security-policy-report-only') continue;
            if (isHtml && lk === 'content-encoding') continue;
            if (isHtml && lk === 'content-length') continue;
            if (lk === 'set-cookie') {
                const cookies = Array.isArray(v) ? v : [v];
                outHeaders[k] = cookies.map(c =>
                    c.replace(/;\s*domain=[^;]*/gi, '')
                     .replace(/;\s*samesite=[^;]*/gi, '')
                     .replace(/;\s*secure/gi, '')
                );
                continue;
            }
            outHeaders[k] = v;
        }

        if (!isHtml) {
            res.writeHead(proxyRes.statusCode, outHeaders);
            proxyRes.pipe(res);
            return;
        }

        let chunks = [];
        let stream = proxyRes;
        if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf8');
            const tag = '<script src="/tt-userscript.js"></script>';
            html = html.includes('</head>') ? html.replace('</head>', tag + '</head>') : tag + html;
            html = html.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, '');
            res.writeHead(proxyRes.statusCode, outHeaders);
            res.end(html);
        });
        stream.on('error', err => {
            console.error('proxy decompress error:', err);
            res.status(502).end();
        });
    });

    proxyReq.on('error', err => {
        console.error('proxy upstream error:', err);
        res.status(502).end();
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
    } else {
        proxyReq.end();
    }
});

app.listen(PORT, () => {
    dialServer.start();
    console.log(`TizenTube service running on port ${PORT}`);
});
