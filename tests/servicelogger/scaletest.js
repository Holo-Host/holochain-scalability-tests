const { expect } = require('chai')
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const tryorama = require('@holochain/tryorama')
const encodeHoloHash = require('@holo-host/cryptolib').Codec.HoloHash.encode
const { parseCfg, presentDuration } = require('../utils')

describe('Servicelogger DNA', async () => {
  let agents
  let s
  let endScenario

  before(async () => {
    await setUpHoloports()
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
    agents = await installAgents(s, 'servicelogger')
  })

  afterEach(() => endScenario())

  it('logs the service', async () => {
    console.log('LOGGING...')
    expect(true).to.equal(true)
  })

})