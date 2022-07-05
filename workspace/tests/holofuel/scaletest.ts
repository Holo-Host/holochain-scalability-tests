import test from 'tape-promise/tape.js'
import path from 'path'
import { testSetup } from '../common/trycp-helper.js'
import { parseCfg, getListOfTryCPServers } from '../common/utils.js'
import { randomSelection, wait, presentDuration } from './utils.js'
import {
	sendTransaction,
	acceptTransaction,
	numCompleted,
	numActionable,
	numPending,
	getFinalState,
} from './helpers.js'
import lodash from 'lodash'
const { sum } = lodash

test('measures timing for random p2p transactions with serial acceptance', async (t) => {
	/**
	 * Test setup
	 */
	let {
		testSettings: {
			conductorsPerHoloport: numberOfConductor,
			agentsPerConductor: numberOfAgents,
		},
		dnas,
		appTestSettings: { numOfTransactions },
	} = parseCfg()
	let [
		{
			scenario,
			config: [{ conductor, agentHapps }],
		},
	] = await testSetup({
		listOfTryCPs: getListOfTryCPServers(),
		numberOfConductor,
		numberOfAgents,
		testDnaPath: {
			path: path.join(dnas[0].path),
		},
		properties: {
			skip_proof: true,
			// holo_agent_override: membraneProofGenerator?.agentPubKey,
			not_editable_profile: true,
		},
		signalHandler: (s) => console.log('Signal received: ', s),
		membraneProofGenerator: undefined,
	})
	/**
	 * Start creating Pre-Auth
	 */
	let totalAccepted = 0

	const incrementAccepted = () => {
		const currentTenth = Math.floor((totalAccepted * 10) / numOfTransactions)
		totalAccepted += 1
		const newTenth = Math.floor((totalAccepted * 10) / numOfTransactions)
		if (newTenth > currentTenth) {
			console.log(`${totalAccepted}/${numOfTransactions} ✔`)
		}
	}
	// Start the clock to track sending transactions
	const timeStarted = Date.now()
	console.log(`[${timeStarted}]: Start Sending ${numOfTransactions} tx...`)
	const transactions = []
	await Promise.all(
		Array.from({ length: numOfTransactions }, async () => {
			let randomConductor = randomSelection(agentHapps.length)
			let randomAgent = randomSelection(agentHapps[randomConductor].length)
			const sender = agentHapps[randomConductor][randomAgent]
			randomConductor = randomSelection(agentHapps.length)
			randomAgent = randomSelection(agentHapps[randomConductor].length)
			const receiver = agentHapps[randomConductor][randomAgent]
			const transaction = await sendTransaction(sender, receiver)
			transactions.push({
				receiver,
				transaction,
			})
		})
	)
	// Stop the clock to check the time taken to create random transactions
	const finishedSending = Date.now()
	console.log(`[${finishedSending}]: Finished Sending ✔`)

	/**
	 * Start Accepting transactions in parallel
	 */
	for (let i = 0; i < transactions.length; i++) {
		const { receiver, transaction } = transactions[i]
		await acceptTransaction(receiver, transaction)
		incrementAccepted()
	}
	const finishedAccepting = Date.now()
	console.log(`[${finishedAccepting}]: Finished Accepting ✔`)

	let totalActionable = 0
	let totalCompleted = 0
	let totalPending = 0

	while (totalCompleted < numOfTransactions * 2 || totalPending > 0) {
		const completedPerAgent = await Promise.all(
			agentHapps.map(
				async (conductor) => await Promise.all(conductor.map(numCompleted))
			)
		)
		const pendingPerAgent = await Promise.all(
			agentHapps.map(
				async (conductor) => await Promise.all(conductor.map(numPending))
			)
		)
		const actionablePerAgent = await Promise.all(
			agentHapps.map(
				async (conductor) => await Promise.all(conductor.map(numActionable))
			)
		)
		// await Promise.all()
		totalCompleted = sum(completedPerAgent.flat())
		totalPending = sum(pendingPerAgent.flat())
		totalActionable = sum(actionablePerAgent.flat())
		console.log(`completedPerAgent ${completedPerAgent} ✔`)
		console.log(`totalCompleted ${totalCompleted}/${numOfTransactions * 2} ✔`)
		console.log(`totalPending ${totalPending} ✔`)
		console.log(`totalActionable ${totalActionable} ✔`)
		await wait(5_000)
	}

	const finishedAll = Date.now()

	console.log('All complete ✔')

	// This is separated from the expects so that the report is the last thing in the logs
	const finalStates = await Promise.all(
		agentHapps.map(async (agent) => await Promise.all(agent.map(getFinalState)))
	)
	let results = []
	let totalNumAgents = 0
	agentHapps.forEach((a) => a.length + totalNumAgents)
	results.push({
		title: 'measures timing for random p2p transactions with serial acceptance',
		logs: [
			`Total Agents\t${totalNumAgents}`,
			`Total Promises Created\t${numOfTransactions}`,
			// `Time Waiting for Agent Consistency (Min)\t${presentDuration(
			// 	Math.min(...Object.values(agentConsistencyMs))
			// )}`,
			// `Time Waiting for Agent Consistency (Max)\t${presentDuration(
			// 	Math.max(...Object.values(agentConsistencyMs))
			// )}`,
			// `Time Waiting for Agent Consistency (Avg)\t${presentDuration(
			// 	mean(Object.values(agentConsistencyMs))
			// )}`,
			`Time Taken to Create Promises (incl. Agent Consistency)\t${presentDuration(
				finishedSending - timeStarted
			)}`,
			`Time Taken to Accept Promises (incl. Agent Consistency)\t${presentDuration(
				finishedAccepting - finishedSending
			)}`,
			`Time Waiting for Transactions to be Completed\t${presentDuration(
				finishedAll - finishedAccepting
			)}`,
			`Total time taken\t${presentDuration(finishedAll - timeStarted)}`,
		],
	})

	t.equals(
		sum(finalStates.flat().map(({ balance }) => Number(balance))),
		0,
		'Final balance of the entry system is 0'
	)
	t.equals(
		sum(finalStates.flat().map(({ completed }) => completed)),
		numOfTransactions * 2,
		`Expected number of transactions completed`
	)
	results.forEach(({ title, logs }) => {
		console.log(' ')
		console.log(title)
		logs.forEach((result) => console.log(result))
	})
	scenario.cleanUp()
})
