const encodeAgentHash = require('@holo-host/cryptolib').Codec.AgentId.encode

// fn that gets the first activity_logs
const getActivityLog = async (host_happ, signator_happ) => {
  let request_payload = {
    call_spec: {
      args_hash: "uhCkkmrkoAHPVf_eufG7eC5fm6QKrW5pPMoktvG5LOC0SnJ4vV1Uv",
      function: "get_message",
      zome: "chat",
      dna_alias: "element-chat",
      hha_hash: "uhCkkmrkoAHPVf_eufG7eC5fm6QKrW5pPMoktvG5LOC0SnJ4vV1Uv"
    },
    // NB: The 'host_agent_id' *is not* in the holohash format as it is a holo host pubkey (as generated from the hpos-seed)
    host_id: "d5xbtnrazkxx8wjxqum7c77qj919pl2agrqd3j2mmxm62vd3k",
    timestamp: [162303, 0]
  }

  let request = {
    agent_id: encodeAgentHash(host_happ.agent),
    request: request_payload,
    request_signature: await get_request_signature(request_payload, signator_happ)
  }

  let response_payload = "kRW1wN0luUmxjM1FpT2lKcGJtWnZjbTFoZEdsdmJpSXNJblJvYVhNaU9uc2liblZ0WW1WeUlqb3hMQ0ozYVd4c0lqcGJJbUpsSUd"
  let response = {
    response_hash: response_payload,
    host_metrics: {
      cpu: 7,
      bandwidth: 1
    },
    signed_response_hash: await get_response_signature(response_payload, signator_happ),
    weblog_compat: {
      source_ip: "100:0:0:0",
      status_code: 200
    }
  }

  let confirmation_payload = {
    response_digest: "JblJvYVhNaU9uc2liblZ0WW1WeUlqb",
    metrics: {
      response_received: [165303, 0]
    }
  }
  let confirmation = {
    confirmation: confirmation_payload,
    confirmation_signature: await get_confirmation_signature(confirmation_payload, signator_happ)
  }
  return {
    request,
    response,
    confirmation
  }
}

async function get_request_signature(data, signator_happ) {
  const signature = await signator_happ.cells[0].call('service', 'sign_request', data);
  return signature
}
async function get_response_signature(data, signator_happ) {
  return await signator_happ.cells[0].call('service', 'sign_response', data);
}
async function get_confirmation_signature(data, signator_happ) {
  return await signator_happ.cells[0].call('service', 'sign_confirmation', data);
}


module.exports = getActivityLog