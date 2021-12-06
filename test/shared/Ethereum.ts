
import { ethers, waffle, network } from 'hardhat'

export async function minerStart() {
  await network.provider.send("evm_mine")
  await network.provider.send("evm_setAutomine", [true])
}

export async function minerStop() {
  await network.provider.send("evm_setAutomine", [false])
}

export async function mineBlock() {
  return ethers.provider.send("evm_mine", [])
}
