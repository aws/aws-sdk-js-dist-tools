#!/usr/bin/env node
/* eslint no-process-exit:0 */

var fs = require('graceful-fs');
var path = require('path');
var exec = require('child_process').exec;
var async = require('async');
var https = require('https');

var Builder = require('aws-sdk/dist-tools/browser-builder');

function buildVersion(done) {
  if (!this.writeCache) return done();

  if (this.minify) {
    console.log('* Building min/unmin cache for ' + this.version);
  }
  new Builder(this).addServices('all').build(done);
}

function downloadVersion(done) {
  var version = this.version;
  var sdkName = version;
  var versionDirname = path.join(__dirname, 'sdks', sdkName);
  if (fs.existsSync(versionDirname)) return done();

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
    done();
  });
}

function npmInstall(done) {
  var version = this.version;
  var sdkName = version;
  var versionDirname = path.join(__dirname, 'sdks', sdkName);
  if (fs.existsSync(path.join(versionDirname, 'node_modules'))) return done();

  console.log('* npm install for ' + sdkName);
  exec('cd ' + versionDirname + ' && npm install --production', function(err, stdout, stderr) {
    if (err) {
      console.log('* Could not npm install', sdkName);
      console.log(stderr);
      process.exit(1);
      return;
    }
    done();
  });
}

function init(versions, cb) {
  var cache = process.env.NO_CACHE ? false : true;
  console.log('* Setting up versions: ' + versions.join(', '));

  var sdkDir = path.join(__dirname, 'sdks');
  if (!fs.existsSync(sdkDir)) fs.mkdirSync(sdkDir);

  var cacheRoot = path.join(__dirname, 'server-cache');
  if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot);

  var result = {versions: {}, cache: cache};
  async.eachLimit(versions, 4, function(version, done) {
    var libPath = path.join(sdkDir, version);
    result.versions[version] = libPath;

    async.series([
      downloadVersion.bind({version: version}),
      npmInstall.bind({version: version}),
      function(next) {
        var cachePath = path.join(cacheRoot, version);
        if (cache) {
          if (fs.existsSync(cachePath)) return next();
          else fs.mkdirSync(cachePath);
        }

        async.parallel([
          buildVersion.bind({writeCache: cache, minify: true,
            cacheRoot: cachePath, libPath: libPath, version: version}),
          buildVersion.bind({writeCache: cache, minify: false,
            cacheRoot: cachePath, libPath: libPath, version: version})
        ], function() { console.log('* Done building ' + version); next(); });
      },
      function(next) {
        exec('rm -rf ' + sdkDir, next);
      }
    ], done);
  }, function() {
    console.log('* Done loading SDKs.');
    cb(result);
  });
}

// run if we called this tool directly
if (require.main === module) {
  init(process.argv.slice(2), function() {
    console.log('* Done initializing server.');
  });
}

module.exports = init;
