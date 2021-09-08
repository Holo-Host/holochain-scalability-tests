const { expect } = require('chai')
const tryorama = require('@holochain/tryorama')
const { Codec } = require('@holo-host/cryptolib')
const encodeAgentHash = Codec.AgentId.encode
const encodeHoloHash = Codec.HoloHash.encode
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const { parseCfg, presentDuration } = require('../utils')
const getActivityLog = require('../common')

describe('Servicelogger DNA', async () => {
  let host_sl_happs, signator_happ, endScenario, cfg, s
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
    // ([signator_happ, ...host_sl_happs] = test_happs)
    signator_happ = test_happs[0]
    host_sl_happs = test_happs.slice(0)

    const settings = {
      // note: using signing agent as both 3rd party signer and provider pubkey for test simplification purposes only
      provider_pubkey: encodeAgentHash(signator_happ.agent),
      max_fuel_before_invoice: 3,
      price_compute: 1,
      price_bandwidth: 1,
      price_storage: 1,
      max_time_before_invoice: [604800, 0]
    }
    
    try {
      await Promise.all(host_sl_happs.map(async host_sl_happ => await host_sl_happ.cells[0].call('service', 'set_logger_settings', settings)))
      console.log(`Logger Settings set for all ${host_sl_happs.length} (non-signatory) host agents`)
    } catch (error) {
      console.log('Error: Failed to set servicelogger settings:', error)
    }
  })
  afterEach(() => endScenario())
  
  it('logs the service activity', async () => {
    const activityCallCount = cfg.appSettings.servicelogger.zomeCallsPerHapp
    console.log('activityCallCount... : ', activityCallCount)

    for (let agentIdx = 0; agentIdx < host_sl_happs.length; agentIdx++) {
      const activity_log = await getActivityLog(host_sl_happs[agentIdx], signator_happ)
      console.log("activity_log : ", activity_log);
      for (let activityIdx = 0; activityIdx < activityCallCount; activityIdx++) {
        await Promise.all(
          host_sl_happs.map(async host_sl_happ => {
            console.log(' -------------- >>>>>>>>>>>>>> ', await host_sl_happ.cells[0].call('service', 'log_activity', activity_log))
          })
        )
      }
    }
    expect(true).to.equal(true)
  })

})