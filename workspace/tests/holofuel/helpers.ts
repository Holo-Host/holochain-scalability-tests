import {
	getTimestamp,
	base64AgentId,
	agentConsistencyMs,
	wait,
	extractCell,
} from './utils.js'
import { AgentHapp } from '@holochain/tryorama'

export const sendTransaction = async (
	sender: AgentHapp,
	receiver: AgentHapp
) => {
	const payload = {
		receiver: base64AgentId(receiver.agentPubKey),
		amount: '1',
		timestamp: getTimestamp(),
		expiration_date: Number.MAX_SAFE_INTEGER,
	}

	const agentConsistencyDelay = 5_000
	while (true) {
		try {
			const transaction = await extractCell(sender).callZome({
				zome_name: 'transactor',
				fn_name: 'create_promise',
				payload,
			})
			return transaction
		} catch (e) {
			if (String(e).includes('is not held')) {
				// This error means that the recipient is not yet present in our DHT shard.
				agentConsistencyMs[base64AgentId(sender.agentPubKey)] +=
					agentConsistencyDelay
				await wait(agentConsistencyDelay)
			} else {
				console.error('create_promise error', e, 'payload', payload)
				throw e
			}
		}
	}
}

export const acceptTransaction = async (receiver: AgentHapp, transaction) => {
	const payload = {
		address: transaction.id,
		timestamp: getTimestamp(),
	}

	const agentConsistencyDelay = 5_000
	while (true) {
		try {
			const pre_auth = await extractCell(receiver).callZome({
				zome_name: 'transactor',
				fn_name: 'accept_transaction',
				payload,
			})

			let new_transaction = await extractCell(receiver).callZome({
				zome_name: 'transactor',
				fn_name: 'complete_transactions',
				payload: pre_auth,
			})
			return new_transaction
		} catch (e) {
			if (
				String(e).includes('not in your actionable list') ||
				String(e).includes('Invalid Address:') ||
				String(e).includes('Link does not exist')
			) {
				// This error means that the transaction is not yet present in our DHT shard.
				console.error(e)
				console.error('agent "final" state', await getFinalState(receiver))
				agentConsistencyMs[base64AgentId(receiver.agentPubKey)] +=
					agentConsistencyDelay
				await wait(agentConsistencyDelay)
			} else {
				console.error('accept_transaction error', e, 'payload', payload)
				throw e
			}
		}
	}
}

export const getFinalState = async (agent) => {
	const [actionable, completed, pending, ledger] = await Promise.all(
		[
			'get_actionable_transactions',
			'get_completed_transactions',
			'get_pending_transactions',
			'get_ledger',
		].map((fn_name) =>
			extractCell(agent).callZome({
				zome_name: 'transactor',
				fn_name,
			})
		)
	)
	return {
		actionable,
		completed: completed.length,
		pending,
		balance: ledger.balance,
	}
}

export const numCompleted = async (agent) => {
	const completedTransactions = await extractCell(agent).callZome({
		zome_name: 'transactor',
		fn_name: 'get_completed_transactions',
	})

	return completedTransactions.length
}

export const numPending = async (agent) => {
	const result = await extractCell(agent).callZome({
		zome_name: 'transactor',
		fn_name: 'get_pending_transactions',
	})
	return result.invoice_pending.length + result.promise_pending.length
}

export const numActionable = async (agent) => {
	const result = await extractCell(agent).callZome({
		zome_name: 'transactor',
		fn_name: 'get_actionable_transactions',
	})
	return result.invoice_actionable.length + result.promise_actionable.length
}
