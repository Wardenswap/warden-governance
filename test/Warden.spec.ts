import { ethers, waffle, network } from 'hardhat'
import { utils, BigNumber, constants } from 'ethers'
const { parseUnits } = utils
import { expect } from 'chai'
import { Warden } from '../typechain'
import { getApprovalDigest } from './shared/utilities'
import { ecsign } from 'ethereumjs-util'

const EXPECT_TOTAL_SUPPLY = parseUnits('200000000', 18) // 200,000,000 Wad
const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
)


describe('Warden', () => {
  let warden: Warden
  let chainId: number

  const provider = waffle.provider
  const [deployer, spender, other] = provider.getWallets()

  beforeEach(async () => {
    // Deploy Uni route
    warden = await (await ethers.getContractFactory('Warden')).deploy(
      deployer.address
    )
    await warden.deployed()

    chainId = (await waffle.provider.getNetwork()).chainId
  })

  it('Should deploy properly', async () => {
    expect(await warden.name()).to.eq('WardenSwap')
    expect(await warden.symbol()).to.eq('WAD')
    expect(await warden.decimals()).to.eq(18)
    expect(await warden.totalSupply()).to.eq(EXPECT_TOTAL_SUPPLY)

    expect(await warden.balanceOf(deployer.address)).to.eq(EXPECT_TOTAL_SUPPLY)
    expect(await warden.DOMAIN_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
      )
    )
    expect(await warden.DELEGATION_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Delegation(address delegatee,uint256 nonce,uint256 expiry)')
      )
    )
    expect(await warden.PERMIT_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
      )
    )
  })

  it('permit', async () => {
    const amount = utils.parseUnits('10', 18)
    const nonce = await warden.nonces(deployer.address)
    const deadline = constants.MaxUint256
    const digest = await getApprovalDigest(
      warden,
      deployer.address,
      spender.address,
      amount,
      nonce,
      deadline,
      chainId
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployer.privateKey.slice(2), 'hex'))

    await expect(warden.connect(other).permit(deployer.address, spender.address, amount, deadline, v, utils.hexlify(r), utils.hexlify(s)))
      .to.emit(warden, 'Approval')
      .withArgs(deployer.address, spender.address, amount)
    expect(await warden.allowance(deployer.address, spender.address)).to.eq(amount)
    expect(await warden.nonces(deployer.address)).to.eq('1')

    await warden.connect(spender).transferFrom(deployer.address, spender.address, amount)
  })
})
