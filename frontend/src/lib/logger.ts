const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  info: (msg: string, ...args: unknown[]) => isDev && console.info(`[plague] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => isDev && console.warn(`[plague] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[plague] ${msg}`, ...args),
}
