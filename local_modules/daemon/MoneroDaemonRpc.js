const MoneroDaemon = require("./MoneroDaemon");
const MoneroRpc = require("../common/MoneroRpc")

/**
 * Implements a Monero daemon using monero-daemon-rpc.
 */
class MoneroDaemonRpc extends MoneroDaemon {
  
  /**
   * Constructs the daemon.
   * 
   * @param rpcOrConfig is an RPC connection or a configuration for one
   */
  constructor(rpcOrConfig) {
    super();
    
    // set rpc connection
    if (rpcOrConfig instanceof MoneroRpc) {
      this.rpc = rpcOrConfig;
    } else {
      this.rpc = new MoneroRpc(rpcOrConfig);
    }
  }
  
  async getHeight() {
    console.log("Sending RPC request...");
    let resp = await this.rpc.sendJsonRpcRequest("get_block_count");
    console.log("Received RPC response...");
    console.log(resp);
    throw new Error("Not implemented");
  }
}

module.exports = MoneroDaemonRpc;