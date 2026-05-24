const JWT_SECRET_MIN_LENGTH = 32;

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET must be defined.");
  }

  if (process.env.NODE_ENV === "production" && secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters long.`);
  }

  return secret;
};
