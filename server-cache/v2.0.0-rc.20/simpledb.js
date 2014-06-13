AWS.SimpleDB = AWS.Service.defineService('simpledb');


AWS.util.update(AWS.SimpleDB.prototype, {

  setEndpoint: function setEndpoint(endpoint) {
    if (this.config.region === 'us-east-1') {
      var prefix = this.api.endpointPrefix;
      this.endpoint = new AWS.Endpoint(prefix + this.endpointSuffix());
    } else {
      AWS.Service.prototype.setEndpoint.call(this, endpoint);
    }
  }
});
