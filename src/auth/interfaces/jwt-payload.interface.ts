export interface JwtPayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  iat?: number;
  exp?: number;
}
