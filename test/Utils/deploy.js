const { formatUnits, parseUnits } = require("ethers/lib/utils");

module.exports.deployErc20Token = async function deployErc20Token(ops) {
    return await (
        await ethers.getContractFactory("UnderLyingToken")
    ).deploy(parseUnits(ops.supply.toString(), 18), ops.name, ops.symbol);;
};

module.exports.deployErc20Tokens = async function deployErc20Tokens(ops) {
    const tokens = [];
    for (const op of ops) {
        const token = await module.exports.deployErc20Token(op);
        console.log("\n✅ Deploy UnderLyingToken to: ", token.address);
        op.underlying = token.address;
        tokens.push(token);
    }
    return tokens;
};

module.exports.deployPriceOracle = async function deployPriceOracle() {
    return (
        await ethers.getContractFactory("SimplePriceOracle")
    ).deploy();
};

module.exports.deployComptroller = async function deployComptroller() {
    return (
        await ethers.getContractFactory("Comptroller")
    ).deploy();
};

module.exports.deployUnitroller = async function deployUnitroller() {
    return (
        await ethers.getContractFactory("Unitroller")
    ).deploy();
};

module.exports.deployInterestRateModels = async function deployInterestRateModels(baseRatePerYear, multiplierPerYear) {
    return await (
        await ethers.getContractFactory("WhitePaperInterestRateModel")
    ).deploy(baseRatePerYear, multiplierPerYear);
};

function etherMantissa(num, scale = 18) {
    return ethers.utils.parseUnits(num, scale);
}

module.exports.deployCTokens = async function deployCTokens(
    configs,
    interestRateModels,
    priceOracle,
    comptroller,
    deployer,
) {
    const cTokens = [];
    for (const tokenConfig of configs) {
        const cErc20Delegate = await (
            await ethers.getContractFactory("CErc20Delegate")
        ).deploy();
        console.log("\n✅ Deploy CErc20Delegate to: ", cErc20Delegate.address);
        const initialExchangeRateMantissa_ = etherMantissa('1');
        const data = 0x00;
        const cErc20 = await (
            await ethers.getContractFactory("CErc20Delegator")
        ).deploy(
            tokenConfig.underlying,
            comptroller.address,
            interestRateModels.address,
            initialExchangeRateMantissa_,
            tokenConfig.name,
            tokenConfig.symbol,
            18,
            deployer.address,
            cErc20Delegate.address,
            data
        );
        console.log(`\n✅ Deploy cErc20 ${tokenConfig.name} to: `, cErc20.address);
        await cErc20._setImplementation(cErc20Delegate.address, false, data);
        // await cErc20._setReserveFactor(tokenConfig.reserveFactor);
        await comptroller._supportMarket(cErc20.address);
        await priceOracle.setUnderlyingPrice(cErc20.address, tokenConfig.underlyingPrice);
        await comptroller._setCollateralFactor(cErc20.address, parseUnits("0.5", 18).toString());
        // await comptroller._setCloseFactor(parseUnits("0.5", 18).toString());
        // await comptroller._setLiquidationIncentive(parseUnits("1.08", 18));
        cTokens.push(cErc20);
    }
    return cTokens;
};