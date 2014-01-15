#!/usr/bin/env node

var fs = require('fs');
var exec = require('child_process').exec;
var https = require('https');

var Builder = require('./browser-builder');

function init(cb) {
  var versions = fs.readFileSync(__dirname + '/server-versions.txt');
  versions = versions.toString().split(/\r?\n/).filter(function(v) {
    return v && v.length > 0;
  });
  console.log('* Setting up versions: ' + versions.join(', '));

  var sdkDir = __dirname + '/sdks';
  if (!fs.existsSync(sdkDir)) fs.mkdirSync(sdkDir);

  var libPaths = {};
  var numLoaded = 0;
  versions.forEach(function (version) {
    downloadVersion(version, function() {
      var libPath = __dirname + '/sdks/' + version;
      libPaths[version] = libPath;
      new Builder({cache: true, minify: true, libPath: libPath}).addServices('all').build(function() {
        console.log('* Built minified ' + version);

        new Builder({cache: true, libPath: libPath}).addServices('all').build(function() {
          console.log('* Built unminified ' + version);

          numLoaded++;

          if (numLoaded >= versions.length) {
            cb(libPaths);
          }
        });
      });
    });
  });
}

function downloadVersion(version, cb) {
  var sdkName = version;
  var versionDirname = __dirname + '/sdks/' + sdkName;
  if (!fs.existsSync(versionDirname)) {
    var n = version.replace(/^v/, '');
    fs.mkdirSync(versionDirname);

    console.log('* Downloading ' + sdkName);
    exec('curl https://registry.npmjs.org/aws-sdk/-/aws-sdk-' + n + '.tgz | ' +
         'tar xfz - -C ' + versionDirname + ' --strip=1', function(err, stdout, stderr) {
      if (err) {
        console.log('* Could not download', sdkName);
        console.log(stderr);
        process.exit(1);
        return;
      }
      cb();
    });
  } else { cb(); }
}

// run if we called this tool directly
if (require.main === module) init(function() {
  console.log('* Done initializing server');
});

module.exports = init;
