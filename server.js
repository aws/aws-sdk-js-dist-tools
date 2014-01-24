var url = require('url');
var domain = require('domain');

var express = require('express');

var Builder = require('./browser-builder');

var port = process.argv[2] || process.env.PORT || 8080;

function domainHandler(request, response, callback) {
  var dom = domain.create();
  dom.add(request);
  dom.add(response);
  dom.on('error', function (err) {
    response.writeHead(400, err.message, {'content-type': 'text/plain'});
    response.end(err.message);
  }).run(function() {
    try { callback(dom) } catch (e) { dom.emit('error', e); }
  });
}

function buildSDK(request, response) {
  domainHandler(request, response, function(dom) {
    var version = request.params[0];
    var libPath = request.app.get('libPaths')[version];
    var cache = request.app.get('cache');
    if (!libPath) {
      var message = 'Unsupported SDK version ' + version;
      response.writeHead(400, message, {'content-type': 'text/plain'});
      response.end(message);
      return;
    }

    var minify = request.params[1] || false;
    var query = url.parse(request.url).query;
    if (query) query = query.replace(/=?&/g, ',').replace(/=/, '-');

    new Builder({cache: cache, minify: minify, libPath: libPath}).
                addServices(query).build(function (err, code) {
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
app.get(/^\/aws-sdk-(v\d.+?)(\.min)?\.js$/, buildSDK);

module.exports = app;

// run if we called this tool directly
if (require.main === module) {
  require('./server-init')(function(result) {
    app.set('cache', result.cache);
    app.set('libPaths', result.libPaths);
    app.listen(port);
    console.log('* aws-sdk builder listening on http://localhost:' + port);
  });
}
