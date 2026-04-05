export interface JwtPayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  iat?: number;
  exp?: number;
}
