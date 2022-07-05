import test from 'tape-promise/tape.js'
import { testSetup } from '../common/trycp-helper.js'
import { parseCfg, getListOfTryCPServers } from '../common/utils.js'
import { getTimestamp } from './utils.js'
import path from 'path'

test('testing initial setup model', async (t) => {
	// Setting up the mem-proof server

	let { testSettings, dnas } = parseCfg()
	let [
		{
			scenario,
			config: [{ conductor, agentHapps }],
		},
	] = await testSetup({
		listOfTryCPs: getListOfTryCPServers(),
		numberOfConductor: testSettings.conductorsPerHoloport,
		numberOfAgents: testSettings.agentsPerConductor,
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

	console.log('List apps: ', await conductor.adminWs().listDnas())

	const conductor_number = 0
	const agent_number = 0

	const expiration_date = Number.MAX_SAFE_INTEGER
	const promise_args0 = {
		receiver: agentHapps[conductor_number][agent_number].agentPubKey,
		amount: '1.23',
		note: 'hey Bob I think I want to pay you',
		timestamp: getTimestamp(),
		expiration_date,
	}
	let result: any = await agentHapps[conductor_number][
		agent_number
	].cells[0].callZome({
		zome_name: 'transactor',
		fn_name: 'create_promise',
		payload: promise_args0,
	})

	console.log('Result: ', result)
	t.ok(result.id)
	scenario.cleanUp()
})
