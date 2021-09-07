const { expect } = require('chai')
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const tryorama = require('@holochain/tryorama')
const encodeHoloHash = require('@holo-host/cryptolib').Codec.HoloHash.encode
const { parseCfg, presentDuration } = require('../utils')

describe('Holofuel DNA', async () => {
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
    orchestrator.registerScenario('holofuel scaletest', scenario => {
      scenarioStarted(scenario)
      return scenarioEndedPromise
    })
    orchestrator.run()
    s = await scenarioPromise
    agents = await installAgents(s, 'holofuel')
  })

  afterEach(() => endScenario())

  it('can make a zome call on each agent', async () => {
    await Promise.all(
      agents.map(async agent => {
        expect(
          await agent.cells[0].call('transactor', 'get_ledger', null)
        ).to.deep.equal({
          available: '0',
          balance: '0',
          credit: '0',
          fees: '0',
          payable: '0',
          receivable: '0'
        })
      })
    )
  })

  it('reaches consistency after many agents all send to every other agent concurrently', async () => {
    const cfg = parseCfg()

    const currentlyAccepting = {}
    let totalCompleted = 0
    const totalExpected =
      agents.length * (agents.length - 1) * cfg.promisesPerAgentPerPeer

    const sendAllPeers = async (agent, agentIdx) => {
      for (
        let promiseIdx = 0;
        promiseIdx < cfg.promisesPerAgentPerPeer;
        promiseIdx++
      ) {
        for (
          let counterpartyOffset = 1;
          counterpartyOffset < agents.length;
          counterpartyOffset++
        ) {
          const counterparty =
            agents[(agentIdx + counterpartyOffset) % agents.length]

          await agent.cells[0].call('transactor', 'create_promise', {
            receiver: encodeHoloHash('agent', Buffer.from(counterparty.agent)),
            amount: '1',
            timestamp: [0, 0],
            expiration_date: [Number.MAX_SAFE_INTEGER, 0]
          })
        }
      }
    }

    const incrementCompleted = () => {
      const currentTenth = Math.floor((totalCompleted * 10) / totalExpected)
      totalCompleted += 1
      const newTenth = Math.floor((totalCompleted * 10) / totalExpected)
      if (newTenth > currentTenth) {
        console.log(`${totalCompleted}/${totalExpected} ✔`)
      }
    }

    const accept = async (receiver, id) => {
      if (currentlyAccepting[id]) {
        return
      }
      currentlyAccepting[id] = true
      try {
        await receiver.cells[0].call('transactor', 'accept_transaction', {
          address: id,
          timestamp: [0, 0]
        })
        incrementCompleted()
      } finally {
        delete currentlyAccepting[id]
      }
    }

    const tryAcceptAll = async receiver => {
      const { promise_actionable } = await receiver.cells[0].call(
        'transactor',
        'get_actionable_transactions',
        null
      )

      for (const promise of promise_actionable) {
        try {
          await accept(receiver, promise.id)
        } catch (e) {}
      }
    }

    const getFinalState = async agent => {
      const [actionable, completed, pending, ledger] = await Promise.all(
        [
          'get_actionable_transactions',
          'get_completed_transactions',
          'get_pending_transactions',
          'get_ledger'
        ].map(fn => agent.cells[0].call('transactor', fn, null))
      )
      return {
        actionable,
        completed: completed.length,
        pending,
        balance: ledger.balance
      }
    }

    const expectedFinalState = {
      actionable: {
        promise_actionable: [],
        invoice_actionable: []
      },
      completed: (totalExpected * 2) / agents.length,
      pending: {
        promise_pending: [],
        invoice_pending: []
      },
      balance: '0'
    }

    const start = Date.now()

    await Promise.all(agents.map(sendAllPeers))
    const finishSend = Date.now()

    while (totalCompleted < totalExpected) {
      await Promise.all(agents.map(tryAcceptAll))
    }
    const finishAccept = Date.now()

    expect(await Promise.all(agents.map(getFinalState))).to.deep.equal(
      agents.map(() => expectedFinalState)
    )

    console.log(`
Total Holoports\t${cfg.holoports.length}
Total Conductors\t${cfg.holoports.length * cfg.conductorsPerHoloport}
Total Agents\t${agents.length}
Total Transactions Completed\t${totalCompleted}
Time Taken to Create Promises\t${presentDuration(finishSend - start)}
Time Taken to Accept Promises\t${presentDuration(finishAccept - finishSend)}`)
  })
})
