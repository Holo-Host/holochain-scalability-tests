const { expect } = require('chai')
const tryorama = require('@holochain/tryorama')
const { performance } = require('perf_hooks')
const { Codec } = require('@holo-host/cryptolib')
const encodeAgentHash = Codec.AgentId.encode
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const { parseCfg, presentDuration, accumulate } = require('../utils')
const { getActivityLog, getDiskUsage, getSettings } = require('../common');

const TEST_TIMEOUT = 300_000 // 5 MINTUES
const LOGGING_INTERVAL = 60_000 // 1 MINUTE

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('Servicelogger DNA', async () => {
  let host_sl_happs, signatory_happ, endScenario, cfg, s
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

    const test_happs = await installAgents(s, 'servicelogger')
    // todo: make signatory agents a global var instead of static number (currently 1)
    signatory_happ = test_happs[0]
    host_sl_happs = test_happs.slice(0)
    const settings = getSettings(signatory_happ)
    try {
      await Promise.all(host_sl_happs.map(async host_sl_happ => await host_sl_happ.cells[0].call('service', 'set_logger_settings', settings)))
      console.log(`Logger Settings set for all ${host_sl_happs.length} (non-signatory) host agents`)
    } catch (error) {
      console.log('Error: Failed to set servicelogger settings:', error)
    }
  })
  afterEach(() => endScenario())
  
  it('logs the service activity and disk usage for set interval', async () => {
    const activityCallCount = cfg.appSettings.servicelogger.zomeCallsPerHapp
    const totalExpectedActivityLogCount = activityCallCount * host_sl_happs.length
    const completedActivityLogPerHost = {}
    const totalExpectedDiskLogEventCount = (TEST_TIMEOUT/LOGGING_INTERVAL) * host_sl_happs.length
    const completedDiskLogEventsPerHost = {}

    let diskLogIntervalID
    let logActivityDuration = 0
    const logHostService = async () => {
      const startTime = performance.now()
      // start making zome calls to log activity
      // > iterate over number of hosts
      for (let agentIdx = 0; agentIdx < host_sl_happs.length; agentIdx++) {
        // >> iterate over number of zome calls per host and log activity
        for (let activityIdx = 0; activityIdx < activityCallCount; activityIdx++) {
          const activityLog = await getActivityLog(signatory_happ)
          console.log("activity Log params : ", activityLog);
          try {
            const logActivityResult = await host_sl_happs[agentIdx].cells[0].call('service', 'log_activity', activityLog)
            console.log(' Activity Log Result -------------- >', logActivityResult)
            if (!completedActivityLogPerHost[host_sl_happs[agentIdx].agent]) {
              completedActivityLogPerHost[host_sl_happs[agentIdx].agent] = 0
            }
            completedActivityLogPerHost[host_sl_happs[agentIdx].agent]++
          } catch (error) {
            console.error(`Error - Failed to log activity call #${activityIdx} for host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} : ${error}`)
          }
        }
        
        // log disk usage per host every 1 min
        const logUsage = async () => {
          console.log("starting setInterval... ");
          try {
            const diskUsage = getDiskUsage(host_sl_happs)
            const logDiskUsageResult = await host_sl_happs[agentIdx].cells[0].call('service', 'log_disk_usage', diskUsage)
            console.log(' Disk Usage Log Result -------------- > ', logDiskUsageResult)
            if (!completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent]) {
              completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent] = 0
            }
            completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent]++
          } catch (error) {
            // detect when the zome calls start to fail for each host
            // track last failed for each user
            // log the time it failed 
            console.error(`Error - Failed to log disk usage call #${agentIdx} for host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} : ${error}`)
          }
        }
        
        await logUsage()
        diskLogIntervalID = setInterval(() => logUsage(), LOGGING_INTERVAL)
      }
      
      console.log('COMPLETE....')
      console.log('completedActivityLogPerHost :', completedActivityLogPerHost)
      logActivityDuration = performance.now() - startTime

      // intentionally wait for remaining duration of test time (to ensure all nec disk usg calls are made)
      await delay(TEST_TIMEOUT - logActivityDuration)
      clearInterval(diskLogIntervalID)
      console.log('completedDiskLogEventsPerHost :', completedDiskLogEventsPerHost)
    }

    // start loop that runs for given time (RUNTIME)
    Promise.race([
      await logHostService(),
      new Promise(resolve => {
        setTimeout(() => {
          console.log('TIMING OUT....')
          resolve()
        }, TEST_TIMEOUT, 'Service Logging Timer is Complete');
      })
    ])
      .then(() => {
        console.log("NEXT... ")
        // Log successful call count each agent that did NOT succeed in making 100% of expected log_activity & log_disk_usage calls:
        for (let agentIdx = 0; agentIdx < host_sl_happs.length; agentIdx++) {
          if (completedActivityLogPerHost[host_sl_happs[agentIdx].agent] !== activityCallCount) {
            console.warn(`Host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} only succeded in ${completedActivityLogPerHost[host_sl_happs[agentIdx].agent] || 0}/${activityCallCount} activity log calls`)
          }
          if (completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent] !== (TEST_TIMEOUT/LOGGING_INTERVAL)) {
            console.warn(`Host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} only succeded in ${completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent] || 0}/${TEST_TIMEOUT/LOGGING_INTERVAL} disk usage log calls`)
          }
        }
    
        // STATS: 
        // Total time the test ran
    
        // Total number of logs per host
        // Sum Total number of logs
    
        // Total number of disk logs events per host
        // Sum Total number of disk logs events (disk logs x number of hosts)'
        console.log(`
          Total Holoports\t${cfg.holoports.length}
          Total Conductors\t${(cfg.holoports.length * cfg.conductorsPerHoloport) + [signatory_happ].length}
          Total Host Agents\t${host_sl_happs.length}
          Total Signatory Agents\t${[signatory_happ].length}
          **********************************************
          Total number of Activity Logs \t${totalCompletedActivityLogCount}
          Total number of Disk Log Events \t${totalCompletedDiskLogEventCount}
          \n

          Log Activity Calls Duration\t${presentDuration(logActivityDuration) || 'Test Incomplete'}
          Full Test Duration\t${presentDuration(TEST_TIMEOUT)}
          `)
        //
        testDuration = 0

        const totalCompletedActivityLogCount = accumulate(Object.values(completedActivityLogPerHost)) || 0
        const totalCompletedDiskLogEventCount = accumulate(Object.values(completedDiskLogEventsPerHost)) || 0

        console.log('totalExpectedActivityLogCount : ', totalExpectedActivityLogCount)
        console.log('totalCompletedActivityLogCount : ', totalCompletedActivityLogCount)
        expect(totalExpectedActivityLogCount).to.equal(totalCompletedActivityLogCount)

        console.log('totalExpectedDiskLogEventCount : ', totalExpectedDiskLogEventCount)
        console.log('totalCompletedDiskLogEventCount : ', totalCompletedDiskLogEventCount)
        console.log('completedDiskLogEventsPerHost : ', completedDiskLogEventsPerHost)
        expect(totalExpectedDiskLogEventCount).to.equal(completedDiskLogEventsPerHost)
      })
  })
})