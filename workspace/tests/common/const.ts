import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const HOLOFUEL_DNA_PATH = {
	path: path.join(__dirname, '../dnas/holofuel.dna'),
}

export const JC_DNA_PATH = {
	path: path.join(__dirname, '../dnas/joining-code-factory.dna'),
}

const TRYCP_SERVER_PORT = 9000
const TRYCP_SERVER_HOST = '0.0.0.0'
export const SERVER_URL = new URL(
	`ws://${TRYCP_SERVER_HOST}:${TRYCP_SERVER_PORT}`
)
