







AWS.S3 = AWS.Service.defineService('s3', ['2006-03-01'], {

  initialize: function initialize(options) {
    AWS.Service.prototype.initialize.call(this, options);
    this.setEndpoint((options || {}).endpoint, options);
  },

  setupRequestListeners: function setupRequestListeners(request) {
    request.addListener('build', this.addContentType);
    request.addListener('build', this.populateURI);
    request.addListener('build', this.computeContentMd5);
    request.removeListener('validate',
      AWS.EventListeners.Core.VALIDATE_REGION);
    request.addListener('extractError', this.extractError);
    request.addListener('extractData', this.extractData);
  },


  populateURI: function populateURI(req) {
    var httpRequest = req.httpRequest;
    var b = req.params.Bucket;

    if (b) {
      if (!req.service.pathStyleBucketName(b)) {
        httpRequest.endpoint.host = httpRequest.endpoint.hostname = b + '.' +
          httpRequest.endpoint.hostname;

        httpRequest.virtualHostedBucket = b; // needed for signing the request
        httpRequest.path = httpRequest.path.replace(new RegExp('^/' + b), '');
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
      if (AWS.util.isBrowser() && navigator.userAgent.match(/Firefox/)) {
        var charset = '; charset=' + document.characterSet;
        httpRequest.headers['Content-Type'] += charset;
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

    if (!Buffer.isBuffer(req.httpRequest.body) &&
        typeof req.httpRequest.body !== 'string') {
      return false;
    }

    var rules = req.service.api.operations[req.operation].input.members;
    if (rules.ContentMD5 && !req.params.ContentMD5) return true;
  },


  computeContentMd5: function computeContentMd5(req) {
    if (req.service.willComputeChecksums(req)) {
      var md5 = AWS.util.crypto.md5(req.httpRequest.body, 'base64');
      req.httpRequest.headers['Content-MD5'] = md5;
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
    return AWS.util.uriEscapePath(String(value));
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
    if (request.operation == 'completeMultipartUpload' &&
        error.statusCode === 200) {
      return true;
    } else {
      var _super = AWS.Service.prototype.retryableError;
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
      resp.error = AWS.util.error(new Error(), {
        code: codes[resp.httpResponse.statusCode],
        message: null
      });
    } else {
      var data = new AWS.XML.Parser({}).parse(body.toString());
      resp.error = AWS.util.error(new Error(), {
        code: data.Code || code,
        message: data.Message || null
      });
    }
  },


  setEndpoint: function setEndpoint(endpoint) {
    if (endpoint) {
      this.endpoint = new AWS.Endpoint(endpoint, this.config);
    } else if (this.config.region && this.config.region !== 'us-east-1') {
      var hostname = 's3-' + this.config.region + '.amazonaws.com';
      this.endpoint = new AWS.Endpoint(hostname);
    } else {
      this.endpoint = new AWS.Endpoint(this.api.globalEndpoint, this.config);
    }
  },


  getSignedUrl: function getSignedUrl(operation, params, callback) {
    var expires = params.Expires || 900;
    delete params.Expires; // we can't validate this
    var url = require('url');
    var events = ['validate', 'build', 'sign'];
    var request = this.makeRequest(operation, params);

    var expiresHeader = 'presigned-expires';

    function signedUrlBuilder() {
      delete request.httpRequest.headers['User-Agent'];
      delete request.httpRequest.headers['X-Amz-User-Agent'];
      request.httpRequest.headers[expiresHeader] = parseInt(
        AWS.util.date.unixTimestamp() + expires, 10).toString();
    }

    function signedUrlSigner() {
      var queryParams = {};

      AWS.util.each(request.httpRequest.headers, function (key, value) {
        if (key === expiresHeader) key = 'Expires';
        queryParams[key] = value;
      });
      delete request.httpRequest.headers[expiresHeader];

      var auth = queryParams['Authorization'].split(':');
      delete queryParams['Authorization'];
      delete queryParams['Host'];
      queryParams['AWSAccessKeyId'] = auth[0].split(' ')[1];
      queryParams['Signature'] = auth[1];

      var endpoint = request.httpRequest.endpoint;
      var parsedUrl = url.parse(request.httpRequest.path);
      var querystring = AWS.util.queryParamsToString(queryParams);
      endpoint.pathname = parsedUrl.pathname;
      endpoint.search = !parsedUrl.search ? querystring :
                        parsedUrl.search + '&' + querystring;
    }

    request.on('build', signedUrlBuilder);
    request.on('sign', signedUrlSigner);
    request.removeListener('build', this.addContentType);
    if (!params.Body) { // no Content-MD5 signing if body is not provided
      request.removeListener('build', this.computeContentMd5);
    }

    if (callback) {
      request.emitEvents(events, new AWS.Response(request), function (err) {
        if (err) callback(err, null);
        else callback(null, url.format(request.httpRequest.endpoint));
      });
    } else {
      AWS.util.arrayEach(events, function (item) {
        request.emitEvent(item, [request]);
      });
      return url.format(request.httpRequest.endpoint);
    }
  }
});

AWS.S3.prototype.createBucket = function createBucket(params, callback) {
  if (!params) params = {};
  var hostname = this.endpoint.hostname;
  if (hostname != this.api.globalEndpoint && !params.CreateBucketConfiguration) {
    params.CreateBucketConfiguration = { LocationConstraint: this.config.region };
  }
  return this.makeRequest('createBucket', params, callback);
};


