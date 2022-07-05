import { Codec } from '@holo-host/cryptolib'

export const getTimestamp = () => Date.now() * 1000
export const randomSelection = (l) => Math.floor(Math.random() * l)
export const base64AgentId = (a) =>
	Codec.HoloHash.encode('agent', Buffer.from(a))
export let agentConsistencyMs = {}
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const presentDuration = (ms) => {
	const second = 1000
	const minute = 60 * second
	const hour = 60 * minute
	const twoDigits = (num) => ('00' + num).slice(-2)
	const threeDigits = (num) => ('000' + num).slice(-3)

	const h = twoDigits(Math.floor(ms / hour))
	const m = twoDigits(Math.floor(ms / minute) % 60)
	const s = twoDigits(Math.floor(ms / second) % 60)
	return `${h}:${m}:${s}.${threeDigits(ms)}`
}
export const extractCell = (c) => {
	const [cell] = c.namedCells.values()
	return cell
}
