import { program } from 'commander';
import { Choreographer, TransformerConfig, getServerInfo, getNetworkInfo } from '../../omniverse-services-deployer';
import config from 'config';
import fs from 'fs';
import { Request } from './request';
import { createKMSKey, createPrivateKey } from './generate';

if (!fs.existsSync(config.get("tranformerDeployInfoPath"))) {
    fs.writeFileSync(config.get("tranformerDeployInfoPath"), "{}");
}

function convertToTransformersFromConfig(
    transformers: any,
    transformerPath: string,
    AASignerPath: string
): Map<string, TransformerConfig> {
    let ret = new Map<string, TransformerConfig>();
    for (let name in transformers) {
        const tf: TransformerConfig = {
            name,
            erc20: {
                projectPath: transformerPath,
                template: "erc20",
                data: JSON.parse(JSON.stringify(transformers[name].erc20))
              },
              transformer: {
                projectPath: transformerPath,
                template: "transformer",
                data: JSON.parse(JSON.stringify(transformers[name].transformer))
              },
              AASigner: {
                projectPath: AASignerPath,
                template: "transformerSigner",
                data: JSON.parse(JSON.stringify(transformers[name].transformerSigner))
              }
        };
        ret.set(name, tf);
    }
    return ret;
}

program
    .command('gen <name>')
    .option('-k, --kms', 'if use KMS', false)
    .description('generate a private key for a transformer')
    .action(async (name: string, options: any) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }
        
        if (options.kms) {
            createKMSKey(name);
        }
        else {
            createPrivateKey(name);
        }
    });

program
    .command('utxo <name>')
    .description('show UTXOs by request `PreTransfer`')
    .action(async (name: string, options: any) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }

        const server = getServerInfo();
        const request = new Request(server.rpc);
        let preTransferData = await request.rpc('preTransfer', [
            {
                assetId: "0x0000000000000000000000000000000000000000000000000000000000000000",
                address: config.get(`transformers.${name}.compressedPublicKey`),
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
    .command('deploy <name>')
    .description('deploy a transformer')
    .action(async (name: string) => {
        const network = getNetworkInfo(config.get('network') as string);
        const transformers = convertToTransformersFromConfig(
            config.get('transformers'),
            config.get("transformerPath"),
            config.get("AASignerPath")
        );
        transformers.forEach((value, key) => {
            value.AASigner.data.contracts.omniverseAA.NETWORK_NAME = config.get('network');
        });
        const cg = new Choreographer(network);
        await cg.init();
        const sks = JSON.parse(fs.readFileSync(config.get("secret")).toString());
        await cg.deployTransformer(transformers.get(name)!, sks.deployer);
    });

program.parse();
