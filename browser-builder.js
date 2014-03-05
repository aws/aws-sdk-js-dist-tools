#!/usr/bin/env node

var fs = require('fs');
var util = require('util');

var defaultServices = 'cloudwatch,dynamodb,kinesis,s3,sqs,sns,sts';
var sanitizeRegex = /[^a-zA-Z0-9,-]/;

function CacheStrategy(builder) {
  this.builder = builder;
  this.cacheRoot = this.builder.options.cacheRoot;
  this.minify = this.builder.options.minify;

  this.loadServices();
  if (!this.builder.cacheExists()) {
    fs.mkdirSync(this.builder.cachePath());
  }
}

CacheStrategy.prototype.loadServices = function() {
  this.services = {};
  fs.readdirSync(this.cacheRoot).forEach(function(file) {
    var match = file.match(/^([^_-]+)-(latest|\d+-\d+-\d+)\.(?:min\.)?js$/);
    if (match) {
      var service = match[1], version = match[2];
      if (!this.services[service]) this.services[service] = {};
      this.services[service][version] = service + '-' + version;
    }
  }.bind(this));
};

CacheStrategy.prototype.getServiceHeader = function(service) {
  if (service === 'all') {
    return Object.keys(this.services).map(function (name) {
      return this.getServiceHeader(name);
    }.bind(this)).join('\n');
  }

  if (this.services[service] && this.builder.cacheExists(service)) {
    return this.read(service);
  }
  return null;
};

CacheStrategy.prototype.getService = function(service, version) {
  if (service === 'all') {
    return Object.keys(this.services).map(function (name) {
      return this.getService(name);
    }.bind(this)).join('\n');
  }

  var versions = this.services[service];
  if (versions) {
    var file = versions[version || 'latest'];
    if (file && this.builder.cacheExists(file)) {
      return this.read(file);
    }
  }
  return null;
};

CacheStrategy.prototype.getCore = function(callback) {
  if (this.builder.cacheExists('_core')) {
    callback(null, this.read('_core'));
  } else {
    callback(new Error('Core not found.'));
  }
};

CacheStrategy.prototype.read = function(path) {
  return fs.readFileSync(this.builder.cachePath(path)).toString();
};

function DefaultStrategy(builder) {
  this.builder = builder;
  this.libPath = this.builder.options.libPath;
  this.isCached = this.builder.options.writeCache;
  this.isMinified = this.builder.options.minify;
  this.minifyOptions = this.builder.options.minifyOptions || {};
  this.minifyOptions.fromString = true;
  this.AWS = require(this.libPath + '/lib/aws');
  this.license = [
    '// AWS SDK for JavaScript v' + this.AWS.VERSION,
    '// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
    '// License at https://sdk.amazonaws.com/js/BUNDLE_LICENSE.txt'
  ].join('\n') + '\n';
  this.setServiceClasses();

  if (this.isCached && !this.builder.cacheExists()) {
    fs.mkdirSync(this.builder.cachePath());
  }
}

DefaultStrategy.prototype.setServiceClasses = function() {
  this.serviceClasses = {};
  this.AWS.util.each.call(this, this.AWS, function(name, serviceClass) {
    if (serviceClass.serviceIdentifier) {
      this.serviceClasses[serviceClass.serviceIdentifier] = serviceClass;
    }
  });
};

DefaultStrategy.prototype.minify = function(code) {
  var uglify = require('uglify-js');
  var minified = uglify.minify(code, this.minifyOptions);
  return minified.code;
};

DefaultStrategy.prototype.stripComments = function(code) {
  var lines = code.split(/\r?\n/);
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

DefaultStrategy.prototype.className = function(api) {
  var name = api.serviceAbbreviation || api.serviceFullName;
  name = name.replace(/^Amazon|AWS\s*|\(.*|\s+|\W+/g, '');
  if (name === 'ElasticLoadBalancing') name = 'ELB';
  else if (name === 'SWF') name = 'SimpleWorkflow';
  return name;
};

DefaultStrategy.prototype.getServiceHeader = function(service) {
  if (service === 'all') {
    return Object.keys(this.serviceClasses).map(function(service) {
      return this.getServiceHeader(service);
    }.bind(this)).join('\n');
  }

  var svcPath = this.libPath + '/lib/services/' + service + '.js';
  if (!fs.existsSync(svcPath)) return null;

  var lines = fs.readFileSync(svcPath).toString().split(/\r?\n/);
  var file = lines.map(function (line) {
    line = line.replace(/^var\s*.*\s*=\s*require\s*\(.+\).*/, '');
    line = line.replace(/^module.exports\s*=.*/, '');
    line = line.replace(/\bAWS\b/g, 'window.AWS');
    return line;
  }).join('\n');
  if (this.isMinified) file = this.minify(file);
  else file = this.stripComments(file);

  if (this.isCached) {
    fs.writeFileSync(this.builder.cachePath(service), file);
  }

  return file;
};

DefaultStrategy.prototype.getService = function(service, version) {
  if (service === 'all') {
    return Object.keys(this.serviceClasses).map(function(service) {
      var out = this.serviceClasses[service].apiVersions.map(function(version) {
        if (version.indexOf('*') >= 0) return null;
        return this.getService(service, version);
      }.bind(this)).filter(function(c) { return c !== null; }).join('\n');

      if (this.isCached) {
        // build 'latest', but don't add it to code (for caching)
        this.getService(service, 'latest');
      }

      return out;
    }.bind(this)).join('\n');
  }

  var svc;
  if (!this.serviceClasses[service]) {
    return null;
  }

  try {
    var svc = new this.serviceClasses[service]({apiVersion: version});
  } catch (e) {
    return null;
  }

  var line = util.format(
    'window.AWS.Service.defineServiceApi(window.AWS.%s, "%s", %s);',
    this.className(svc.api), svc.api.apiVersion, JSON.stringify(svc.api));

  if (this.isCached) {
    fs.writeFileSync(this.builder.cachePath(service + '-' + version), line);
  }

  return line;
};

DefaultStrategy.prototype.getCore = function(callback) {
  var browserify = require('browserify');
  var browserFile = this.libPath + '/lib/browser.js';
  browserify(browserFile).ignore('domain').bundle(function (err, data) {
    if (err) return callback(err);

    var code = (data || '').toString();
    if (this.isMinified) code = this.minify(code);
    else code = this.stripComments(code);

    code = this.license + code;
    if (this.isCached) {
      fs.writeFileSync(this.builder.cachePath('_core'), code);
    }

    callback(null, code);
  }.bind(this));
};

function Builder(options) {
  this.setDefaultOptions(options);
  this.serviceCode = [];
  this.builtServices = {};
  this.buildStrategy = this.options.cache ?
    new CacheStrategy(this) : new DefaultStrategy(this);
}

Builder.prototype.setDefaultOptions = function(options) {
  this.options = options || {};
  this.options.libPath = this.options.libPath || this.getRootPath();
  this.options.cacheRoot = this.options.cacheRoot ||
    this.options.libPath + '/dist-tools/cache';
  this.options.cache = this.options.cache || false;
  this.options.writeCache = this.options.writeCache || false;
  this.options.minify = this.options.minify || false;
  this.options.minifyOptions = this.options.minifyOptions || {compress: false};
};

Builder.prototype.getRootPath = function() {
  if (fs.existsSync(__dirname + '/../lib/aws.js')) {
    return __dirname + '/../';
  } else {
    return __dirname + '/node_modules/aws-sdk';
  }
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

Builder.prototype.buildService = function(name, usingDefaultServices) {
  var match = name.match(/^(.+?)(?:-(.+?))?$/);
  var service = match[1], version = match[2] || 'latest';
  var contents = [];

  if (!this.builtServices[service]) {
    this.builtServices[service] = {};

    var lines = this.buildStrategy.getServiceHeader(service);
    if (lines === null) {
      if (!usingDefaultServices) {
        var err = new Error('Invalid module: ' + service);
        err.name = 'InvalidModuleError';
        throw err;
      }
    } else {
      contents.push(lines);
    }
  }

  if (!this.builtServices[service][version]) {
    this.builtServices[service][version] = true;

    var lines = this.buildStrategy.getService(service, version);
    if (lines === null) {
      if (!usingDefaultServices) {
        var err = new Error('Invalid module: ' + service + '-' + version);
        err.name = 'InvalidModuleError';
        throw err;
      }
    } else {
      contents.push(lines);
    }
  }

  return contents.join('\n');
};

Builder.prototype.addServices = function(services) {
  var usingDefaultServices = false;
  if (!services) {
    usingDefaultServices = true;
    services = defaultServices;
  }
  if (services.match(sanitizeRegex)) {
    throw new Error('Incorrectly formatted service names');
  }

  var invalidModules = [];
  var stsIncluded = false;
  services.split(',').sort().forEach(function(name) {
    if (name.match(/^sts\b/) || name === 'all') stsIncluded = true;
    try {
      this.serviceCode.push(this.buildService(name, usingDefaultServices));
    } catch (e) {
      if (e.name === 'InvalidModuleError') invalidModules.push(name);
      else throw e;
    }
  }.bind(this));

  if (!stsIncluded) {
    this.serviceCode.push(this.buildService('sts'));
  }

  if (invalidModules.length > 0) {
    throw new Error('Missing modules: ' + invalidModules.join(', '));
  }

  return this;
};

Builder.prototype.build = function(callback) {
  this.buildStrategy.getCore(function(err, core) {
    callback(err, err ? null : (core + ';' + this.serviceCode.join('\n')));
  }.bind(this));
};

// run if we called this tool directly
if (require.main === module) {
  var options = {
    minify: process.env.MINIFY ? true : false,
    cache: process.env.CACHE ? true : false,
    writeCache: process.env.WRITE_CACHE ? true : false,
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
