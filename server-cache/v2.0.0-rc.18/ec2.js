window.AWS.EC2 = window.AWS.Service.defineService('ec2');


window.AWS.util.update(window.AWS.EC2.prototype, {

  setupRequestListeners: function setupRequestListeners(request) {
    request.removeListener('extractError', window.AWS.EventListeners.Query.EXTRACT_ERROR);
    request.addListener('extractError', this.extractError);

    if (request.operation === 'copySnapshot') {
      request.onAsync('validate', this.buildCopySnapshotPresignedUrl);
    }
  },


  buildCopySnapshotPresignedUrl: function buildCopySnapshotPresignedUrl(req, done) {
    if (req.params.PresignedUrl || req._subRequest) {
      return done();
    }

    req.params = window.AWS.util.copy(req.params);
    req.params.DestinationRegion = req.service.config.region;

    var config = window.AWS.util.copy(req.service.config);
    delete config.endpoint;
    config.region = req.params.SourceRegion;
    config.signatureVersion = 'v4';
    var svc = new req.service.constructor(config);
    var newReq = svc[req.operation](req.params);
    newReq._subRequest = true;
    newReq.presign(function(err, url) {
      if (err) done(err);
      else {
        req.params.PresignedUrl = url;
        done();
      }
    });
  },


  extractError: function extractError(resp) {
    var httpResponse = resp.httpResponse;
    var data = new window.AWS.XML.Parser({}).parse(httpResponse.body.toString() || '');
    if (data.Errors)
      resp.error = window.AWS.util.error(new Error(), {
        code: data.Errors.Error.Code,
        message: data.Errors.Error.Message
      });
    else
      resp.error = window.AWS.util.error(new Error(), {
        code: httpResponse.statusCode,
        message: null
      });
  }
});
