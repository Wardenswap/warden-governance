import { ethers, waffle, network } from 'hardhat'
import { utils, BigNumber, constants } from 'ethers'
const { parseUnits, formatBytes32String } = utils
import { expect } from 'chai'
import { Warden } from '../typechain'
import { getApprovalDigest, getDelegateBySigDigest } from './shared/utilities'
import { ecsign } from 'ethereumjs-util'
import { minerStop, minerStart, mineBlock } from './shared/Ethereum'
const MaxUint96 = '79228162514264337593543950335'

const TOTAL_SUPPLY = parseUnits('200000000', 18) // 200,000,000 Wad
const TEST_AMOUNT = parseUnits('10', 18)

describe('Warden', () => {
  let warden: Warden
  let chainId: number

  const provider = waffle.provider
  const [deployer, spender, other0, other1, a1, a2] = provider.getWallets()

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

  it('nested delegation', async () => {
    const amount0 = parseUnits('1', 18)
    const amount1 = parseUnits('2', 18)
    await warden.transfer(other0.address, amount0)
    await warden.transfer(other1.address, amount1)

    expect(await warden.getCurrentVotes(other0.address)).to.be.eq(0)
    expect(await warden.getCurrentVotes(other1.address)).to.be.eq(0)

    await expect(warden.connect(other0).delegate(other1.address))
      .to.emit(warden, 'DelegateChanged')
      .withArgs(other0.address, constants.AddressZero, other1.address)
      .to.emit(warden, 'DelegateVotesChanged')
      .withArgs(other1.address, 0, amount0)
    expect(await warden.getCurrentVotes(other0.address)).to.be.eq(0)
    expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0)

    await expect(warden.connect(other1).delegate(other1.address))
      .to.emit(warden, 'DelegateChanged')
      .withArgs(other1.address, constants.AddressZero, other1.address)
      .to.emit(warden, 'DelegateVotesChanged')
      .withArgs(other1.address, amount0, amount0.add(amount1))
    expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0.add(amount1))

    await expect(warden.connect(other1).delegate(deployer.address))
      .to.emit(warden, 'DelegateChanged')
      .withArgs(other1.address, other1.address, deployer.address)
      .to.emit(warden, 'DelegateVotesChanged')
      .withArgs(other1.address, amount0.add(amount1), amount0)
      .to.emit(warden, 'DelegateVotesChanged')
      .withArgs(deployer.address, constants.AddressZero, amount1)
    expect(await warden.getCurrentVotes(other1.address)).to.be.eq(amount0)
    expect(await warden.getCurrentVotes(deployer.address)).to.be.eq(amount1)
  })

  describe('delegateBySig', () => {
    it('reverts if the signatory is invalid', async () => {
      const delegatee = deployer, nonce = BigNumber.from('0'), expiry = BigNumber.from('0')
      await expect(warden.connect(other0).delegateBySig(deployer.address, nonce, expiry, 0, formatBytes32String('bad'), formatBytes32String('bad')))
      .revertedWith('Wad::delegateBySig: invalid signature')
    })

    it('reverts if the nonce is bad ', async () => {
      const delegatee = deployer, nonce = BigNumber.from('1'), expiry = BigNumber.from('0')
      const digest = await getDelegateBySigDigest(warden, delegatee.address, nonce, expiry, chainId)
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployer.privateKey.slice(2), 'hex'))

      await expect(warden.connect(other0).delegateBySig(deployer.address, nonce, expiry, v, utils.hexlify(r), utils.hexlify(s)))
      .revertedWith('Wad::delegateBySig: invalid nonce')
    })

    it('reverts if the signature has expired', async () => {
      const delegatee = deployer, nonce = BigNumber.from('0'), expiry = BigNumber.from('0')
      const digest = await getDelegateBySigDigest(warden, delegatee.address, nonce, expiry, chainId)
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployer.privateKey.slice(2), 'hex'))

      await expect(warden.connect(other0).delegateBySig(deployer.address, nonce, expiry, v, utils.hexlify(r), utils.hexlify(s)))
      .revertedWith('Wad::delegateBySig: signature expired')
    })

    it('delegates on behalf of the signatory', async () => {
      const delegatee = deployer, nonce = BigNumber.from('0'), expiry = BigNumber.from('10000000000')
      const digest = await getDelegateBySigDigest(warden, delegatee.address, nonce, expiry, chainId)
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployer.privateKey.slice(2), 'hex'))

      await expect(warden.connect(other0).delegateBySig(deployer.address, nonce, expiry, v, utils.hexlify(r), utils.hexlify(s)))
        .to.emit(warden, 'DelegateChanged')
        .withArgs(deployer.address, constants.AddressZero, deployer.address)
        .to.emit(warden, 'DelegateVotesChanged')
        .withArgs(deployer.address, 0, TOTAL_SUPPLY)
      expect(await warden.getCurrentVotes(deployer.address)).to.be.eq(TOTAL_SUPPLY)
    })
  })

  describe('numCheckpoints', () => {
    it('returns the number of checkpoints for a delegate', async () => {
      const delegator = other0
      await warden.transfer(delegator.address, parseUnits('100', 18))
      expect(await warden.numCheckpoints(a1.address)).to.eq(0)

      const t1 = await warden.connect(delegator).delegate(a1.address)
      const r1 = await t1.wait()
      expect(await warden.numCheckpoints(a1.address)).to.eq(1)

      const t2 = await warden.connect(delegator).transfer(a2.address, parseUnits('10', 18))
      const r2 = await t2.wait()
      expect(await warden.numCheckpoints(a1.address)).to.eq(2)

      const t3 = await warden.connect(delegator).transfer(a2.address, parseUnits('10', 18))
      const r3 = await t3.wait()
      expect(await warden.numCheckpoints(a1.address)).to.eq(3)

      const t4 = await warden.transfer(delegator.address, parseUnits('20', 18))
      const r4 = await t4.wait()
      expect(await warden.numCheckpoints(a1.address)).to.eq(4)

      const a = await warden.checkpoints(a1.address, 0)

      expect(await warden.checkpoints(a1.address, 0)).to.eql([r1.blockNumber, parseUnits('100', 18)])
      expect(await warden.checkpoints(a1.address, 1)).to.eql([r2.blockNumber, parseUnits('90', 18)])
      expect(await warden.checkpoints(a1.address, 2)).to.eql([r3.blockNumber, parseUnits('80', 18)])
      expect(await warden.checkpoints(a1.address, 3)).to.eql([r4.blockNumber, parseUnits('100', 18)])
    })

    it('does not add more than one checkpoint in a block', async () => {
      const delegator = other0

      await warden.transfer(delegator.address, parseUnits('100', 18))
      expect(await warden.numCheckpoints(a1.address)).to.eq(0)
      await minerStop()

      const t1 =  await warden.connect(delegator).delegate(a1.address)
      const t2 =  await warden.connect(delegator).transfer(a2.address, parseUnits('10', 18))
      const t3 =  await warden.connect(delegator).transfer(a2.address, parseUnits('10', 18))

      await minerStart()
      const r1 = await t1.wait()
      const r2 = await t2.wait()
      const r3 = await t3.wait()
      
      expect(await warden.numCheckpoints(a1.address)).to.eq(1)

      expect(await warden.checkpoints(a1.address, 0)).to.eql([r1.blockNumber, parseUnits('80', 18)])
      expect(await warden.checkpoints(a1.address, 1)).to.eql([0, parseUnits('0', 18)])
      expect(await warden.checkpoints(a1.address, 2)).to.eql([0, parseUnits('0', 18)])

      const t4 = await warden.transfer(delegator.address, parseUnits('20', 18))
      const r4 = await t4.wait()
      expect(await warden.numCheckpoints(a1.address)).to.eq(2)
      expect(await warden.checkpoints(a1.address, 1)).to.eql([r4.blockNumber, parseUnits('100', 18)])
    })
  })

  describe('getPriorVotes', () => {
    it('reverts if block number >= current block', async () => {
      await expect(warden.getPriorVotes(a1.address, 5e10))
      .revertedWith('Wad::getPriorVotes: not yet determined')
    })

    it('returns 0 if there are no checkpoints', async () => {
      expect(await warden.getPriorVotes(a1.address, 0)).to.eq(0)
    })

    it('returns the latest block if >= last checkpoint block', async () => {
      const t1 = await warden.delegate(a1.address)
      await mineBlock()
      await mineBlock()
      const r1 = await t1.wait()

      expect(await warden.getPriorVotes(a1.address, r1.blockNumber)).to.eq(TOTAL_SUPPLY)
      expect(await warden.getPriorVotes(a1.address, r1.blockNumber + 1)).to.eq(TOTAL_SUPPLY)
    })

    it('returns zero if < first checkpoint block', async () => {
      await mineBlock()
      const t1 = await warden.delegate(a1.address)
      await mineBlock()
      await mineBlock()
      const r1 = await t1.wait()

      expect(await warden.getPriorVotes(a1.address, r1.blockNumber - 1)).to.eq('0')
      expect(await warden.getPriorVotes(a1.address, r1.blockNumber + 1)).to.eq(TOTAL_SUPPLY)
    })

    it('generally returns the voting balance at the appropriate checkpoint', async () => {
      const t1 = await warden.delegate(a1.address)
      await mineBlock()
      await mineBlock()
      const t2 = await warden.transfer(a2.address, parseUnits('10', 18))
      await mineBlock()
      await mineBlock()
      const t3 = await warden.transfer(a2.address, parseUnits('10', 18))
      await mineBlock()
      await mineBlock()
      const t4 = await warden.connect(a2).transfer(deployer.address, parseUnits('20', 18))
      await mineBlock()
      await mineBlock()

      const r1 = await t1.wait()
      const r2 = await t2.wait()
      const r3 = await t3.wait()
      const r4 = await t4.wait()

      expect(await warden.getPriorVotes(a1.address, r1.blockNumber - 1)).to.eq('0')
      expect(await warden.getPriorVotes(a1.address, r1.blockNumber)).to.eq(TOTAL_SUPPLY)
      expect(await warden.getPriorVotes(a1.address, r1.blockNumber + 1)).to.eq(TOTAL_SUPPLY)
      expect(await warden.getPriorVotes(a1.address, r2.blockNumber)).to.eq(TOTAL_SUPPLY.sub(parseUnits('10', 18)))
      expect(await warden.getPriorVotes(a1.address, r2.blockNumber + 1)).to.eq(TOTAL_SUPPLY.sub(parseUnits('10', 18)))
      expect(await warden.getPriorVotes(a1.address, r3.blockNumber)).to.eq(TOTAL_SUPPLY.sub(parseUnits('20', 18)))
      expect(await warden.getPriorVotes(a1.address, r3.blockNumber + 1)).to.eq(TOTAL_SUPPLY.sub(parseUnits('20', 18)))
      expect(await warden.getPriorVotes(a1.address, r4.blockNumber)).to.eq(TOTAL_SUPPLY)
      expect(await warden.getPriorVotes(a1.address, r4.blockNumber + 1)).to.eq(TOTAL_SUPPLY)
    })
  })
})
