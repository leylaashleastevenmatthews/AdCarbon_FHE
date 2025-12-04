// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AdCarbonFHE is SepoliaConfig {
    struct EncryptedAdCampaign {
        uint256 id;
        euint32 encryptedImpressions;
        euint32 encryptedClicks;
        euint64 encryptedDataTransfer; // in MB
        euint64 encryptedServerEnergy; // in kWh
        uint256 timestamp;
        address advertiser;
    }

    struct CarbonFootprint {
        euint64 encryptedCO2; // in grams
        bool isRevealed;
        uint256 timestamp;
    }

    uint256 public campaignCount;
    mapping(uint256 => EncryptedAdCampaign) public encryptedCampaigns;
    mapping(uint256 => CarbonFootprint) public carbonFootprints;
    mapping(uint256 => uint256) private requestToCampaignId;

    event CampaignSubmitted(uint256 indexed id, address indexed advertiser, uint256 timestamp);
    event FootprintCalculationRequested(uint256 indexed campaignId);
    event FootprintRevealed(uint256 indexed campaignId, uint256 co2Amount);

    modifier onlyAdvertiser(uint256 campaignId) {
        require(encryptedCampaigns[campaignId].advertiser == msg.sender, "Not campaign owner");
        _;
    }

    /// @notice Submit encrypted ad campaign data
    function submitEncryptedCampaign(
        euint32 impressions,
        euint32 clicks,
        euint64 dataTransfer,
        euint64 serverEnergy
    ) public {
        campaignCount += 1;
        uint256 newId = campaignCount;

        encryptedCampaigns[newId] = EncryptedAdCampaign({
            id: newId,
            encryptedImpressions: impressions,
            encryptedClicks: clicks,
            encryptedDataTransfer: dataTransfer,
            encryptedServerEnergy: serverEnergy,
            timestamp: block.timestamp,
            advertiser: msg.sender
        });

        carbonFootprints[newId] = CarbonFootprint({
            encryptedCO2: FHE.asEuint64(0),
            isRevealed: false,
            timestamp: 0
        });

        emit CampaignSubmitted(newId, msg.sender, block.timestamp);
    }

    /// @notice Request carbon footprint calculation
    function requestCarbonFootprint(uint256 campaignId) public onlyAdvertiser(campaignId) {
        EncryptedAdCampaign storage campaign = encryptedCampaigns[campaignId];
        require(!carbonFootprints[campaignId].isRevealed, "Already calculated");

        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(campaign.encryptedImpressions);
        ciphertexts[1] = FHE.toBytes32(campaign.encryptedClicks);
        ciphertexts[2] = FHE.toBytes32(campaign.encryptedDataTransfer);
        ciphertexts[3] = FHE.toBytes32(campaign.encryptedServerEnergy);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateFootprint.selector);
        requestToCampaignId[reqId] = campaignId;

        emit FootprintCalculationRequested(campaignId);
    }

    /// @notice Calculate carbon footprint from decrypted data
    function calculateFootprint(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 campaignId = requestToCampaignId[requestId];
        require(campaignId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint32 impressions = results[0];
        uint32 clicks = results[1];
        uint64 dataTransfer = uint64(results[2]);
        uint64 serverEnergy = uint64(results[3]);

        // Simplified carbon calculation (real implementation would use FHE ops)
        euint64 encryptedCO2 = calculateEncryptedCO2(
            FHE.asEuint32(impressions),
            FHE.asEuint32(clicks),
            FHE.asEuint64(dataTransfer),
            FHE.asEuint64(serverEnergy)
        );

        carbonFootprints[campaignId].encryptedCO2 = encryptedCO2;
    }

    /// @notice Reveal calculated carbon footprint
    function revealCarbonFootprint(uint256 campaignId) public onlyAdvertiser(campaignId) {
        CarbonFootprint storage footprint = carbonFootprints[campaignId];
        require(!footprint.isRevealed, "Already revealed");
        require(FHE.isInitialized(footprint.encryptedCO2), "Not calculated yet");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(footprint.encryptedCO2);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.finalizeReveal.selector);
        requestToCampaignId[reqId] = campaignId;
    }

    /// @notice Finalize footprint reveal
    function finalizeReveal(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 campaignId = requestToCampaignId[requestId];
        require(campaignId != 0, "Invalid request");

        CarbonFootprint storage footprint = carbonFootprints[campaignId];
        FHE.checkSignatures(requestId, cleartexts, proof);

        uint64 co2Amount = abi.decode(cleartexts, (uint64));
        footprint.isRevealed = true;
        footprint.timestamp = block.timestamp;

        emit FootprintRevealed(campaignId, co2Amount);
    }

    /// @notice Internal function to calculate CO2 (simplified)
    function calculateEncryptedCO2(
        euint32 impressions,
        euint32 clicks,
        euint64 dataTransfer,
        euint64 serverEnergy
    ) private pure returns (euint64) {
        // Conversion factors (simplified)
        euint64 dataFactor = FHE.asEuint64(2); // grams per MB
        euint64 energyFactor = FHE.asEuint64(500); // grams per kWh
        
        // Calculate components
        euint64 dataCO2 = FHE.mul(dataTransfer, dataFactor);
        euint64 energyCO2 = FHE.mul(serverEnergy, energyFactor);
        
        // Sum total CO2
        return FHE.add(dataCO2, energyCO2);
    }

    /// @notice Get campaign details
    function getCampaign(uint256 campaignId) public view returns (
        address advertiser,
        uint256 timestamp,
        bool isFootprintCalculated,
        bool isFootprintRevealed
    ) {
        EncryptedAdCampaign storage c = encryptedCampaigns[campaignId];
        CarbonFootprint storage f = carbonFootprints[campaignId];
        return (
            c.advertiser,
            c.timestamp,
            FHE.isInitialized(f.encryptedCO2),
            f.isRevealed
        );
    }
}