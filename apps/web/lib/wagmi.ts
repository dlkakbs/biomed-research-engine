import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { arcTestnet } from './chain';

export const wagmiConfig = getDefaultConfig({
  appName: 'BioMed Research Engine',
  projectId: '780126d1008ee6fdd65dbc8837c25dac',
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [metaMaskWallet, walletConnectWallet],
    },
  ],
  chains: [arcTestnet],
  ssr: true,
});
