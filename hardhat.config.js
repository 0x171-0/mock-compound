require('@nomicfoundation/hardhat-toolbox');
require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-etherscan');
require('dotenv').config();
const { API_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	solidity: '0.8.10',
	defaultNetwork: 'hardhat',
	networks: {
		goerli: {
			url: API_URL,
			accounts: [PRIVATE_KEY],
		},
		hardhat: {
			forking: {
				url: `https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`,
				enabled: true,
				blockNumber: 15815693,
			},
			// gas: 7000000,
			// gasPrice: 9230900745,
			allowUnlimitedContractSize: true,
		},
		localhost: {
			url: 'http://127.0.0.1:8545',
			allowUnlimitedContractSize: true,
		},
	},
	etherscan: {
		apiKey: ETHERSCAN_API_KEY,
	},
};
