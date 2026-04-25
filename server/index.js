#!/usr/bin/env node
import adbhost from 'adbhost';
import nodeFetch from 'node-fetch';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ID = 'TZTubeAlne.TizenTubeStandalone';

const tvIp = process.argv[2];
if (!tvIp) {
    console.error('Usage: node server/index.js <TV_IP>');
    console.error('Example: node server/index.js 192.168.1.50');
    process.exit(1);
}

let userScript;
try {
    userScript = readFileSync(join(__dirname, '..', 'dist', 'userScript.js'), 'utf-8');
    console.log('userScript loaded (' + userScript.length + ' bytes)');
} catch {
    console.error('dist/userScript.js not found — run build/wrap-tizen.sh first.');
    process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function attachDebugger(port, adbConn) {
    try {
        const res = await nodeFetch(`http://${tvIp}:${port}/json`);
        const targets = await res.json();
        if (!targets[0]?.webSocketDebuggerUrl) throw new Error('No debugger URL in /json response');

        const wsUrl = targets[0].webSocketDebuggerUrl;
        adbConn._stream.end();

        console.log('CDP: connecting to', wsUrl);
        const ws = new WebSocket(wsUrl);
        let msgId = 12;

        ws.on('open', () => {
            ws.send(JSON.stringify({ id: 7,  method: 'Debugger.enable' }));
            ws.send(JSON.stringify({ id: 11, method: 'Runtime.enable' }));
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (
                msg.method === 'Runtime.executionContextCreated' &&
                msg.params?.context?.origin === 'https://www.youtube.com'
            ) {
                console.log('YouTube TV context detected — injecting userScript...');
                ws.send(JSON.stringify({
                    id: msgId++,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: userScript,
                        contextId: msg.params.context.id,
                        objectGroup: 'console',
                        includeCommandLineAPI: true,
                        doNotPauseOnExceptionsAndMuteConsole: false,
                        returnByValue: false,
                        generatePreview: false,
                    }
                }));
                console.log('userScript injected successfully.');
            }
        });

        ws.on('error', err => console.error('CDP WebSocket error:', err.message));
        ws.on('close', () => console.log('CDP connection closed — re-inject on next launch.'));
    } catch (err) {
        console.error('attachDebugger failed:', err.message);
    }
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
        console.log('SDB disconnected.');
    });
}

launchAndInject();
