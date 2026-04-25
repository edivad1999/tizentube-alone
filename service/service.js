var dial = require('@patrickkfkan/peer-dial');
var express = require('express');
var cors = require('cors');

var app = express();

app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
}));

var PORT = 8085;
var APP_SUFFIX = 'TizenTubeStandalone';

var ytApp = {
    name: 'YouTube',
    state: 'stopped',
    allowStop: true,
    pid: null,
    additionalData: {},
    launch: function() {
        var pkgId = tizen.application.getAppInfo().packageId;
        tizen.application.launchAppControl(
            new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view'),
            pkgId + '.' + APP_SUFFIX,
            null,
            null
        );
    }
};

var dialServer = new dial.Server({
    expressApp: app,
    port: PORT,
    prefix: '/dial',
    manufacturer: 'TizenTube',
    modelName: 'TizenTubeStandalone',
    friendlyName: 'TizenTube',
    delegate: {
        getApp: function(name) {
            return name === 'YouTube' ? ytApp : null;
        },
        launchApp: function(appName, launchData, callback) {
            if (appName !== 'YouTube') { callback(null); return; }
            var parsed = launchData.split('&').reduce(function(acc, cur) {
                var parts = cur.split('=');
                var key = parts[0];
                var value = parts[1];
                acc[key] = value !== undefined ? value : '';
                return acc;
            }, {});
            if (parsed.yumi) {
                ytApp.additionalData = parsed;
                ytApp.state = 'running';
                callback('');
                return;
            }
            ytApp.pid = 'run';
            ytApp.state = 'starting';
            ytApp.launch();
            ytApp.state = 'running';
            callback(ytApp.pid);
        },
        stopApp: function(appName, pid, callback) {
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

setInterval(function() {
    tizen.application.getAppsContext(function(ctxList) {
        var pkgId = tizen.application.getAppInfo().packageId;
        var found = false;
        for (var i = 0; i < ctxList.length; i++) {
            if (ctxList[i].appId === pkgId + '.' + APP_SUFFIX) {
                found = true;
                break;
            }
        }
        if (!found) {
            ytApp.state = 'stopped';
            ytApp.pid = null;
            ytApp.additionalData = {};
        }
    });
}, 5000);

app.listen(PORT, function() {
    dialServer.start();
    console.log('TizenTube DIAL service running on port ' + PORT);
});
