import test from 'tape-promise/tape.js'
import { testSetup } from '../utils/trycp-helper.js'
import { HOLOFUEL_DNA_PATH, SERVER_URL } from '../utils/const.js'
import { getTimestamp } from './utils.js'

test('testing initial setup model', async (t) => {
	let [
		{
			config: [{ conductor, agentHapps }],
		},
	] = await testSetup({
		listOfTryCPs: [SERVER_URL],
		numberOfConductor: 1,
		numberOfAgents: 1,
		testDnaPath: HOLOFUEL_DNA_PATH,
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
})
