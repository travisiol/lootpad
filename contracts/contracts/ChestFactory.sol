// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPonsFeeEscrow} from "./interfaces/IPonsV2.sol";
import {Chest} from "./Chest.sol";

/**
 * Deploys chests for the router. It lives in its own contract only because
 * a router that embeds the chest's creation code is over the contract size
 * limit. Anyone can call it; a chest created here belongs to whoever called
 * (that caller is the chest's `router`), so a chest created outside the
 * Lootpad router is simply not in the Lootpad registry.
 */
contract ChestFactory {
    event ChestCreated(address indexed chest, address indexed router, address indexed creator);

    function createChest(
        address creator,
        IPonsFeeEscrow escrow,
        uint64 lockDuration,
        uint16 burnBps,
        uint16 padBps,
        uint16 openerBps
    ) external returns (Chest chest) {
        chest = new Chest(msg.sender, creator, escrow, lockDuration, burnBps, padBps, openerBps);
        emit ChestCreated(address(chest), msg.sender, creator);
    }
}
