const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules } = require('./Utils/deploy');
const { SnapshotHelper } = require('./utils/snapshot');

describe('Compound v2 Test - fixture', function () {
	let owner, accountA, accountB, otheraccounts;
	let erc20A,
		erc20B,
		unitrollerProxy,
		cErc20A,
		cErc20B,
		priceOracle,
		interestRateModel,
		ctokenArgs,
		liquidator,
		borrower;

	let snapshotHelper;
	before(async function () {
		/* ------------------- set up account ------------------- */
		[owner, accountA, accountB, ...otheraccounts] = await ethers.getSigners();
		liquidator = await ethers.getSigner(accountA.address);
		borrower = await ethers.getSigner(accountB.address);
		/* ------------------------------------------------------ */
		/*                     deploy contract                    */
		/* ------------------------------------------------------ */
		ctokenArgs = {
			erc20A: {
				name: 'erc20A',
				symbol: 'BORROW',
				underlying: '',
				underlyingPrice: 1,
				collateralFactor: 0.5, // 50%
				closeFactor: 0.5, // 50%
				reserveFactor: 0.5, // 50%
				supply: 10000000,
				liquidationIncentive: 1.1,
				decimal: 10 ** 18,
			},
			erc20B: {
				name: 'erc20B',
				symbol: 'COLLATERAL',
				underlying: '',
				underlyingPrice: 100,
				collateralFactor: 0.5, // 50%
				closeFactor: 0.5, // 50%
				reserveFactor: 0.5, // 50%
				supply: 10000000,
				liquidationIncentive: 1.1,
				decimal: 10 ** 18,
			},
		};
		({
			priceOracle,
			unitroller,
			comptroller,
			unitrollerProxy,
			interestRateModel,
			underlyingTokens,
			cTokens,
		} = await deployCompoundModules(owner, ctokenArgs));
		[erc20A, erc20B] = underlyingTokens;
		[cErc20A, cErc20B] = cTokens;

		for (const user of [owner, accountA, accountB]) {
			// enterMarkets 就是個人要選擇這項 cTokens 當作抵押品
			await unitrollerProxy
				.connect(user)
				.enterMarkets([cErc20A.address, cErc20B.address]);
		}
		snapshot = await helpers.takeSnapshot();
		snapshotHelper = new SnapshotHelper(unitrollerProxy);
	});

	afterEach(async function () {
		await snapshot.restore();
	});

	it('Check user markets', async function () {
		const enteredMarketsA = await unitrollerProxy.getAssetsIn(
			liquidator.address,
		);
		const enteredMarketsB = await unitrollerProxy.getAssetsIn(borrower.address);
		expect(enteredMarketsA.length).to.equal(2);
		expect(enteredMarketsA[0]).to.equal(cErc20A.address);
		expect(enteredMarketsA[1]).to.equal(cErc20B.address);
		expect(enteredMarketsB.length).to.equal(2);
		expect(enteredMarketsA[0]).to.equal(cErc20A.address);
		expect(enteredMarketsA[1]).to.equal(cErc20B.address);
	});

	it('Check Price Oracle', async function () {
		expect(await priceOracle.getUnderlyingPrice(cErc20A.address)).to.equal(
			BigInt(ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal),
		);
		expect(await priceOracle.assetPrices(erc20A.address)).to.equal(
			BigInt(ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal),
		);
		expect(await priceOracle.getUnderlyingPrice(cErc20B.address)).to.equal(
			BigInt(ctokenArgs.erc20B.underlyingPrice * ctokenArgs.erc20B.decimal),
		);
		expect(await priceOracle.assetPrices(erc20B.address)).to.equal(
			BigInt(ctokenArgs.erc20B.underlyingPrice * ctokenArgs.erc20B.decimal),
		);
	});

	it('Check Collateral Factor', async function () {
		const marketA = await unitrollerProxy.markets(cErc20A.address);
		const marketB = await unitrollerProxy.markets(cErc20B.address);
		expect(marketA.collateralFactorMantissa).to.equal(
			BigInt(ctokenArgs.erc20A.collateralFactor * ctokenArgs.erc20A.decimal),
		);
		expect(marketB.collateralFactorMantissa).to.equal(
			BigInt(ctokenArgs.erc20B.collateralFactor * ctokenArgs.erc20A.decimal),
		);
	});
});
