const { expect } = require('chai')
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const tryorama = require('@holochain/tryorama')
const encodeHoloHash = require('@holo-host/cryptolib').Codec.HoloHash.encode
const { parseCfg, presentDuration, wait } = require('../utils')
const { sum, mean } = require('lodash')

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
    agents = await installAgents(s)
  })

  afterEach(() => endScenario())

  it.skip('can make a zome call on each agent', async () => {
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

    let totalAccepted = 0
    const agentConsistencyMs = agents.map(() => 0)
    const totalExpected =
      agents.length * (agents.length - 1) * cfg.promisesPerAgentPerPeer

    const transactionsFromAgent = {}
    const transactionsToAgent = {}
    const transactionStatus = {}

    const sendAllPeers = async (agent, agentIdx) => {
      for (
        let counterpartyOffset = 1;
        counterpartyOffset < agents.length;
        counterpartyOffset++
      ) {
        const counterparty =
          agents[(agentIdx + counterpartyOffset) % agents.length]
        for (
          let promiseIdx = 0;
          promiseIdx < cfg.promisesPerAgentPerPeer;
          promiseIdx++
        ) {
          const payload = {
            receiver: encodeHoloHash('agent', Buffer.from(counterparty.agent)),
            amount: '1',
            timestamp: [0, 0],
            expiration_date: [Number.MAX_SAFE_INTEGER, 0]
          }

          let foundAgent = false
          const agentConsistencyDelay = 5_000
          while (!foundAgent) {
            try {
              const transaction = await agent.cells[0].call('transactor', 'create_promise', payload)
              transactionStatus[transaction.id] === 'PENDING'
              foundAgent = true
              const agentKey = encodeHoloHash('agent', Buffer.from(agent.agent))
              const counterpartyKey = encodeHoloHash('agent', Buffer.from(counterparty.agent))
              if (transactionsFromAgent[agentKey]) {
                transactionsFromAgent[agentKey]++
              } else {
                transactionsFromAgent[agentKey] = 1
              }

              if (transactionsToAgent[counterpartyKey]) {
                transactionsToAgent[counterpartyKey]++
              } else {
                transactionsToAgent[counterpartyKey] = 1
              }
            } catch (e) {
              if (String(e).includes('is not held')) {
                // This error means that the recipient is not yet present in our DHT shard.
                agentConsistencyMs[agentIdx] += agentConsistencyDelay
                await wait(agentConsistencyDelay)
              } else {
                console.error('create_promise error', e, 'payload', payload)
                throw e
              }
            }
          }
        }
      }
    }

    const incrementAccepted = () => {
      const currentTenth = Math.floor((totalAccepted * 10) / totalExpected)
      totalAccepted += 1
      const newTenth = Math.floor((totalAccepted * 10) / totalExpected)
      if (newTenth > currentTenth) {
        console.log(`${totalAccepted}/${totalExpected} ✔`)
      }
    }

    const accept = async (receiver, id) => {
      await receiver.cells[0].call('transactor', 'accept_transaction', {
        address: id,
        timestamp: [0, 0]
      })
      transactionStatus[id] = 'Accepted'
      incrementAccepted()
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

      return promise_actionable.length
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

    const numCompleted = async agent => {
      const completedTransactions = await agent.cells[0].call(
        'transactor',
        'get_completed_transactions',
        null
      )
      completedTransactions.forEach(completedTransaction => {
        transactionStatus[completedTransaction.id] = 'Completed'
      })

      return completedTransactions.length
    }

    const numPending = async agent => {
      const result = await agent.cells[0].call(
        'transactor',
        'get_pending_transactions',
        null
      )
      return result.invoice_pending.length + result.promise_pending.length
    }

    const numActionable = async agent => {
      const result = await agent.cells[0].call(
        'transactor',
        'get_actionable_transactions',
        null
      )
      return result.invoice_actionable.length + result.promise_actionable.length
    }

    const expectedFinalState = {
      actionable: {
        promise_actionable: [],
        invoice_actionable: []
      },
      completed: (totalExpected * 2) / agents.length,
      pending: {
        promise_pending: [],
        invoice_pending: [],
        invoice_declined: [],
        promise_declined: []
      },
      balance: '0'
    }

    const start = Date.now()

    await Promise.all(agents.map(sendAllPeers))
    const finishSend = Date.now()

    console.log('Finished Sending ✔')
    console.log('Transactions from agent', transactionsFromAgent,  '✔')
    console.log('Transactions to agent', transactionsToAgent,  '✔')

    const totalActuallyExpect = sum(Object.values(transactionsToAgent))

    let totalActionable = 0

    while (totalAccepted < totalActuallyExpect || totalActionable > 0) {
      const actionablePerAgent = await Promise.all(agents.map(tryAcceptAll))
      totalActionable = sum(actionablePerAgent)
    }
    const finishAccept = Date.now()

    console.log('Finished Accepting ✔')
    console.log('Transaction status ✔', transactionStatus)

    let totalCompleted = 0
    let totalPending = 0
    while ((totalCompleted < totalActuallyExpect * 2) || totalPending > 0) {
      const completedPerAgent = await Promise.all(agents.map(numCompleted))
      const pendingPerAgent = await Promise.all(agents.map(numPending))
      const actionablePerAgent = await Promise.all(agents.map(numActionable))
      totalCompleted = sum(completedPerAgent)
      totalPending = sum(pendingPerAgent)
      totalActionable = sum(actionablePerAgent)
      console.log(`completedPerAgent ${completedPerAgent} ✔`)
      console.log(`totalCompleted ${totalCompleted}/${totalActuallyExpect * 2} ✔`)
      console.log(`totalPending ${totalPending} ✔`)
      console.log(`totalActionable ${totalActionable} ✔`)
      console.log('Transaction status ✔', transactionStatus)
      await wait(5_000)
    }

    const finishedAll = Date.now()

    console.log('All complete ✔')

    console.log(`
Total Holoports\t${cfg.holoports.length}
Total Conductors\t${cfg.holoports.length * cfg.conductorsPerHoloport}
Total Agents\t${agents.length}
Total Promises Created\t${totalAccepted}
Time Waiting for Agent Consistency (Min)\t${presentDuration(
      Math.min(...agentConsistencyMs)
    )}
Time Waiting for Agent Consistency (Max)\t${presentDuration(
      Math.max(...agentConsistencyMs)
    )}
Time Waiting for Agent Consistency (Avg)\t${presentDuration(
      mean(agentConsistencyMs)
    )}
Time Taken to Create Promises (incl. Agent Consistency)\t${presentDuration(
      finishSend - start
    )}
Time Taken to Accept Promises\t${presentDuration(finishAccept - finishSend)}
Time Waiting for Transactions to be Completed\t${presentDuration(finishedAll - finishAccept)}`)
  })

  expect(await Promise.all(agents.map(getFinalState))).to.deep.equal(
    agents.map(() => expectedFinalState)
  )
})
