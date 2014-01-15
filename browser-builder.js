#!/usr/bin/env node

var fs = require('fs');
var util = require('util');

var browserify = require('browserify');
var uglify = require('uglify-js');

var defaultServices = 'dynamodb,s3,sqs,sns,sts';
var sanitizeRegex = /[^a-zA-Z0-9,-]/;

function Builder(options) {
  this.setDefaultOptions(options);
  this.loadAWS();
  this.setServiceClasses();
  this.code = '';
  this.serviceCode = [];
  this.license = [
    '// AWS SDK for JavaScript v' + this.AWS.VERSION,
    '// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
    '// License at https://sdk.amazonaws.com/js/BUNDLE_LICENSE.txt'
  ].join('\n') + '\n';

  if (this.options.cache && !this.cacheExists()) {
    fs.mkdirSync(this.cachePath());
  }
}

Builder.prototype.getRootPath = function() {
  var root = __dirname + '/aws-sdk';
  if (!fs.existsSync(root)) root = __dirname + '/..';
  return root;
}

Builder.prototype.setDefaultOptions = function(options) {
  this.options = options || {};
  this.options.libPath = this.options.libPath || this.getRootPath();
  this.options.cache = this.options.cache || false;
  this.options.minify = this.options.minify || false;
  this.options.minifyOptions = this.options.minifyOptions || {compress: false};
};

Builder.prototype.loadAWS = function() {
  this.AWS = require(this.options.libPath + '/lib/aws');
}

Builder.prototype.setServiceClasses = function() {
  this.serviceClasses = {};
  this.AWS.util.each.call(this, this.AWS, function(name, serviceClass) {
    if (serviceClass.serviceIdentifier) {
      this.serviceClasses[serviceClass.serviceIdentifier] = serviceClass;
    }
  });
};

Builder.prototype.cachePath = function(path) {
  var fullPath = this.options.libPath + '/dist-tools/cache';
  if (path) {
    fullPath += '/' + path + (this.options.minify ? '.min' : '') + '.js';
  }

  return fullPath;
};

Builder.prototype.cacheExists = function(path) {
  return fs.existsSync(this.cachePath(path));
};

Builder.prototype.buildServiceMap = function(services) {
  var self = this, map = {}, invalidModules = [];
  services.forEach(function(name) {
    if (name === 'all') {
      Object.keys(self.serviceClasses).forEach(function(svcName) {
        var svc = new self.serviceClasses[svcName]();
        map[svcName] = map[svcName] || {};
        map[svcName][svc.api.apiVersion] = svc;
      });
    } else {
      var match = name.match(/^(.+?)(?:-(.+?))?$/);
      var service = match[1], version = match[2];
      if (self.serviceClasses[service]) {
        map[service] = map[service] || {};
        try {
          var opts = version ? {apiVersion: version} : {};
          var svc = new self.serviceClasses[service](opts);
          map[service][svc.api.apiVersion] = svc;
        } catch (e) {
          invalidModules.push(service + (version ? '-' + version : ''));
        }
      } else {
        invalidModules.push(service);
      }
    }
  });

  if (invalidModules.length > 0) {
    throw new Error('Missing modules: ' + invalidModules.join(', '));
  }

  return map;
}

Builder.prototype.className = function(api) {
  var name = api.serviceAbbreviation || api.serviceFullName;
  name = name.replace(/^Amazon|AWS\s*|\(.*|\s+|\W+/g, '');
  if (name === 'ElasticLoadBalancing') name = 'ELB';
  else if (name === 'SWF') name = 'SimpleWorkflow';
  return name;
};

Builder.prototype.buildService = function(service, versions) {
  var self = this;
  var svcPath = self.options.libPath + '/lib/services/' + service + '.js';
  var ServiceClass = self.serviceClasses[service];
  var contents = [];

  if (self.options.cache && self.cacheExists(service)) {
    contents.push(fs.readFileSync(self.cachePath(service)).toString());
  } else {
    var lines = fs.readFileSync(svcPath).toString().split(/\r?\n/);
    var file = lines.map(function (line) {
      line = line.replace(/^var\s*.*\s*=\s*require\s*\(.+\).*/, '');
      line = line.replace(/^module.exports\s*=.*/, '');
      return line;
    }).join('\n');
    if (self.options.minify) file = self.minify(file);
    else file = self.stripComments(file);
    if (self.options.cache) fs.writeFileSync(self.cachePath(service), file);

    contents.push(file);
  }

  Object.keys(versions).forEach(function(version) {
    var svc = versions[version];
    var cacheName = service + '-' + version;
    if (self.options.cache && self.cacheExists(cacheName)) {
      contents.push(fs.readFileSync(self.cachePath(cacheName)).toString());
    } else {
      var line = util.format('AWS.Service.defineServiceApi(AWS.%s, "%s", %s);',
        self.className(svc.api), version, JSON.stringify(svc.api));
      if (self.options.cache) fs.writeFileSync(self.cachePath(cacheName), line);
      contents.push(line);
    }
  });

  return contents.join('\n');
};

Builder.prototype.addServices = function(services) {
  var self = this;
  services = services || defaultServices;
  if (services.match(sanitizeRegex)) {
    throw new Error('Incorrectly formatted service names');
  }

  var map = self.buildServiceMap(services.split(','));
  Object.keys(map).forEach(function(name) {
    self.serviceCode.push(self.buildService(name, map[name]));
  });

  return self;
};

Builder.prototype.build = function(callback) {
  var self = this;

  if (this.options.cache && this.cacheExists('core')) {
    this.code = fs.readFileSync(this.cachePath('core')).toString();
    callback(null, this.code + ';' + this.serviceCode.join('\n'));
  } else {
    var browserFile = this.options.libPath + '/lib/browser.js';
    browserify(browserFile).ignore('domain').bundle(function (err, data) {
      if (err) return callback(err);

      self.code = (data || '').toString();

      if (self.options.minify) self.code = self.minify();
      else self.code = self.stripComments();

      self.code = self.license + self.code;
      if (self.options.cache) fs.writeFileSync(self.cachePath('core'), self.code);

      callback(null, self.code + ';' + self.serviceCode.join('\n'));
    });
  }

  return this;
};

Builder.prototype.minify = function(code) {
  this.options.minifyOptions = this.options.minifyOptions || {};
  this.options.minifyOptions.fromString = true;

  var minified = uglify.minify(code || this.code, this.options.minifyOptions);
  return minified.code;
};

Builder.prototype.stripComments = function(code) {
  var lines = (code || this.code).split(/\r?\n/);
  var multiLine = false;
  lines = lines.map(function (line) {
    rLine = line;
    if (line.match(/^\s*\/\//)) {
      rLine = null;
    } else if (line.match(/^\s*\/\*/)) {
      multiLine = true;
      rLine = null;
    }

    if (multiLine) {
      var multiLineEnd = line.match(/\*\/(.*)/);
      if (multiLineEnd) {
        multiLine = false;
        rLine = multiLineEnd[1];
      } else {
        rLine = null;
      }
    }

    return rLine;
  }).filter(function(l) { return l != null; });

  var newCode = lines.join('\n');
  newCode = newCode.replace(/\/\*\*[\s\S]+?Copyright\s+.+?Amazon[\s\S]+?\*\//g, '');
  return newCode;
};

// run if we called this tool directly
if (require.main === module) {
  var options = {
    minify: process.env.MINIFY ? true : false,
    cache: process.env.CACHE ? true : false,
    libPath: process.env.LIB_PATH
  };
  var services = process.argv[2] || process.env.SERVICES;
  new Builder(options).addServices(services).build(function (err, code) {
    if (err) console.error(err.message);
    else console.log(code);
  });
}

module.exports = Builder;
