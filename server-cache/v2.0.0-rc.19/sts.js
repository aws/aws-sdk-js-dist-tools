window.AWS.STS = window.AWS.Service.defineService('sts');


window.AWS.util.update(window.AWS.STS.prototype, {

  credentialsFrom: function credentialsFrom(data, credentials) {
    if (!data) return null;
    if (!credentials) credentials = new window.AWS.TemporaryCredentials();
    credentials.expired = false;
    credentials.accessKeyId = data.Credentials.AccessKeyId;
    credentials.secretAccessKey = data.Credentials.SecretAccessKey;
    credentials.sessionToken = data.Credentials.SessionToken;
    credentials.expireTime = data.Credentials.Expiration;
    return credentials;
  },

  assumeRoleWithWebIdentity: function assumeRoleWithWebIdentity(params, callback) {
    return this.makeUnauthenticatedRequest('assumeRoleWithWebIdentity', params, callback);
  },

  assumeRoleWithSAML: function assumeRoleWithSAML(params, callback) {
    return this.makeUnauthenticatedRequest('assumeRoleWithSAML', params, callback);
  }
});
