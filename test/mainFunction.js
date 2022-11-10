const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules } = require('./Utils/deploy');
const { SnapshotHelper } = require('./utils/snapshot');

describe('Compound v2 Test', function () {
	let owner, accountA, accountB, otheraccounts;
	let undA,
		undB,
		unitrollerProxy,
		cErc20A,
		cErc20B,
		priceOracle,
		interestRateModel,
		ctokenArgs,
		signerA,
		signerB;
	let snapshotHelper;
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
		snapshotHelper = new SnapshotHelper(unitrollerProxy);
	});

	afterEach(async function () {
		await snapshot.restore();
	});

	async function mintCTokenWithToken(token, ctoken, signerA, mintAmount) {
		await token.transfer(signerA.address, mintAmount);
		await token.connect(signerA).approve(ctoken.address, mintAmount);
		await ctoken.connect(signerA).mint(mintAmount);
	}

	describe('Fullfill Request', function () {
		it('Should be able to mint then redeem', async function () {
			/* ------------------------ mint ------------------------ */
			const mintAmount = parseUnits('100', 18);
			await mintCTokenWithToken(undA, cErc20A, signerA, mintAmount);
			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				totalSupply: mintAmount,
				cash: mintAmount,
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerA,
					tokens: [undA],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: parseUnits(String(100 * 1 * 0.5), 18),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [mintAmount],
				},
			);
			/* ----------------------- redeem ----------------------- */
			await cErc20A.connect(signerA).redeem(mintAmount);
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerA,
					tokens: [undA],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall: 0,
					},
					tokens: [mintAmount],
					cTokens: [0],
				},
			);
		});

		it('Should be able to borrow then repay', async function () {
			/* ------------------- mint token a------------------------ */
			await mintCTokenWithToken(undA, cErc20A, signerA, parseUnits('100', 18));
			/* -------------------- mint token b -------------------- */
			await mintCTokenWithToken(undB, cErc20B, signerB, parseUnits('1', 18));
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerB,
					tokens: [undB],
					cTokens: [cErc20B],
				},
				{
					user: {
						liquidity: parseUnits('50', 18),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [parseUnits('1', 18)],
				},
			);
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = parseUnits('50', 18);
			await cErc20A.connect(signerB).borrow(borrowAmount);
			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				cash: parseUnits(String(100 - 50), 18),
				totalBorrows: borrowAmount,
				totalSupply: parseUnits('100', 18),
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerB,
					tokens: [undA],
					cTokens: [cErc20A, cErc20B],
				},
				{
					user: {
						liquidity: 0,
						shortfall: 0,
					},
					tokens: [borrowAmount],
					cTokens: [0, parseUnits('1', 18)],
				},
			);
			/* -------------------- repay borrow -------------------- */
			await undA.connect(signerB).approve(cErc20A.address, borrowAmount);
			await cErc20A.connect(signerB).repayBorrow(borrowAmount);
			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				cash: parseUnits(String(100), 18),
				totalBorrows: 0,
				totalSupply: parseUnits('100', 18),
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerB,
					tokens: [undA],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: parseUnits('50', 18),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [0],
				},
			);
		});

		it('If collateral factor goes down, should be able to liquidateBorrow', async function () {
			await mintCTokenWithToken(undA, cErc20A, signerA, parseUnits('100', 18));
			await mintCTokenWithToken(undB, cErc20B, signerB, parseUnits('1', 18));
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = parseUnits('50', 18);
			await cErc20A.connect(signerB).borrow(borrowAmount);
			/* --------------- collateralFactor change -------------- */
			await unitrollerProxy._setCollateralFactor(
				cErc20B.address,
				parseUnits('0.25', 18).toString(),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerB,
					tokens: [undA],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall: parseUnits('25', 18),
					},
					tokens: [borrowAmount],
					cTokens: [0],
				},
			);
			/* ---------------------- liquidate --------------------- */
			await undA.transfer(signerA.address, parseUnits('20', 18));
			await undA
				.connect(signerA)
				.approve(cErc20A.address, parseUnits('20', 18));
			await cErc20A
				.connect(signerA)
				.liquidateBorrow(
					signerB.address,
					parseUnits('20', 18),
					cErc20B.address,
				);
			expect(await cErc20A.totalBorrows()).to.equal(parseUnits('30', 18));
		});

		it('If price goes down, should be able to liquidateBorrow', async function () {
			await mintCTokenWithToken(undA, cErc20A, signerA, parseUnits('100', 18));
			await mintCTokenWithToken(undB, cErc20B, signerB, parseUnits('1', 18));
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = parseUnits('50', 18);
			await cErc20A.connect(signerB).borrow(borrowAmount);
			expect(await cErc20A.totalBorrows()).to.equal(borrowAmount);
			/* ---------------------- liquidate --------------------- */
			await priceOracle.setUnderlyingPrice(
				cErc20B.address,
				parseUnits('50', 18),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: signerB,
					tokens: [undA],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall: parseUnits('25', 18),
					},
					tokens: [borrowAmount],
					cTokens: [0],
				},
			);
			await undA.transfer(signerA.address, parseUnits('20', 18));
			await undA
				.connect(signerA)
				.approve(cErc20A.address, parseUnits('20', 18));
			await cErc20A
				.connect(signerA)
				.liquidateBorrow(
					signerB.address,
					parseUnits('20', 18),
					cErc20B.address,
				);
			expect(await cErc20A.totalBorrows()).to.equal(parseUnits('30', 18));
		});
	});
});
