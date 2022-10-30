// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract UnderLyingToken is ERC20 {
    constructor(
        uint256 initialSupply,
        string memory name,
        string memory symbole
    ) ERC20(name, symbole) {
        _mint(msg.sender, initialSupply);
    }
}
