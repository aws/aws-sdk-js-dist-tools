window.AWS.S3 = window.AWS.Service.defineService('s3');


window.AWS.util.update(window.AWS.S3.prototype, {

  initialize: function initialize(options) {
    window.AWS.Service.prototype.initialize.call(this, options);
    this.setEndpoint((options || {}).endpoint, options);
  },


  setupRequestListeners: function setupRequestListeners(request) {
    request.addListener('build', this.addContentType);
    request.addListener('build', this.populateURI);
    request.addListener('build', this.computeContentMd5);
    request.addListener('build', this.computeSha256);
    request.removeListener('validate',
      window.AWS.EventListeners.Core.VALIDATE_REGION);
    request.addListener('extractError', this.extractError);
    request.addListener('extractData', this.extractData);
    request.addListener('beforePresign', this.prepareSignedUrl);
  },


  populateURI: function populateURI(req) {
    var httpRequest = req.httpRequest;
    var b = req.params.Bucket;

    if (b) {
      if (!req.service.pathStyleBucketName(b)) {
        httpRequest.endpoint.hostname = b + '.' + httpRequest.endpoint.hostname;

        var port = httpRequest.endpoint.port;
        if (port !== 80 && port !== 443) {
          httpRequest.endpoint.host = httpRequest.endpoint.hostname + ':' +
            httpRequest.endpoint.port;
        } else {
          httpRequest.endpoint.host = httpRequest.endpoint.hostname;
        }

        httpRequest.virtualHostedBucket = b; // needed for signing the request
        httpRequest.path = httpRequest.path.replace(new RegExp('/' + b), '');
        if (httpRequest.path[0] !== '/') {
          httpRequest.path = '/' + httpRequest.path;
        }
      }
    }
  },


  addContentType: function addContentType(req) {
    var httpRequest = req.httpRequest;
    if (!httpRequest.headers['Content-Type']) { // always have a Content-Type
      httpRequest.headers['Content-Type'] = 'application/octet-stream';
    }

    var contentType = httpRequest.headers['Content-Type'];
    if (window.AWS.util.isBrowser()) {
      if (typeof httpRequest.body === 'string' && !contentType.match(/;\s*charset=/)) {
        var charset = '; charset=UTF-8';
        httpRequest.headers['Content-Type'] += charset;
      } else {
        var replaceFn = function(_, prefix, charset) {
          return prefix + charset.toUpperCase();
        };

        httpRequest.headers['Content-Type'] =
          contentType.replace(/(;\s*charset=)(.+)$/, replaceFn);
      }
    }
  },


  computableChecksumOperations: {
    putBucketCors: true,
    putBucketLifecycle: true,
    putBucketTagging: true,
    deleteObjects: true
  },


  willComputeChecksums: function willComputeChecksums(req) {
    if (this.computableChecksumOperations[req.operation]) return true;
    if (!this.config.computeChecksums) return false;

    if (!window.AWS.util.Buffer.isBuffer(req.httpRequest.body) &&
        typeof req.httpRequest.body !== 'string') {
      return false;
    }

    var rules = req.service.api.operations[req.operation].input.members;

    if (req.service.getSignerClass(req) === window.AWS.Signers.V4) {
      if (rules.ContentMD5 && !rules.ContentMD5.required) return false;
    }

    if (rules.ContentMD5 && !req.params.ContentMD5) return true;
  },


  computeContentMd5: function computeContentMd5(req) {
    if (req.service.willComputeChecksums(req)) {
      var md5 = window.AWS.util.crypto.md5(req.httpRequest.body, 'base64');
      req.httpRequest.headers['Content-MD5'] = md5;
    }
  },


  computeSha256: function computeSha256(req) {
    if (req.service.getSignerClass(req) === window.AWS.Signers.V4) {
      req.httpRequest.headers['X-Amz-Content-Sha256'] =
        window.AWS.util.crypto.sha256(req.httpRequest.body || '', 'hex');
    }
  },


  pathStyleBucketName: function pathStyleBucketName(bucketName) {
    if (this.config.s3ForcePathStyle) return true;

    if (this.dnsCompatibleBucketName(bucketName)) {
      return (this.config.sslEnabled && bucketName.match(/\./)) ? true : false;
    } else {
      return true; // not dns compatible names must always use path style
    }
  },


  dnsCompatibleBucketName: function dnsCompatibleBucketName(bucketName) {
    var b = bucketName;
    var domain = new RegExp(/^[a-z0-9][a-z0-9\.\-]{1,61}[a-z0-9]$/);
    var ipAddress = new RegExp(/(\d+\.){3}\d+/);
    var dots = new RegExp(/\.\./);
    return (b.match(domain) && !b.match(ipAddress) && !b.match(dots)) ? true : false;
  },


  escapePathParam: function escapePathParam(value) {
    return window.AWS.util.uriEscapePath(String(value));
  },


  successfulResponse: function successfulResponse(resp) {
    var req = resp.request;
    var httpResponse = resp.httpResponse;
    if (req.operation === 'completeMultipartUpload' &&
        httpResponse.body.toString().match('<Error>'))
      return false;
    else
      return httpResponse.statusCode < 300;
  },


  retryableError: function retryableError(error, request) {
    if (request.operation === 'completeMultipartUpload' &&
        error.statusCode === 200) {
      return true;
    } else {
      var _super = window.AWS.Service.prototype.retryableError;
      return _super.call(this, error, request);
    }
  },


  extractData: function extractData(resp) {
    var req = resp.request;
    if (req.operation === 'getBucketLocation') {
      var match = resp.httpResponse.body.toString().match(/>(.+)<\/Location/);
      if (match) {
        delete resp.data['_'];
        resp.data.LocationConstraint = match[1];
      }
    }
  },


  extractError: function extractError(resp) {
    var codes = {
      304: 'NotModified',
      403: 'Forbidden',
      400: 'BadRequest',
      404: 'NotFound'
    };

    var code = resp.httpResponse.statusCode;
    var body = resp.httpResponse.body;
    if (codes[code] && body.length === 0) {
      resp.error = window.AWS.util.error(new Error(), {
        code: codes[resp.httpResponse.statusCode],
        message: null
      });
    } else {
      var data = new window.AWS.XML.Parser({}).parse(body.toString());
      resp.error = window.AWS.util.error(new Error(), {
        code: data.Code || code,
        message: data.Message || null
      });
    }
  },


  setEndpoint: function setEndpoint(endpoint) {
    if (endpoint) {
      this.endpoint = new window.AWS.Endpoint(endpoint, this.config);
    } else if (this.config.region && this.config.region !== 'us-east-1') {
      var sep = '-';
      if (this.isRegionV4()) sep = '.';
      var hostname = 's3' + sep + this.config.region + this.endpointSuffix();
      this.endpoint = new window.AWS.Endpoint(hostname);
    } else {
      this.endpoint = new window.AWS.Endpoint(this.api.globalEndpoint, this.config);
    }
  },


  getSignedUrl: function getSignedUrl(operation, params, callback) {
    params = window.AWS.util.copy(params || {});
    var expires = params.Expires || 900;
    delete params.Expires; // we can't validate this
    var request = this.makeRequest(operation, params);
    return request.presign(expires, callback);
  },


  prepareSignedUrl: function prepareSignedUrl(request) {
    request.removeListener('build', request.service.addContentType);
    if (!request.params.Body) {
      request.removeListener('build', request.service.computeContentMd5);
      request.removeListener('build', request.service.computeSha256);
    }
  },

  createBucket: function createBucket(params, callback) {
    if (!params) params = {};
    var hostname = this.endpoint.hostname;
    if (hostname !== this.api.globalEndpoint && !params.CreateBucketConfiguration) {
      params.CreateBucketConfiguration = { LocationConstraint: this.config.region };
    }
    return this.makeRequest('createBucket', params, callback);
  }
});
