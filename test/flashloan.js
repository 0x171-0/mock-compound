const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules, deployFlashloan } = require('./Utils/deploy');
const { SnapshotHelper } = require('./utils/snapshot');

describe('Compound v2 Test', function () {
	let owner, accountA, accountB, otheraccounts;
	let borrower, liqidator;
	let unitrollerProxy, priceOracle, ctokenArgs;
	let usdc, uni, cUSDC, cUNI, flashloan;
	let snapshotHelper;

	const AAVE_LENDING_POOL_ADDRESS_PROVIDER =
		'0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5';
	const AAVE_LENDING_POOL_ADDRESS =
		'0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
	const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
	const UNI_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
	const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
	const WHALE_MAKER = '0xf977814e90da44bfa03b6295a0616a897441acec';
	const WHALE_BINANCE = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
	before(async function () {
		/* ------------------- set up account ------------------- */
		[owner, accountA, accountB, ...otheraccounts] = await ethers.getSigners();
		borrower = await ethers.getSigner(accountA.address);
		liqidator = await ethers.getSigner(accountB.address);
		/* ------------------------------------------------------ */
		/*                     deploy compound                    */
		/* ------------------------------------------------------ */
		ctokenArgs = ctokenArgs = [
			{
				name: 'cUSDC',
				symbol: 'cUSDC',
				underlying: USDC_ADDRESS,
				underlyingPrice: parseUnits('1', 18 + (18 - 6)),
				collateralFactor: parseUnits('0.5', 18), // 50
				closeFactor: parseUnits('0.5', 18), // 50
				initialExchangeRateMantissa_: parseUnits('1', 6),
				liquidationIncentive: parseUnits('1.08', 18),
			},
			{
				name: 'cUNI',
				symbol: 'cUNI',
				underlying: UNI_ADDRESS,
				underlyingPrice: parseUnits('10', 18),
				collateralFactor: parseUnits('0.5', 18), // 50%
				closeFactor: parseUnits('0.5', 18), // 50
				liquidationIncentive: parseUnits('1.08', 18),
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
		[cUSDC, cUNI] = cTokens;
		usdc = await ethers.getContractAt('ERC20', USDC_ADDRESS);
		uni = await ethers.getContractAt('ERC20', UNI_ADDRESS);
		/* ------------------------------------------------------ */
		/*                      entry markets                     */
		/* ------------------------------------------------------ */
		for (const user of [owner, accountA, accountB]) {
			// enterMarkets 就是個人要選擇這項 cTokens 當作抵押品
			await unitrollerProxy
				.connect(user)
				.enterMarkets([cUSDC.address, cUNI.address]);
		}
		await unitrollerProxy
			.connect(borrower)
			.enterMarkets([cUSDC.address, cUNI.address]);
		await unitrollerProxy
			.connect(liqidator)
			.enterMarkets([cUSDC.address, cUNI.address]);
		/* ------------------------------------------------------ */
		/*                    deploy flashloan                    */
		/* ------------------------------------------------------ */
		flashloan = await deployFlashloan(
			AAVE_LENDING_POOL_ADDRESS_PROVIDER,
			UNISWAP_ROUTER,
		);
		snapshotHelper = new SnapshotHelper(unitrollerProxy);
		snapshot = await helpers.takeSnapshot();
	});

	afterEach(async function () {
		await snapshot.restore();
	});

	async function mintCTokenWithTokenForkWithWhale(opt) {
		const { token, ctoken, signer, transferAmount, mintAmount, supplyer } = opt;
		const wallet = await ethers.getImpersonatedSigner(supplyer);
		await token.connect(wallet).transfer(signer.address, transferAmount);
		await token.connect(signer).approve(ctoken.address, transferAmount);
		await ctoken.connect(signer).mint(transferAmount);
	}

	it('Should be able to mint', async function () {
		/* ------------------- mint token a------------------------ */
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: parseUnits('1000', 18),
			mintAmount: parseUnits('1000', 18),
			supplyer: WHALE_BINANCE,
		});
		await snapshotHelper.expectCTokenSnapshot(cUNI, {
			totalSupply: parseUnits('1000', 18),
			cash: parseUnits('1000', 18),
		});
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: parseUnits('5000', 18),
					shortfall: 0,
				},
				tokens: [0],
				cTokens: [parseUnits('1000', 18)],
			},
		);
		/* -------------------- mint token b -------------------- */
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liqidator,
			transferAmount: parseUnits('5000', 6),
			mintAmount: parseUnits('5000', 18),
			supplyer: WHALE_MAKER,
		});
		await snapshotHelper.expectCTokenSnapshot(cUSDC, {
			totalSupply: parseUnits('5000', 18),
			cash: parseUnits('5000', 6),
		});
		await snapshotHelper.expectUserSnapShot(
			{
				user: liqidator,
				tokens: [usdc],
				cTokens: [cUSDC],
			},
			{
				user: {
					liquidity: parseUnits('2500', 18),
					shortfall: 0,
				},
				tokens: [0],
				cTokens: [parseUnits('5000', 18)],
			},
		);
	});

	it('Use lashloan to liquidate', async function () {
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: parseUnits('1000', 18),
			mintAmount: parseUnits('1000', 18),
			supplyer: WHALE_BINANCE,
		});
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liqidator,
			transferAmount: parseUnits('5000', 6),
			mintAmount: parseUnits('5000', 18),
			supplyer: WHALE_MAKER,
		});
		/* ----------------------- borrow ----------------------- */
		const borrowAmount = parseUnits('5000', 6);
		expect(await await cUSDC.supplyRatePerBlock()).to.equal(0);
		await cUSDC.connect(borrower).borrow(borrowAmount);
		expect(await cUSDC.totalBorrows()).to.equal(borrowAmount);
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [usdc],
				cTokens: [cUSDC],
			},
			{
				user: {
					liquidity: 0,
					shortfall: 0,
				},
				tokens: [borrowAmount],
				cTokens: [0],
			},
		);
		/* ------------------- price goes down ------------------ */
		await priceOracle.setUnderlyingPrice(cUNI.address, parseUnits('6.2', 18));
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: 0,
					shortfall: parseUnits('1900', 18),
				},
				tokens: [0],
				cTokens: [parseUnits('1000', 18)],
			},
		);
		/* ---------------------- liquidate --------------------- */
		const abi = new ethers.utils.AbiCoder();
		const flashLaonParameters = {
			receiverAddress: flashloan.address,
			assets: [usdc.address],
			amounts: [parseUnits('2500', 6)],
			modes: [0],
			onBehalfOf: flashloan.address,
			params: abi.encode(
				['address', 'address', 'address', 'address'],
				[borrower.address, cUSDC.address, cUNI.address, uni.address],
			),
			referralCode: 0,
		};

		await flashloan.myFlashLoanCall(
			flashLaonParameters.assets,
			flashLaonParameters.amounts,
			flashLaonParameters.params,
		);

		[errA, liquidityA, shortfallA] = await unitrollerProxy
			.connect(borrower)
			.getAccountLiquidity(borrower.address);
		expect((await usdc.balanceOf(flashloan.address)) - 120000000).lessThan(
			10000000,
		);
		expect(await cUSDC.totalBorrows()).to.equal(
			borrowAmount - flashLaonParameters.amounts,
		);
		expect(errA).to.equal(0);
		expect(liquidityA).to.equal(0);
		expect(shortfallA).to.below(parseUnits('1900', 18));
	});

	it('Use lashloan to liquidate', async function () {
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: parseUnits('1000', 18),
			mintAmount: parseUnits('1000', 18),
			supplyer: WHALE_BINANCE,
		});
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liqidator,
			transferAmount: parseUnits('5000', 6),
			mintAmount: parseUnits('5000', 18),
			supplyer: WHALE_MAKER,
		});
		/* ----------------------- borrow ----------------------- */
		const borrowAmount = parseUnits('5000', 6);
		expect(await await cUSDC.supplyRatePerBlock()).to.equal(0);
		await cUSDC.connect(borrower).borrow(borrowAmount);
		expect(await cUSDC.totalBorrows()).to.equal(borrowAmount);
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [usdc],
				cTokens: [cUSDC],
			},
			{
				user: {
					liquidity: 0,
					shortfall: 0,
				},
				tokens: [borrowAmount],
				cTokens: [0],
			},
		);
		/* ------------------- price goes down ------------------ */
		await priceOracle.setUnderlyingPrice(cUNI.address, parseUnits('6.2', 18));
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: 0,
					shortfall: parseUnits('1900', 18),
				},
				tokens: [0],
				cTokens: [parseUnits('1000', 18)],
			},
		);
		/* ---------------------- liquidate --------------------- */
		const abi = new ethers.utils.AbiCoder();
		const flashLaonParameters = {
			receiverAddress: flashloan.address,
			assets: [usdc.address],
			amounts: [parseUnits('2500', 6)],
			modes: [0],
			onBehalfOf: flashloan.address,
			params: abi.encode(
				['address', 'address', 'address', 'address'],
				[borrower.address, cUSDC.address, cUNI.address, uni.address],
			),
			referralCode: 0,
		};

		const lendingPool = await ethers.getContractAt(
			'ILendingPool',
			AAVE_LENDING_POOL_ADDRESS,
		);
		await lendingPool
			.connect(liqidator)
			.flashLoan(
				flashloan.address,
				flashLaonParameters.assets,
				flashLaonParameters.amounts,
				flashLaonParameters.modes,
				flashLaonParameters.onBehalfOf,
				flashLaonParameters.params,
				flashLaonParameters.referralCode,
			);

		[errA, liquidityA, shortfallA] = await unitrollerProxy
			.connect(borrower)
			.getAccountLiquidity(borrower.address);
		expect((await usdc.balanceOf(flashloan.address)) - 120000000).lessThan(
			10000000,
		);
		expect(await cUSDC.totalBorrows()).to.equal(
			borrowAmount - flashLaonParameters.amounts,
		);
		expect(errA).to.equal(0);
		expect(liquidityA).to.equal(0);
		expect(shortfallA).to.below(parseUnits('1900', 18));
	});
});
