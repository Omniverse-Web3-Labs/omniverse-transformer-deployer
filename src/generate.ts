import AWS from 'aws-sdk';
import * as asn1js from 'asn1js';
import { keccak256 } from 'ethers';
import * as kmsConfig from '../config/kms.json';
import { ethers } from 'ethers';
import secp256k1 from 'secp256k1';
import { execSync } from 'child_process';
import config from 'config';
import fs from 'fs';
import { SignerType } from '../../omniverse-services-deployer';

export async function createKMSKey(name: string) {
    const kms = new AWS.KMS(kmsConfig.endpoint ? {
      endpoint: kmsConfig.endpoint
    } : {});
    
    async function getPublicKey(keyId: string) {
        const params: AWS.KMS.GetPublicKeyRequest = {
          KeyId: keyId, // 使用你创建的密钥 ID 或 ARN
        };
      
        const data = await kms.getPublicKey(params).promise();
        
        if (data.PublicKey) {
            console.log("public key", data.PublicKey);
        const publicKeyArray = new Uint8Array(data.PublicKey as ArrayBuffer);

        // 解析 ASN.1 编码的公钥
        const asn1 = asn1js.fromBER(publicKeyArray.buffer);
        if (asn1.offset === -1) {
            throw new Error('Invalid ASN.1 format');
        }

        const sequence = asn1.result as asn1js.Sequence;

        // 提取 ASN.1 Sequence 中的字段
        const sequenceValue = sequence.valueBlock.value; // 这是一个数组，包含多个字段
        
        // 提取 AlgorithmIdentifier 和 SubjectPublicKey
        // const algorithmIdentifier = sequenceValue[0] as asn1js.Sequence; // 第一个字段，通常是 AlgorithmIdentifier
        const subjectPublicKey = sequenceValue[1] as asn1js.BitString; // 第二个字段，通常是 SubjectPublicKey

        // 提取 BIT STRING 中的公钥数据
        const bitStringData = subjectPublicKey.valueBlock.valueHexView; // BIT STRING 数据，包括前缀字节
        const publicKeyBuffer = Buffer.from(bitStringData.slice(1)); // 去掉前缀字节

        console.log("publicKeyBuffer", publicKeyBuffer);

            // 输出完整的非压缩公钥（包括 X 和 Y 坐标）
        const uncompressedPublicKey = `0x${publicKeyBuffer.toString('hex')}`;
        const compressedPublicKey = uncompressedPublicKey.substring(0, 66);
        
        console.log('Public Key (Hex):', uncompressedPublicKey, compressedPublicKey);
        
        return {uncompressedPublicKey, compressedPublicKey};
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
    console.log('ethereumAddress', ethereumAddress);
    
    saveConfig(name, {
        signerType: 'kms',
        params: {
            keyId: keyMetadata!.KeyId,
            pk: pk!.uncompressedPublicKey
        }
    }, ethereumAddress, pk!.compressedPublicKey, pk!.uncompressedPublicKey);

    fundAccount(ethereumAddress, pk!.compressedPublicKey);
}

function saveConfig(name: string, key: any, ethAddress: string, compressedPublicKey: string, uncompressedPublicKey: string) {
    // save keys
    let sks: any = {};
    if (fs.existsSync(config.get('secret'))) {
        sks = JSON.parse(fs.readFileSync(config.get('secret')).toString());
    }
    sks[`${name}-AASigner`] = key;
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
    if (key.signerType == 'kms') {
        configs[`transformers`][`${name}`].transformer.SIGNER = SignerType.KMS_SIGNER;
    }
    else if (key.signerType == 'sk') {
        configs[`transformers`][`${name}`].transformer.SIGNER = SignerType.SK_SIGNER;
    }
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

export async function createPrivateKey(name: string) {
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