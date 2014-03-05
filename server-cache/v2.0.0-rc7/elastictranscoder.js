

window.AWS.ElasticTranscoder = window.AWS.Service.defineService('elastictranscoder', ['2012-09-25'], {
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


