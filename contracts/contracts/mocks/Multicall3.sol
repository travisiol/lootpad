// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// The slice of Multicall3 viem uses (`aggregate3`), for the mock network
/// served by scripts/serve-mock.ts; set at the canonical address with
/// hardhat_setCode so batched reads behave as on Robinhood Chain.
contract Multicall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        returnData = new Result[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory data) = calls[i].target.call(calls[i].callData);
            if (!ok && !calls[i].allowFailure) revert("Multicall3: call failed");
            returnData[i] = Result(ok, data);
        }
    }
}
