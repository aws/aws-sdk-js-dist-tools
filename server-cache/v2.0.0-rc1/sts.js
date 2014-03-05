



window.AWS.STS = window.AWS.Service.defineService('sts', ['2011-06-15'], {

  credentialsFrom: function credentialsFrom(data, credentials) {
    if (!data) return null;
    if (!credentials) credentials = new window.AWS.TemporaryCredentials();
    credentials.expired = false;
    credentials.accessKeyId = data.Credentials.AccessKeyId;
    credentials.secretAccessKey = data.Credentials.SecretAccessKey;
    credentials.sessionToken = data.Credentials.SessionToken;
    credentials.expireTime = data.Credentials.Expiration;
    return credentials;
  }
});

window.AWS.STS.prototype.assumeRoleWithWebIdentity = function assumeRoleWithWebIdentity(params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = {};
  }

  var request = this.makeRequest('assumeRoleWithWebIdentity', params);
  request.removeListener('validate', window.AWS.EventListeners.Core.VALIDATE_CREDENTIALS);
  request.removeListener('sign', window.AWS.EventListeners.Core.SIGN);
  request.addListener('build', function convertToGET(request) {
    request.httpRequest.method = 'GET';
    request.httpRequest.path = '/?' + request.httpRequest.body;
    request.httpRequest.body = '';

    delete request.httpRequest.headers['Content-Length'];
    delete request.httpRequest.headers['Content-Type'];
  });

  return callback ? request.send(callback) : request;
};


