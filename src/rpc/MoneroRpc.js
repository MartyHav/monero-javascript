const MoneroRpcError = require("./MoneroRpcError");
const request = require("request-promise");
const http = require('http');

/**
 * Default RPC configuration.
 */
const MoneroRpcConfigDefault = {
    protocol: "http",
    host: "localhost",
    port: 18081,
    user: null,
    pass: null,
    uri: null
}

/**
 * Interacts with a Monero RPC API.
 */
class MoneroRpc {
  
  /**
   * Constructs a RPC connection using the given config.
   * 
   * @param config defines the rpc configuration as a map
   */
  constructor(config) {
    
    // merge config with defaults
    this.config = Object.assign({}, MoneroRpcConfigDefault, config);
    
    // standardize uri
    if (config.uri) {
      // TODO: strip trailing slash
    } else {
      this.config.uri = this.config.protocol + "://" + this.config.host + ":" + this.config.port;
    }
  }
  
  /**
   * Sends a JSON RPC request.
   * 
   * @param method is the JSON RPC method to invoke
   * @param params are request parameters
   * @return a Promise invoked with the response
   */
  async sendJsonRpcRequest(method, params) {
    
    // build request
    let opts = {
        method: "POST",
        uri: this.config.uri + "/json_rpc",
        json: {
          id: "0",
          jsonrpc: "2.0",
          method: method,
          params: params
        },
        agent: new http.Agent({ // TODO: recycle agent?
          keepAlive: true,
          maxSockets: 1
        })
    };
    if (this.config.user) {
      opts.forever = true;
      opts.auth = {
          user: this.config.user,
          pass: this.config.pass,
          sendImmediately: false
      }
    }
    
    // send request and await response
    let resp = await request(opts);
    if (resp.error) throw new MoneroRpcError(resp.error.code, resp.error.message, opts);
    return resp.result;
  }
  
  /**
   * Sends a RPC request to the given path and with the given paramters.
   * 
   * E.g. "/get_transactions" with params
   */
  async sendPathRpcRequest(path, params) {
    
    // build request
    let opts = {
        method: "POST",
        uri: this.config.uri + "/" + path,
        agent: new http.Agent({ // TODO: recycle agent?
          keepAlive: true,
          maxSockets: 1
        }),
        json: params
    };
    if (this.config.user) {
      opts.forever = true;
      opts.auth = {
          user: this.config.user,
          pass: this.config.pass,
          sendImmediately: false
      }
    }
    
    // send request and await response
    let resp = await request(opts);
    if (resp.error) throw new MoneroRpcError(resp.error.code, resp.error.message, opts);
    return resp.result;
  }
  
  /**
   * Sends a binary RPC request.
   * 
   * @param method is the binary RPC method to invoke
   * @params are the request parameters
   * @return a Promise invoked with the response
   */
  async sendBinRpcRequest(method, params) {
    
    // build request
    let opts = {
        method: "POST",
        uri: this.config.uri + "/" + method,
        agent: new http.Agent({ // TODO: recycle agent?
          keepAlive: true,
          maxSockets: 1
        }),
        resolveWithFullResponse: true,
        encoding: null,
        body: Buffer.from(JSON.stringify(params)), // TODO: how to do parameters
    };
    if (this.config.user) {
      opts.forever = true;
      opts.auth = {
          user: this.config.user,
          pass: this.config.pass,
          sendImmediately: false
      }
    }
    
    // send request and await response
    console.log("Sending to: " + this.config.uri + "/" + method);
    console.log(opts);
    let resp = await request(opts);
    if (resp.error) throw new MoneroRpcError(resp.error.code, resp.error.message, opts);
    return resp.result;
  }
}

module.exports = MoneroRpc;