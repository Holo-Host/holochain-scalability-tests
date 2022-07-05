import fs from 'fs'
import YAML from 'yaml'

export const parseCfg = () => {
	let fileContents = fs.readFileSync(process.env.TEST_CONFIG, 'utf-8')
	return YAML.parse(fileContents)
}

export const parseHoloCfg = () => {
	let fileContents = fs.readFileSync('./tests/holo-config.yaml', 'utf-8')
	return YAML.parse(fileContents)
}

export const getListOfTryCPServers = () => {
	let fileContents = fs.readFileSync('./tests/holo-config.yaml', 'utf-8')
	let yamlFile = YAML.parse(fileContents)
	let tryCPServers: URL[] = []
	yamlFile.holoports.forEach((port) =>
		tryCPServers.push(new URL(`ws://${port.zerotierIp}:9000`))
	)
	return tryCPServers
}
