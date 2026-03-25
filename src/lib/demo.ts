export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export const DEMO_USER = {
  name: 'Demo User',
  email: 'demo@example.com',
  password: 'demo1234!',
} as const;

export const DEMO_REPO_URL = 'https://github.com/smithadifd/hoard';
