const namedLevel = require('named-level-store')
const hyperdrive = require('hyperdrive')
const explain = require('explain-error')
const concat = require('concat-stream')
const mapLimit = require('map-limit')
const assert = require('assert')
const level = require('level')
const pump = require('pump')

module.exports = MultiDrive

// manage a collection of hyperdrives
// (str, fn) -> null
function MultiDrive (name, cb) {
  if (!(this instanceof MultiDrive)) return new MultiDrive(name, cb)

  assert.equal(typeof name, 'string', 'multidrive: name should be a string')
  assert.equal(typeof cb, 'function', 'multidrive: cb should be a function')

  const self = this

  this.db = namedLevel(name)
  this.drives = {}
  this.queue = []

  const rs = this.db.createReadStream()
  pump(rs, concat({ encoding: 'json' }, sink), (err) => {
    if (err) return cb(err)
  })

  function sink (pairs) {
    mapLimit(pairs, 1, iterator, function (err) {
      if (err) return cb(err)
      while (self.queue.length) self.queue.shift()()
    })

    function iterator (pair, done) {
      const name = pair.key
      const directory = pair.value

      // TODO: figure out if there's a better way to signal a database was removed
      level(directory, function (err, db) {
        if (err) return done(explain(err, 'multidrive: error recreating database in ' + directory))

        const drive = hyperdrive(db)
        drive.location = directory
        self.drives[name] = drive
        done()
      })
    }
  }
}

// (str, str, fn) -> null
MultiDrive.prototype.create = function (name, directory, cb) {
  assert.equal(typeof name, 'string', 'multidrive.create: name should be a string')
  assert.equal(typeof directory, 'string', 'multidrive.create: directory should be a string')
  assert.equal(typeof cb, 'function', 'multidrive.create: cb should be a function')

  const self = this

  level(directory, function (err, db) {
    if (err) return cb(explain(err, 'multidrive: error creating database'))
    const drive = hyperdrive(db)
    drive.location = directory

    self.db.put(name, directory, function (err) {
      if (err) return cb(err)
      cb(null, drive)
    })
  })
}

// remove an instance from the registry, does not remove the directory itself
// (str, fn) -> null
MultiDrive.prototype.delete = function (name, cb) {
  assert.equal(typeof name, 'string', 'multidrive.delete: name should be a string')
  assert.equal(typeof cb, 'function', 'multidrive.delete: cb should be a function')
  this.db.del(name, cb)
}

// (fn) -> null
MultiDrive.prototype.list = function (cb) {
  assert.equal(typeof cb, 'function', 'multidrive.list: cb should be a function')
  if (this.ready) cb(null, this.drives)
  else this.queue.push(cb)
}
