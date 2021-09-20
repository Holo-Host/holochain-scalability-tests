const { expect } = require('chai')
const tryorama = require('@holochain/tryorama')
const { performance } = require('perf_hooks')
const { Codec } = require('@holo-host/cryptolib')
const _ = require('lodash')
const { inspect } = require('util')
const encodeAgentHash = Codec.AgentId.encode
const { setUpHoloports, restartTrycp, installAgents } = require('../tests-setup')
const { parseCfg, presentDuration, presentFrequency, getNestedLogValue, accumulate, displaylast6 } = require('../utils')
const { getActivityLog, getDiskUsage, getSettings } = require('./utils/index')

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
    
    const { agents: testHapps } = await installAgents(s, 'servicelogger')
    const signatoryHappIndices = []
    signatoryHapps = testHapps.filter((_,i) => {
      if (i%(testHapps.length/cfg.holoports.length) === 0) {
        signatoryHappIndices.push(i)
        return true
      }
    })
    // remove signatory happs to form hosted happ array
    signatoryHappIndices.map(sigHappIndex => {
      testHapps.splice(sigHappIndex, 1)
    })
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
      const agentIdx = hostedHappSLs.indexOf(hostHapp)
      try {
        if (paramFnArgs === signatoryHapps) {
          const hostIndex = Math.floor(agentIdx/(cfg.agentsPerConductor * cfg.conductorsPerHoloport))
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
        console.log(`Completed ${zomeFnName.includes('activity') ? 'Activity' : 'Disk Usage'} Call: agent:${agentIdx} x count:${count}`)
      } catch (error) {
        activityLogDuration = Math.floor(performance.now() - startTime)
        console.error(`Error: Failed to log ${zomeFnName.includes('activity') ? 'Activity' : 'Disk Usage'} call #${count} for agent #${agentIdx} (${encodeAgentHash(hostHapp.agent)}) : ${error}`)
        logList[encodeAgentHash(hostHapp.agent)].push({
          count,
          duration: activityLogDuration,
          error: {
            time: performance.now(),
            message: inspect(error.message)
          }
        })
      }
    }

    const startTestTime = Date.now()
    do {
      const loopDate = Date.now()
      if ((loopDate - startTestTime)%activityLoggingInterval === 0) {
        await Promise.all(hostedHappSLs.map(hh => callZome(hh, completedActivityLogPerAgent, 'log_activity', getActivityLog, signatoryHapps)) )
      }
      if ((loopDate - startTestTime)%diskUsageLoggingInterval === 0) {
        await Promise.all(hostedHappSLs.map(hh => callZome(hh, completedDiskLogEventsPerAgent, 'log_disk_usage', getDiskUsage, hostedHappSLs)) )
      }
    } while (Date.now() - startTestTime < (testTimeout - 100))

    const totalCompletedActivityLogCount = accumulate(getNestedLogValue(completedActivityLogPerAgent, 'count'))
    const totalCompletedDiskLogEventCount = accumulate(getNestedLogValue(completedDiskLogEventsPerAgent, 'count'))
    const totalCompletedActivityErrorCount = getNestedLogValue(completedActivityLogPerAgent, 'error', { all: true }).filter(el => el !== null).length
    const totalCompletedDiskLogErrorCount = getNestedLogValue(completedDiskLogEventsPerAgent, 'error', { all: true }).filter(el => el !== null).length
    const avgActivityLogCallDuration = Math.round(getNestedLogValue(completedActivityLogPerAgent, 'duration', { all: true }).reduce((acc, t) => acc + t, 0)/hostedHappSLs.length)
    const avgDiskLogCallDuration = Math.round(getNestedLogValue(completedDiskLogEventsPerAgent, 'duration', { all: true }).reduce((acc, t) => acc + t, 0)/hostedHappSLs.length)

    // log outcomes in terminal
    console.table(
      {
        '-': '-',
        'Test Duration': presentDuration(testTimeout),
        'Number Holoports': cfg.holoports.length,
        'Number Agents Per Host Conductor': cfg.agentsPerConductor,
        'Total Host Conductors': cfg.holoports.length * cfg.conductorsPerHoloport,
        'Total Hosted Agents': hostedHappSLs.length,
        'Total Signatory Conductors (x1/Holoport)': signatoryHapps.length,
        'Total Signatory Agents (x1/Signatory Conductor)': signatoryHapps.length,
        '--': '--',
        'Activity Log Frequency': presentFrequency('call', activityLoggingInterval),
        'Average Duration per Activity Log Call': presentDuration(avgActivityLogCallDuration),
        'Total Activity Log Calls Invoked': totalCompletedActivityLogCount,
        'Total Activity Log Call Errors': totalCompletedActivityErrorCount,
        'Total Successful Activity Log Calls': totalCompletedActivityLogCount - totalCompletedActivityErrorCount,
        '---': '---',
        'Disk Usage Log Frequency': presentFrequency('call', diskUsageLoggingInterval),
        'Average Duration per Disk Usage Log Call': presentDuration(avgDiskLogCallDuration),
        'Total Disk Usage Log Calls Invoked': totalCompletedDiskLogEventCount,
        'Total Disk Usage Log Call Errors': totalCompletedDiskLogErrorCount,
        'Total Successful Disk Usage Log Calls': totalCompletedDiskLogEventCount - totalCompletedDiskLogErrorCount
      }
    )
    function AgentRecord(pubkey) {
      const getAgentValueList = (logList, key) => logList[encodeAgentHash(pubkey)].map(log => log[key])
      const agentActivityErrorList = getAgentValueList(completedActivityLogPerAgent, 'error')
      const agentActivityErrorCount = agentActivityErrorList.filter(el => el !== null).length
      const agentActivityDurationList = getAgentValueList(completedActivityLogPerAgent, 'duration')
      const agentAvgActivityDuration = Math.round(agentActivityDurationList.reduce((acc, t) => acc + t, 0))
      const agentDiskUsageErrorList = getAgentValueList(completedDiskLogEventsPerAgent, 'error')
      const agentDiskUsageErrorCount = agentDiskUsageErrorList.filter(el => el !== null).length
      const agentDiskUsageDurationList = getAgentValueList(completedDiskLogEventsPerAgent, 'duration')
      const agentAvgDiskUsageDuration = Math.round(agentDiskUsageDurationList.reduce((acc, t) => acc + t, 0))
      this['Agent ID'] = displaylast6(encodeAgentHash(pubkey))
      this['Successful Activity Logs'] = completedActivityLogPerAgent[encodeAgentHash(pubkey)].pop().count - agentActivityErrorCount
      this['Avg Activity Log Duration(ms)'] = presentDuration(agentAvgActivityDuration)
      this['First Activity Log Error(ms)'] = agentActivityErrorCount[0] ? Math.floor(agentActivityErrorCount[0].time) : 'N/A'
      this['Successful Disk Usage Logs'] = completedDiskLogEventsPerAgent[encodeAgentHash(pubkey)].pop().count - agentDiskUsageErrorCount
      this['Avg Disk Usage Log Duration(ms)'] = presentDuration(agentAvgDiskUsageDuration)
      this['First Disk Usage Log Error(ms)'] = agentDiskUsageErrorCount[0] ? Math.floor(agentDiskUsageErrorCount[0].time) : 'N/A'
    }
    console.table(hostedHappSLs.map(hostedHappSL => new AgentRecord(hostedHappSL.agent)))
    
    // test whether expected number of tests were run and all passed
    expect(totalExpectedActivityLogCount).to.equal(totalCompletedActivityLogCount)
    expect(totalCompletedActivityErrorCount).to.equal(0)
    expect(totalExpectedDiskLogEventCount).to.equal(totalCompletedDiskLogEventCount)
    expect(totalCompletedDiskLogErrorCount).to.equal(0)
  })
})