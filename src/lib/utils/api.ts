import { NextResponse } from 'next/server';

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json(meta ? { data, meta } : { data });
}

export function apiError(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function apiNotFound(resource: string = 'Resource') {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

export function apiValidationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
