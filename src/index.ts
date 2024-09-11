import { program } from 'commander';
import { Choreographer, TransformerConfig, getServerInfo, getNetworkInfo } from '../../omniverse-services-deployer';
import config from 'config';
import { ethers } from 'ethers';
import secp256k1 from 'secp256k1';
import fs from 'fs';
import { execSync } from 'child_process';
import { Request } from './request';
import AWS from 'aws-sdk';
import * as asn1js from 'asn1js';
import { ECPublicKey } from 'pkijs';
import { ec as EC } from 'elliptic';
import { keccak256 } from 'ethers';
import * as kmsConfig from '../config/kms.json';

const kms = new AWS.KMS();
const ec = new EC('secp256k1'); 

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

async function createKMSKey(name: string) {
    async function getPublicKey(keyId: string) {
        const params: AWS.KMS.GetPublicKeyRequest = {
          KeyId: keyId, // 使用你创建的密钥 ID 或 ARN
        };
      
        try {
          const data = await kms.getPublicKey(params).promise();
          
          if (data.PublicKey) {
            const publicKeyArray = new Uint8Array(data.PublicKey as ArrayBuffer);

            // 解析 ASN.1 编码的公钥
            const asn1 = asn1js.fromBER(publicKeyArray.buffer);
            if (asn1.offset === -1) {
                throw new Error('Invalid ASN.1 format');
            }
              
            // 使用 pkijs 提取公钥的 X 和 Y 坐标
            const ecPublicKey = new ECPublicKey({ schema: asn1.result });

            const xCoord = Buffer.from(ecPublicKey.x).toString('hex');
            const yCoord = Buffer.from(ecPublicKey.y).toString('hex');

             // 输出完整的非压缩公钥（包括 X 和 Y 坐标）
            const uncompressedPublicKey = `0x${xCoord}${yCoord}`;
            const compressedPublicKey = `0x${xCoord}`;
            
            console.log('Uncompressed Public Key (Hex):', uncompressedPublicKey);
            
            return {uncompressedPublicKey, compressedPublicKey};
          }
        } catch (err) {
          console.error('Error getting public key:', err);
        }
      }

    async function createKey() {
        const params: AWS.KMS.CreateKeyRequest = {
          Description: 'KMS key for a specific role and IP',
          KeyUsage: 'SIGN_VERIFY',
          CustomerMasterKeySpec: 'ECC_SECG_P256K1',  // 设置曲线类型为 secp256k1
          Origin: 'AWS_KMS',
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  AWS: kmsConfig.role,
                },
                Action: 'kms:*',
                Resource: '*',
                Condition: {
                  IpAddress: {
                    'aws:SourceIp': kmsConfig.ip, // 替换成允许的 IP 地址
                  },
                },
              },
            ],
          }),
        };
      
        try {
          const data = await kms.createKey(params).promise();
          console.log('KMS Key Created:', data);
          return data.KeyMetadata;
        } catch (err) {
          console.error('Error creating KMS Key:', err);
        }
      }

    const keyMetadata = await createKey();
    const pk = await getPublicKey(keyMetadata!.KeyId);
    // 对公钥的后 64 字节进行 Keccak256 哈希
    const publicKeyHash = keccak256(pk!.uncompressedPublicKey);
    // 取哈希的后 40 个字符（20 字节）作为以太坊地址
    const ethereumAddress = `0x${publicKeyHash.slice(-40)}`;
    
    saveConfig(name, {signerType: 'kms', params: keyMetadata}, ethereumAddress, pk!.compressedPublicKey, pk!.uncompressedPublicKey);

    fundAccount(ethereumAddress, pk!.compressedPublicKey);
}

function saveConfig(name: string, key: any, ethAddress: string, compressedPublicKey: string, uncompressedPublicKey: string) {
    // save keys
    let sks: any = {};
    if (fs.existsSync(config.get('secret'))) {
        sks = JSON.parse(fs.readFileSync(config.get('secret')).toString());
    }
    sks[`${name}-transformer-AASigner`] = key;
    sks[`${name}-erc20`] = key;
    sks[`${name}-transformer`] = key;
    fs.writeFileSync(config.get('secret'), JSON.stringify(sks, null, '\t'));

    let configs = JSON.parse(
        fs.readFileSync('config/default.json').toString()
    );
    configs[`transformers`][`${name}`]['compressedPublicKey'] = compressedPublicKey;
    configs[`transformers`][`${name}`]['uncompressedPublicKey'] = uncompressedPublicKey;
    configs[`transformers`][`${name}`]['address'] = ethAddress;
    configs[`transformers`][`${name}`].transformerSigner.contracts.omniverseAA.signer = ethAddress;
    fs.writeFileSync(
        'config/default.json',
        JSON.stringify(configs, null, '\t')
    );
}

async function fundAccount(ethAddress: string, compressed: string) {
    if (!config.has(`faucet`)) {
        return;
    }

    // fund account
    console.log('fund account');

    let ret = execSync(
        `curl "${config.get('faucet.local')}${ethAddress}"`
    );
    console.log('local', ret.toString());

    ret = execSync(`curl "${config.get('faucet.omniverse')}${compressed}"`);
    console.log('local', ret.toString());
}

async function createPrivateKey(name: string) {
    // generate
    const wallet = ethers.Wallet.createRandom();
    console.log('Address: ', wallet.address);
    console.log('Private Key: ', wallet.privateKey);
    console.log('Mnemonic: ', wallet.mnemonic!.phrase);
    const pubkey = secp256k1.publicKeyCreate(
        Buffer.from(wallet.privateKey.substring(2), 'hex'),
        false
    );
    console.log(
        'uncompressed',
        '0x' + Buffer.from(pubkey).toString('hex').substring(2)
    );
    const compressed = '0x' + wallet.publicKey.substring(4);
    const uncompressed = '0x' + Buffer.from(pubkey).toString('hex').substring(2);
    console.log('Public Key:', compressed);

    saveConfig(name, {signerType: 'sk', params: {sk: wallet.privateKey}}, wallet.address, compressed, uncompressed);

    fundAccount(wallet.address, compressed);
}

program
    .command('generateSK <name>')
    .description('generate a private key for a transformer')
    .action(async (name: string) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }
        
        createPrivateKey(name);
    });

program
    .command('showUTXO <name>')
    .description('show UTXOs by request `PreTransfer`')
    .action(async (name: string) => {
        if (!config.has(`transformers.${name}`)) {
            throw new Error(`No transformer named ${name} is configured`);
        }

        const server = getServerInfo();
        const request = new Request(server.rpc);
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
        await cg.deployTransformer(transformers.get(name)!, sks[`${name}-transformer`]);
    });

program.parse();
