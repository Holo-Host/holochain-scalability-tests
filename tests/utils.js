const fs = require('fs')
const YAML = require('yaml')
const encodeHoloHash = require('@holo-host/cryptolib').Codec.HoloHash.encode

exports.parseCfg = () => {
  let fileContents = fs.readFileSync('./tests/config.yaml', 'utf-8')
  return YAML.parse(fileContents)
}

exports.delay = ms => new Promise(resolve => setTimeout(resolve, ms))

exports.getNestedLogValue = (arr, value, opts = {}) => {
  const { all } = opts
  return Object.values(arr).flatMap(valueRecords => {
    if (all) {
      const recordList = valueRecords.map(record => record[value])
      return recordList
    } else {
      return valueRecords[valueRecords.length-1][value]
    }
  })
}

exports.accumulate = intArray => intArray.reduce((acc, int) => acc + int, 0)

exports.makePercentage = fraction => fraction * 100

exports.presentFrequency = (unit, ms) => {
  const fullTime = this.presentDuration(ms)
  return `1 ${unit}/${fullTime}`
}

exports.presentDuration = ms => {
  const second = 1000
  const minute = 60 * second
  const hour = 60 * minute
  const twoDigits = num => ('00' + num).slice(-2)
  const threeDigits = num => ('000' + num).slice(-3)

  const h = twoDigits(Math.floor(ms / hour))
  const m = twoDigits(Math.floor(ms / minute) % 60)
  const s = twoDigits(Math.floor(ms / second) % 60)
  return `${h}:${m}:${s}.${threeDigits(ms)}`
}

exports.wait = ms => new Promise(resolve => setTimeout(resolve, ms))

exports.base64AgentId = tryoramaAgent => encodeHoloHash('agent', Buffer.from(tryoramaAgent.agent))

exports.displaylast6 = string => string.slice(-6)