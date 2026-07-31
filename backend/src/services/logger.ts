import winston from 'winston';
import { config } from '../config';

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr =
        Object.keys(meta).length > 0 ? `  ${JSON.stringify(meta)}` : '';
      return `${String(timestamp)} [${level}] ${String(message)}${metaStr}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
