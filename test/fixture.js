const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules } = require('./Utils/deploy');

describe('Compound v2 Test', function () {
	let owner, accountA, accountB, otheraccounts;
	let signerA, signerB;
	let undA, undB, unitrollerProxy, cErc20A, cErc20B, priceOracle, ctokenArgs;

	before(async function () {
		/* ------------------- set up account ------------------- */
		[owner, accountA, accountB, ...otheraccounts] = await ethers.getSigners();
		signerA = await ethers.getSigner(accountA.address);
		signerB = await ethers.getSigner(accountB.address);
		/* ------------------------------------------------------ */
		/*                     deploy contract                    */
		/* ------------------------------------------------------ */
		ctokenArgs = [
			{
				name: 'UnderA',
				symbol: 'UNDA',
				underlying: '',
				underlyingPrice: parseUnits('1', 18),
				collateralFactor: parseUnits('0.5', 18), // 50%
				closeFactor: parseUnits('0.5', 18), // 50
				reserveFactor: parseUnits('5', 18), // 50%
				supply: 10000000,
				liquidationIncentive: parseUnits('1.1', 18),
			},
			{
				name: 'UnderB',
				symbol: 'UNDB',
				underlying: '',
				underlyingPrice: parseUnits('100', 18),
				collateralFactor: parseUnits('0.5', 18), // 50%
				reserveFactor: parseUnits('5', 18), // 50%
				closeFactor: parseUnits('0.5', 18), // 50
				supply: 10000000,
				liquidationIncentive: parseUnits('1.1', 18),
			},
		];
		({
			priceOracle,
			unitroller,
			comptroller,
			unitrollerProxy,
			interestRateModel,
			underlyingTokens,
			cTokens,
		} = await deployCompoundModules(owner, ctokenArgs));
		[undA, undB] = underlyingTokens;
		[cErc20A, cErc20B] = cTokens;

		for (const user of [owner, accountA, accountB]) {
			// enterMarkets 就是個人要選擇這項 cTokens 當作抵押品
			await unitrollerProxy
				.connect(user)
				.enterMarkets([cErc20A.address, cErc20B.address]);
		}
		snapshot = await helpers.takeSnapshot();
	});

	afterEach(async function () {
		await snapshot.restore();
	});

	describe('Check fixtures', function () {
		it('Check user markets', async function () {
			const enteredMarketsA = await unitrollerProxy.getAssetsIn(
				signerA.address,
			);
			const enteredMarketsB = await unitrollerProxy.getAssetsIn(
				signerB.address,
			);
			expect(enteredMarketsA.length).to.equal(2);
			expect(enteredMarketsA[0]).to.equal(cErc20A.address);
			expect(enteredMarketsA[1]).to.equal(cErc20B.address);
			expect(enteredMarketsB.length).to.equal(2);
			expect(enteredMarketsA[0]).to.equal(cErc20A.address);
			expect(enteredMarketsA[1]).to.equal(cErc20B.address);
		});
		it('Check Price Oracle', async function () {
			expect(await priceOracle.getUnderlyingPrice(cErc20A.address)).to.equal(
				ctokenArgs[0].underlyingPrice,
			);
			expect(await priceOracle.assetPrices(undA.address)).to.equal(
				ctokenArgs[0].underlyingPrice,
			);
			expect(await priceOracle.getUnderlyingPrice(cErc20B.address)).to.equal(
				ctokenArgs[1].underlyingPrice,
			);
			expect(await priceOracle.assetPrices(undB.address)).to.equal(
				ctokenArgs[1].underlyingPrice,
			);
		});
		it('Check Collateral Factor', async function () {
			const marketA = await unitrollerProxy.markets(cErc20A.address);
			const marketB = await unitrollerProxy.markets(cErc20B.address);
			expect(marketA.collateralFactorMantissa).to.equal(
				ctokenArgs[0].collateralFactor,
			);
			expect(marketB.collateralFactorMantissa).to.equal(
				ctokenArgs[1].collateralFactor,
			);
		});
	});
});
