request = require('supertest')
server = require('../server')
helpers = require('./helpers')
expect = helpers.chai.expect

paths = {}
paths['v' + helpers.AWS.VERSION] = { libPath: __dirname + '/../node_modules/aws-sdk' }
server.set('versions', paths)
server.set('cache', false)

describe 'bundle server routes', ->
  route = null
  beforeEach -> route = '/'
  get = -> request(server).get(route)

  describe '/aws-sdk-v' + helpers.AWS.VERSION + '.js', ->
    beforeEach -> route = '/aws-sdk-v' + helpers.AWS.VERSION + '.js'

    it 'builds unminified SDK', (done) ->
      get().set('Accept-Encoding', '').expect(200).
        expect(/AWS\.DynamoDB/).expect(/AWS\.S3/).
        expect(/Copyright Amazon\.com, Inc\./i).end (err, res) ->
          return done(err) if err
          expect(res.text.substr(0, 3)).to.equal('// ') # license first
          expect(res.headers['content-encoding']).not.to.equal('gzip')
          svc = helpers.evalCode("new window.AWS.DynamoDB()", res.text)
          expect(svc.api.apiVersion).to.equal(new helpers.AWS.DynamoDB().api.apiVersion)
          done(err)

    it 'accepts services list as query string', (done) ->
      get().query('iam,cloudwatch').expect(200).
        expect(/AWS\.IAM/).expect(/AWS\.CloudWatch/).end(done)

    it 'accepts services list as fancy query string', (done) ->
      get().query('iam&cloudwatch=2010-08-01').expect(200).
        expect(/AWS\.IAM/).expect(/AWS\.CloudWatch/).end(done)

    it 'accepts services list as fancy query string with trailing =', (done) ->
      get().query('iam=&cloudwatch=2010-08-01').expect(200).
        expect(/AWS\.IAM/).expect(/AWS\.CloudWatch/).end(done)

    it 'can return contents as gzipped data', (done) ->
      get().set('Accept-Encoding', 'gzip').expect(200).end (err, res) ->
        expect(res.headers['content-encoding']).to.equal('gzip')
        done(err)

  describe '/aws-sdk-v' + helpers.AWS.VERSION + '.min.js', ->
    beforeEach -> route = '/aws-sdk-v' + helpers.AWS.VERSION + '.min.js'

    it 'builds minified SDK', (done) ->
      get().expect(200).end (err, res) ->
        expect(res.text).to.match(/Copyright Amazon\.com, Inc\./i)
        expect(res.text).to.match(/function \w\(\w,\w,\w\)\{function \w\(\w,\w\)\{/)
        svc = helpers.evalCode("new window.AWS.DynamoDB()", res.text)
        expect(svc.api.apiVersion).to.equal(new helpers.AWS.DynamoDB().api.apiVersion)
        done(err)

  describe 'error handling', ->
    beforeEach -> route = '/aws-sdk-v' + helpers.AWS.VERSION + '.js'

    it 'returns 400 if module is missing', (done) ->
      get().query('invalidmodule').
        expect(400, /Missing modules: invalidmodule/).end(done)

    it 'can handle weird/malicious requests', (done) ->
      get(route).query('/etc/passwd').
        expect(400, /Incorrectly formatted service names/).end(done)

    it 'does not respond to any other route', (done) ->
      request(server).post('/åßç').expect(404).end(done)
