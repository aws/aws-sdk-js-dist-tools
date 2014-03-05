fs = require('fs')
request = require('supertest')
app = require('../server')
helpers = require('./helpers')
spawn = require('child_process').spawn
http = require('http')
expect = helpers.chai.expect
origEnv = process.env

describe 'app.init', ->
  beforeEach -> process.env = {}

  describe 'cache', ->
    it 'defaults to true', ->
      app.init()
      expect(app.get('cache')).to.equal(true)

    it 'turns cache off if NO_CACHE is set', ->
      process.env.NO_CACHE = true
      app.init()
      expect(app.get('cache')).to.equal(false)

  describe 'versions', ->
    it 'sets versions to versions in server-cache directory', ->
      app.init()
      versions = fs.readdirSync(__dirname + '/../server-cache')
      expect(Object.keys(app.get('versions')).sort()).to.eql(versions.sort())

describe 'cached routes', ->
  app.init()
  version = Object.keys(app.get('versions'))[0]
  route = null

  get = -> request(app).get(route)

  describe '/aws-sdk-' + version + '.js', ->
    beforeEach -> route = '/aws-sdk-' + version + '.js'

    it 'builds unminified SDK', (done) ->
      get().set('Accept-Encoding', '').expect(200).
        expect(/AWS\.DynamoDB/).expect(/AWS\.S3/).
        expect(/Copyright Amazon\.com, Inc\./i).end(done)

    it 'accepts services list as query string', (done) ->
      get().query('iam,cloudwatch').expect(200).
        expect(/AWS\.IAM/).expect(/AWS\.CloudWatch/).end(done)

    it 'accepts services list as fancy query string', (done) ->
      get().query('iam&cloudwatch=2010-08-01').expect(200).
        expect(/AWS\.IAM/).expect(/AWS\.CloudWatch/).end(done)

  describe 'older versions', ->
    beforeEach ->
      route = '/aws-sdk-v2.0.0-rc1.js'

    it 'does not generate unbuilt services', (done) ->
      get().query('kinesis').expect(400).end(done)

    it 'does not generate APIs that were not built for a given SDK version', (done) ->
      get().query('cloudfront=2013-11-22').expect(400).
        expect(/Missing modules: cloudfront-2013-11-22/).end(done)

    it 'does not add services that were added to default in previous versions', (done) ->
      get().expect(400).end (err, res) ->
        expect(res.text).not.to.match(/AWS\.Kinesis/)
        done()

  describe 'acceptance', ->
    Object.keys(app.get('versions')).slice(1).forEach (version) ->
      describe '/aws-sdk-' + version + '.js', ->
        beforeEach -> route = '/aws-sdk-' + version + '.js'

        it 'builds unminified SDK', (done) ->
          get().set('Accept-Encoding', '').expect(200).end (err, res) ->
            eVersion = helpers.evalCode('window.AWS.VERSION', res.text)
            expect('v' + eVersion).to.equal(version)
            done()

describe 'bundle server routes', ->
  route = null
  beforeEach -> route = '/'

  get = ->
    paths = {}
    paths['v' + helpers.AWS.VERSION] = libPath: __dirname + '/../node_modules/aws-sdk'

    app.set('cache', false)
    app.set('versions', paths)
    request(app).get(route)

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
      request(app).post('/åßç').expect(404).end(done)

describe 'main program', ->
  app.init()
  version = Object.keys(app.get('versions'))[0]

  runServer = (done, port) ->
    port = (port || '8080').toString()
    url = 'http://127.0.0.1:' + port + '/aws-sdk-' + version
    child = spawn(__dirname + '/../server.js', [port.toString()], env: origEnv)
    child.stdout.on 'data', (data) ->
      if data.toString().indexOf('Serving versions:') >= 0
        http.get url + '.js', (res) ->
          expect(res.statusCode).to.equal(200)
          http.get url + '.min.js', (res) ->
            expect(res.statusCode).to.equal(200)
            child.kill()
            done()

  it 'runs on 8080', (done) ->
    runServer(done)

  it 'can be run on another port', (done) ->
    runServer(done, 40000 + parseInt(Math.random(100) * 100, 10))
