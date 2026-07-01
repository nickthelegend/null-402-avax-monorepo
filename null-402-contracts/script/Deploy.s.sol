// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {Null402Pool, IERC20, IGroth16Verifier} from "../src/Null402Pool.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {MockUSD} from "../src/MockUSD.sol";

// Deploy null-402 to Avalanche Fuji:
//   PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url fuji --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        Groth16Verifier verifier = new Groth16Verifier();
        MockUSD token = new MockUSD();
        Null402Pool pool = new Null402Pool(
            IERC20(address(token)),
            IGroth16Verifier(address(verifier)),
            deployer // operator = deployer/relayer
        );
        // Seed the pool with payout liquidity and give the deployer some nUSD.
        token.mint(address(pool), 100_000 * 1e7);
        token.mint(deployer, 10_000 * 1e7);
        vm.stopBroadcast();

        console.log("NULL402_VERIFIER=%s", address(verifier));
        console.log("NULL402_TOKEN=%s", address(token));
        console.log("NULL402_POOL=%s", address(pool));
        console.log("NULL402_OPERATOR=%s", deployer);
    }
}
