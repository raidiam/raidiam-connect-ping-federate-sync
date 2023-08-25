import { createLogger, format, transports } from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

export const getLogger = (logLevel = 'info') => {
  const logFormat = format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
  const logger =
   createLogger({
    level: logLevel,
    format: format.combine(format.colorize(), format.timestamp(), logFormat),
    transports: [new transports.Console()],
  })
  logger.add(new transports.DailyRotateFile({ filename: 'logs/%DATE%.log', datePattern: 'YYYY-MM-DD',  format: format.json()}))
  return logger;
}
