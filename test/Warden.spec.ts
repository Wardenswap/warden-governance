import { ethers, waffle, network } from 'hardhat'
import { utils, BigNumber, constants } from 'ethers'
const { parseUnits } = utils
import { expect } from 'chai'
import { Warden } from '../typechain'
import { getApprovalDigest } from './shared/utilities'
import { ecsign } from 'ethereumjs-util'
const MaxUint96 = '79228162514264337593543950335'

const TOTAL_SUPPLY = parseUnits('200000000', 18) // 200,000,000 Wad
const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
)
const TEST_AMOUNT = parseUnits('10', 18)

describe('Warden', () => {
  let warden: Warden
  let chainId: number

  const provider = waffle.provider
  const [deployer, spender, other0, other1] = provider.getWallets()

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
    expect(await warden.totalSupply()).to.eq(TOTAL_SUPPLY)

    expect(await warden.balanceOf(deployer.address)).to.eq(TOTAL_SUPPLY)
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

  it('approve', async () => {
    await expect(warden.approve(spender.address, TEST_AMOUNT))
      .to.emit(warden, 'Approval')
      .withArgs(deployer.address, spender.address, TEST_AMOUNT)
    expect(await warden.allowance(deployer.address, spender.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer', async () => {
    await expect(warden.transfer(other0.address, TEST_AMOUNT))
      .to.emit(warden, 'Transfer')
      .withArgs(deployer.address, other0.address, TEST_AMOUNT)
    expect(await warden.balanceOf(deployer.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await warden.balanceOf(other0.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer:all', async () => {
    await warden.transfer(other0.address, TOTAL_SUPPLY)
  })

  it('transfer:fail', async () => {
    await expect(warden.transfer(other0.address, TOTAL_SUPPLY.add(1)))
    .to.be.revertedWith('Wad::_transferTokens: transfer amount exceeds balance')
    await expect(warden.connect(other0).transfer(deployer.address, 1))
    .to.be.revertedWith('Wad::_transferTokens: transfer amount exceeds balance')
  })

  it('transferFrom', async () => {
    await warden.approve(spender.address, TEST_AMOUNT)
    await expect(warden.connect(spender).transferFrom(deployer.address, spender.address, TEST_AMOUNT))
      .to.emit(warden, 'Transfer')
      .withArgs(deployer.address, spender.address, TEST_AMOUNT)
      .to.emit(warden, 'Approval')
      .withArgs(deployer.address, spender.address, '0')
    expect(await warden.allowance(deployer.address, spender.address)).to.eq(0)
    expect(await warden.balanceOf(deployer.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await warden.balanceOf(spender.address)).to.eq(TEST_AMOUNT)
  })

  it('transferFrom: max approval', async () => {
    await expect(warden.approve(spender.address, constants.MaxUint256))
      .to.emit(warden, 'Approval')
      .withArgs(deployer.address, spender.address, MaxUint96)
    await expect(warden.connect(spender).transferFrom(deployer.address, spender.address, TEST_AMOUNT))
      .to.emit(warden, 'Transfer')
      .withArgs(deployer.address, spender.address, TEST_AMOUNT)
      .to.not.emit(warden, 'Approval')
    expect(await warden.allowance(deployer.address, spender.address)).to.eq(MaxUint96)
    expect(await warden.balanceOf(deployer.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT))
    expect(await warden.balanceOf(spender.address)).to.eq(TEST_AMOUNT)
  })

  it('permit', async () => {
    const nonce = await warden.nonces(deployer.address)
    const deadline = constants.MaxUint256
    const digest = await getApprovalDigest(
      warden,
      deployer.address,
      spender.address,
      TEST_AMOUNT,
      nonce,
      deadline,
      chainId
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployer.privateKey.slice(2), 'hex'))

    await expect(warden.connect(other0).permit(deployer.address, spender.address, TEST_AMOUNT, deadline, v, utils.hexlify(r), utils.hexlify(s)))
      .to.emit(warden, 'Approval')
      .withArgs(deployer.address, spender.address, TEST_AMOUNT)
    expect(await warden.allowance(deployer.address, spender.address)).to.eq(TEST_AMOUNT)
    expect(await warden.nonces(deployer.address)).to.eq('1')

    await warden.connect(spender).transferFrom(deployer.address, spender.address, TEST_AMOUNT)
  })

  describe('Delegation', () => {
    it('nested delegation', async () => {
      const amount0 = parseUnits('1', 18)
      const amount1 = parseUnits('2', 18)
      await warden.transfer(other0.address, amount0)
      await warden.transfer(other1.address, amount1)
  
      expect(await warden.getCurrentVotes(other0.address)).to.be.eq(0)
      expect(await warden.getCurrentVotes(other1.address)).to.be.eq(0)
  
      await warden.connect(other0).delegate(other1.address)
      expect(await warden.getCurrentVotes(other0.address)).to.be.eq(0)
      expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0)
  
      await warden.connect(other1).delegate(other1.address)
      expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0.add(amount1))
  
      await warden.connect(other1).delegate(deployer.address)
      expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0)
      expect(await warden.getCurrentVotes(deployer.address)).to.be.eq(amount1)
    })
  })
})
