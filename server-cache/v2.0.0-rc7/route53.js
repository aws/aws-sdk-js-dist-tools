

AWS.Route53 = AWS.Service.defineService('route53', ['2012-12-12'], {

  setupRequestListeners: function setupRequestListeners(request) {
    request.on('build', this.sanitizeUrl);
  },


  sanitizeUrl: function sanitizeUrl(request) {
    var path = request.httpRequest.path;
    request.httpRequest.path = path.replace(/\/%2F\w+%2F/, '/');
  },


  setEndpoint: function setEndpoint(endpoint) {
    if (endpoint) {
      AWS.Service.prototype.setEndpoint(endpoint);
    } else {
      var opts = {sslEnabled: true}; // SSL is always enabled for Route53
      this.endpoint = new AWS.Endpoint(this.api.globalEndpoint, opts);
    }
  }
});


