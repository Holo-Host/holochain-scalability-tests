const { wait, base64AgentId } = require('../utils')
const { getTimestamp } = require('../utils')

let agentConsistencyMs = {}

const resetConsistencyTimes = agents => {
  for (var agentKey in agentConsistencyMs){
    if (agentConsistencyMs.hasOwnProperty(agentKey)){
        delete agentConsistencyMs[agentKey]
    }
  }

  agents.forEach(agent => {
    agentConsistencyMs[base64AgentId(agent)] = 0
  })
}

const sendTransaction = async (sender, receiver) => {
  const payload = {
    receiver: base64AgentId(receiver),
    amount: '1',
    timestamp: getTimestamp(),
    expiration_date: Number.MAX_SAFE_INTEGER
  }

  const agentConsistencyDelay = 5_000
  while (true) {
    try {
      const transaction = await sender.cells[0].call('transactor', 'create_promise', payload)
      return transaction
    } catch (e) {
      if (String(e).includes('is not held')) {
        // This error means that the recipient is not yet present in our DHT shard.
        agentConsistencyMs[base64AgentId(sender)] += agentConsistencyDelay
        await wait(agentConsistencyDelay)
      } else {
        console.error('create_promise error', e, 'payload', payload)
        throw e
      }
    }
  }
}

const acceptTransaction = async (receiver, transaction) => {
  const payload = {
    address: transaction.id,
    timestamp: getTimestamp()
  }

  const agentConsistencyDelay = 5_000
  while (true) {
    try {
      const transaction = await receiver.cells[0].call('transactor', 'accept_transaction', payload)
      return transaction
    } catch (e) {
      if (String(e).includes('not in your actionable list') || String(e).includes('Invalid Address:') || String(e).includes('Link does not exist')) {
        // This error means that the transaction is not yet present in our DHT shard.
        console.error(e)
        console.error('agent "final" state', await getFinalState(receiver))
        agentConsistencyMs[base64AgentId(receiver)] += agentConsistencyDelay
        await wait(agentConsistencyDelay)
      } else {
        console.error('accept_transaction error', e, 'payload', payload)
        throw e
      }
    }
  }
}

const numCompleted = async agent => {
  const completedTransactions = await agent.cells[0].call(
    'transactor',
    'get_completed_transactions',
    null
  )

  return completedTransactions.length
}

const numPending = async agent => {
  const result = await agent.cells[0].call(
    'transactor',
    'get_pending_transactions',
    null
  )
  return result.invoice_pending.length + result.promise_pending.length
}

const numActionable = async agent => {
  const result = await agent.cells[0].call(
    'transactor',
    'get_actionable_transactions',
    null
  )
  return result.invoice_actionable.length + result.promise_actionable.length
}

const getFinalState = async agent => {
  const [actionable, completed, pending, ledger] = await Promise.all(
    [
      'get_actionable_transactions',
      'get_completed_transactions',
      'get_pending_transactions',
      'get_ledger'
    ].map(fn => agent.cells[0].call('transactor', fn, null))
  )
  return {
    actionable,
    completed: completed.length,
    pending,
    balance: ledger.balance
  }
}

exports.resetConsistencyTimes = resetConsistencyTimes
exports.agentConsistencyMs = agentConsistencyMs
exports.sendTransaction = sendTransaction
exports.acceptTransaction = acceptTransaction
exports.numCompleted = numCompleted
exports.numPending = numPending
exports.numActionable = numActionable
exports.getFinalState = getFinalState
