#!/usr/bin/env node

var fs = require('fs');
var util = require('util');

var defaultServices = 'cloudwatch,dynamodb,kinesis,s3,sqs,sns,sts';
var sanitizeRegex = /[^a-zA-Z0-9,-]/;

function Builder(options) {
  this.setDefaultOptions(options);
  this.loadAWS();
  this.setServiceClasses();
  this.code = '';
  this.serviceCode = [];
  this.builtServices = {};
  this.license = [
    '// AWS SDK for JavaScript v' + (this.AWS ? this.AWS.VERSION : 'UNKNOWN'),
    '// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
    '// License at https://sdk.amazonaws.com/js/BUNDLE_LICENSE.txt'
  ].join('\n') + '\n';

  if (this.options.cache && !this.cacheExists()) {
    fs.mkdirSync(this.cachePath());
  }
}

Builder.prototype.getRootPath = function() {
  if (fs.existsSync(__dirname + '/../lib/aws.js')) {
    return __dirname + '/../';
  } else {
    return __dirname + '/node_modules/aws-sdk';
  }
}

Builder.prototype.setDefaultOptions = function(options) {
  this.options = options || {};
  this.options.libPath = this.options.libPath || this.getRootPath();
  this.options.cacheRoot = this.options.cacheRoot ||
    this.options.libPath + '/dist-tools/cache';
  this.options.cache = this.options.cache || false;
  this.options.minify = this.options.minify || false;
  this.options.minifyOptions = this.options.minifyOptions || {compress: false};
};

Builder.prototype.loadAWS = function() {
  try {
    this.AWS = require(this.options.libPath + '/lib/aws');
  } catch (e) { // cannot load AWS, allow this if cache is on
    if (this.options.cache) this.AWS = null;
    else throw e;
  }
}

Builder.prototype.setServiceClasses = function() {
  this.serviceClasses = {};
  if (!this.AWS) return;
  this.AWS.util.each.call(this, this.AWS, function(name, serviceClass) {
    if (serviceClass.serviceIdentifier) {
      this.serviceClasses[serviceClass.serviceIdentifier] = serviceClass;
    }
  });
};

Builder.prototype.cachePath = function(path) {
  var fullPath = this.options.cacheRoot;
  if (path) {
    fullPath += '/' + path + (this.options.minify ? '.min' : '') + '.js';
  }

  return fullPath;
};

Builder.prototype.cacheExists = function(path) {
  return fs.existsSync(this.cachePath(path));
};

Builder.prototype.className = function(api) {
  var name = api.serviceAbbreviation || api.serviceFullName;
  name = name.replace(/^Amazon|AWS\s*|\(.*|\s+|\W+/g, '');
  if (name === 'ElasticLoadBalancing') name = 'ELB';
  else if (name === 'SWF') name = 'SimpleWorkflow';
  return name;
};

Builder.prototype.buildService = function(name) {
  var self = this;
  if (name === 'all') {
    return Object.keys(self.serviceClasses).map(function(service) {
      var out = self.serviceClasses[service].apiVersions.map(function(version) {
        if (version.indexOf('*') >= 0) return null;
        return self.buildService(service + '-' + version);
      }).filter(function(c) { return c !== null; }).join('\n');
      self.buildService(service); // build 'latest', but don't add it to code
      return out;
    }).join('\n');
  }

  var match = name.match(/^(.+?)(?:-(.+?))?$/);
  var service = match[1], version = match[2] || 'latest';
  var contents = [];

  if (!self.builtServices[service]) {
    self.builtServices[service] = {};

    if (self.options.cache && self.cacheExists(service)) {
      contents.push(fs.readFileSync(self.cachePath(service)).toString());
    } else if (this.serviceClasses[service]) {
      var svcPath = self.options.libPath + '/lib/services/' + service + '.js';
      var lines = fs.readFileSync(svcPath).toString().split(/\r?\n/);
      var file = lines.map(function (line) {
        line = line.replace(/^var\s*.*\s*=\s*require\s*\(.+\).*/, '');
        line = line.replace(/^module.exports\s*=.*/, '');
        line = line.replace(/\bAWS\b/g, 'window.AWS');
        return line;
      }).join('\n');
      if (self.options.minify) file = self.minify(file);
      else file = self.stripComments(file);
      if (self.options.cache) fs.writeFileSync(self.cachePath(service), file);

      contents.push(file);
    } else {
      throw new Error('Invalid module: ' + service);
    }
  }

  if (!self.builtServices[service][version]) {
    self.builtServices[service][version] = true;

    var cacheName = service + '-' + version;
    if (self.options.cache && self.cacheExists(cacheName)) {
      contents.push(fs.readFileSync(self.cachePath(cacheName)).toString());
    } else if (this.serviceClasses[service]) {
      var svc = new this.serviceClasses[service]({apiVersion: version});
      var line = util.format(
        'window.AWS.Service.defineServiceApi(window.AWS.%s, "%s", %s);',
        self.className(svc.api), svc.api.apiVersion, JSON.stringify(svc.api));
      if (self.options.cache) fs.writeFileSync(self.cachePath(cacheName), line);
      contents.push(line);
    } else {
      throw new Error('Invalid module: ' + service + '-' + version);
    }
  }

  return contents.join('\n');
};

Builder.prototype.addServices = function(services) {
  var self = this;
  services = services || defaultServices;
  if (services.match(sanitizeRegex)) {
    throw new Error('Incorrectly formatted service names');
  }

  var invalidModules = [];
  services.split(',').sort().forEach(function(name) {
    try {
      self.serviceCode.push(self.buildService(name));
    } catch (e) {
      invalidModules.push(name);
    }
  });

  if (invalidModules.length > 0) {
    throw new Error('Missing modules: ' + invalidModules.join(', '));
  }

  return self;
};

Builder.prototype.build = function(callback) {
  var self = this;

  if (this.options.cache && this.cacheExists('core')) {
    this.code = fs.readFileSync(this.cachePath('core')).toString();
    callback(null, this.code + ';' + this.serviceCode.join('\n'));
  } else {
    var browserFile = this.options.libPath + '/lib/browser.js';
    var browserify = require('browserify');
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
  var uglify = require('uglify-js');

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
    cacheRoot: process.env.CACHE_ROOT,
    libPath: process.env.LIB_PATH
  };
  var services = process.argv[2] || process.env.SERVICES;
  new Builder(options).addServices(services).build(function (err, code) {
    if (err) console.error(err.message);
    else console.log(code);
  });
}

module.exports = Builder;
