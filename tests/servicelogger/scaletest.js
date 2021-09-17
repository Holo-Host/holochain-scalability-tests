const { expect } = require('chai')
const tryorama = require('@holochain/tryorama')
const { performance } = require('perf_hooks')
const { Codec } = require('@holo-host/cryptolib')
const _ = require('lodash')
const encodeAgentHash = Codec.AgentId.encode
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const { parseCfg, presentDuration, presentFrequency, getNestedLogValue, accumulate, makePercentage } = require('../utils')
const { getActivityLog, getDiskUsage, getSettings } = require('../common')

describe('Servicelogger DNA', async () => {
  let testTimeout, activityLoggingInterval, diskUsageLoggingInterval, hostedHappSLs, signatoryHapps, endScenario, cfg, s
  before(async () => {
    await setUpHoloports()
    cfg = parseCfg()
  })
  beforeEach(async () => {
    await restartTrycp()
    const orchestrator = new tryorama.Orchestrator({
      mode: {
        executor: 'none',
        // This is misleading; spawning will still be remote
        spawning: 'local'
      }
    })
    let scenarioStarted
    const scenarioPromise = new Promise(resolve => (scenarioStarted = resolve))
    const scenarioEndedPromise = new Promise(resolve => (endScenario = resolve))
    orchestrator.registerScenario('servicelogger scaletest', scenario => {
      scenarioStarted(scenario)
      return scenarioEndedPromise
    })
    orchestrator.run()
    s = await scenarioPromise

    testTimeout = cfg.appSettings.servicelogger.testDuration
    activityLoggingInterval = cfg.appSettings.servicelogger.activityLoggingInterval
    diskUsageLoggingInterval = cfg.appSettings.servicelogger.diskUsageLoggingInterval
    
    const testHapps = await installAgents(s, 'servicelogger')
    const signatoryHappIndices = []
    signatoryHapps = testHapps.filter((_,i) => {
      if (i%(cfg.holoports.length * cfg.agentsPerConductor + 1) === 0) {
        signatoryHappIndices.push(i)
        return i%(cfg.holoports.length * cfg.agentsPerConductor + 1) === 0
      }
    })
    // remove signatory happs to form hosted happ array
    signatoryHappIndices.map(sigHappIndex => testHapps.splice(sigHappIndex, 1))
    hostedHappSLs = testHapps
    const settings = getSettings(signatoryHapps[0])
    try {
      await Promise.all(hostedHappSLs.map(async hostedHappSL => await hostedHappSL.cells[0].call('service', 'set_logger_settings', settings)))
      console.log(`Logger Settings set for all ${hostedHappSLs.length} (non-signatory) agents`)
    } catch (error) {
      console.log('Error: Failed to set servicelogger settings:', error)
    }
  })
  afterEach(() => endScenario())
  
  it('logs the service activity and disk usage for set interval', async () => {
    if ( activityLoggingInterval > testTimeout || diskUsageLoggingInterval > testTimeout) {
      throw new Error('Provided test duration is not longer than duration of logging intervals.\nPlease revisit the testing config and correct provided lengths (in ms).')
    }
    const totalExpectedActivityLogCount = Math.ceil(testTimeout/activityLoggingInterval) * hostedHappSLs.length
    const completedActivityLogPerAgent = {}
    const totalExpectedDiskLogEventCount = Math.ceil(testTimeout/diskUsageLoggingInterval) * hostedHappSLs.length
    const completedDiskLogEventsPerAgent = {}

    const callZome = async (hostHapp, logList, zomeFnName, paramFn, paramFnArgs) => {
      if (!logList[encodeAgentHash(hostHapp.agent)]) {
        logList[encodeAgentHash(hostHapp.agent)] = []
      }
      let count = logList[encodeAgentHash(hostHapp.agent)].length
      count++
      const startTime = performance.now()
      try {
        if (paramFnArgs === signatoryHapps) {
          const hasNoRemainder = count%cfg.agentsPerConductor === 0
          const hostIndex = hasNoRemainder
            ? count/cfg.agentsPerConductor - 1
            : Math.floor(count/cfg.agentsPerConductor)
          paramFnArgs = signatoryHapps[hostIndex]
        }
        const params = await paramFn(paramFnArgs)
        await hostHapp.cells[0].call('service', zomeFnName, params)
        activityLogDuration = Math.floor(performance.now() - startTime)
        logList[encodeAgentHash(hostHapp.agent)].push({
          count,
          duration: activityLogDuration,
          error: null
        })
      } catch (error) {
        activityLogDuration = Math.floor(performance.now() - startTime)
        console.error(`Error: Failed to log activity call #${logList[encodeAgentHash(hostHapp.agent)]} for host agent ${encodeAgentHash(hostHapp.agent)} : ${error}`)
        logList[encodeAgentHash(hostHapp.agent)].push({
          count,
          duration: activityLogDuration,
          error: {
            time: performance.now(),
            message: error.message
          }
        })
      }
    }

    const startTestTime = Date.now()
    do {
      const loopDate = Date.now()
      if ((loopDate - startTestTime)%activityLoggingInterval === 0) { // activityLoggingInterval
        await Promise.all(hostedHappSLs.map(hh => callZome(hh, completedActivityLogPerAgent, 'log_activity', getActivityLog, signatoryHapps)) )
      }
      if ((loopDate - startTestTime)%diskUsageLoggingInterval === 0) { // diskUsageLoggingInterval
        await Promise.all(hostedHappSLs.map(hh => callZome(hh, completedDiskLogEventsPerAgent, 'log_disk_usage', getDiskUsage, hostedHappSLs)) )
      }
    } while (Date.now() - startTestTime < (testTimeout - 100)) // testTimeout

    const totalCompletedActivityLogCount = accumulate(getNestedLogValue(completedActivityLogPerAgent, 'count'))
    const totalCompletedDiskLogEventCount = accumulate(getNestedLogValue(completedDiskLogEventsPerAgent, 'count'))
    const totalCompletedActivityErrorCount = getNestedLogValue(completedActivityLogPerAgent, 'error', { all: true }).filter(el => el !== null).length
    const totalCompletedDiskLogErrorCount = getNestedLogValue(completedDiskLogEventsPerAgent, 'error', { all: true }).filter(el => el !== null).length

    console.log(`\n**********************************************`)
    console.table(
      {
        'Test Duration': presentDuration(testTimeout),
        'Number Holoports': cfg.holoports.length,
        'Total Conductors': (cfg.holoports.length * cfg.conductorsPerHoloport) + signatoryHapps.length,
        'Total Signatory Agents': signatoryHapps.length,
        'Total Hosted Agents': hostedHappSLs.length,
        'Activity Log Frequency': presentFrequency('call', activityLoggingInterval),
        'Total Activity Log Calls Invoked': totalCompletedActivityLogCount,
        'Total Activity Log Call Errors': totalCompletedActivityErrorCount,
        'Disk Usage Log Frequency': presentFrequency('call', diskUsageLoggingInterval),
        'Total Disk Usage Log Calls Invoked': totalCompletedDiskLogEventCount,
        'Total Disk Usage Log Call Errors': totalCompletedDiskLogErrorCount
      }
    )
    console.log(`**********************************************\n`)
    function AgentRecord(pubkey) {
      const agentActivityErrorList = completedActivityLogPerAgent[encodeAgentHash(pubkey)].map(log => log.error)
      const agentActivityErrorCount = agentActivityErrorList.filter(el => el !== null).length
      const firstAgentActivityError = agentActivityErrorList.find(el => el !== null)

      const agentDiskUsageErrorList = completedDiskLogEventsPerAgent[encodeAgentHash(pubkey)].map(log => log.error)
      const agentDiskUsageErrorCount = agentDiskUsageErrorList.filter(el => el !== null).length
      const firstAgentDiskUsageError = agentDiskUsageErrorList.find(el => el !== null)

      this['Agent ID'] = encodeAgentHash(pubkey)
      this['Activity Logs Successfully Completed'] = completedActivityLogPerAgent[encodeAgentHash(pubkey)].pop().count - agentActivityErrorCount
      this['Time of First Activity Log Error (ms)'] = firstAgentActivityError ? Math.floor(firstAgentActivityError.time) : 'N/A'
      this['Disk Usage Logs Successfully Completed'] = completedDiskLogEventsPerAgent[encodeAgentHash(pubkey)].pop().count - agentDiskUsageErrorCount
      this['Time of First Disk Usage Log Error (ms)'] = firstAgentDiskUsageError ? Math.floor(firstAgentDiskUsageError.time) : 'N/A'
    }
    console.table(hostedHappSLs.map(hostedHappSL => new AgentRecord(hostedHappSL.agent)))
    
    expect(totalExpectedActivityLogCount).to.equal(totalCompletedActivityLogCount)
    expect(totalCompletedActivityErrorCount).to.equal(0)
    expect(totalExpectedDiskLogEventCount).to.equal(totalCompletedDiskLogEventCount)
    expect(totalCompletedDiskLogErrorCount).to.equal(0)
  })
})