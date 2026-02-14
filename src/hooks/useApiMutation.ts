'use client';

import { useState, useCallback } from 'react';

interface UseApiMutationOptions<TResponse> {
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
}

interface UseApiMutationResult<TBody, TResponse> {
  mutate: (body?: TBody) => Promise<TResponse | undefined>;
  isPending: boolean;
  status: 'idle' | 'success' | 'error';
  error: string | null;
  reset: () => void;
}

export function useApiMutation<TBody = unknown, TResponse = unknown>(
  url: string | (() => string),
  options?: UseApiMutationOptions<TResponse>
): UseApiMutationResult<TBody, TResponse> {
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const mutate = useCallback(async (body?: TBody): Promise<TResponse | undefined> => {
    setIsPending(true);
    setStatus('idle');
    setError(null);
    try {
      const resolvedUrl = typeof url === 'function' ? url() : url;
      const res = await fetch(resolvedUrl, {
        method: options?.method ?? 'POST',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || 'Request failed';
        setStatus('error');
        setError(message);
        options?.onError?.(message);
        return undefined;
      }
      setStatus('success');
      options?.onSuccess?.(data);
      return data as TResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setStatus('error');
      setError(message);
      options?.onError?.(message);
      return undefined;
    } finally {
      setIsPending(false);
    }
  }, [url, options]);

  return { mutate, isPending, status, error, reset };
}
