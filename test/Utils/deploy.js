const { formatUnits, parseUnits } = require('ethers/lib/utils');

async function deployErc20Token(ops) {
	return await (
		await ethers.getContractFactory('UnderLyingToken')
	).deploy(parseUnits(ops.supply.toString(), 18), ops.name, ops.symbol);
}

async function deployErc20Tokens(ops) {
	const tokens = [];
	for (const op of ops) {
		const token = await module.exports.deployErc20Token(op);
		// console.log("\n✅ Deploy UnderLyingToken to: ", token.address);
		op.underlying = token.address;
		tokens.push(token);
	}
	return tokens;
}

async function deployPriceOracle() {
	return (await ethers.getContractFactory('SimplePriceOracle')).deploy();
}

async function deployFlashloan(address, address2) {
	return (await ethers.getContractFactory('MyFlashLoan')).deploy(
		address,
		address2,
	);
}

async function deployComptroller() {
	return (await ethers.getContractFactory('Comptroller')).deploy();
}

async function deployUnitroller() {
	return (await ethers.getContractFactory('Unitroller')).deploy();
}

async function deployInterestRateModels(baseRatePerYear, multiplierPerYear) {
	return await (
		await ethers.getContractFactory('WhitePaperInterestRateModel')
	).deploy(baseRatePerYear, multiplierPerYear);
}

async function deployCTokens(
	configs,
	interestRateModels,
	priceOracle,
	comptroller,
	deployer,
) {
	const cTokens = [];
	for (const c of configs) {
		const cErc20Delegate = await (
			await ethers.getContractFactory('CErc20Delegate')
		).deploy();
		// console.log('\n✅ Deploy CErc20Delegate to: ', cErc20Delegate.address);
		const data = 0x00;
		const initialExchangeRateMantissa_ =
			c.initialExchangeRateMantissa_ || BigInt(10 ** 18);

		const cErc20 = await (
			await ethers.getContractFactory('CErc20Delegator')
		).deploy(
			c.underlying,
			comptroller.address,
			interestRateModels.address,
			initialExchangeRateMantissa_,
			c.name,
			c.symbol,
			Math.log10(c.decimal),
			deployer.address,
			cErc20Delegate.address,
			data,
		);
		// console.log(`\n✅ Deploy cErc20 ${c.name} to: `, cErc20.address);
		await cErc20._setImplementation(cErc20Delegate.address, false, data);
		// await cErc20._setReserveFactor(c.reserveFactor * c.decimal);
		// _supportMarket 是項目方選擇要支持這項 cToken
		await comptroller._supportMarket(cErc20.address);
		const price =
			BigInt(initialExchangeRateMantissa_) !== BigInt(10 ** 18)
				? (BigInt(c.underlyingPrice) * BigInt(c.decimal) * BigInt(c.decimal)) /
				  BigInt(c?.initialExchangeRateMantissa_)
				: BigInt(c.underlyingPrice) * BigInt(c.decimal);

		await priceOracle.setUnderlyingPrice(cErc20.address, price);
		await comptroller._setCollateralFactor(
			cErc20.address,
			BigInt(c.collateralFactor * c.decimal),
		);
		await comptroller._setCloseFactor(BigInt(c.closeFactor * c.decimal));
		await comptroller._setLiquidationIncentive(
			BigInt(c.liquidationIncentive * c.decimal),
		);
		cTokens.push(cErc20);
	}
	return cTokens;
}

async function deployCompoundModules(owner, ctokenArgs) {
	/* ------------------------------------------------------ */
	/*                   priceOracle module                   */
	/* ------------------------------------------------------ */
	const priceOracle = await deployPriceOracle();
	/* ------------------------------------------------------ */
	/*                   comptroller module                   */
	/* ------------------------------------------------------ */
	const unitroller = await deployUnitroller();
	// console.log("\n✅ Deploy Unitroller to: ", unitroller.address);

	const comptroller = await deployComptroller();
	// console.log("\n✅ Deploy Comptroller to: ", comptroller.address);
	/* ---------------------- Set Proxy --------------------- */
	// @dev unitroller is proxy of comptroller module
	await unitroller._setPendingImplementation(comptroller.address);
	await comptroller._become(unitroller.address);

	/* ----- Call Comptroller Use Proxy --------------------- */
	const unitrollerProxy = await ethers.getContractAt(
		'Comptroller',
		unitroller.address,
	);

	await unitrollerProxy._setPriceOracle(priceOracle.address);
	// await unitrollerProxy._setMaxAssets(20);
	/* ------------------------------------------------------ */
	/*                   interestRate module                  */
	/* ------------------------------------------------------ */
	const interestRateModel = await deployInterestRateModels(
		0,
		0,
		// INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.baseRatePerYear,
		// INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.multiplierPerYear
	);
	// console.log(
	//   "\n✅ Deploy WhitePaperInterestRateModel to: ",
	//   interestRateModel.address
	// );
	/* ------------------------------------------------------ */
	/*                   cToken module                        */
	/* ------------------------------------------------------ */
	let underlyingTokens;
	if (ctokenArgs[Object.keys(ctokenArgs)[0]].underlying.length === 0) {
		underlyingTokens = await deployErc20Tokens(Object.values(ctokenArgs));
	}
	const cTokens = await deployCTokens(
		Object.values(ctokenArgs),
		interestRateModel,
		priceOracle,
		unitrollerProxy,
		owner,
	);

	return {
		priceOracle,
		unitroller,
		comptroller,
		unitrollerProxy,
		interestRateModel,
		underlyingTokens,
		cTokens,
	};
}

module.exports = {
	deployErc20Token: deployErc20Token,
	deployErc20Tokens: deployErc20Tokens,
	deployPriceOracle: deployPriceOracle,
	deployFlashloan: deployFlashloan,
	deployComptroller: deployComptroller,
	deployUnitroller: deployUnitroller,
	deployInterestRateModels: deployInterestRateModels,
	deployCTokens: deployCTokens,
	deployCompoundModules: deployCompoundModules,
};
