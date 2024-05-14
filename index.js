import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import BigNumber from 'bignumber.js';
import fs from 'fs';
import readlineSync from 'readline-sync';
import chalk from 'chalk';

const client = new SuiClient({
    url: getFullnodeUrl('mainnet'),
});

function calculateBalance(totalBalance, divider) {
    return Number(totalBalance) / Math.pow(10, divider);
}

function reverseCalculateBalance(balance, multiplier) {
    return balance * Math.pow(10, multiplier);
}

const parseAmount = (amount, coinDecimals) => new BigNumber(amount).shiftedBy(coinDecimals).integerValue();

const checkCanSend = async (suiAddress, amount, transactionBuilder) => {
    const totalBalance = await client.getBalance({
        owner: suiAddress,
        coinType: "0x2::sui::SUI"
    });

    if (new BigNumber(totalBalance.totalBalance).gte(amount)) {
        const splitAmount = transactionBuilder.pure(amount.toString());
        const [splitCoin] = transactionBuilder.splitCoins(transactionBuilder.gas, [splitAmount]);
        return splitCoin;
    }
    return null;
};

const sendTransaction = (client, bytes, signature) => new Promise(async (resolve, reject) => {
    try {
        await client.dryRunTransactionBlock({
            transactionBlock: bytes
        });
        const result = await client.executeTransactionBlock({
            signature: signature,
            transactionBlock: bytes,
            requestType: 'WaitForLocalExecution',
            options: {
                showEffects: true
            }
        });
        resolve(result)
    } catch (error) {
        reject(error)
    }
});

(async () => {
    const SUI_MNEMONIC = readlineSync.question('Input your mnemonic / seed phrase : ');
    if (!SUI_MNEMONIC) {
        console.log(chalk.red('Please input the correct mnemonic.'));
        process.exit(0); 
    }

    const amountToSend = readlineSync.question('Input the amount of SUI to send to each address : ');
    const amountToSendCleaned = amountToSend.replace(',', '.');
    if (isNaN(parseFloat(amountToSendCleaned))) {
        console.log(chalk.red('Please input a valid amount.'));
        process.exit(0); 
    }

    const secret_key_mnemonics = SUI_MNEMONIC;
    const keypair = Ed25519Keypair.deriveKeypair(secret_key_mnemonics);
    const suiAddress = keypair.getPublicKey().toSuiAddress();

    const client = new SuiClient({
        url: getFullnodeUrl('mainnet'),
    });

    const amountToSendParsed = parseAmount(amountToSendCleaned, 9);

    const addresses = fs.readFileSync('address.txt', 'utf-8').split('\n').filter(Boolean);

    // Check sender balance
    const senderBalanceResult = await client.getBalance({
        owner: suiAddress,
        coinType: "0x2::sui::SUI"
    });
    const realSenderBalance = calculateBalance(senderBalanceResult.totalBalance, 9);
    console.log(chalk.yellow(`Sender Address: ${suiAddress}`));
    console.log(chalk.yellow(`Sender Balance: ${realSenderBalance} SUI`));

    if (new BigNumber(realSenderBalance).lt(amountToSendCleaned * addresses.length)) {
        console.log(chalk.red('Insufficient balance to complete the transaction.'));
        process.exit(0);
    }

    for (const address of addresses) {
        const txb = new TransactionBlock();
        const canSendResult = await checkCanSend(suiAddress, amountToSendParsed, txb);

        if (!canSendResult) {
            console.log(chalk.red(`Insufficient balance to send ${amountToSend} SUI to ${address}`));
            continue;
        }

        txb.transferObjects([canSendResult], txb.pure(address));
        txb.setGasBudget("10000000"); // Ensure the gas budget is a string
        txb.setSender(suiAddress);

        try {
            const { bytes, signature } = await txb.sign({
                client,
                signer: keypair
            });

            const txResult = await sendTransaction(client, bytes, signature);
            if (txResult.effects.status.status === 'success') {
                console.log(chalk.green(`Successfully sent ${amountToSend} SUI to ${address}`));
            } else {
                console.log(chalk.red(`Failed to send ${amountToSend} SUI to ${address}`));
            }
        } catch (error) {
            console.log(chalk.red(`Error sending ${amountToSend} SUI to ${address}: ${error.message}`));
        }
    }
})();
