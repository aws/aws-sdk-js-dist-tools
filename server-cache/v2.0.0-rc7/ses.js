

AWS.SES = AWS.Service.defineService('ses', ['2010-12-01'], {

  initialize: function initialize(options) {
    options = options || {};
    options.region = options.region || 'us-east-1';
    AWS.Service.prototype.initialize.call(this, options);
  },


  defaultEndpoint: 'us-east-1',


  setupRequestListeners: function setupRequestListeners(request) {
    request.removeListener('validate',
      AWS.EventListeners.Core.VALIDATE_REGION);
  }
});


