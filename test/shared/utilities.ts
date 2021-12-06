import { Contract, utils, constants, BigNumber } from 'ethers'
import { Warden } from '../../typechain'

const getAddress = utils.getAddress
const keccak256 = utils.keccak256
const defaultAbiCoder = utils.defaultAbiCoder
const toUtf8Bytes = utils.toUtf8Bytes
const solidityPack = utils.solidityPack

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

function getDomainSeparator(name: string, tokenAddress: string, chainId: number) {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(name)),
        chainId,
        tokenAddress
      ]
    )
  )
}

export async function getApprovalDigest(
  token: Warden,
  owner: string,
  spender: string,
  value: BigNumber,
  nonce: BigNumber,
  deadline: BigNumber,
  chainId: number
) {
  const name = await token.name()
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address, chainId)
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
          )
        )
      ]
    )
  )
}
