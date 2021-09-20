const { expect } = require('chai')
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const tryorama = require('@holochain/tryorama')
const { parseCfg, presentDuration, wait, base64AgentId } = require('../utils')
const {
  resetConsistencyTimes,
  agentConsistencyMs,
  sendTransaction,
  acceptTransaction,
  numCompleted,
  numPending,
  numActionable,
  getFinalState
} = require('./transactions')
const { sum, mean } = require('lodash')

describe('Holofuel DNA', async () => {
  let agents
  let players
  let s
  let endScenario
  let results = []
  let cfg

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
    orchestrator.registerScenario('holofuel scaletest', scenario => {
      scenarioStarted(scenario)
      return scenarioEndedPromise
    })
    orchestrator.run()
    s = await scenarioPromise
    const installedAgents = await installAgents(s, 'holofuel')
    agents = installedAgents.agents
    players = installedAgents.players
    resetConsistencyTimes(agents)
  })

  afterEach(() => endScenario())

  after(() => {
    results.forEach(({ title, logs }) => {
      console.log(' ')
      console.log(title)
      logs.forEach(result => console.log(result))
    })
  })

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
    let totalAccepted = 0
    const agentConsistencyMs = agents.map(() => 0)
    const totalExpected =
      agents.length * (agents.length - 1) * cfg.appSettings.holofuel.promisesPerAgentPerPeer

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
          promiseIdx < cfg.appSettings.holofuel.promisesPerAgentPerPeer;
          promiseIdx++
        ) {
          const payload = {
            receiver: base64AgentId(counterparty),
            amount: '1',
            timestamp: [0, 0],
            expiration_date: [Number.MAX_SAFE_INTEGER, 0]
          }

          let foundAgent = false
          const agentConsistencyDelay = 5_000
          while (!foundAgent) {
            try {
              await agent.cells[0].call('transactor', 'create_promise', payload)
              foundAgent = true
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
      incrementAccepted()
    }

    const tryAcceptAll = async receiver => {
      const { promise_actionable } = await receiver.cells[0].call(
        'transactor',
        'get_actionable_transactions',
        null
      )

      for (let i = 0; i < promise_actionable.length; i++) {
        const promise = promise_actionable[i]
        try {
          await accept(receiver, promise.id)
        } catch (e) {}
      }

      return promise_actionable.length
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

    let totalActionable = 0

    while (totalAccepted < totalExpected || totalActionable > 0) {
      const actionablePerAgent = await Promise.all(agents.map(tryAcceptAll))
      totalActionable = sum(actionablePerAgent)
    }
    const finishAccept = Date.now()

    console.log('Finished Accepting ✔')

    let totalCompleted = 0
    let totalPending = 0
    while ((totalCompleted < totalExpected * 2) || totalPending > 0) {
      const completedPerAgent = await Promise.all(agents.map(numCompleted))
      const pendingPerAgent = await Promise.all(agents.map(numPending))
      const actionablePerAgent = await Promise.all(agents.map(numActionable))
      totalCompleted = sum(completedPerAgent)
      totalPending = sum(pendingPerAgent)
      totalActionable = sum(actionablePerAgent)
      console.log(`completedPerAgent ${completedPerAgent} ✔`)
      console.log(`totalCompleted ${totalCompleted}/${totalExpected * 2} ✔`)
      console.log(`totalPending ${totalPending} ✔`)
      console.log(`totalActionable ${totalActionable} ✔`)
      await wait(5_000)
    }

    const finishedAll = Date.now()

    // this is separated from the expect so that the report is the last thing in the logs
    const finalStates = await Promise.all(agents.map(getFinalState))

    console.log('All complete ✔')

    results.push({
      title: 'reaches consistency after many agents all send to every other agent concurrently',
      logs: [
        `Total Holoports\t${cfg.holoports.length}`,
        `Total Conductors\t${cfg.holoports.length * cfg.conductorsPerHoloport}`,
        `Total Agents\t${agents.length}`,
        `Total Promises Created\t${totalAccepted}`,
        `Time Waiting for Agent Consistency (Min)\t${presentDuration(
          Math.min(...agentConsistencyMs)
        )}`,
        `Time Waiting for Agent Consistency (Max)\t${presentDuration(
          Math.max(...agentConsistencyMs)
        )}`,
        `Time Waiting for Agent Consistency (Avg)\t${presentDuration(
          mean(agentConsistencyMs)
        )}`,
        `Time Taken to Create Promises (incl. Agent Consistency)\t${presentDuration(
          finishSend - start
        )}`,
        `Time Taken to Accept Promises\t${presentDuration(finishAccept - finishSend)}`,
        `Time Waiting for Transactions to be Completed\t${presentDuration(finishedAll - finishAccept)}`,
        `Total time taken\t${presentDuration(finishedAll - start)}`
      ]
    })

    expect(finalStates).to.deep.equal(
      agents.map(() => expectedFinalState)
    )
  })

  it('measures timing for random p2p transactions with parallel acceptance', async () => {
    const { numTransactions } = cfg

    let totalAccepted = 0

    const incrementAccepted = () => {
      const currentTenth = Math.floor((totalAccepted * 10) / numTransactions)
      totalAccepted += 1
      const newTenth = Math.floor((totalAccepted * 10) / numTransactions)
      if (newTenth > currentTenth) {
        console.log(`${totalAccepted}/${numTransactions} ✔`)
      }
    }

    const timeStarted = Date.now()

    await Promise.all(Array.from({ length: numTransactions }, async () => {
      const sender = agents[Math.floor(Math.random() * agents.length)]
      const receiver = agents.filter(agent => base64AgentId(agent) !== base64AgentId(sender))[Math.floor(Math.random() * (agents.length - 1))]
      const transaction = await sendTransaction(sender, receiver)

      await acceptTransaction(receiver, transaction)
      incrementAccepted()
    }))

    const finishedSending = Date.now()

    console.log('Finished Sending and Accepting ✔')

    let totalActionable = 0
    let totalCompleted = 0
    let totalPending = 0
    while ((totalCompleted < numTransactions * 2) || totalPending > 0) {
      const completedPerAgent = await Promise.all(agents.map(numCompleted))
      const pendingPerAgent = await Promise.all(agents.map(numPending))
      const actionablePerAgent = await Promise.all(agents.map(numActionable))
      totalCompleted = sum(completedPerAgent)
      totalPending = sum(pendingPerAgent)
      totalActionable = sum(actionablePerAgent)
      console.log(`completedPerAgent ${completedPerAgent} ✔`)
      console.log(`totalCompleted ${totalCompleted}/${numTransactions * 2} ✔`)
      console.log(`totalPending ${totalPending} ✔`)
      console.log(`totalActionable ${totalActionable} ✔`)
      await wait(5_000)
    }

    const finishedAll = Date.now()

    console.log('All complete ✔')

    // this is separated from the expects so that the report is the last thing in the logs
    const finalStates = await Promise.all(agents.map(getFinalState))


    results.push({
      title: 'measures timing for random p2p transactions with parallel acceptance',
      logs: [
        `Total Agents\t${agents.length}`,
        `Total Promises Created\t${numTransactions}`,
        `Time Waiting for Agent Consistency (Min)\t${presentDuration(
              Math.min(...Object.values(agentConsistencyMs))
            )}`,
        `Time Waiting for Agent Consistency (Max)\t${presentDuration(
              Math.max(...Object.values(agentConsistencyMs))
            )}`,
        `Time Waiting for Agent Consistency (Avg)\t${presentDuration(
              mean(Object.values(agentConsistencyMs))
            )}`,
        `Time Taken to Create And Accept Promises (incl. Agent Consistency)\t${presentDuration(
              finishedSending - timeStarted
            )}`,
        `Time Waiting for Transactions to be Completed\t${presentDuration(finishedAll - finishedSending)}`,
        `Total time taken\t${presentDuration(finishedAll - timeStarted)}`
      ]
    })

    expect(sum(finalStates.map(({ balance }) => Number(balance)))).to.equal(0)
    expect(sum(finalStates.map(({ completed }) => completed))).to.equal(numTransactions * 2)
  })

  it('measures timing for random p2p transactions with serial acceptance', async () => {
    const { numTransactions } = cfg

    let totalAccepted = 0

    const incrementAccepted = () => {
      const currentTenth = Math.floor((totalAccepted * 10) / numTransactions)
      totalAccepted += 1
      const newTenth = Math.floor((totalAccepted * 10) / numTransactions)
      if (newTenth > currentTenth) {
        console.log(`${totalAccepted}/${numTransactions} ✔`)
      }
    }

    const timeStarted = Date.now()

    const transactions = []

    await Promise.all(Array.from({ length: numTransactions }, async () => {
      const sender = agents[Math.floor(Math.random() * agents.length)]
      const receiver = agents.filter(agent => base64AgentId(agent) !== base64AgentId(sender))[Math.floor(Math.random() * (agents.length - 1))]
      const transaction = await sendTransaction(sender, receiver)
      transactions.push({
        receiver,
        transaction
      })
    }))

    const finishedSending = Date.now()

    console.log('Finished Sending ✔')

    for (let i = 0; i < transactions.length; i++) {
      const { receiver, transaction } = transactions[i]
      await acceptTransaction(receiver, transaction)
      incrementAccepted()
    }

    const finishedAccepting = Date.now()

    console.log('Finished Accepting ✔')

    let totalActionable = 0
    let totalCompleted = 0
    let totalPending = 0

    while ((totalCompleted < numTransactions * 2) || totalPending > 0) {
      const completedPerAgent = await Promise.all(agents.map(numCompleted))
      const pendingPerAgent = await Promise.all(agents.map(numPending))
      const actionablePerAgent = await Promise.all(agents.map(numActionable))
      totalCompleted = sum(completedPerAgent)
      totalPending = sum(pendingPerAgent)
      totalActionable = sum(actionablePerAgent)
      console.log(`completedPerAgent ${completedPerAgent} ✔`)
      console.log(`totalCompleted ${totalCompleted}/${numTransactions * 2} ✔`)
      console.log(`totalPending ${totalPending} ✔`)
      console.log(`totalActionable ${totalActionable} ✔`)
      await wait(5_000)
    }

    const finishedAll = Date.now()

    console.log('All complete ✔')

    // this is separated from the expects so that the report is the last thing in the logs
    const finalStates = await Promise.all(agents.map(getFinalState))

    results.push({
      title: 'measures timing for random p2p transactions with serial acceptance',
      logs: [
        `Total Agents\t${agents.length}`,
        `Total Promises Created\t${numTransactions}`,
        `Time Waiting for Agent Consistency (Min)\t${presentDuration(
              Math.min(...Object.values(agentConsistencyMs))
            )}`,
        `Time Waiting for Agent Consistency (Max)\t${presentDuration(
              Math.max(...Object.values(agentConsistencyMs))
            )}`,
        `Time Waiting for Agent Consistency (Avg)\t${presentDuration(
              mean(Object.values(agentConsistencyMs))
            )}`,
        `Time Taken to Create Promises (incl. Agent Consistency)\t${presentDuration(
              finishedSending - timeStarted
            )}`,
        `Time Taken to Accept Promises (incl. Agent Consistency)\t${presentDuration(
          finishedAccepting - finishedSending
        )}`,
        `Time Waiting for Transactions to be Completed\t${presentDuration(finishedAll - finishedAccepting)}`,
        `Total time taken\t${presentDuration(finishedAll - timeStarted)}`
      ]
    })

    expect(sum(finalStates.map(({ balance }) => Number(balance)))).to.equal(0)
    expect(sum(finalStates.map(({ completed }) => completed))).to.equal(numTransactions * 2)
  })

  it('measures timing for random p2p transactions with serial acceptance and some senders offline', async () => {
    const getPlayerIdx = appId => Number(appId.match(/^p([0-9]*)a/)[1])

    const { numTransactions, fractionOffline } = cfg
    const activationDelay = 2_000

    const numSenders = Math.floor(agents.length / 2)
    const senders = agents.slice(0, numSenders)
    const receivers = agents.slice(numSenders)

    const timeStarted = Date.now()

    const transactions = []

    let totalAccepted

    await Promise.all(Array.from({ length: numTransactions }, async () => {
      const senderIdx = Math.floor(Math.random() * senders.length)
      const sender = senders[senderIdx]
      const receiver = receivers[Math.floor(Math.random() * receivers.length)]
      const transaction = await sendTransaction(sender, receiver)

      transactions.push({
        receiver,
        transaction,
        senderIdx
      })
    }))

    const finishedSending = Date.now()

    console.log('Finished Sending ✔')

    const numOffline = Math.ceil(numSenders * fractionOffline)

    for (let i = 0; i < numOffline; i++) {
      const sender = senders[i]
      const { hAppId } = sender
      const playerIdx = getPlayerIdx(hAppId)
      const player = players[playerIdx]
      await player.adminWs().deactivateApp({
        installed_app_id: hAppId
      })
    }

    const incrementAccepted = () => {
      const currentTenth = Math.floor((totalAccepted * 10) / numTransactions)
      totalAccepted += 1
      const newTenth = Math.floor((totalAccepted * 10) / numTransactions)
      if (newTenth > currentTenth) {
        console.log(`${totalAccepted}/${numTransactions} ✔`)
      }
    }

    for (let i = 0; i < transactions.length; i++) {
      const { receiver, transaction, senderIdx } = transactions[i]
      const result = await acceptTransaction(receiver, transaction, numTransactions)
      incrementAccepted()
      if (senderIdx < numOffline) {
        expect(result.status).deep.equal({ Accepted: null })
      } else {
        expect(result.status).deep.equal({ Completed: null })
      }
    }

    const finishedAccepting = Date.now()

    console.log('Finished Accepting ✔')

    await wait(activationDelay)

    for (let i = 0; i < numOffline; i++) {
      const sender = senders[i]
      const { hAppId } = sender
      const playerIdx = getPlayerIdx(hAppId)
      const player = players[playerIdx]
      await player.adminWs().activateApp({
        installed_app_id: hAppId
      })
    }

    const completeAllAccepted = async () => {
      for (let i = 0; i < senders.length; i++) {
        const sender = senders[i]
        await sender.cells[0].call('transactor', 'complete_accepted_transactions', null)
      }
    }

    let totalActionable = 0
    let totalCompleted = 0
    let totalPending = 0
    while ((totalCompleted < numTransactions * 2) || totalPending > 0) {
      await completeAllAccepted()

      const completedPerAgent = await Promise.all(agents.map(numCompleted))
      const pendingPerAgent = await Promise.all(agents.map(numPending))
      const actionablePerAgent = await Promise.all(agents.map(numActionable))
      totalCompleted = sum(completedPerAgent)
      totalPending = sum(pendingPerAgent)
      totalActionable = sum(actionablePerAgent)
      console.log(`completedPerAgent ${completedPerAgent} ✔`)
      console.log(`totalCompleted ${totalCompleted}/${numTransactions * 2} ✔`)
      console.log(`totalPending ${totalPending} ✔`)
      console.log(`totalActionable ${totalActionable} ✔`)
      await wait(5_000)
    }

    const finishedAll = Date.now()

    console.log('All complete ✔')

    results.push({
      title: 'measures timing for random p2p transactions with serial acceptance and some senders offline',
      logs: [
        `Total Agents\t${agents.length}`,
        `Total Promises Created\t${numTransactions}`,
        `Time Waiting for Agent Consistency (Min)\t${presentDuration(
          Math.min(...Object.values(agentConsistencyMs))
        )}`,
        `Time Waiting for Agent Consistency (Max)\t${presentDuration(
          Math.max(...Object.values(agentConsistencyMs))
        )}`,
        `Time Waiting for Agent Consistency (Avg)\t${presentDuration(
          mean(Object.values(agentConsistencyMs))
        )}`,
        `Time Taken to Create Promises (incl. Agent Consistency)\t${presentDuration(
          finishedSending - timeStarted
        )}`,
        `Time Taken to Accept Promises (incl. Agent Consistency)\t${presentDuration(
          finishedAccepting - finishedSending
        )}`,
        `Time Waiting for Transactions to be Completed\t${presentDuration(finishedAll - finishedAccepting)}`,
        `Total time taken\t${presentDuration(finishedAll - timeStarted)}`
      ]
    })

    const finalStates = await Promise.all(agents.map(getFinalState))
    expect(sum(finalStates.map(({ balance }) => Number(balance)))).to.equal(0)
    expect(sum(finalStates.map(({ completed }) => completed))).to.equal(numTransactions * 2)
  })
})
