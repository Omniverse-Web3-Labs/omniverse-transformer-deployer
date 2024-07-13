import { program } from 'commander';
import {Choreographer} from "../omniverse-services-deployer/dist/src/choreographer";
import config from "config";
import { TransformerConfig } from "../omniverse-services-deployer/dist/src/types";
  
function convertToTransformersFromConfig(transformers: any): Map<string, TransformerConfig> {
let ret = new Map<string, TransformerConfig>();
for (let name in transformers) {
    const tf: TransformerConfig = {
    name,
    erc20: transformers[name].erc20,
    transformer: transformers[name].transformer
    }
    ret.set(name, tf);
}
return ret;
}

program
      .command('deployTransformer <name>')
      .description('deploy a transformer')
    .action(async (name: string) => {
      const network = {
        rpc: config.get("network.rpc") as string
      };
      const transformers = convertToTransformersFromConfig(config.get("transformers"));
      const cg = new Choreographer(network);
      await cg.init();
      await cg.deployTransformer(transformers.get(name)!);
    });

program.parse();