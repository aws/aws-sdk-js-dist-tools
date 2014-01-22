#!/usr/bin/env node

var fs = require('graceful-fs');
var exec = require('child_process').exec;
var async = require('async');
var https = require('https');

var Builder = require('./browser-builder');

function init(cb) {
  var cache = process.env.NO_CACHE ? false : true;
  var versions = fs.readFileSync(__dirname + '/server-versions.txt');
  versions = versions.toString().split(/\r?\n/).filter(function(v) {
    return v && v.length > 0;
  });
  console.log('* Setting up versions: ' + versions.join(', '));

  var sdkDir = __dirname + '/server-cache';
  if (!fs.existsSync(sdkDir)) fs.mkdirSync(sdkDir);

  var result = {libPaths: {}, cache: cache};
  async.eachLimit(versions, 4, function(version, done) {
    var libPath = sdkDir + '/' + version;
    result.libPaths[version] = libPath;

    async.series([
      downloadVersion.bind({version: version}),
      function(next) {
        var cachePath = libPath + '/dist-tools/cache';
        if (cache && fs.existsSync(cachePath)) return next();

        async.parallel([
          buildVersion.bind({cache: cache, minify: true,
            libPath: libPath, version: version}),
          buildVersion.bind({cache: cache, minify: false,
            libPath: libPath, version: version})
        ], function() { console.log('* Done building ' + version); next(); });
      }
    ], done);
  }, function() {
    console.log('* Done loading SDKs.');
    cb(result);
  });
}

function buildVersion(done) {
  if (!this.cache) return done();

  if (this.minify) {
    console.log('* Building min/unmin cache for ' + this.version);
  }
  new Builder(this).addServices('all').build(done);
}

function downloadVersion(done) {
  var version = this.version;
  var sdkName = version;
  var versionDirname = __dirname + '/server-cache/' + sdkName;
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

// run if we called this tool directly
if (require.main === module) {
  init(function() { console.log('* Done initializing server.'); });
}

module.exports = init;
