#!/usr/bin/env node
import adbhost from 'adbhost';
import nodeFetch from 'node-fetch';
import WebSocket from 'ws';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_ID = 'TZTubeAlne.TizenTubeStandalone';
const CDP_RETRIES = 15;
const CDP_RETRY_DELAY = 750;
const TRIGGER_PORT = parseInt(process.env.PORT || '3000', 10);

// Spoof Cobalt/ATV UA so YouTube serves the same ad config as a real Cobalt device.
// Tizen WebKit's default UA causes YouTube to serve a different (less restrictive) ad policy.
const COBALT_UA = 'Mozilla/5.0 (Linux armeabi-v7a; Android 14) Cobalt/25.lts.30.1034958-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, Google_ATV_sabrina_2020/UTTC.250917.004 (google, Chromecast) com.google.android.youtube.tv/5.30.301';

const tvIp = process.argv[2] || process.env.TV_IP;

if (!tvIp) {
    console.error('Usage: node server/index.js <TV_IP>');
    console.error('       TV_IP=192.168.1.50 node server/index.js');
    console.error('       docker run --rm -e TV_IP=... ghcr.io/edivad1999/tizentube-alone');
    process.exit(1);
}

// Load userScript: prefer installed @foxreis/tizentube npm package, fall back to local dist/
let userScript;
try {
    const scriptPath = require.resolve('@foxreis/tizentube/dist/userScript.js');
    userScript = readFileSync(scriptPath, 'utf-8');
    const pkg = JSON.parse(readFileSync(require.resolve('@foxreis/tizentube/package.json'), 'utf-8'));
    console.log('userScript loaded from @foxreis/tizentube@' + pkg.version + ' (npm)');
} catch {
    try {
        userScript = readFileSync(join(__dirname, '..', 'dist', 'userScript.js'), 'utf-8');
        console.log('userScript loaded from local dist/');
    } catch {
        console.error('userScript not found. Install @foxreis/tizentube or run the build first.');
        process.exit(1);
    }
}

console.log('userScript size: ' + userScript.length + ' bytes');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Inflight guard — prevents duplicate launches while a debug attach is in progress
let injecting = false;

async function attachDebugger(port, adbConn, attempt = 1) {
    try {
        const res = await nodeFetch('http://' + tvIp + ':' + port + '/json');
        const targets = await res.json();
        if (!targets[0]?.webSocketDebuggerUrl) throw new Error('No debugger URL in /json response');

        const wsUrl = targets[0].webSocketDebuggerUrl;
        adbConn._intentionalClose = true;
        adbConn._stream.end();

        console.log('CDP: connecting to ' + wsUrl);
        const ws = new WebSocket(wsUrl);
        let msgId = 20;
        let reloaded = false;

        // Append an interval that re-patches _yttv sandbox contexts as YouTube creates them.
        const yttvPatcher = `
setInterval(function() {
  if (typeof JSON._patched === 'undefined') return;
  if (!window._yttv) return;
  for (var k in window._yttv) {
    if (window._yttv[k] && window._yttv[k].JSON && window._yttv[k].JSON.parse !== JSON.parse) {
      window._yttv[k].JSON.parse = JSON.parse;
    }
  }
}, 500);
`;
        // Sentinel injected before userScript so index.html knows it's in debug mode.
        const fullScript = 'window.__TIZENTUBE_DEBUG__=true;\n' + userScript + '\nJSON._patched = true;\n' + yttvPatcher;

        ws.on('open', () => {
            ws.send(JSON.stringify({ id: 7,  method: 'Debugger.enable' }));
            ws.send(JSON.stringify({ id: 11, method: 'Runtime.enable' }));
            ws.send(JSON.stringify({ id: 12, method: 'Page.enable' }));
            // Spoof Cobalt/ATV user agent before page loads
            ws.send(JSON.stringify({
                id: 14,
                method: 'Network.setUserAgentOverride',
                params: { userAgent: COBALT_UA },
            }));
            // Primary injection: runs before any document parsing in every new document
            ws.send(JSON.stringify({
                id: 13,
                method: 'Page.addScriptToEvaluateOnNewDocument',
                params: { source: fullScript },
            }));
            console.log('Page.addScriptToEvaluateOnNewDocument registered.');
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());

            // Once registration confirmed, reload so current page starts fresh with hooks in place
            if (msg.id === 13) {
                if (msg.error) {
                    console.error('Page.addScriptToEvaluateOnNewDocument failed:', msg.error.message);
                } else {
                    console.log('Pre-document injection registered, identifier:', msg.result?.identifier);
                    if (!reloaded) {
                        reloaded = true;
                        console.log('Reloading page to apply hooks from page start...');
                        ws.send(JSON.stringify({ id: 15, method: 'Page.reload' }));
                    }
                }
            }

            // Fallback: inject per-context to catch any contexts that slip through
            if (msg.method === 'Runtime.executionContextCreated') {
                const origin = msg.params?.context?.origin || '';
                const ctxId  = msg.params?.context?.id;
                console.log('Execution context created, origin: ' + origin);
                ws.send(JSON.stringify({
                    id: msgId++,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: userScript,
                        contextId: ctxId,
                        objectGroup: 'console',
                        includeCommandLineAPI: true,
                        doNotPauseOnExceptionsAndMuteConsole: false,
                        returnByValue: false,
                        generatePreview: false,
                    }
                }));
                console.log('userScript injected into context ' + ctxId + ' (' + origin + ')');
            }
        });

        ws.on('error', err => console.error('CDP WebSocket error:', err.message));
        ws.on('close', () => {
            injecting = false;
            console.log('CDP connection closed. Ready for next launch trigger.');
        });
    } catch (err) {
        if (attempt < CDP_RETRIES) {
            console.log('attachDebugger attempt ' + attempt + ' failed: ' + err.message + '. Retrying in ' + CDP_RETRY_DELAY + 'ms...');
            await sleep(CDP_RETRY_DELAY);
            return attachDebugger(port, adbConn, attempt + 1);
        }
        injecting = false;
        console.error('attachDebugger failed after ' + CDP_RETRIES + ' attempts:', err.message);
    }
}

function debugLaunch(adb, attempt) {
    attempt = attempt || 1;
    console.log('Sending shell:0 debug (attempt ' + attempt + ')...');
    const shell = adb.createStream('shell:0 debug ' + APP_ID);
    let gotData = false;

    const retryTimer = setTimeout(() => {
        if (gotData) return;
        shell.removeAllListeners('data');
        if (attempt < 3) {
            console.log('No debug response — retrying...');
            debugLaunch(adb, attempt + 1);
        } else {
            injecting = false;
            console.error('debug launch failed after 3 attempts');
            adb._stream.end();
        }
    }, 4000);

    shell.on('data', data => {
        const s = data.toString();
        console.log('debug shell raw:', JSON.stringify(s));
        if (s.includes('debug')) {
            gotData = true;
            clearTimeout(retryTimer);
            const port = s.substr(s.indexOf(':') + 1, 6).replace(' ', '');
            console.log('Debug port: ' + port);
            attachDebugger(parseInt(port), adb);
        }
    });
    shell.on('error', err => console.log('debug shell error:', err.message));
}

function launchAndInject() {
    console.log('Connecting to TV SDB at ' + tvIp + ':26101...');
    const adb = adbhost.createConnection({ host: tvIp, port: 26101 });

    adb._stream.on('connect', () => {
        console.log('SDB connected. Killing any running instance of ' + APP_ID + '...');
        const kill = adb.createStream('shell:0 was_kill ' + APP_ID);
        let killDone = false;

        function afterKill() {
            if (killDone) return;
            killDone = true;
            console.log('Launching ' + APP_ID + ' in debug mode...');
            setTimeout(() => debugLaunch(adb), 300);
        }

        kill.on('data', d => {
            console.log('was_kill response:', JSON.stringify(d.toString().trim()));
            afterKill();
        });
        // If app wasn't running, was_kill may return no data — proceed after timeout
        setTimeout(afterKill, 2000);
    });

    adb._stream.on('error', err => {
        injecting = false;
        console.error('[launch] SDB error: ' + err.message);
    });

    adb._stream.on('close', () => {
        if (adb._intentionalClose) return;
        injecting = false;
        console.log('SDB disconnected unexpectedly.');
    });
}

// HTTP trigger server — TV app calls GET /inject when it opens without debug mode
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.method === 'GET' && req.url === '/inject') {
        if (injecting) {
            console.log('[trigger] /inject received — already in progress, ignoring.');
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'in_progress' }));
            return;
        }
        console.log('[trigger] /inject received — launching debug mode...');
        injecting = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'launching' }));
        launchAndInject();
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(TRIGGER_PORT, '0.0.0.0', () => {
    console.log('Server started. Listening for /inject triggers on port ' + TRIGGER_PORT + '.');
    console.log('TV IP: ' + tvIp);
});
