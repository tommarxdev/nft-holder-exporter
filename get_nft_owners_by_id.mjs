
import { ethers } from 'ethers';
import fs from 'fs';
import dotenv from 'dotenv';
import { createArrayCsvWriter } from 'csv-writer';
import cliProgress from 'cli-progress';
import retry from 'retry';

// Load environment variables
dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL_ASTAR || 'https://evm.astar.network';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x2A314f5611BA26D947b346537AEB685f911fc26A';
const ABI_PATH = './ContractABI.json'; // Path to your ABI file

// Initialize Ethers.js provider (v6 syntax)
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Load Contract ABI
let contractABI;
try {
  const abiData = fs.readFileSync(ABI_PATH, 'utf-8');
  contractABI = JSON.parse(abiData);
} catch (error) {
  console.error(`Failed to load ABI from ${ABI_PATH}:`, error.message);
  process.exit(1);
}

// Initialize Contract Instance
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);

// Initialize CSV Writer in Append Mode
const csvWriter = createArrayCsvWriter({
  path: 'nft_holders.csv',
  header: ['Owner Address', 'Token ID'],
  append: true,
});

// Write CSV Header if File is Empty
if (!fs.existsSync('nft_holders.csv') || fs.statSync('nft_holders.csv').size === 0) {
  fs.writeFileSync('nft_holders.csv', 'Owner Address,Token ID\n');
}

// Initialize Error Log Stream
const errorLogStream = fs.createWriteStream('error.log', { flags: 'a' });

// Function to fetch owners from token ID 1 to 1000
async function fetchOwnersInRange() {
  try {
    const startTokenId = 1001;
    const endTokenId = 2000;

    const batchSize = 5; // Reduced batch size to handle rate limits
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    const total = endTokenId - startTokenId + 1;
    progressBar.start(total, 0);

    for (let i = startTokenId; i <= endTokenId; i += batchSize) {
      const batchEnd = Math.min(i + batchSize - 1, endTokenId);
      const batchPromises = [];

      for (let j = i; j <= batchEnd; j++) {
        batchPromises.push(
          new Promise((resolve) => {
            const operation = retry.operation({
              retries: 10,
              factor: 2,
              minTimeout: 1000,
              maxTimeout: 8000,
            });

            operation.attempt(async () => {
              try {
                const owner = await contract.ownerOf(j);
                // Write to CSV immediately
                await csvWriter.writeRecords([[owner, j]]);
                resolve();
                progressBar.increment();
              } catch (error) {
                if (error.code === 'CALL_EXCEPTION' && error.reason && error.reason.includes('invalid token ID')) {
                  // Token ID does not exist
                  console.warn(`Token ID ${j} is invalid.`);
                  progressBar.increment();
                  resolve();
                } else if (operation.retry(error)) {
                  return;
                } else {
                  console.error(`Failed to fetch owner for token ID ${j}:`, error.message);
                  errorLogStream.write(`Error fetching owner for token ID ${j}: ${error.message}\n`);
                  progressBar.increment();
                  resolve();
                }
              }
            });
          })
        );
      }

      await Promise.all(batchPromises);
      // Introduce a delay between batches
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    progressBar.stop();
  } catch (error) {
    console.error('Error fetching owners:', error.message);
    throw error;
  }
}

// Main function to execute the script
async function main() {
  try {
    await fetchOwnersInRange();
    console.log('Data successfully written to nft_holders.csv');
  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
  } finally {
    errorLogStream.end();
  }
}

// Execute the main function
main();
