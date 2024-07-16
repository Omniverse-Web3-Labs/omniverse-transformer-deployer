import { program } from 'commander';
import { Choreographer } from '@omniverselab/deployer/dist/src/choreographer';
import config from 'config';
import { TransformerConfig } from '@omniverselab/deployer/dist/src/types';
import { ethers } from 'ethers';
import secp256k1 from 'secp256k1';
import fs from 'fs';
import { execSync } from 'child_process';
import { Request } from './request';

if (!fs.existsSync(config.get("tranformerDeployInfoPath"))) {
    fs.writeFileSync(config.get("tranformerDeployInfoPath"), "{}");
}

function convertToTransformersFromConfig(
    transformers: any
): Map<string, TransformerConfig> {
    let ret = new Map<string, TransformerConfig>();
    for (let name in transformers) {
        const tf: TransformerConfig = {
            name,
            erc20: transformers[name].erc20,
            transformer: transformers[name].transformer
        };
        ret.set(name, tf);
    }
    return ret;
}

program
    .command('generateSK <name>')
    .description('generate a private key for a transformer')
    .action(async (name: string) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }
        const wallet = ethers.Wallet.createRandom();
        console.log('Address: ', wallet.address);
        console.log('Private Key: ', wallet.privateKey);
        console.log('Mnemonic: ', wallet.mnemonic!.phrase);
        var pubKey = secp256k1.publicKeyCreate(
            Buffer.from(wallet.privateKey.substring(2), 'hex'),
            false
        );
        console.log(
            'uncompressed',
            '0x' + Buffer.from(pubKey).toString('hex').substring(2)
        );
        const pubkey = '0x' + wallet.publicKey.substring(4);
        console.log('Public Key:', pubkey);

        let sks: any = {};
        if (fs.existsSync(config.get('secret'))) {
            sks = JSON.parse(fs.readFileSync(config.get('secret')).toString());
        }
        sks[`${name}-transformer-AASigner`] = wallet.privateKey;
        sks[`${name}-erc20`] = wallet.privateKey;
        sks[`${name}-transformer`] = wallet.privateKey;
        fs.writeFileSync(config.get('secret'), JSON.stringify(sks, null, '\t'));

        let configs = JSON.parse(
            fs.readFileSync('config/default.json').toString()
        );
        configs[`transformers`][`${name}`]['pubkey'] = pubkey;
        configs[`transformers`][`${name}`]['address'] = wallet.address;
        fs.writeFileSync(
            'config/default.json',
            JSON.stringify(configs, null, '\t')
        );

        if (!config.has(`faucet`)) {
            return;
        }

        console.log('fund account');

        let ret = execSync(
            `curl "${config.get('faucet.local')}${wallet.address}"`
        );
        console.log('local', ret.toString());

        ret = execSync(`curl "${config.get('faucet.omniverse')}${pubkey}"`);
        console.log('local', ret.toString());
    });

program
    .command('showUTXO <name>')
    .description('show UTXOs by request `PreTransfer`')
    .action(async (name: string) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }

        const request = new Request(config.get('network.server'));
        let preTransferData = await request.rpc('preTransfer', [
            {
                assetId: "0x0000000000000000000000000000000000000000000000000000000000000000",
                address: config.get(`transformers.${name}.pubkey`),
                outputs: [
                    {
                        address:
                            '0x0000000000000000000000000000000000000000000000000000000000000000',
                        amount: '1'
                    }
                ]
            }
        ]);
        console.log('preTransferData', preTransferData);

        let configs = JSON.parse(
            fs.readFileSync('config/default.json').toString()
        );
        const transformer = configs[`transformers`][`${name}`].transformer;
        transformer.utxos = [
            {
                txid: preTransferData.feeInputs[0].txid,
                omniAddress: preTransferData.feeInputs[0].address,
                assetId:
                    '0x0000000000000000000000000000000000000000000000000000000000000000',
                index: preTransferData.feeInputs[0].index,
                amount: preTransferData.feeInputs[0].amount
            }
        ];
        fs.writeFileSync(
            'config/default.json',
            JSON.stringify(configs, null, '\t')
        );
    });

program
    .command('deployTransformer <name>')
    .description('deploy a transformer')
    .action(async (name: string) => {
        const network = {
            rpc: config.get('network.rpc') as string
        };
        const transformers = convertToTransformersFromConfig(
            config.get('transformers')
        );
        const cg = new Choreographer(network);
        await cg.init();
        await cg.deployTransformer(transformers.get(name)!);
    });

program.parse();
