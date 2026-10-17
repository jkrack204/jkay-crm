import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, ApiError } from './api';
import type { Config, Me } from './types';

export function useMe() {
  const qc = useQueryClient();
  useEffect(() => {
    const out = () => qc.setQueryData(['me'], null);
    window.addEventListener('jkay:signed-out', out);
    return () => window.removeEventListener('jkay:signed-out', out);
  }, [qc]);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: Me }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<Config>('/config'), staleTime: 5 * 60_000 });
}

export async function logout(qc: ReturnType<typeof useQueryClient>) {
  await api.post('/auth/logout');
  qc.clear();
  qc.setQueryData(['me'], null);
}

export const homeFor = (role: Me['role']) => (role === 'admin' ? '/admin' : role === 'cre' ? '/cre' : '/bd');
