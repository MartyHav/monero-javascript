const assert = require("assert");
const WalletSyncPrinter = require("./WalletSyncPrinter");
const monerojs = require("../../../index");
const LibraryUtils = monerojs.LibraryUtils;
const GenUtils = monerojs.GenUtils;
const MoneroRpcError = monerojs.MoneroRpcError;
const MoneroRpcConnection = monerojs.MoneroRpcConnection;
const BigInteger = monerojs.BigInteger;
const MoneroNetworkType = monerojs.MoneroNetworkType;
const MoneroWalletRpc = monerojs.MoneroWalletRpc;

/**
 * Collection of test utilities and configurations.
 * 
 * TODO: move hard coded to config
 */
class TestUtils {
  
  /**
   * Get a default file system.  Uses an in-memory file system if running in the browser.
   * 
   * @return nodejs-compatible file system
   */
  static getDefaultFs() {
    if (!LibraryUtils.FS) LibraryUtils.FS = GenUtils.isBrowser() ? require('memfs') : require('fs');
    return LibraryUtils.FS;
  }
  
  /**
   * Get a singleton daemon RPC instance shared among tests.
   * 
   * @return {MoneroDaemonRpc} a daemon RPC instance
   */
  static async getDaemonRpc() {
    if (TestUtils.daemonRpc === undefined) TestUtils.daemonRpc = await monerojs.connectToDaemonRpc(Object.assign({proxyToWorker: TestUtils.PROXY_TO_WORKER}, TestUtils.DAEMON_RPC_CONFIG));
    return TestUtils.daemonRpc;
  }
  
  /**
   * Get a singleton instance of a monero-daemon-rpc client.
   */
  static getDaemonRpcConnection() {
    return new MoneroRpcConnection(TestUtils.DAEMON_RPC_CONFIG);
  }
  
  /**
   * Get a singleton instance of a monero-wallet-rpc client.
   * 
   * @return {MoneroWalletRpc} a wallet RPC instance
   */
  static async getWalletRpc() {
    if (TestUtils.walletRpc === undefined) {
      
      // construct wallet rpc instance with daemon connection
      TestUtils.walletRpc = await monerojs.connectToWalletRpc(TestUtils.WALLET_RPC_CONFIG);
    }
    
    // attempt to open test wallet
    try {
      await TestUtils.walletRpc.openWallet({path: TestUtils.WALLET_NAME, password: TestUtils.WALLET_PASSWORD});
    } catch (e) {
      if (!(e instanceof MoneroRpcError)) throw e;
      
      // -1 returned when wallet does not exist or fails to open e.g. it's already open by another application
      if (e.getCode() === -1) {
        
        // create wallet
        await TestUtils.walletRpc.createWallet({path: TestUtils.WALLET_NAME, password: TestUtils.WALLET_PASSWORD, mnemonic: TestUtils.MNEMONIC, restoreHeight: TestUtils.FIRST_RECEIVE_HEIGHT});
      } else {
        throw e;
      }
    }
    
    // ensure we're testing the right wallet
    assert.equal(await TestUtils.walletRpc.getMnemonic(), TestUtils.MNEMONIC);
    assert.equal(await TestUtils.walletRpc.getPrimaryAddress(), TestUtils.ADDRESS);
    
    // sync and save the wallet
    await TestUtils.walletRpc.sync();
    await TestUtils.walletRpc.save();
    
    // start background synchronizing with sync rate
    await TestUtils.walletRpc.startSyncing(TestUtils.SYNC_PERIOD_IN_MS);
    
    // return cached wallet rpc
    return TestUtils.walletRpc;
  }
  
  /**
   * Create a monero-wallet-rpc process bound to the next available port.
   *
   * @return {MoneroWalletRpc} - client connected to an internal monero-wallet-rpc instance
   */
  static async startWalletRpcProcess() {
    
    // get next available offset of ports to bind to
    let portOffset = 1;
    while (Object.keys(TestUtils.WALLET_PORT_OFFSETS).includes("" + portOffset)) portOffset++;
    TestUtils.WALLET_PORT_OFFSETS[portOffset] = undefined; // reserve port
    
    // create or connect to monero-wallet-rpc process
    let wallet;
    if (GenUtils.isBrowser()) {
      let uri = TestUtils.WALLET_RPC_CONFIG.uri.substring(0, TestUtils.WALLET_RPC_CONFIG.uri.lastIndexOf(":")) + ":" + (TestUtils.WALLET_RPC_PORT_START + portOffset);
      wallet = await monerojs.connectToWalletRpc(uri, TestUtils.WALLET_RPC_CONFIG.username, TestUtils.WALLET_RPC_CONFIG.password);
    } else {
        
      // create command to start client with internal monero-wallet-rpc process
      let cmd = [
          TestUtils.WALLET_RPC_LOCAL_PATH,
          "--" + MoneroNetworkType.toString(TestUtils.NETWORK_TYPE),
          "--daemon-address", TestUtils.DAEMON_RPC_CONFIG.uri,
          "--daemon-login", TestUtils.DAEMON_RPC_CONFIG.username + ":" + TestUtils.DAEMON_RPC_CONFIG.password,
          "--rpc-bind-port", "" + (TestUtils.WALLET_RPC_PORT_START + portOffset),
          "--rpc-login", TestUtils.WALLET_RPC_CONFIG.username + ":" + TestUtils.WALLET_RPC_CONFIG.password,
          "--wallet-dir", TestUtils.WALLET_RPC_LOCAL_WALLET_DIR,
          "--rpc-access-control-origins", TestUtils.WALLET_RPC_ACCESS_CONTROL_ORIGINS
      ];
      
      // TODO: include zmq params when supported and enabled
      
      // create and connect to monero-wallet-rpc process
      wallet = await monerojs.connectToWalletRpc(cmd);
    }
    
    // register wallet with port offset
    TestUtils.WALLET_PORT_OFFSETS[portOffset] = wallet;
    return wallet;
  }
  
  /**
   * Stop a monero-wallet-rpc process and release its port.
   * 
   * @param {MoneroWalletRpc} walletRpc - wallet created with internal monero-wallet-rpc process
   */
  static async stopWalletRpcProcess(walletRpc) {
    assert(walletRpc instanceof MoneroWalletRpc, "Must provide instance of MoneroWalletRpc to close");
    
    // get corresponding port
    let portOffset;
    for (const [key, value] of Object.entries(TestUtils.WALLET_PORT_OFFSETS)) {
      if (value === walletRpc) {
        portOffset = key;
        break;
      }
    }
    if (portOffset === undefined) throw new Error("Wallet not registered");
    
    // unregister wallet with port offset
    delete TestUtils.WALLET_PORT_OFFSETS[portOffset];
    if (!GenUtils.isBrowser()) await walletRpc.stopProcess();
  }
  
  /**
   * Get a singleton instance of a wallet supported by WebAssembly bindings to monero-project's wallet2.
   * 
   * @return {MoneroWalletWasm} a wasm wallet instance
   */
  static async getWalletWasm() {
    if (!TestUtils.walletWasm || await TestUtils.walletWasm.isClosed()) {
      
      // create wallet from mnemonic phrase if it doesn't exist
      let fs = TestUtils.getDefaultFs();
      if (!await monerojs.MoneroWalletWasm.walletExists(TestUtils.WALLET_WASM_PATH, fs)) {
        
        // create directory for test wallets if it doesn't exist
        if (!fs.existsSync(TestUtils.TEST_WALLETS_DIR)) {
          if (!fs.existsSync(process.cwd())) fs.mkdirSync(process.cwd(), { recursive: true });  // create current process directory for relative paths which does not exist in memory fs
          fs.mkdirSync(TestUtils.TEST_WALLETS_DIR);
        }
        
        // create wallet with connection
        TestUtils.walletWasm = await monerojs.createWalletWasm({path: TestUtils.WALLET_WASM_PATH, password: TestUtils.WALLET_PASSWORD, networkType: TestUtils.NETWORK_TYPE, mnemonic: TestUtils.MNEMONIC, server: TestUtils.getDaemonRpcConnection(), restoreHeight: TestUtils.FIRST_RECEIVE_HEIGHT, proxyToWorker: TestUtils.PROXY_TO_WORKER, fs: fs});
        assert.equal(await TestUtils.walletWasm.getSyncHeight(), TestUtils.FIRST_RECEIVE_HEIGHT);
        await TestUtils.walletWasm.sync(new WalletSyncPrinter());
        await TestUtils.walletWasm.save();
        await TestUtils.walletWasm.startSyncing(TestUtils.SYNC_PERIOD_IN_MS);
      }
      
      // otherwise open existing wallet
      else {
        TestUtils.walletWasm = await monerojs.openWalletWasm({path: TestUtils.WALLET_WASM_PATH, password: TestUtils.WALLET_PASSWORD, networkType: TestUtils.NETWORK_TYPE, server: TestUtils.getDaemonRpcConnection(), proxyToWorker: TestUtils.PROXY_TO_WORKER, fs: TestUtils.getDefaultFs()});
        await TestUtils.walletWasm.sync(new WalletSyncPrinter());
        await TestUtils.walletWasm.startSyncing(TestUtils.SYNC_PERIOD_IN_MS);
      }
    }
    
    // ensure we're testing the right wallet
    assert.equal(await TestUtils.walletWasm.getMnemonic(), TestUtils.MNEMONIC);
    assert.equal(await TestUtils.walletWasm.getPrimaryAddress(), TestUtils.ADDRESS);
    return TestUtils.walletWasm;
  }
  
  /**
   * Get a singleton keys-only wallet instance shared among tests.
   * 
   * @return {MoneroWalletKeys} a keys-only wallet instance
   */
  static async getWalletKeys() {
    if (TestUtils.walletKeys === undefined) {
      
      // create wallet from mnemonic
      TestUtils.walletKeys = await monerojs.createWalletKeys({networkType: TestUtils.NETWORK_TYPE, mnemonic: TestUtils.MNEMONIC});
    }
    return TestUtils.walletKeys;
  }
  
  static testUnsignedBigInteger(num, nonZero) {
    assert(num);
    assert(num instanceof BigInteger);
    let comparison = num.compare(new BigInteger(0));
    assert(comparison >= 0);
    if (nonZero === true) assert(comparison > 0);
    if (nonZero === false) assert(comparison === 0);
  }
  
  static async getExternalWalletAddress() {
    let wallet = await monerojs.createWalletKeys({networkType: TestUtils.NETWORK_TYPE});
    return await wallet.getPrimaryAddress();
  }
  
  static txsMergeable(tx1, tx2) {
    try {
      let copy1 = tx1.copy();
      let copy2 = tx2.copy();
      if (copy1.isConfirmed()) copy1.setBlock(tx1.getBlock().copy().setTxs([copy1]));
      if (copy2.isConfirmed()) copy2.setBlock(tx2.getBlock().copy().setTxs([copy2]));
      copy1.merge(copy2);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

// ---------------------------- STATIC TEST CONFIG ----------------------------

// TODO: export these to key/value properties file for tests

// test wallet config
TestUtils.WALLET_NAME = "test_wallet_1";
TestUtils.WALLET_PASSWORD = "supersecretpassword123";
TestUtils.TEST_WALLETS_DIR = "./test_wallets";
TestUtils.WALLET_WASM_PATH = TestUtils.TEST_WALLETS_DIR + "/" + TestUtils.WALLET_NAME;

TestUtils.MAX_FEE = new BigInteger("7500000").multiply(new BigInteger("10000"));
TestUtils.NETWORK_TYPE = MoneroNetworkType.STAGENET;

// default keypair to test
TestUtils.MNEMONIC = "limits linen agreed gesture medicate having nurse doing pests tonic nugget pimple anxiety saucepan movement acquire estate likewise exult niece pedantic voyage fuselage gyrate fuselage";
TestUtils.ADDRESS = "54mANzvpzCWQD9FPG9a4XXaRjvQF7uLCxRc6i2uGx9pnQ6nUKaoKZ2oC9kC3Ee6SKBgFLzkwssZ9QH6TeiNGC6CFA99Hnck";
TestUtils.FIRST_RECEIVE_HEIGHT = 501; // NOTE: this value MUST be the height of the wallet's first tx for tests

// wallet RPC config
TestUtils.WALLET_RPC_CONFIG = {
  uri: "http://localhost:38084",
  username: "rpc_user",
  password: "abc123",
  rejectUnauthorized: true // reject self-signed certificates if true
};

// daemon RPC config
TestUtils.DAEMON_RPC_CONFIG = {
  uri: "http://localhost:38081",
  username: "superuser",
  password: "abctesting123",
  rejectUnauthorized: true // reject self-signed certificates if true
};

const WalletTxTracker = require("./WalletTxTracker");
TestUtils.WALLET_TX_TRACKER = new WalletTxTracker(); // used to track wallet txs for tests
TestUtils.PROXY_TO_WORKER = undefined; // default to true if browser, false otherwise
TestUtils.SYNC_PERIOD_IN_MS = 5000; // period between wallet syncs in milliseconds

// monero-wallet-rpc process management
TestUtils.WALLET_RPC_PORT_START = 38084;
TestUtils.WALLET_PORT_OFFSETS = {};
TestUtils.WALLET_RPC_LOCAL_PATH = "/Applications/monero-x86_64-apple-darwin11-v0.17.1.9-rct/monero-wallet-rpc";
TestUtils.WALLET_RPC_LOCAL_WALLET_DIR = "/Applications/monero-x86_64-apple-darwin11-v0.17.1.9-rct";
TestUtils.WALLET_RPC_ACCESS_CONTROL_ORIGINS = "http://localhost:8080"; // cors access from web browser

module.exports = TestUtils;
