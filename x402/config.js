const NETWORK_MODE = process.env.NETWORK_MODE || "testnet";

const networks = {
  testnet: {
    USDT0_ADDRESS: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
    CHAIN_RPC: "https://rpc.testnet.stable.xyz",
    CHAIN_NETWORK: "eip155:2201",
    CHAIN_EXPLORER: "https://testnet.stablescan.xyz",
    CHAIN_LABEL: "Stable Testnet",
    CHAIN_ID: 2201,
    USDT0_DOMAIN_NAME: "USD₮0",
    WALLET_INDEX: 0,
  },
  mainnet: {
    USDT0_ADDRESS: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    CHAIN_RPC: "https://rpc.stable.xyz",
    CHAIN_NETWORK: "eip155:988",
    CHAIN_EXPLORER: "https://stablescan.xyz",
    CHAIN_LABEL: "Stable Mainnet",
    CHAIN_ID: 988,
    USDT0_DOMAIN_NAME: "USDT0",
    WALLET_INDEX: 2,
  },
};

const config = networks[NETWORK_MODE];
if (!config) {
  console.error(`Unknown NETWORK_MODE: ${NETWORK_MODE}. Use "testnet" or "mainnet".`);
  process.exit(1);
}

export const {
  USDT0_ADDRESS,
  CHAIN_RPC,
  CHAIN_NETWORK,
  CHAIN_EXPLORER,
  CHAIN_LABEL,
  CHAIN_ID,
  USDT0_DOMAIN_NAME,
  WALLET_INDEX,
} = config;

export const PRICE_UNITS = "100";
export { NETWORK_MODE };