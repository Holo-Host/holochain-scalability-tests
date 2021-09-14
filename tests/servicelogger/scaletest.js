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
    signatory_happ = test_happs[0]
    host_sl_happs = test_happs.slice(0)
    // ([signatory_happ, ...host_sl_happs] = test_happs)
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
    // set number of signator agents 
    // set number of hosts >> affects number of host agents
    // set number of zome calls
    const activityCallCount = cfg.appSettings.servicelogger.zomeCallsPerHapp
    console.log('activityCallCount... : ', activityCallCount)

    const totalExpectedActivityLogCount = activityCallCount * host_sl_happs.length
    const completedActivityLogPerHost = {}

    const totalExpectedDiskLogEventCount = (TEST_TIMEOUT/LOGGING_INTERVAL) * host_sl_happs.length
    const completedDiskLogEventsPerHost = {}

    let testDuration = 0
    const logHostService = async () => {
      console.log('STARTED....')
      const startTime = performance.now()
      // start making zome calls to log activity
      // > interate over number of hosts
      for (let agentIdx = 0; agentIdx < host_sl_happs.length; agentIdx++) {
        // >> iterate over number of zome calls per host
        for (let activityIdx = 0; activityIdx < activityCallCount; activityIdx++) {
          const activityLog = await getActivityLog(signatory_happ)
          console.log("activity Log params : ", activityLog);
          try {
            const logActivityResult = await host_sl_happs[agentIdx].cells[0].call('service', 'log_activity', activityLog)
            console.log(' activity Log result -------------- >>>>>>>>>>>>>> ', logActivityResult)
            if (!completedActivityLogPerHost[host_sl_happs[agentIdx].agent]) {
              completedActivityLogPerHost[host_sl_happs[agentIdx].agent] = 0
            }
            completedActivityLogPerHost[host_sl_happs[agentIdx].agent]++
          } catch (error) {
            console.error(`Error - Failed to log activity call #${activityIdx} for host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} : ${error}`)
          }
        }
        
        // log disk usage per host every 1 min (...or do we want do it after a certain volume of calls?)
        const logUsage = async () => {
          console.log("starting setInterval... ");
          try {
            const diskUsage = getDiskUsage(host_sl_happs)
            const logDiskUsageResult = await host_sl_happs[agentIdx].cells[0].call('service', 'log_disk_usage', diskUsage)
            console.log(' log Disk UsageResult -------------- >>>>>>>>>>>>>> ', logDiskUsageResult)
            // expect(logDiskUsageResult).to.have.property('total_disk_usage', 1)
            // expect(logDiskUsageResult).to.have.property('integrated_entries')
            // expect(logDiskUsageResult).to.have.property('source_chains')
            
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
        setInterval(() => logUsage(), LOGGING_INTERVAL)
      }

      console.log('COMPLETE....')
      console.log('completedActivityLogPerHost :', completedActivityLogPerHost)
      console.log('completedDiskLogEventsPerHost :', completedDiskLogEventsPerHost)
      testDuration = performance.now() - startTime
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
            console.log('activityCallCount : ', activityCallCount)
            console.warn(`Host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} only succeded in ${completedActivityLogPerHost[host_sl_happs[agentIdx].agent] || 0} activity log calls`)
          }
          if (completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent] !== (TEST_TIMEOUT/LOGGING_INTERVAL)) {
            console.log('TEST_TIMEOUT/LOGGING_INTERVAL : ', TEST_TIMEOUT/LOGGING_INTERVAL)
            console.warn(`Host agent ${encodeAgentHash(host_sl_happs[agentIdx].agent)} only succeded in ${completedDiskLogEventsPerHost[host_sl_happs[agentIdx].agent] || 0} disk usage log calls`)
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

          Test Duration\t${presentDuration(testDuration) || 'Test Incomplete'}
          Set Test Timeout\t${presentDuration(TEST_TIMEOUT)}
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