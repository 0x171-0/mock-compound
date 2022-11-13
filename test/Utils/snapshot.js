const { expect } = require('chai');

class SnapshotHelper {
	constructor(unitrollerProxy) {
		this.unitrollerProxy = unitrollerProxy;
	}
	async getUserSnapShot(user, cTokens, tokens) {
		const result = {
			cTokens: [],
			tokens: [],
			user: {},
		};
		const [_err, liquidity, shortfall] = await this.unitrollerProxy
			.connect(user)
			.getAccountLiquidity(user.address);
		result.user.liquidity = liquidity;
		result.user.shortfall = shortfall;
		if (cTokens?.length) {
			for (const ctoken of cTokens) {
				result.cTokens.push(await ctoken.balanceOf(user.address));
			}
		}
		if (tokens?.length) {
			for (const token of tokens) {
				result.tokens.push(await token.balanceOf(user.address));
			}
		}
		return result;
	}
	async expectUserSnapShot(userInsfo, expectSnapShot) {
		const result = await this.getUserSnapShot(
			userInsfo.user,
			userInsfo.cTokens,
			userInsfo.tokens,
		);
		const { cTokens, tokens, user } = result;
		if (expectSnapShot?.user?.liquidity) {
			expect(user.liquidity).to.equal(expectSnapShot.user.liquidity);
		}
		if (expectSnapShot?.user?.shortfall) {
			expect(user.shortfall).to.equal(expectSnapShot.user.shortfall);
		}
		if (expectSnapShot?.tokens?.length > 0) {
			expectSnapShot?.tokens?.forEach((t, index) => {
				expect(tokens[index]).to.equal(t);
			});
		}
		if (expectSnapShot?.cTokens?.length > 0) {
			expectSnapShot.cTokens.forEach((t, index) => {
				expect(cTokens[index]).to.equal(t);
			});
		}
	}

	async getCTokenSnapshot(cToken) {
		return {
			totalSupply: await cToken.totalSupply(),
			cash: await cToken.getCash(),
			totalBorrows: await cToken.totalBorrows(),
		};
	}

	async expectCTokenSnapshot(cToken, expectSnapshot) {
		const result = await this.getCTokenSnapshot(cToken);
		// console.log(`cToken[${cToken.address}-snapshot]\n`, result);
		const { cash, totalSupply, totalBorrows } = result;
		expect(totalSupply).to.equal(expectSnapshot.totalSupply);
		expect(cash).to.equal(expectSnapshot.cash);
		if (expectSnapshot.totalBorrows) {
			expect(totalBorrows).to.equal(expectSnapshot.totalBorrows);
		}
	}
}

module.exports = {
	SnapshotHelper: SnapshotHelper,
};
