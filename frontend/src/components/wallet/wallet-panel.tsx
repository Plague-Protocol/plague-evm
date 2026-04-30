type WalletPanelProps = {
  variant?: 'dark' | 'light'
}

export function WalletPanel({ variant = 'dark' }: WalletPanelProps) {
  const isDark = variant === 'dark'

  return (
    <section
      className={[
        'hud-panel p-5',
        isDark ? 'bg-plague-black text-plague-white' : 'bg-plague-white text-plague-black',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`font-mono text-xs uppercase tracking-[0.2em] ${isDark ? 'text-plague-white/75' : 'text-plague-black/65'}`}>
            Wallet Status
          </p>
          <h3 className="mt-2 font-display text-4xl leading-none">Freighter</h3>
        </div>
        <span className="status-dot online" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className={`border-3 p-3 ${isDark ? 'border-plague-white bg-plague-white text-plague-black' : 'border-plague-black bg-plague-yellow'}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Address</p>
          <p className="mt-2 font-mono text-sm">GB3A...QJ7N</p>
        </div>
        <div className={`border-3 p-3 ${isDark ? 'border-plague-white bg-plague-white text-plague-black' : 'border-plague-black bg-plague-white'}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Network</p>
          <p className="mt-2 font-mono text-sm">Stellar Testnet</p>
        </div>
        <div className={`border-3 p-3 ${isDark ? 'border-plague-white bg-plague-red text-plague-white' : 'border-plague-black bg-plague-red text-plague-white'}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Balance</p>
          <p className="mt-2 font-display text-4xl leading-none">128 XLM</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button className={`btn-brutal px-4 py-3 text-xs ${isDark ? 'bg-plague-yellow text-plague-black' : 'bg-plague-black text-plague-white'}`}>
          Connect Wallet Mock
        </button>
        <button className={`btn-brutal px-4 py-3 text-xs ${isDark ? 'bg-plague-white text-plague-black' : 'bg-plague-white text-plague-black'}`}>
          View Session
        </button>
      </div>
    </section>
  )
}
