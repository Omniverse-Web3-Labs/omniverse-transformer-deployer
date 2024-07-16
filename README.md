# Omniverse transformer deploying tool

## Prerequisite

- node >= v20.11.1

## Install

```
npm install
```

## Usage

This tutorial will show you how to deploy an omniverse transformer.

### Add transformer information to `config` file

Open `config/default.json`, add transformer information as the child of `transformer`, such as

```
"TEST1": {  // token name
			"erc20": {
				"name": "TEST1",    // token name
				"mintTo": "0x0000000000000000000000000000000000000000", // initial mint to the erc20 contract itself
				"mintNum": "21000000"   // initial mint amount
			},
			"transformer": {
				"assetId": "0x2a8e070f01af52d5a3abb3db90cf8a648d2f410e2481bc00203f62c13297ab11",    // the omniverse asset id the transformer will handle with
				"utxos": [  // Initial UTXOs for the AA, keep empty as the initial state. It will be filled automatically in the following step. 
                ]
            }
}
```

**NOTE**: `utxos` can be empty, but it is RECOMMENDED to add some gas UTXOs, in order the AA contract can construct Omniverse transaction

### Create an omniverse account

```
npx ts-node src/index.ts generateSK <TOKEN_NAME>    // `TEST1` for example
```

After the key is generated, two fields will be added to the <TOKEN_NAME> field

```
"pubkey": "0xb94f4f5cf8f04561c86f57152a75b30580554efa6f2ee9d8aa0b12a5cf8accca",
"address": "0xA992D126dECc2A76B60E7af29237f137CC1e408E"
```

The private key will be save in a file, the path of which is configured in the field `secret` of file `config/default`

If there are faucets for the network, the omniverse account as well as the local account will be funded.

### Set UTXOs

```
npx ts-node src/index.ts showUTXO <TOKEN_NAME>
```

The utxos will be filled like this

```
"utxos": [
					{
						"txid": "0xb314c5a5b1eca646f89a1d52f218e4e41999092baa5a449c02e2ab91802795e2",
						"omniAddress": "0x1b6d124aafd1c13a96d5f81047595458070ded2b6d01424c7c5cb4b0c9166364",
						"assetId": "0x0000000000000000000000000000000000000000000000000000000000000000",
						"index": 1,
						"amount": "100000000000000"
					}
				]
```

### Deploy

```
npx ts-node src/index.ts deployTransformer <TOKEN_NAME>
```

## Next steps

### Launch AA signer

### Add to transformer list

Contact the team to add the transformer contract to transformer list, in order to show it on the web