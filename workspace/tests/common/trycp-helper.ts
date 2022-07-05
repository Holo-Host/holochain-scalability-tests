import {
	TryCpClient,
	AgentHapp,
	TryCpConductor,
	TryCpScenario,
} from '@holochain/tryorama'
import * as msgpack from '@msgpack/msgpack'
import { Codec } from '@holo-host/cryptolib'

type Memproof = {
	signed_action: {
		action: any
		signature: Buffer
	}
	entry: any
}

type TestConfiguration = {
	listOfTryCPs: URL[]
	numberOfConductor: number
	numberOfAgents: number
	testDnaPath: { path: string }
	properties?: any
	signalHandler?: any
	membraneProofGenerator?: AgentHapp
}

type PlayersPerConductor = {
	conductor: TryCpConductor
	agentHapps: AgentHapp[][]
}

type Scenarios = {
	scenario: TryCpScenario
	client: TryCpClient
	config: PlayersPerConductor[]
}

export async function testSetup(
	config: TestConfiguration
): Promise<Scenarios[]> {
	let result: Scenarios[] = []
	for (let i = 0; i < config.listOfTryCPs.length; i++) {
		const scenario = new TryCpScenario()
		try {
			const client = await scenario.addClient(config.listOfTryCPs[i])
			let setup = await installAgents(client, config)
			result.push({
				scenario,
				client,
				config: setup,
			})
		} catch (e) {
			console.log(e)
		}
	}
	return result
}

export async function installAgents(
	tryCpClient: TryCpClient,
	config: TestConfiguration
): Promise<PlayersPerConductor[]> {
	// call addPlayerToConductor based on the number of conductors needed
	let result: PlayersPerConductor[] = []
	for (let i = 0; i < config.numberOfConductor; i++) {
		result.push(await addPlayersPerConductor(tryCpClient, config))
	}
	return result
}

async function addPlayersPerConductor(
	tryCpClient: TryCpClient,
	config: TestConfiguration
): Promise<PlayersPerConductor> {
	const conductor = await tryCpClient.addConductor(config.signalHandler)
	// generate agents
	let agentHapps: AgentHapp[][] = []
	for (let i = 0; i < config.numberOfAgents; i++) {
		let agentPubKey = await conductor.adminWs().generateAgentPubKey()
		let membraneProof
		// generate a mem-proof
		if (!!config.membraneProofGenerator) {
			const membrane_proof: Memproof =
				await config.membraneProofGenerator.cells[0].callZome({
					zome_name: 'code-generator',
					fn_name: 'make_proof',
					payload: {
						role: 'holofuel',
						record_locator: 'RECORD_LOCATOR',
						registered_agent: Codec.AgentId.encode(agentPubKey),
					},
				})
			membraneProof = Array.from(msgpack.encode(membrane_proof))
		}
		agentHapps.push(
			await conductor.installAgentsHapps({
				agentsDnas: [
					{
						dnas: [
							{
								source: config.testDnaPath,
								membraneProof,
							},
						],
						agentPubKey,
					},
				],
				properties: config.properties,
			})
		)
	}

	return { conductor, agentHapps }
}
