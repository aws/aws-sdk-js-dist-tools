fs = require('fs')

evalCode = (code, preamble) ->
  eval """
    (function() {
      var window = {};
      #{preamble};
      return #{code};
    })();
  """

module.exports =
  AWS: require('../../lib/aws')
  Builder: require('../browser-builder')
  chai: require('chai')
  evalCode: evalCode
