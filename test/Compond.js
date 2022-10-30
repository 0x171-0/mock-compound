const { expect } = require("chai");
const { ethers } = require("hardhat");
const { formatUnits, parseUnits } = require("ethers/lib/utils");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployPriceOracle, deployComptroller, deployUnitroller, deployCTokens, deployInterestRateModels, deployErc20Tokens } = require("./Utils/deploy");
const { INTEREST_RATE_MODEL } = require("../config");


describe("Compound v2 Test", function () {
  let owner, accountA, accountB, otheraccounts;
  let undA, undB, unitrollerProxy, cErc20A,
    cErc20B, priceOracle, whitePaperInterestRateModel,
    ctokenArgs, signerA, signerB;

  before(async function () {
    /* ------------------- set up account ------------------- */
    [owner, accountA, accountB, ...otheraccounts] = await ethers.getSigners();
    signerA = await ethers.getSigner(accountA.address);
    signerB = await ethers.getSigner(accountB.address);
    /* ------------------------------------------------------ */
    /*                   priceOracle module                   */
    /* ------------------------------------------------------ */
    priceOracle = await deployPriceOracle();
    console.log("\n✅ Deploy SimplePriceOracle to: ", priceOracle.address);
    /* ------------------------------------------------------ */
    /*                   comptroller module                   */
    /* ------------------------------------------------------ */
    const unitroller = await deployUnitroller();
    console.log("\n✅ Deploy Unitroller to: ", unitroller.address);

    const comptroller = await deployComptroller();
    console.log("\n✅ Deploy Comptroller to: ", comptroller.address);
    /* ---------------------- Set Proxy --------------------- */
    // @dev unitroller is proxy of comptroller module
    await unitroller._setPendingImplementation(comptroller.address);
    await comptroller._become(unitroller.address);

    /* ----- Call Comptroller Use Proxy --------------------- */
    unitrollerProxy = await ethers.getContractAt(
      "Comptroller",
      unitroller.address
    );

    await unitrollerProxy._setPriceOracle(priceOracle.address);
    // await unitrollerProxy._setMaxAssets(20);
    /* ------------------------------------------------------ */
    /*                   interestRate module                  */
    /* ------------------------------------------------------ */
    whitePaperInterestRateModel = await deployInterestRateModels(
      0, 0
      // INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.baseRatePerYear,
      // INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.multiplierPerYear
    );
    console.log(
      "\n✅ Deploy WhitePaperInterestRateModel to: ",
      whitePaperInterestRateModel.address
    );

    /* ------------------------------------------------------ */
    /*                   cToken module                        */
    /* ------------------------------------------------------ */
    ctokenArgs = [
      {
        name: "UnderA",
        symbol: "UNDA",
        underlying: '',
        underlyingPrice: parseUnits('1', 18),
        collateralFactor: parseUnits('0.5', 18), // 50%
        // reserveFactor: parseUnits('5', 18), // 50%
        supply: 10000000,
      },
      {
        name: "UnderB",
        symbol: "UNDB",
        underlying: '',
        underlyingPrice: parseUnits('100', 18),
        collateralFactor: parseUnits('0.5', 18), // 50%
        // reserveFactor: parseUnits('5', 18), // 50%
        supply: 10000000,
      },
    ];
    [undA, undB] = await deployErc20Tokens(ctokenArgs);
    [cErc20A, cErc20B] = await deployCTokens(
      ctokenArgs,
      whitePaperInterestRateModel,
      priceOracle,
      unitrollerProxy,
      owner
    );
    await unitrollerProxy.connect(signerA).enterMarkets([cErc20A.address, cErc20B.address]);
    await unitrollerProxy.connect(signerB).enterMarkets([cErc20A.address, cErc20B.address]);
    snapshot = await helpers.takeSnapshot();
  });

  afterEach(async function () {
    await snapshot.restore();
  });

  describe("Check fixtures", function () {
    it('Check user markets', async function () {
      const enteredMarketsA = await unitrollerProxy.getAssetsIn(signerA.address);
      const enteredMarketsB = await unitrollerProxy.getAssetsIn(signerB.address);
      expect(enteredMarketsA.length).to.equal(2);
      expect(enteredMarketsA[0]).to.equal(cErc20A.address);
      expect(enteredMarketsA[1]).to.equal(cErc20B.address);
      expect(enteredMarketsB.length).to.equal(2);
      expect(enteredMarketsA[0]).to.equal(cErc20A.address);
      expect(enteredMarketsA[1]).to.equal(cErc20B.address);
    });
    it('Check Price Oracle', async function () {
      expect(await priceOracle.getUnderlyingPrice(cErc20A.address)).to.equal(ctokenArgs[0].underlyingPrice);
      expect(await priceOracle.assetPrices(undA.address)).to.equal(ctokenArgs[0].underlyingPrice);
      expect(await priceOracle.getUnderlyingPrice(cErc20B.address)).to.equal(ctokenArgs[1].underlyingPrice);
      expect(await priceOracle.assetPrices(undB.address)).to.equal(ctokenArgs[1].underlyingPrice);
    });
    it('Check Collateral Factor', async function () {
      const marketA = await unitrollerProxy.markets(cErc20A.address);
      const marketB = await unitrollerProxy.markets(cErc20B.address);
      expect(marketA.collateralFactorMantissa).to.equal(ctokenArgs[0].collateralFactor);
      expect(marketB.collateralFactorMantissa).to.equal(ctokenArgs[1].collateralFactor);
    });
  });

  describe("Fullfill Request", function () {

    async function mintCTokenWithToken(token, ctoken, signerA, numInString) {
      await token.transfer(signerA.address, parseUnits(numInString, 18));
      expect(await token.balanceOf(signerA.address)).to.equal(parseUnits(numInString, 18));
      await token.connect(signerA).approve(ctoken.address, parseUnits(numInString, 18));
      await ctoken.connect(signerA).mint(parseUnits(numInString, 18));
      expect(await undA.balanceOf(signerA.address)).to.equal(0);
      expect(await ctoken.balanceOf(signerA.address)).to.equal(parseUnits(numInString, 18));
      expect(await ctoken.totalSupply()).to.equal(parseUnits(numInString, 18));
      expect(await ctoken.getCash()).to.equal(parseUnits(numInString, 18));
    }
    it("Should be able to mint then redeem", async function () {
      /* ------------------------ mint ------------------------ */
      await mintCTokenWithToken(undA, cErc20A, signerA, "100")
      /* ----------------------- redeem ----------------------- */
      await cErc20A.connect(signerA).redeem(parseUnits("100", 18));
      expect(await undA.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
      expect(await cErc20A.balanceOf(signerA.address)).to.equal(0);
      expect(await cErc20A.totalSupply()).to.equal(0);
      expect(await cErc20A.getCash()).to.equal(0);
      expect(await cErc20A.supplyRatePerBlock()).to.equal(0);
    });

    it("Should be able to borrow then repay", async function () {
      /* ------------------- mint token a------------------------ */
      await mintCTokenWithToken(undA, cErc20A, signerA, "100")
      /* -------------------- mint token b -------------------- */
      await mintCTokenWithToken(undB, cErc20B, signerB, "1")
      const [err, liquidity, shortfall] = await unitrollerProxy.connect(signerB).getAccountLiquidity(signerB.address);
      expect(err).to.equal(0);
      expect(liquidity).to.equal(parseUnits("50", 18));
      expect(shortfall).to.equal(0);
      /* ----------------------- borrow ----------------------- */
      const borrowAmount = parseUnits("50", 18);
      expect(await await cErc20A.supplyRatePerBlock()).to.equal(0);
      await cErc20A.connect(signerB).borrow(borrowAmount);
      expect(await cErc20A.totalBorrows()).to.equal(borrowAmount);
    });

    it("If collateral factor go down, should be able to liquidateBorrow", async function () {
      /* ------------------- mint token a------------------------ */
      await mintCTokenWithToken(undA, cErc20A, signerA, "100")
      /* -------------------- mint token b -------------------- */
      await mintCTokenWithToken(undB, cErc20B, signerB, "1")
      const [err, liquidity ,shortfall] = await unitrollerProxy.connect(signerB).getAccountLiquidity(signerB.address);
      expect(err).to.equal(0);
      expect(liquidity).to.equal(parseUnits("50", 18));
      expect(shortfall).to.equal(0);
      /* ----------------------- borrow ----------------------- */
      const borrowAmount = parseUnits("50", 18);
      expect(await await cErc20A.supplyRatePerBlock()).to.equal(0);
      await cErc20A.connect(signerB).borrow(borrowAmount);
      expect(await cErc20A.totalBorrows()).to.equal(borrowAmount);
      /* ---------------------- liquidate --------------------- */
      await unitrollerProxy._setCollateralFactor(cErc20B.address, parseUnits("0.4", 18).toString());

      await undA.transfer(signerA.address, parseUnits("20", 18));
      await undA.connect(signerA).approve(cErc20A.address, parseUnits("20", 18));
      const [err2, liquidity2, shortfall2] = await unitrollerProxy.connect(signerB).getAccountLiquidity(signerB.address);
      await unitrollerProxy._setCloseFactor(parseUnits("0.5", 18).toString());
      expect(err2).to.equal(0);
      expect(liquidity2).to.equal(0);
      expect(shortfall2).to.equal(parseUnits("10", 18));
      await cErc20A.connect(signerA).liquidateBorrow(signerB.address, parseUnits("20", 18), cErc20B.address);
      expect(await cErc20A.totalBorrows()).to.equal(parseUnits("30", 18));
    });

    it("If price go down, should be able to liquidateBorrow", async function () {
      /* ------------------- mint token a------------------------ */
      await mintCTokenWithToken(undA, cErc20A, signerA, "100")
      /* -------------------- mint token b -------------------- */
      await mintCTokenWithToken(undB, cErc20B, signerB, "1")
      const [err, liquidity ,shortfall] = await unitrollerProxy.connect(signerB).getAccountLiquidity(signerB.address);
      expect(err).to.equal(0);
      expect(liquidity).to.equal(parseUnits("50", 18));
      expect(shortfall).to.equal(0);
      /* ----------------------- borrow ----------------------- */
      const borrowAmount = parseUnits("50", 18);
      expect(await await cErc20A.supplyRatePerBlock()).to.equal(0);
      await cErc20A.connect(signerB).borrow(borrowAmount);
      expect(await cErc20A.totalBorrows()).to.equal(borrowAmount);
      /* ---------------------- liquidate --------------------- */
      await priceOracle.setUnderlyingPrice(cErc20B.address, parseUnits('50', 18));

      await undA.transfer(signerA.address, parseUnits("20", 18));
      await undA.connect(signerA).approve(cErc20A.address, parseUnits("20", 18));
      const [err2, liquidity2, shortfall2] = await unitrollerProxy.connect(signerB).getAccountLiquidity(signerB.address);
      await unitrollerProxy._setCloseFactor(parseUnits("0.5", 18).toString());
      expect(err2).to.equal(0);
      expect(liquidity2).to.equal(0);
      expect(shortfall2).to.equal(parseUnits("25", 18));
      await cErc20A.connect(signerA).liquidateBorrow(signerB.address, parseUnits("20", 18), cErc20B.address);
      expect(await cErc20A.totalBorrows()).to.equal(parseUnits("30", 18));
    });
  });
});
