#!/usr/bin/env node

var url = require('url');
var domain = require('domain');
var fs = require('fs');
var path = require('path');
var express = require('express');

var Builder = require('./browser-builder');

var port = process.argv[2] || process.env.PORT;
if (!port && __dirname.match(/\/srv\//)) port = 80;
if (!port) port = 8080;

function domainHandler(request, response, callback) {
  var dom = domain.create();
  dom.add(request);
  dom.add(response);
  dom.on('error', function (err) {
    response.writeHead(400, err.message, {'content-type': 'text/plain'});
    response.end(err.message);
  }).run(function() {
    try { callback(dom); } catch (e) { dom.emit('error', e); }
  });
}

function buildSDK(request, response) {
  domainHandler(request, response, function(dom) {
    var version = request.params[0];
    var params = request.app.get('versions')[version];
    if (!params) {
      var message = 'Unsupported SDK version ' + version;
      response.writeHead(400, message, {'content-type': 'text/plain'});
      response.end(message);
      return;
    }

    var cache = request.app.get('cache');
    var minify = request.params[1] || false;
    params = {
      cache: cache,
      minify: minify,
      libPath: params.libPath,
      cacheRoot: params.cacheRoot
    };

    var query = url.parse(request.url).query;
    if (query) query = query.replace(/=?&/g, ',').replace(/=/, '-');

    new Builder(params).addServices(query).build(function (err, code) {
      if (err) return dom.emit('error', err);

      response.setHeader('content-type', 'text/javascript');
      response.writeHead(200);
      response.write(code);
      response.end();
    });
  });
}

var app = express();
app.use(express.compress());
app.use(express.favicon());
if (require.main === module) {
  app.use(express.logger()); // enable logging only for executable
}
app.get(/^\/aws-sdk-(v\d.+?|latest)(\.min)?\.js$/, buildSDK);

app.init = function() {
  app.set('cache', process.env.NO_CACHE ? false : true);

  var versions = {};
  var cacheDir = path.join(__dirname, 'server-cache');
  if (app.get('cache') && fs.existsSync(cacheDir)) {
    fs.readdirSync(cacheDir).forEach(function(version) {
      versions[version] = { cacheRoot: path.join(cacheDir, version) };
    });
  }
  if (process.env.USE_MASTER) {
    versions.latest = { libPath: path.join(__dirname, '..', '..') };
  }
  app.set('versions', versions);
};

module.exports = app;

// run if we called this tool directly
if (require.main === module) {
  app.init();
  app.listen(port);

  var versionList = Object.keys(app.get('versions')).join(', ');
  console.log('* AWS SDK builder listening on http://localhost:' + port);
  console.log('* Serving versions: ' + versionList);
}
