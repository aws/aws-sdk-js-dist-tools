

window.AWS.SimpleDB = window.AWS.Service.defineService('simpledb', ['2009-04-15'], {

  setEndpoint: function setEndpoint(endpoint) {
    if (this.config.region === 'us-east-1') {
      var prefix = this.api.endpointPrefix;
      this.endpoint = new window.AWS.Endpoint(prefix + '.amazonaws.com');
    } else {
      window.AWS.Service.prototype.setEndpoint.call(this, endpoint);
    }
  }
});


