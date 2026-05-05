import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length
        ? ' ' + JSON.stringify(meta, (_k, v) =>
            v instanceof Error ? { message: v.message, stack: v.stack } : v
          )
        : ''
      return `${timestamp} [${level}]: ${message}${metaStr}`
    })
  ),
  transports: [new winston.transports.Console()],
})
