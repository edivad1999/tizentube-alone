#!/usr/bin/env node
import adbhost from 'adbhost';
import nodeFetch from 'node-fetch';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_ID = 'TZTubeAlne.TizenTubeStandalone';
const CDP_RETRIES = 15;
const CDP_RETRY_DELAY = 750;

// Spoof Cobalt/ATV UA so YouTube serves the same ad config as a real Cobalt device.
// Tizen WebKit's default UA causes YouTube to serve a different (less restrictive) ad policy.
const COBALT_UA = 'Mozilla/5.0 (Linux armeabi-v7a; Android 14) Cobalt/25.lts.30.1034958-gold (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, Google_ATV_sabrina_2020/UTTC.250917.004 (google, Chromecast) com.google.android.youtube.tv/5.30.301';

const tvIp = process.argv[2] || process.env.TV_IP;
if (!tvIp) {
    console.error('Usage: node server/index.js <TV_IP>');
    console.error('       TV_IP=192.168.1.50 node server/index.js');
    console.error('       docker run --rm ghcr.io/edivad1999/tizentube-alone <TV_IP>');
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
        // The pre-document injection runs before _yttv exists, so the patch loop at the end of
        // adblock.js is a no-op on first run. The interval catches every key added later.
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
        const fullScript = userScript + '\nJSON._patched = true;\n' + yttvPatcher;

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
            console.log('CDP connection closed. Waiting for user to open TizenTube...');
            setTimeout(pollForApp, 2000);
        });
    } catch (err) {
        if (attempt < CDP_RETRIES) {
            console.log('attachDebugger attempt ' + attempt + ' failed: ' + err.message + '. Retrying in ' + CDP_RETRY_DELAY + 'ms...');
            await sleep(CDP_RETRY_DELAY);
            return attachDebugger(port, adbConn, attempt + 1);
        }
        console.error('attachDebugger failed after ' + CDP_RETRIES + ' attempts:', err.message);
    }
}

// Poll SDB until the app process appears, then relaunch in debug mode to enable injection.
// This fires after the user explicitly opens TizenTube from the TV home screen.
function pollForApp() {
    const adb = adbhost.createConnection({ host: tvIp, port: 26101 });
    adb._intentionalClose = false;

    adb._stream.on('connect', () => {
        const shell = adb.createStream('shell:0 ps');
        let output = '';
        shell.on('data', d => { output += d.toString(); });
        shell.on('end', () => {
            adb._intentionalClose = true;
            adb._stream.end();
            if (output.includes('TZTubeAlne')) {
                console.log('TizenTube detected running — switching to debug mode...');
                launchAndInject();
            } else {
                setTimeout(pollForApp, 2000);
            }
        });
        // Fallback: if shell never sends 'end', move on after 3s
        setTimeout(() => {
            if (!adb._intentionalClose) {
                adb._intentionalClose = true;
                adb._stream.end();
                setTimeout(pollForApp, 2000);
            }
        }, 3000);
    });

    adb._stream.on('error', () => setTimeout(pollForApp, 3000));
    adb._stream.on('close', () => {});
}

function launchAndInject() {
    console.log('Connecting to TV SDB at ' + tvIp + ':26101...');
    const adb = adbhost.createConnection({ host: tvIp, port: 26101 });

    adb._stream.on('connect', () => {
        console.log('SDB connected. Launching ' + APP_ID + ' in debug mode...');
        const shell = adb.createStream('shell:0 debug ' + APP_ID);
        shell.on('data', data => {
            const s = data.toString();
            if (s.includes('debug')) {
                const port = s.substring(s.indexOf(':') + 1, s.indexOf(':') + 7).trim();
                console.log('Debug port: ' + port);
                attachDebugger(parseInt(port), adb);
            }
        });
    });

    adb._stream.on('error', err => {
        console.error('SDB error: ' + err.message + '. Retrying in 5s...');
        setTimeout(launchAndInject, 5000);
    });

    adb._stream.on('close', () => {
        if (adb._intentionalClose) return;
        console.log('SDB disconnected unexpectedly. Polling for app in 3s...');
        setTimeout(pollForApp, 3000);
    });
}

launchAndInject();
