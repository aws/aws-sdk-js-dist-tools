fs = require('fs')

evalCode = (code, preamble) ->
  eval """
    (function() {
      var window = {};
      #{preamble};
      return #{code};
    })();
  """

AWS = null
if fs.existsSync(__dirname + '/../../lib/aws.js')
  AWS = require('../../lib/aws')
else
  AWS = require(__dirname + '/../node_modules/aws-sdk/lib/aws')

module.exports =
  AWS: AWS
  Builder: require('../browser-builder')
  chai: require('chai')
  evalCode: evalCode
