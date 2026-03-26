import { Command } from 'commander';
import { Signer, bytesToPrefixedHex } from '@fastxyz/sdk';

const program = new Command();

program
    .name('fast')
    .description('Fast CLI - Account and transaction utilities')
    .version('0.0.1');

program
    .command('generate')
    .description('Generate a new account and display its address')
    .action(async () => {
        const privKeyBytes = new Uint8Array(32);
        crypto.getRandomValues(privKeyBytes);
        const privKeyHex = bytesToPrefixedHex(privKeyBytes);

        const signer = new Signer(privKeyHex);
        const address = await signer.getAddress();

        console.log('Generated new account:');
        console.log(`  Address:     ${address.toString()}`);
        console.log(`  Private Key: ${privKeyHex}`);
    });

program.parse(process.argv);