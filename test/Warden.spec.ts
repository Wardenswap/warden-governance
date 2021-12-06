import { ethers, waffle, network } from 'hardhat'
import { utils, BigNumber } from 'ethers'
const { parseUnits } = utils
import { expect } from 'chai'
import { Warden } from '../typechain'

const EXPECT_TOTAL_SUPPLY = parseUnits('200000000', 18) // 200,000,000 Wad

describe('Warden', () => {
  let warden: Warden

  const provider = waffle.provider
  const [deployer, other] = provider.getWallets()

  beforeEach(async () => {
    // Deploy Uni route
    warden = await (await ethers.getContractFactory('Warden')).deploy(
      deployer.address
    )
    await warden.deployed()
  })

  it('Should deploy properly', async () => {
    expect(await warden.name()).to.eq('WardenSwap')
    expect(await warden.symbol()).to.eq('WAD')
    expect(await warden.decimals()).to.eq(18)
    expect(await warden.totalSupply()).to.eq(EXPECT_TOTAL_SUPPLY)

    expect(await warden.balanceOf(deployer.address)).to.eq(EXPECT_TOTAL_SUPPLY)
  })
})
