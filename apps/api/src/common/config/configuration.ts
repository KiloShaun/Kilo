export default () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  security: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    inviteExpiresInDays: parseInt(process.env.INVITE_EXPIRES_IN_DAYS ?? '7', 10),
  },
  tracking: {
    liveWindowSeconds: parseInt(process.env.LOCATION_LIVE_WINDOW_SECONDS ?? '45', 10),
    staleWindowSeconds: parseInt(process.env.LOCATION_STALE_WINDOW_SECONDS ?? '300', 10),
  },
});
