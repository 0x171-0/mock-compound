const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules } = require('./Utils/deploy');
const { SnapshotHelper } = require('./utils/snapshot');

describe('Compound v2 Test', function () {
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

	async function mintCTokenWithToken(token, ctoken, signerA, mintAmount) {
		await token.transfer(signerA.address, mintAmount);
		await token.connect(signerA).approve(ctoken.address, mintAmount);
		await ctoken.connect(signerA).mint(mintAmount);
	}

	describe('Fullfill Request', function () {
		it.only('Should be able to mint then redeem', async function () {
			/* ------------------------ mint ------------------------ */
			const mintAmount = 100n;
			await mintCTokenWithToken(
				erc20A,
				cErc20A,
				liquidator,
				mintAmount * BigInt(ctokenArgs.erc20A.decimal),
			);

			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				totalSupply: mintAmount * BigInt(ctokenArgs.erc20A.decimal),
				cash: mintAmount * BigInt(ctokenArgs.erc20A.decimal),
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: liquidator,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity:
							mintAmount *
							BigInt(
								ctokenArgs.erc20A.underlyingPrice *
									ctokenArgs.erc20A.collateralFactor *
									ctokenArgs.erc20A.decimal,
							),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [mintAmount * BigInt(ctokenArgs.erc20A.decimal)],
				},
			);

			/* ----------------------- redeem ----------------------- */
			await cErc20A
				.connect(liquidator)
				.redeem(mintAmount * BigInt(ctokenArgs.erc20A.decimal));
			await snapshotHelper.expectUserSnapShot(
				{
					user: liquidator,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall: 0,
					},
					tokens: [mintAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0],
				},
			);
		});

		it.only('Should be able to borrow then repay', async function () {
			const mintAmountOfA = 100n;
			const mintAmountOfB = 1n;
			await mintCTokenWithToken(
				erc20A,
				cErc20A,
				liquidator,
				mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: liquidator,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity:
							mintAmountOfA *
							BigInt(
								ctokenArgs.erc20A.underlyingPrice *
									ctokenArgs.erc20A.collateralFactor *
									ctokenArgs.erc20A.decimal,
							),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal)],
				},
			);
			console.log(
				'????',
				mintAmountOfA,
				ctokenArgs.erc20A.underlyingPrice,
				ctokenArgs.erc20A.collateralFactor,
				ctokenArgs.erc20A.decimal,
				mintAmountOfA *
					BigInt(
						ctokenArgs.erc20A.underlyingPrice *
							ctokenArgs.erc20A.collateralFactor *
							ctokenArgs.erc20A.decimal,
					),
			);
			/* -------------------- mint token b -------------------- */
			await mintCTokenWithToken(
				erc20B,
				cErc20B,
				borrower,
				mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20B],
					cTokens: [cErc20B],
				},
				{
					user: {
						liquidity:
							mintAmountOfB *
							BigInt(
								ctokenArgs.erc20B.underlyingPrice *
									ctokenArgs.erc20B.collateralFactor *
									ctokenArgs.erc20B.decimal,
							),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal)],
				},
			);
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = 50n;
			await cErc20A
				.connect(borrower)
				.borrow(borrowAmount * BigInt(ctokenArgs.erc20A.decimal));
			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				cash:
					(mintAmountOfA - borrowAmount) * BigInt(ctokenArgs.erc20B.decimal),
				totalBorrows: borrowAmount * BigInt(ctokenArgs.erc20A.decimal),
				totalSupply: mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A, cErc20B],
				},
				{
					user: {
						liquidity: 0,
						shortfall: 0,
					},
					tokens: [borrowAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0, mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal)],
				},
			);
			/* -------------------- repay borrow -------------------- */
			await erc20A
				.connect(borrower)
				.approve(
					cErc20A.address,
					borrowAmount * BigInt(ctokenArgs.erc20A.decimal),
				);
			await cErc20A
				.connect(borrower)
				.repayBorrow(borrowAmount * BigInt(ctokenArgs.erc20A.decimal));
			await snapshotHelper.expectCTokenSnapshot(cErc20A, {
				cash: mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
				totalBorrows: 0,
				totalSupply: mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
			});
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity:
							mintAmountOfB *
							BigInt(
								ctokenArgs.erc20B.underlyingPrice *
									ctokenArgs.erc20B.collateralFactor *
									ctokenArgs.erc20B.decimal,
							),
						shortfall: 0,
					},
					tokens: [0],
					cTokens: [0],
				},
			);
		});

		it.only('If collateral factor goes down, should be able to liquidateBorrow', async function () {
			const mintAmountOfA = 100n;
			const mintAmountOfB = 1n;
			await mintCTokenWithToken(
				erc20A,
				cErc20A,
				liquidator,
				mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
			);
			await mintCTokenWithToken(
				erc20B,
				cErc20B,
				borrower,
				mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal),
			);
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = 50n;
			await cErc20A
				.connect(borrower)
				.borrow(borrowAmount * BigInt(ctokenArgs.erc20A.decimal));
			expect(await cErc20A.totalBorrows()).to.equal(
				borrowAmount * BigInt(ctokenArgs.erc20A.decimal),
			);
			/* --------------- collateralFactor change -------------- */
			const newColleteralFactor = 0.25;
			await unitrollerProxy._setCollateralFactor(
				cErc20B.address,
				BigInt(newColleteralFactor * ctokenArgs.erc20B.decimal),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall:
							borrowAmount *
								BigInt(
									ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal,
								) -
							mintAmountOfB *
								BigInt(
									ctokenArgs.erc20B.underlyingPrice *
										newColleteralFactor *
										ctokenArgs.erc20B.decimal,
								),
					},
					tokens: [borrowAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0],
				},
			);
			/* ---------------------- liquidate --------------------- */
			const liquidateAmount = 25n;
			await erc20A.transfer(
				liquidator.address,
				liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
			);
			await erc20A
				.connect(liquidator)
				.approve(
					cErc20A.address,
					liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
				);
			await cErc20A
				.connect(liquidator)
				.liquidateBorrow(
					borrower.address,
					liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
					cErc20B.address,
				);
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall:
							(borrowAmount - liquidateAmount) *
								BigInt(
									ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal,
								) -
							mintAmountOfB *
								BigInt(
									ctokenArgs.erc20B.underlyingPrice *
										newColleteralFactor *
										ctokenArgs.erc20B.decimal,
								),
					},
					tokens: [borrowAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0],
				},
			);
			expect(await cErc20A.totalBorrows()).to.equal(
				(borrowAmount - liquidateAmount) * BigInt(ctokenArgs.erc20A.decimal),
			);
		});

		it.only('If price goes down, should be able to liquidateBorrow', async function () {
			const mintAmountOfA = 100n;
			const mintAmountOfB = 1n;
			await mintCTokenWithToken(
				erc20A,
				cErc20A,
				liquidator,
				mintAmountOfA * BigInt(ctokenArgs.erc20A.decimal),
			);
			await mintCTokenWithToken(
				erc20B,
				cErc20B,
				borrower,
				mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal),
			);
			/* ----------------------- borrow ----------------------- */
			const borrowAmount = 50n;
			await cErc20A
				.connect(borrower)
				.borrow(borrowAmount * BigInt(ctokenArgs.erc20A.decimal));
			expect(await cErc20A.totalBorrows()).to.equal(
				borrowAmount * BigInt(ctokenArgs.erc20A.decimal),
			);
			/* ---------------------- liquidate --------------------- */
			const newPriceOfTokenB = 50;
			await priceOracle.setUnderlyingPrice(
				cErc20B.address,
				BigInt(newPriceOfTokenB * ctokenArgs.erc20B.decimal),
			);
			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall:
							borrowAmount *
								BigInt(
									ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal,
								) -
							mintAmountOfB *
								BigInt(
									newPriceOfTokenB *
										ctokenArgs.erc20B.collateralFactor *
										ctokenArgs.erc20B.decimal,
								),
					},
					tokens: [borrowAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0],
				},
			);
			const liquidateAmount = 25n;
			await erc20A.transfer(
				liquidator.address,
				liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
			);
			await erc20A
				.connect(liquidator)
				.approve(
					cErc20A.address,
					liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
				);
			const tx = await cErc20A
				.connect(liquidator)
				.liquidateBorrow(
					borrower.address,
					liquidateAmount * BigInt(ctokenArgs.erc20A.decimal),
					cErc20B.address,
				);

			const liquidateResult = await tx.wait();
			const transferEvents = liquidateResult.events?.filter((x) => {
				return x.event == 'Transfer';
			});
			const liquidatorSeizeTokens =
				transferEvents[1].args[transferEvents[1].args.length - 1];
			const protocolSeizeTokens =
				transferEvents[2].args[transferEvents[2].args.length - 1];
			console.log('liquidatorSeizeTokens->', liquidatorSeizeTokens);
			console.log('protocolSeizeTokens->', protocolSeizeTokens);

			const seizeTokens =
				Number(liquidatorSeizeTokens) + Number(protocolSeizeTokens);

			expect(await cErc20A.totalBorrows()).to.equal(
				(borrowAmount - liquidateAmount) * BigInt(ctokenArgs.erc20A.decimal),
			);

			expect(
				BigInt(+(await cErc20B.balanceOf(borrower.address)) + seizeTokens),
			).to.equal(mintAmountOfB * BigInt(ctokenArgs.erc20B.decimal));

			await snapshotHelper.expectUserSnapShot(
				{
					user: borrower,
					tokens: [erc20A],
					cTokens: [cErc20A],
				},
				{
					user: {
						liquidity: 0,
						shortfall:
							(borrowAmount - liquidateAmount) *
								BigInt(
									ctokenArgs.erc20A.underlyingPrice * ctokenArgs.erc20A.decimal,
								) -
							mintAmountOfB *
								BigInt(
									newPriceOfTokenB *
										ctokenArgs.erc20B.collateralFactor *
										ctokenArgs.erc20B.decimal,
								),
					},
					tokens: [borrowAmount * BigInt(ctokenArgs.erc20A.decimal)],
					cTokens: [0],
				},
			);
			expect(await cErc20A.totalBorrows()).to.equal(parseUnits('25', 18));
		});
	});
});
