helpers = require('./helpers')
Builder = helpers.Builder
child = require('child_process')

describe 'Builder', ->
  describe 'addServices', ->
    builder = null
    code = null
    beforeEach -> builder = new helpers.Builder

    add = (services) ->
      builder.addServices(services)
      code = builder.serviceCode.join('\n')

    assertServiceAdded = (klass, version) ->
      version = version || new helpers.AWS[klass]().api.apiVersion;
      expect(code).toMatch 'AWS\\.' + klass +
        ' = AWS\\.Service\\.defineService\\(\'' +
        helpers.AWS[klass].serviceIdentifier + '\''
      expect(code).toMatch 'AWS\\.Service\\.defineServiceApi\\(AWS\\.' +
        klass + ', "' + version + '",'

    assertBundleFailed = (services, errMsg) ->
      expect(-> builder.addServices(services)).toThrow(errMsg)

    it 'accepts comma delimited services by name', ->
      add 's3,cloudwatch'
      assertServiceAdded 'S3'
      assertServiceAdded 'CloudWatch'

    it 'uses latest service version if version suffix is not supplied', ->
      add 'rds'
      assertServiceAdded 'RDS'

    it 'accepts fully qualified service-version pair', ->
      add 'rds-2013-09-09'
      assertServiceAdded 'RDS', '2013-09-09'

    it 'accepts "all" for all services', ->
      add 'all'
      Object.keys(builder.serviceClasses).forEach (s) ->
        name = builder.className(new builder.serviceClasses[s]().api)
        assertServiceAdded(name)

    it 'throws an error if the service does not exist', ->
      assertBundleFailed 'invalidmodule', 'Missing modules: invalidmodule'

    it 'throws an error if the service version does not exist', ->
      services = 's3-1999-01-01'
      msg = 'Missing modules: s3-1999-01-01'
      assertBundleFailed(services, msg)

    it 'groups multiple errors into one error object', ->
      services = 's3-1999-01-01,invalidmodule,dynamodb-01-01-01'
      msg = 'Missing modules: dynamodb-01-01-01, invalidmodule, s3-1999-01-01'
      assertBundleFailed(services, msg)

    it 'throws an opaque error if special characters are found (/, ., *)', ->
      msg = 'Incorrectly formatted service names'
      assertBundleFailed('path/to/service', msg)
      assertBundleFailed('to/../../../root', msg)
      assertBundleFailed('*.js', msg)
      assertBundleFailed('a.b', msg)
      assertBundleFailed('a=b', msg)
      assertBundleFailed('!d', msg)
      assertBundleFailed('valid1,valid2,invalid.module', msg)

  describe 'build', ->
    bundleCache = {}
    data = null

    beforeEach -> data = ''

    buildBundle = (services, opts, code, cb) ->
      cacheKey = JSON.stringify(services: services, options: opts)
      if bundleCache[cacheKey]
        result = null
        if code
          result = helpers.evalCode(code, bundleCache[cacheKey])
        return cb(null, result)

      err = false
      opts = opts || {}
      runs ->
        new Builder(opts).addServices(services).build((e, c) -> err = e; data = c)
      waitsFor -> err || data
      runs ->
        bundleCache[cacheKey] = data
        result = null
        if !err && code
          result = helpers.evalCode(code, data)
        cb(err, result)

    it 'defaults to no minification', ->
      buildBundle null, null, 'window.AWS', (err, AWS) ->
        expect(data).toMatch(/Copyright Amazon\.com/i)

    it 'can be minified (slow)', ->
      buildBundle null, minify: true, null, ->
        expect(data).toMatch(/Copyright Amazon\.com/i) # has license
        expect(data).toMatch(/function \w\(\w,\w,\w\)\{function \w\(\w,\w\)\{/)

    it 'can build default services into bundle', ->
      buildBundle null, null, 'window.AWS', (err, AWS) ->
        expect(new AWS.S3().api.apiVersion).toEqual(new helpers.AWS.S3().api.apiVersion)
        expect(new AWS.DynamoDB().api.apiVersion).toEqual(new helpers.AWS.DynamoDB().api.apiVersion)
        expect(new AWS.STS().api.apiVersion).toEqual(new helpers.AWS.STS().api.apiVersion)

    it 'can build all services into bundle', ->
      buildBundle 'all', null, 'window.AWS', (err, AWS) ->
        Object.keys(helpers.AWS).forEach (k) ->
          if k.serviceIdentifier
            expect(typeof AWS[k]).toEqual('object')

    describe 'as executable', ->
      cwd = __dirname + '/../'
      script = './browser-builder.js'

      it 'uses first argument to get services list', ->
        done = false
        runs ->
          pid = child.spawn(script, ['iam-2010-05-08'], cwd: cwd)
          pid.stdout.on('data', (b) -> data += b.toString())
          pid.on('close', -> done = true)
        waitsFor -> done
        runs ->
          expect(data).toMatch(/Copyright Amazon\.com/i)
          expect(data).toContain('"2010-05-08"')
          expect(data).not.toContain('"2006-03-01"')

      it 'uses MINIFY environment variable to set minification mode', ->
        done = false
        runs ->
          env = JSON.parse(JSON.stringify(process.env))
          env.MINIFY = '1'
          pid = child.spawn(script, [], cwd: cwd, env: env)
          pid.stdout.on('data', (b) -> data += b.toString())
          pid.on('close', -> done = true)
        waitsFor -> done
        runs ->
          expect(data).toMatch(/Copyright Amazon\.com/i)
          expect(data).toMatch(/function \w\(\w,\w,\w\)\{function \w\(\w,\w\)\{/)
          expect(data).toContain('"2006-03-01"')
