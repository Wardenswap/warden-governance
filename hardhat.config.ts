require('dotenv').config()
import { task } from "hardhat/config"
import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import "@nomiclabs/hardhat-waffle"
import "solidity-coverage"
import { HardhatUserConfig } from "hardhat/config"

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: '0.5.16',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000000
      }
    }
  },
  networks: {
    hardhat: {
    }
  },
  mocha: {
    timeout: 200000
  }
}

export default config
