const { expect } = require('chai');
const { ethers } = require('hardhat');
const { formatUnits, parseUnits, parseEther } = require('ethers/lib/utils');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { deployCompoundModules, deployFlashloan } = require('./Utils/deploy');
const { SnapshotHelper } = require('./utils/snapshot');

describe('Compound v2 Test 0 Flashloan', function () {
	let owner, accountA, accountB, otheraccounts;
	let borrower, liquidator;
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
		liquidator = await ethers.getSigner(accountB.address);
		/* ------------------------------------------------------ */
		/*                     deploy compound                    */
		/* ------------------------------------------------------ */
		ctokenArgs = ctokenArgs = {
			usdc: {
				name: 'cUSDC',
				symbol: 'cUSDC',
				underlying: USDC_ADDRESS,
				underlyingPrice: 1,
				collateralFactor: 0.5, // 50
				closeFactor: 0.5, // 50
				initialExchangeRateMantissa_: 10 ** 6,
				liquidationIncentive: 1.08,
				underlyingDecimal: 10 ** 6,
				decimal: 10 ** 18,
			},
			uni: {
				name: 'cUNI',
				symbol: 'cUNI',
				underlying: UNI_ADDRESS,
				underlyingPrice: 10,
				collateralFactor: 0.5, // 50
				closeFactor: 0.5, // 50
				liquidationIncentive: 1.08,
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
			.connect(liquidator)
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
		const uniTokenExchangeRate = await cUSDC.exchangeRateStored();
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
		const uniMintAmount = 1000;
		/* ------------------- mint token a------------------------ */
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			mintAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			supplyer: WHALE_BINANCE,
		});
		await snapshotHelper.expectCTokenSnapshot(cUNI, {
			totalSupply: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			cash: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
		});
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: BigInt(
						uniMintAmount *
							ctokenArgs.uni.underlyingPrice *
							ctokenArgs.uni.collateralFactor *
							ctokenArgs.uni.decimal,
					),
					shortfall: 0,
				},
				tokens: [0],
				cTokens: [BigInt(uniMintAmount * ctokenArgs.uni.decimal)],
			},
		);
		/* -------------------- mint token b -------------------- */
		const usdcMintAmount = 5000;
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liquidator,
			transferAmount: BigInt(
				usdcMintAmount * ctokenArgs.usdc.underlyingDecimal,
			),
			mintAmount: BigInt(usdcMintAmount * ctokenArgs.usdc.decimal),
			supplyer: WHALE_MAKER,
		});

		await snapshotHelper.expectCTokenSnapshot(cUSDC, {
			totalSupply: BigInt(usdcMintAmount * ctokenArgs.usdc.decimal),
			cash: BigInt(usdcMintAmount * ctokenArgs.usdc.underlyingDecimal),
		});

		await snapshotHelper.expectUserSnapShot(
			{
				user: liquidator,
				tokens: [usdc],
				cTokens: [cUSDC],
			},
			{
				user: {
					liquidity: BigInt(
						usdcMintAmount *
							ctokenArgs.usdc.decimal *
							ctokenArgs.usdc.closeFactor *
							ctokenArgs.usdc.underlyingPrice,
					),
					shortfall: 0,
				},
				tokens: [0],
				cTokens: [BigInt(usdcMintAmount * ctokenArgs.usdc.decimal)],
			},
		);
	});

	it('Use lashloan to liquidate', async function () {
		const uniMintAmount = 1000;
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			mintAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			supplyer: WHALE_BINANCE,
		});
		const borrowUsdcAmount = 5000;
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liquidator,
			transferAmount: BigInt(
				borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal,
			),
			mintAmount: BigInt(borrowUsdcAmount * ctokenArgs.usdc.decimal),
			supplyer: WHALE_MAKER,
		});
		/* ----------------------- borrow ----------------------- */
		expect(await await cUSDC.supplyRatePerBlock()).to.equal(0);
		await cUSDC
			.connect(borrower)
			.borrow(BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal));
		expect(await cUSDC.totalBorrows()).to.equal(
			BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal),
		);
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
				tokens: [BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal)],
				cTokens: [0],
			},
		);
		/* ------------------- price goes down ------------------ */
		const newPrice = 6.2;
		await priceOracle.setUnderlyingPrice(
			cUNI.address,
			BigInt(newPrice * ctokenArgs.uni.decimal),
		);
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: 0,
					shortfall:
						BigInt(
							borrowUsdcAmount *
								ctokenArgs.usdc.underlyingPrice *
								ctokenArgs.usdc.decimal,
						) -
						BigInt(
							uniMintAmount *
								newPrice *
								ctokenArgs.uni.collateralFactor *
								ctokenArgs.uni.decimal,
						),
				},
				tokens: [0],
				cTokens: [BigInt(uniMintAmount * ctokenArgs.uni.decimal)],
			},
		);
		/* ---------------------- liquidate --------------------- */
		const liquidateUsdcAmount = 2500;
		const abi = new ethers.utils.AbiCoder();
		const flashLaonParameters = {
			receiverAddress: flashloan.address,
			assets: [usdc.address],
			amounts: [
				BigInt(liquidateUsdcAmount * ctokenArgs.usdc.underlyingDecimal),
			],
			modes: [0],
			onBehalfOf: flashloan.address,
			params: abi.encode(
				['address', 'address', 'address', 'address'],
				[borrower.address, cUSDC.address, cUNI.address, uni.address],
			),
			referralCode: 0,
		};

		const tx = await flashloan.myFlashLoanCall(
			flashLaonParameters.assets,
			flashLaonParameters.amounts,
			flashLaonParameters.params,
		);

		const liquidateResult = await tx.wait();
		const transferEvents = liquidateResult.events?.filter((x) => {
			// console.log('x==>', x.event);
			return x.event == 'Transfer';
		});

		expect((await usdc.balanceOf(flashloan.address)) - 120000000).lessThan(
			10000000,
		);

		expect(await cUSDC.totalBorrows()).to.equal(
			borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal -
				flashLaonParameters.amounts,
		);
		// TODO:
		// await snapshotHelper.expectUserSnapShot(
		// 	{
		// 		user: borrower,
		// 	},
		// 	{
		// 		user: {
		// 			liquidity: 0,
		// 			shortfall:
		// 				BigInt(
		// 					(borrowUsdcAmount - liquidateUsdcAmount) *
		// 						ctokenArgs.usdc.underlyingPrice *
		// 						ctokenArgs.usdc.decimal,
		// 				) -
		// 				BigInt(
		// 					+(await cUNI.balanceOf(borrower.address)) *
		// 						newPrice *
		// 						ctokenArgs.uni.collateralFactor,
		// 				),
		// 		},
		// 	},
		// );
		/* 
		shortfall: 
		    -750000000000000159998
      		+750000000000000262144
		*/
	});

	it('Use lashloan to liquidate', async function () {
		const uniMintAmount = 1000;
		await mintCTokenWithTokenForkWithWhale({
			token: uni,
			ctoken: cUNI,
			signer: borrower,
			transferAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			mintAmount: BigInt(uniMintAmount * ctokenArgs.uni.decimal),
			supplyer: WHALE_BINANCE,
		});
		const borrowUsdcAmount = 5000;
		await mintCTokenWithTokenForkWithWhale({
			token: usdc,
			ctoken: cUSDC,
			signer: liquidator,
			transferAmount: BigInt(
				borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal,
			),
			mintAmount: BigInt(borrowUsdcAmount * ctokenArgs.usdc.decimal),
			supplyer: WHALE_MAKER,
		});
		/* ----------------------- borrow ----------------------- */
		expect(await await cUSDC.supplyRatePerBlock()).to.equal(0);
		await cUSDC
			.connect(borrower)
			.borrow(BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal));
		expect(await cUSDC.totalBorrows()).to.equal(
			BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal),
		);
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
				tokens: [BigInt(borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal)],
				cTokens: [0],
			},
		);
		/* ------------------- price goes down ------------------ */
		const newPrice = 6.2;
		await priceOracle.setUnderlyingPrice(
			cUNI.address,
			BigInt(newPrice * ctokenArgs.uni.decimal),
		);
		await snapshotHelper.expectUserSnapShot(
			{
				user: borrower,
				tokens: [uni],
				cTokens: [cUNI],
			},
			{
				user: {
					liquidity: 0,
					shortfall:
						BigInt(
							borrowUsdcAmount *
								ctokenArgs.usdc.underlyingPrice *
								ctokenArgs.usdc.decimal,
						) -
						BigInt(
							uniMintAmount *
								newPrice *
								ctokenArgs.uni.collateralFactor *
								ctokenArgs.uni.decimal,
						),
				},
				tokens: [0],
				cTokens: [BigInt(uniMintAmount * ctokenArgs.uni.decimal)],
			},
		);
		/* ---------------------- liquidate --------------------- */
		const liquidateUsdcAmount = 2500;
		const abi = new ethers.utils.AbiCoder();
		const flashLaonParameters = {
			receiverAddress: flashloan.address,
			assets: [usdc.address],
			amounts: [
				BigInt(liquidateUsdcAmount * ctokenArgs.usdc.underlyingDecimal),
			],
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
			.connect(liquidator)
			.flashLoan(
				flashloan.address,
				flashLaonParameters.assets,
				flashLaonParameters.amounts,
				flashLaonParameters.modes,
				flashLaonParameters.onBehalfOf,
				flashLaonParameters.params,
				flashLaonParameters.referralCode,
			);

		expect((await usdc.balanceOf(flashloan.address)) - 120000000).lessThan(
			10000000,
		);

		expect(await cUSDC.totalBorrows()).to.equal(
			borrowUsdcAmount * ctokenArgs.usdc.underlyingDecimal -
				flashLaonParameters.amounts,
		);
	});
});
