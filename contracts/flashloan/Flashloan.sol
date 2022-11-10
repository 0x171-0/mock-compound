pragma solidity ^0.8.10;

import {CErc20} from '../CErc20.sol';
import {FlashLoanReceiverBase} from './FlashLoanReceiverBase.sol';
import {ILendingPool} from './ILendingPool.sol';
import {ILendingPoolAddressesProvider} from './ILendingPoolAddressesProvider.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {TransferHelper} from '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import {ISwapRouter} from '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import 'hardhat/console.sol';

/** @dev refs: https://docs.aave.com/developers/v/2.0/guides/flash-loans
    !!!
    Never keep funds permanently on your FlashLoanReceiverBase contract as they could be 
    exposed to a 'griefing' attack, where the stored funds are used by an attacker.
    !!!
 */
contract MyFlashLoan is FlashLoanReceiverBase {
	ISwapRouter swapRouter;

	constructor(ILendingPoolAddressesProvider provider, ISwapRouter _swapRouter)
		FlashLoanReceiverBase(provider)
	{
		swapRouter = _swapRouter;
	}

	function executeOperation(
		address[] calldata assets,
		uint256[] calldata amounts,
		uint256[] calldata premiums,
		address initiator,
		bytes calldata params
	) external override returns (bool) {
		uint256 amount = amounts[0];
		address tokenOut = assets[0];
		(
			address borrower,
			address cTokenToRepay,
			address cTokenReward,
			address ercTokenReward
		) = abi.decode(params, (address, address, address, address));

		IERC20(tokenOut).approve(cTokenToRepay, amount);
		CErc20(cTokenToRepay).liquidateBorrow(
			borrower,
			amount,
			CErc20(cTokenReward)
		);
		uint256 redeemTokens = IERC20(cTokenReward).balanceOf(address(this));
		CErc20(cTokenReward).redeem(redeemTokens);

		TransferHelper.safeApprove(
			ercTokenReward,
			address(swapRouter),
			IERC20(ercTokenReward).balanceOf(address(this))
		);

		ISwapRouter.ExactInputSingleParams memory uniSwapparams = ISwapRouter
			.ExactInputSingleParams({
				tokenIn: ercTokenReward,
				fee: 3000,
				tokenOut: tokenOut,
				recipient: address(this),
				deadline: block.timestamp,
				amountIn: IERC20(ercTokenReward).balanceOf(address(this)),
				amountOutMinimum: 0,
				sqrtPriceLimitX96: 0
			});

		uint256 amountOwing = amount + premiums[0];
		uint256 amountOut = swapRouter.exactInputSingle(uniSwapparams);
		require(
			amountOut - amountOwing > 120000000,
			'Does not make enough profits!'
		);
		IERC20(tokenOut).approve(address(LENDING_POOL), amountOwing);
		return true;
	}

	function myFlashLoanCall(
		address[] calldata _assets,
		uint256[] calldata _amounts,
		bytes calldata _params
	) external {
		address receiverAddress = address(this);
		// address[] memory assets = new address[](2);
		// assets[0] = address(INSERT_ASSET_ONE_ADDRESS);
		// assets[1] = address(INSERT_ASSET_TWO_ADDRESS);

		// uint256[] memory amounts = new uint256[](2);
		// amounts[0] = INSERT_ASSET_ONE_AMOUNT;
		// amounts[1] = INSERT_ASSET_TWO_AMOUNT;

		// 0 = no debt, 1 = stable, 2 = variable
		uint256[] memory modes = new uint256[](2);
		modes[0] = 0;
		// modes[1] = 0;

		address onBehalfOf = address(this);
		uint16 referralCode = 0;

		LENDING_POOL.flashLoan(
			receiverAddress,
			_assets,
			_amounts,
			modes,
			onBehalfOf,
			_params,
			referralCode
		);
	}
}
