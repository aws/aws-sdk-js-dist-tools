window.AWS.SES = window.AWS.Service.defineService('ses');


window.AWS.util.update(window.AWS.SES.prototype, {

  initialize: function initialize(options) {
    window.AWS.Service.prototype.initialize.call(this, options);
  },


  defaultEndpoint: 'us-east-1',


  setupRequestListeners: function setupRequestListeners(request) {
    request.removeListener('validate',
      window.AWS.EventListeners.Core.VALIDATE_REGION);
  }
});
