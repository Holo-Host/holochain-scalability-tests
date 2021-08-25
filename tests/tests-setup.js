const util = require('util')
const exec = util.promisify(require('child_process').exec)
const tryorama = require('@holochain/tryorama')

const { parseCfg } = require('./utils')
const memProofJSON = require('./memproofs').memproofs

// module's globals to hold state internally
let cfg = parseCfg()
let testResults = {}

const defaultTryoramaNetworkConfig = {
  bootstrap_service: 'https://bootstrap-staging.holo.host',
  network_type: tryorama.NetworkType.QuicBootstrap,
  transport_pool: [
    {
      type: tryorama.TransportConfigType.Proxy,
      sub_transport: { type: tryorama.TransportConfigType.Quic },
      proxy_config: {
        type: tryorama.ProxyConfigType.RemoteProxyClient,
        proxy_url:
          'kitsune-proxy://SYVd4CF3BdJ4DS7KwLLgeU3_DbHoZ34Y-qroZ79DOs8/kitsune-quic/h/165.22.32.11/p/5779/--'
        // proxy_url:
        //   'kitsune-proxy://nFCWLsuRC0X31UMv8cJxioL-lBRFQ74UQAsb8qL4XyM/kitsune-quic/h/192.168.0.203/p/5778/--',
        // proxy_url:
        //   'kitsune-proxy://CIW6PxKxsPPlcuvUCbMcKwUpaMSmB7kLD8xyyj4mqcw/kitsune-quic/h/147.75.54.129/p/5778/--',
        // proxy_url:
        //   'kitsune-proxy://CIW6PxKxsPPlcuvUCbMcKwUpaMSmB7kLD8xyyj4mqcw/kitsune-quic/h/165.22.32.11/p/5778/--',
        // proxy_url:
        //   'kitsune-proxy://nFCWLsuRC0X31UMv8cJxioL-lBRFQ74UQAsb8qL4XyM/kitsune-quic/h/192.168.0.203/p/33679/--',
        // proxy_url:
        //   'kitsune-proxy://f3gH2VMkJ4qvZJOXx0ccL_Zo5n-s_CnBjSzAsEHHDCA/kitsune-quic/h/164.90.142.115/p/10000/--' // p1
      }
    }
  ],
  tuning_params: {
    gossip_loop_iteration_delay_ms: 2000, //number // default 10

    /// Default agent count for remote notify. [Default: 5]
    default_notify_remote_agent_count: 5,

    /// Default timeout for remote notify. [Default: 30s]
    default_notify_timeout_ms: 1000 * 30,

    /// Default timeout for rpc single. [Default: 30s]
    default_rpc_single_timeout_ms: 1000 * 30,

    /// Default agent count for rpc multi. [Default: 2]
    default_rpc_multi_remote_agent_count: 2,

    /// Default timeout for rpc multi. [Default: 30s]
    default_rpc_multi_timeout_ms: 1000 * 30,

    /// Default agent expires after milliseconds. [Default: 20 minutes]
    agent_info_expires_after_ms: 1000 * 60 * 20,

    /// Tls in-memory session storage capacity. [Default: 512]
    tls_in_mem_session_storage: 512,

    /// How often should NAT nodes refresh their proxy contract?
    /// [Default: 2 minutes]
    proxy_keepalive_ms: 1000 * 60 * 2,

    /// How often should proxy nodes prune their ProxyTo list?
    /// Note - to function this should be > proxy_keepalive_ms.
    /// [Default: 5 minutes]
    proxy_to_expire_ms: 1000 * 60 * 5,

    /// Mainly used as the for_each_concurrent limit,
    /// this restricts the number of active polled futures
    /// on a single thread.
    concurrent_limit_per_thread: 4096,

    /// tx2 quic max_idle_timeout
    /// [Default: 30 seconds]
    tx2_quic_max_idle_timeout_ms: 1000 * 30,

    /// tx2 pool max connection count
    /// [Default: 4096]
    tx2_pool_max_connection_count: 4096,

    /// tx2 channel count per connection
    /// [Default: 3]
    tx2_channel_count_per_connection: 16,

    /// tx2 timeout used for passive background operations
    /// like reads / responds.
    /// [Default: 30 seconds]
    tx2_implicit_timeout_ms: 1000 * 30,

    /// tx2 initial connect retry delay
    /// (note, this delay is currenty exponentially backed off--
    /// multiplied by 2x on every loop)
    /// [Default: 200 ms]
    tx2_initial_connect_retry_delay_ms: 200
  }
}

/**
 * Loop through all holoports and run reset-holoport.sh on them.
 * Check status, if 0 print ok message, if not 0 print ERROR and remove from cfg
 * @param {object} cfg - test configuration containing list of holoports to reset
 * @returns {object} - new test configuration
 */
const resetHoloports = async cfg => {
  if (cfg.disableSsh) {
    return
  }
  console.log(`\nResetting holoports participating in test`)

  const calls = cfg.holoports.map(hp => {
    return exec(
      `./scripts/reset-holoport.sh ${hp.zerotierIp} ${cfg.holoportChannel}`,
      { timeout: 300_000 }
    )
  })
  const results = await Promise.allSettled(calls)

  results.map((result, i) => {
    if (result.status == 'rejected') {
      console.log(
        `${cfg.holoports[i].zerotierIp}: ERROR: failed to reset, removing from test`
      )
      cfg.holoports[i].error = true
      cfg.holoports[i].errorMessage = `failed to reset holoport`
    } else if (result.status == 'fulfilled') {
      console.log(`${cfg.holoports[i].zerotierIp}: ✔`)
    }
  })

  return cfg
}

/**
 * Loop through all holoports and check if there is at least one holoport successfully set up
 * @param {object} cfg - containing list of holoports to enable
 * @returns {bool} - true for non-zero list of set-up holoports
 */
const holoportTest = cfg => {
  return !cfg.holoports.reduce((final, current) => final && current.error, true)
}

exports.setUpHoloports = async () => {
  cfg = await resetHoloports(cfg)
  if (!holoportTest(cfg))
    throw new Error(
      `None of the holoports was set up successfully - aborting test`
    )
}

exports.restartTrycp = async () => {
  if (cfg.disableSsh) {
    return
  }
  console.log(`\nRestarting trycp on holoports`)
  await Promise.all(
    cfg.holoports.map(async hp => {
      await exec(`./scripts/restart-trycp.sh ${hp.zerotierIp}`, {
        timeout: 300_000
      })
      console.log(`${hp.zerotierIp}: ✔`)
    })
  )
}

exports.installAgents = async s => {
  console.log(`\nInstalling agents`)
  const configs = Array.from({ length: cfg.conductorsPerHoloport }, () =>
    tryorama.Config.gen({ network: defaultTryoramaNetworkConfig })
  )

  const playersPerHp = await Promise.all(
    cfg.holoports.map(hp => s.players(configs, true, `${hp.zerotierIp}:9000`))
  )
  const players = playersPerHp.flat()

  const happsPerPlayer = await Promise.all(
    players.map((player, i) => installHappsForPlayer(player, i, cfg))
  )

  const happs = happsPerPlayer.flat()

  await s.shareAllNodes(players)
  console.log('Installing agents: ✔')
  return happs
}

const installHappsForPlayer = async (
  player,
  playerIdx,
  { agentsPerConductor: count, dna }
) => {
  const dnaHash = await player.registerDna(dna, null, {
    holo_agent_override:
      'uhCAkRHEsXSAebzKJtPsLY1XcNePAFIieFBtz2ATanlokxnSC1Kkz',
    skip_proof: false
  })
  // Must be sequential due to a bug in holochain
  const result = []
  for (let agentIdx = 0; agentIdx < count; agentIdx++) {
    const agent_key = await player.adminWs().generateAgentPubKey()
    const dnas = [
      {
        hash: dnaHash,
        nick: 'holofuel',
        membrane_proof: Buffer.from(
          memProofJSON[`${playerIdx * count + agentIdx}@holo.host`],
          'base64'
        ) // Currently hardcoded since we don't have an array of unique membrane proofs
      }
    ]
    const happ = await player._installHapp({
      agent_key,
      dnas,
      installed_app_id: `p${playerIdx}a${agentIdx}`
    })
    result.push(happ)
  }
  return result
}
