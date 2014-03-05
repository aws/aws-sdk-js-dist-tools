

window.AWS.SES = window.AWS.Service.defineService('ses', ['2010-12-01'], {

  initialize: function initialize(options) {
    options = options || {};
    options.region = options.region || 'us-east-1';
    window.AWS.Service.prototype.initialize.call(this, options);
  },


  defaultEndpoint: 'us-east-1',


  setupRequestListeners: function setupRequestListeners(request) {
    request.removeListener('validate',
      window.AWS.EventListeners.Core.VALIDATE_REGION);
  }
});


