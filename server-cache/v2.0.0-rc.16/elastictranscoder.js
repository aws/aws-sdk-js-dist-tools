window.AWS.ElasticTranscoder = window.AWS.Service.defineService('elastictranscoder');


window.AWS.util.update(window.AWS.ElasticTranscoder.prototype, {
  setupRequestListeners: function setupRequestListeners(request) {
    request.addListener('extractError', this.extractErrorCode);
  },


  extractErrorCode: function extractErrorCode(resp) {
    var errorType = resp.httpResponse.headers['x-amzn-errortype'];
    if (errorType) {
      resp.error.name = resp.error.code = errorType.split(':')[0];
    }
  }
});
