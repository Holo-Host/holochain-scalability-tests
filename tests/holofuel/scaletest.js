const { expect } = require('chai')
const {
  setUpHoloports,
  restartTrycp,
  installAgents
} = require('../tests-setup')
const tryorama = require('@holochain/tryorama')
const { parseCfg, presentDuration, wait, base64AgentId, getTimestamp } = require('../utils')
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
    const installedAgents = await installAgents(s)
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

  it.only('reaches consistency after many agents all send to every other agent concurrently', async () => {
    let totalAccepted = 0
    const agentConsistencyMs = agents.map(() => 0)
    const totalExpected =
      agents.length * (agents.length - 1) * cfg.promisesPerAgentPerPeer


    const sendAllPeers = async (agent, agentIdx) => {
      let a = 0
      for (
        let counterpartyOffset = 1;
        counterpartyOffset < agents.length;
        counterpartyOffset++
      ) {
        const counterparty =
          agents[(agentIdx + counterpartyOffset) % agents.length]
        console.log("base64AgentId(counterparty): ", base64AgentId(counterparty));
        for (
          let promiseIdx = 0;
          promiseIdx < cfg.promisesPerAgentPerPeer;
          promiseIdx++
        ) {
          console.log(`Promises i: ${promiseIdx}, counterparty: ${base64AgentId(counterparty)}`);
          const payload = {
            receiver: base64AgentId(counterparty),
            amount: '1',
            timestamp: getTimestamp(),
            expiration_date: [Number.MAX_SAFE_INTEGER, 0]
          }

          let foundAgent = false
          const agentConsistencyDelay = 5_000
          while (!foundAgent) {
            try {
              a++
              console.log("trying to create promise");
              await agent.cells[0].call('transactor', 'create_promise', payload)
              console.log(">", a);
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
        timestamp: getTimestamp()
      })
      incrementAccepted()
    }

    const tryAcceptAll = async receiver => {
      const { promise_actionable } = await receiver.cells[0].call(
        'transactor',
        'get_actionable_transactions',
        null
      )
      console.log("Actionable: ", promise_actionable);
      for (let i=0; i<promise_actionable.length; i++) { // (const promise of promise_actionable) {
        try { 
          console.log("id:",promise_actionable[i].id);
          // console.log("receiver:",receiver);
          await accept(receiver, promise_actionable[i].id)
          // console.log(`id: ${promise_actionable[i].id} completed...`);
        } catch (e) {
          console.log("Error:",e);
        }
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
    await wait(15000)
   
    // let a = await Promise.all(agents.map(getFinalState))
    // for(final of a) {
    //   console.log("Initial State: promise_actionable: ", final.actionable.promise_actionable.length);
    //   console.log("Initial State: invoice_actionable: ", final.actionable.invoice_actionable.length);
    // }
    // console.log("+++++++++++++++++++++++++++++++++");
    // await wait(15000)
    // a = await Promise.all(agents.map(getFinalState))
    // for(final of a) {
    //   console.log("Initial State: promise_actionable: ", final.actionable.promise_actionable.length);
    //   console.log("Initial State: invoice_actionable: ", final.actionable.invoice_actionable.length);
    // }

    let totalActionable = 10000000000 // big number
    console.log("Start accepting");
    while (totalActionable > 0) {
      console.log("Trying to accepting");
      // const actionablePerAgent = await Promise.all(agents.map(tryAcceptAll))
      let actionablePerAgent = []
      for(let a = 0; a < agents.length; a++) {
        let num = await tryAcceptAll(agents[a], a)
        actionablePerAgent.push(num)
      }
      totalActionable = sum(actionablePerAgent)
      console.log("Actioned on: ", totalActionable);
      await wait(15000)
    }
    const finishAccept = Date.now()

    console.log('Finished Accepting ✔')

    let totalCompleted = 0
    let totalPending = 0
    let retry = 0;
    while (totalCompleted < totalExpected * 2 && retry < 5) {
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
      retry++
    }

    const finishedAll = Date.now()
    await wait(20000)
    
    // this is separated from the expect so that the report is the last thing in the logs
    const finalStates = await Promise.all(agents.map(getFinalState))

    console.log('All complete ✔')

    results.push({
      title:
        'reaches consistency after many agents all send to every other agent concurrently',
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
        `Time Taken to Accept Promises\t${presentDuration(
          finishAccept - finishSend
        )}`,
        `Time Waiting for Transactions to be Completed\t${presentDuration(
          finishedAll - finishAccept
        )}`,
        `Total time taken\t${presentDuration(finishedAll - start)}`
      ]
    })
    console.log("++++++++++++++++++++++++++++++++");
    console.log("++++++++++++++++++++++++++++++++");
    console.log("totalExpected: ", totalExpected);
    console.log("Expected State: ", expectedFinalState);
    console.log("Final State: ", finalStates);
    console.log("++++++++++++++++++++++++++++++++");
    console.log("++++++++++++++++++++++++++++++++");
    // for(let i = 0; + i<4;i++){
    //   await wait(20000)
    //   console.log("++++++++++++++++++++++++++++++++");
    //   let a = await Promise.all(agents.map(getFinalState))
    //   console.log("Final State: ", a);
    //   console.log("++++++++++++++++++++++++++++++++");
    // }
    

    expect(finalStates).to.deep.equal(agents.map(() => expectedFinalState))
  })

})
