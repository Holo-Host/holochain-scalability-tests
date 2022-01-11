const { expect } = require('chai')
const tryorama = require('@holochain/tryorama')
const { performance } = require('perf_hooks')
const { Codec } = require('@holo-host/cryptolib')
const _ = require('lodash')
const { setUpHoloports, restartTrycp, installAgents } = require('../tests-setup')
const { parseCfg, parseHoloCfg, presentDuration, presentFrequency, getNestedLogValue, accumulate, displaylast6 } = require('../utils')

let crypto = require("crypto")
const generateRandomPubKey = () => Codec.AgentId.encode(crypto.randomBytes(32))

describe('joining-code factory scale tests', async () => {
  let results = []
  let testTimeout, activityLoggingInterval, diskUsageLoggingInterval, hostedHappSLs, signatoryHapps, endScenario, cfg, s
  before(async () => {
    await setUpHoloports()
    cfg = parseCfg()
    holo_cfg = parseHoloCfg()
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
    orchestrator.registerScenario('jch scale-test', scenario => {
      scenarioStarted(scenario)
      return scenarioEndedPromise
    })
    orchestrator.run()
    s = await scenarioPromise
    const installedAgents = await installAgents(s, 'joining_code_factory')
    agents = installedAgents.agents
    players = installedAgents.players
  })

  afterEach(() => endScenario())

  // it('can make a zome call to create mem-proofs', async () => {
  //   console.log(">>", agents);
  //   await Promise.all(
  //     agents.map(async agent => {
  //       expect(
  //         await agent.cells[0].call('code-generator', 'make_proof', {
  //           role: "ROLE",
  //           record_locator: "RECORD_LOCATOR",
  //           registered_agent: generateRandomPubKey()
  //         })
  //       ).to.have.property('signed_header')
  //     })
  //   )
  // })

  it('can make a zome call to create mem-proofs', async () => {
    console.log("Running test...");
    let completed_create = []
    let failed_create = []
    let completed_gets = []
    let failed_gets = []
    let loops = 0
    const startTestTime = Date.now()
    do {
      loops++
      let payloads = []
      for (let i = 0; i < cfg.appTestSettings.simultaneousCalls; i++) {
        payloads.push({
          role: "ROLE",
          record_locator: "RECORD_LOCATOR",
          registered_agent: generateRandomPubKey()
        })
      }
      let i_cc = completed_create.length
      let i_fc = failed_create.length
      await Promise.all(
        payloads.map(async payload => {
          try {
            let r = await agents[0].cells[0].call('code-generator', 'make_proof', payload)
            completed_create.push(r)
          } catch (e) {
            failed_create.push(e)
          }
        })
      )
      let i_cg = completed_gets.length
      let i_fg = failed_gets.length
      await Promise.all(
        payloads.map(async payload => {
          try {
            let r = await agents[0].cells[0].call('code-generator', 'get_kyc_record', {
              record_locator: payload.record_locator,
              registered_agent: payload.registered_agent
            })
            completed_gets.push(r)
          } catch (e) {
            failed_gets.push(e)
          }
        })
      )

      console.log("Running Loop: ", loops);
      console.table(
        {
          'Completed Create Calls': completed_create.length - i_cc,
          'Failed Create Calls': failed_create.length - i_fc,
          'Completed Get Calls': completed_gets.length - i_cg,
          'Failed Get Calls': failed_gets.length - i_fg,
        }
      )
    } while (Date.now() - startTestTime < (cfg.appTestSettings.testDuration - 100))

    console.table(
      {
        '-': '-',
        'Completed Create Calls': completed_create.length,
        'Failed Create Calls': failed_create.length,
        'Completed Get Calls': completed_gets.length,
        'Failed Get Calls': failed_gets.length,
        '--': '--',
        'Number of Simultaneous Call loops': loops,
        'Test Ran for': `${cfg.appTestSettings.testDuration} ms`,
        '---': '---',
        'Success %': ((completed_create.length + completed_gets.length) / ((loops * cfg.appTestSettings.simultaneousCalls) * 2)) * 100,
        'Failure %': ((failed_create.length + failed_gets.length) / ((loops * cfg.appTestSettings.simultaneousCalls) * 2)) * 100,
        '----': '----',
      }
    )
  })
})