if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = '0'.repeat(64)
}