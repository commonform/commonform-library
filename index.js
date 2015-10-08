module.exports = LevelCommonForm

var analyze = require('commonform-analyze')
var asap = require('asap')
var bytewise = require('bytewise/encoding/hex')
var isChild = require('commonform-predicate').child
var merkleize = require('commonform-merkleize')
var serialize = require('commonform-serialize')
var through = require('through2')
var validate = require('commonform-validate')

var parse = serialize.parse
var stringify = serialize.stringify

var decode = bytewise.decode
var encode = bytewise.encode

var PLACEHOLDER_VALUE = ' '

function formKey(digest) {
  return encode([ 'form', digest ]) }

function termKey(term) {
  return encode([ 'term', term ]) }

function blankKey(blank) {
  return encode([ 'blank', blank ]) }

function LevelCommonForm(levelup) {
  if (!(this instanceof LevelCommonForm)) {
    return new LevelCommonForm(levelup) }
  this.levelup = levelup }

var prototype = LevelCommonForm.prototype

prototype.getForm = function(digest, callback) {
  var key = formKey(digest)
  this.levelup.get(key, function(error, json) {
    if (error) {
      if (error.notFound) {
        callback() }
      else {
        callback(error) } }
    else {
      var form = parse(json)
      callback(null, form) } }) }

function addTermsToBatch(batch, analysis) {
  Object.keys(analysis.uses).reduce(
    function(terms, used) {
      return (
        ( terms.indexOf(used) < -1) ?
          terms.concat(used) :
          terms ) },
    Object.keys(analysis.definitions))
    .forEach(function(term) {
      batch.put(termKey(term), PLACEHOLDER_VALUE) }) }

function addBlanksToBatch(batch, analysis) {
  Object.keys(analysis.blanks)
    .forEach(function(blank) {
      batch.put(blankKey(blank), PLACEHOLDER_VALUE) }) }

function addNamesToBatch(batch, form) {
  var analysis = analyze(form)
  addTermsToBatch(batch, analysis)
  addBlanksToBatch(batch, analysis) }

function addFormsToBatch(batch, form, merkle) {
  var json = stringify(form)
  var key = formKey(merkle.digest)
  batch.put(key, json)
  form.content.forEach(function(element, index) {
    if (isChild(element)) {
      var childForm = element.form
      var childMerkle = merkle.content[index]
      addFormsToBatch(batch, childForm, childMerkle) } }) }

prototype.putForm = function(form, callback) {
  var valid = validate.form(form)
  if (!valid) {
    asap(function() {
      callback(new Error('Invalid form')) }) }
  else {
    var merkle = merkleize(form)
    var root = merkle.digest
    var batch = this.levelup.batch()
    addFormsToBatch(batch, form, merkle)
    addNamesToBatch(batch, form)
    batch.write(function(error) {
      if (error) {
        callback(error) }
      else {
        callback(null, root) } }) } }

function streamNames(namespace) {
  var transform = through.obj(function(chunk, _, callback) {
    callback(null, decode(chunk)[1]) })
  var options = {
    keys: true,
    values: false,
    gt: encode([ namespace, null ]),
    lt: encode([ namespace, undefined ]) }
  this.levelup.createReadStream(options).pipe(transform)
  return transform }

function capitalize(string) {
  return ( string.charAt(0).toUpperCase() + string.slice(1) ) }

( [ 'term', 'blank' ] ).forEach(function(namespace) {
  var capitalized = capitalize(namespace)
  prototype['create' + capitalized + 'Stream'] = function() {
    return streamNames.call(this, namespace) } })

prototype.createDigestStream = function() {
  return streamNames.call(this, 'form') }

prototype.createFormStream = function() {
  var transform = through.obj(function(chunk, _, callback) {
    var digest = decode(chunk.key)[1]
    var form = parse(chunk.value)
    callback(null, { digest: digest, form: form }) })
  var options = {
    keys: true,
    values: true,
    gt: formKey(null),
    lt: formKey(undefined) }
  this.levelup.createReadStream(options).pipe(transform)
  return transform }
