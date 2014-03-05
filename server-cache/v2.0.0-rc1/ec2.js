



window.AWS.EC2 = window.AWS.Service.defineService('ec2', ['2013-06-15*', '2013-07-15*', '2013-08-15*', '2013-10-01'], {
  setupRequestListeners: function setupRequestListeners(request) {
    request.removeListener('extractError', window.AWS.EventListeners.Query.EXTRACT_ERROR);
    request.addListener('extractError', this.extractError);
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


