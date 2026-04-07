export interface JwtPayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  roles: string[];
  iat?: number;
  exp?: number;
}
