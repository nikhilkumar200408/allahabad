"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BlockchainService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockchainService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
const config_1 = require("@nestjs/config");
const ethers = __importStar(require("ethers"));
const crypto = __importStar(require("crypto"));
const BANKING_AUDIT_LEDGER_ABI = [
    {
        inputs: [
            { name: 'txHash', type: 'bytes32' },
            { name: 'previousHash', type: 'bytes32' },
            { name: 'senderAddr', type: 'address' },
            { name: 'receiverAddr', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'timestamp', type: 'uint256' },
        ],
        name: 'anchorTransaction',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [{ name: 'txHash', type: 'bytes32' }],
        name: 'verifyTransaction',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getLastAnchor',
        outputs: [{ name: '', type: 'bytes32' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'txHash', type: 'bytes32' },
            { indexed: false, name: 'blockNumber', type: 'uint256' },
            { indexed: false, name: 'timestamp', type: 'uint256' },
        ],
        name: 'TransactionAnchored',
        type: 'event',
    },
];
let BlockchainService = BlockchainService_1 = class BlockchainService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.logger = new common_1.Logger(BlockchainService_1.name);
        this.initializeBlockchain();
    }
    initializeBlockchain() {
        try {
            const rpcUrl = this.config.get('BLOCKCHAIN_RPC_URL', 'http://localhost:8545');
            const privateKey = this.config.get('BLOCKCHAIN_PRIVATE_KEY');
            this.contractAddress = this.config.get('BLOCKCHAIN_CONTRACT_ADDRESS');
            if (!privateKey) {
                throw new Error('BLOCKCHAIN_PRIVATE_KEY not configured');
            }
            if (!this.contractAddress) {
                throw new Error('BLOCKCHAIN_CONTRACT_ADDRESS not configured');
            }
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.contract = new ethers.Contract(this.contractAddress, BANKING_AUDIT_LEDGER_ABI, this.wallet);
            this.logger.log(`[BLOCKCHAIN-INIT] Connected to ${rpcUrl}, contract: ${this.contractAddress}`);
        }
        catch (error) {
            this.logger.error(`[BLOCKCHAIN-INIT-ERROR] Failed to initialize blockchain: ${error.message}`);
            throw error;
        }
    }
    async anchorTransaction(transactionId, txHash) {
        try {
            this.logger.log(`[ANCHOR] Starting blockchain anchor for transaction ${transactionId}`);
            const transaction = await this.prisma.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    sender: true,
                    receiver: true,
                },
            });
            if (!transaction) {
                throw new Error(`Transaction not found: ${transactionId}`);
            }
            const previousHash = await this.getLastAnchorHash();
            const txHashBytes32 = this.stringToBytes32(txHash);
            const previousHashBytes32 = previousHash
                ? this.stringToBytes32(previousHash)
                : ethers.ZeroHash;
            const senderAddr = this.deriveAddressFromId(transaction.senderId);
            const receiverAddr = this.deriveAddressFromId(transaction.receiverId);
            const amountWei = ethers.parseEther(transaction.amount.toString());
            const timestamp = Math.floor(Date.now() / 1000);
            this.logger.log(`[ANCHOR-PARAMS] txHash=${txHashBytes32}, amount=${transaction.amount}`);
            const tx = await this.contract.anchorTransaction(txHashBytes32, previousHashBytes32, senderAddr, receiverAddr, amountWei, timestamp, {
                gasLimit: 300000,
            });
            this.logger.log(`[ANCHOR-SUBMITTED] tx hash: ${tx.hash}`);
            const receipt = await tx.wait(2);
            if (!receipt) {
                throw new Error('Transaction failed: No receipt returned');
            }
            this.logger.log(`[ANCHOR-CONFIRMED] Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);
            await this.prisma.blockchainAuditLog.update({
                where: { transactionId },
                data: {
                    blockNumber: BigInt(receipt.blockNumber),
                    blockHash: receipt.blockHash,
                    gasUsed: BigInt(receipt.gasUsed.toString()),
                    syncedToChainAt: new Date(),
                },
            });
            return {
                blockNumber: receipt.blockNumber,
                txId: receipt.hash,
            };
        }
        catch (error) {
            this.logger.error(`[ANCHOR-ERROR] Failed to anchor transaction ${transactionId}: ${error.message}`);
            try {
                await this.prisma.blockchainAuditLog.update({
                    where: { transactionId },
                    data: {
                        verificationStatus: 'FAILED',
                    },
                });
            }
            catch (updateErr) {
                this.logger.warn(`Could not update audit log: ${updateErr.message}`);
            }
            throw new common_1.InternalServerErrorException(`Blockchain anchor failed: ${error.message}`);
        }
    }
    async verifyTransaction(txHash) {
        try {
            const txHashBytes32 = this.stringToBytes32(txHash);
            const isVerified = await this.contract.verifyTransaction(txHashBytes32);
            this.logger.log(`[VERIFY] Transaction ${txHash} verified: ${isVerified}`);
            return isVerified;
        }
        catch (error) {
            this.logger.error(`[VERIFY-ERROR] Failed to verify transaction: ${error.message}`);
            return false;
        }
    }
    async getAuditProof(txHash) {
        try {
            const auditLog = await this.prisma.blockchainAuditLog.findUnique({
                where: { txHash },
            });
            if (!auditLog) {
                return {
                    verified: false,
                    blockNumber: null,
                    chainproof: null,
                };
            }
            const isVerified = await this.verifyTransaction(txHash);
            const proof = isVerified
                ? this.constructMerkleProof(txHash, auditLog.previousHash, auditLog.blockNumber?.toString() || '')
                : null;
            return {
                verified: isVerified,
                blockNumber: auditLog.blockNumber ? Number(auditLog.blockNumber) : null,
                chainproof: proof,
            };
        }
        catch (error) {
            this.logger.error(`[AUDIT-PROOF-ERROR] ${error.message}`);
            return {
                verified: false,
                blockNumber: null,
                chainproof: null,
            };
        }
    }
    async batchVerifyTransactions(txHashes) {
        const results = new Map();
        for (const txHash of txHashes) {
            const isVerified = await this.verifyTransaction(txHash);
            results.set(txHash, isVerified);
        }
        return results;
    }
    async getLastAnchorHash() {
        try {
            const lastHash = await this.contract.getLastAnchor();
            return lastHash === ethers.ZeroHash ? null : lastHash;
        }
        catch (error) {
            this.logger.warn(`Could not fetch last anchor hash: ${error.message}`);
            return null;
        }
    }
    getContractAddress() {
        return this.contractAddress;
    }
    getWalletAddress() {
        return this.wallet.address;
    }
    stringToBytes32(value) {
        let hex = value.startsWith('0x') ? value.slice(2) : value;
        if (hex.length < 64) {
            hex = hex.padStart(64, '0');
        }
        if (hex.length > 64) {
            throw new Error(`Value too large for bytes32: ${value}`);
        }
        return `0x${hex}`;
    }
    deriveAddressFromId(id) {
        const salt = this.config.get('BLOCKCHAIN_ADDRESS_DERIVATION_SALT', 'banking-audit-ledger');
        const hmac = crypto
            .createHmac('sha256', salt)
            .update(id)
            .digest('hex');
        const address = `0x${hmac.substring(0, 40)}`;
        return ethers.getAddress(address);
    }
    constructMerkleProof(txHash, previousHash, blockNumber) {
        const proof = {
            txHash,
            previousHash: previousHash || ethers.ZeroHash,
            blockNumber,
            timestamp: new Date().toISOString(),
            proofType: 'chainLink',
        };
        return JSON.stringify(proof);
    }
};
exports.BlockchainService = BlockchainService;
exports.BlockchainService = BlockchainService = BlockchainService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], BlockchainService);
//# sourceMappingURL=blockchain.service.js.map