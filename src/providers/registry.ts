/**
 * Provider registry — maps provider IDs to their adapter constructors.
 *
 * To add a new provider:
 *   1. Create src/providers/myprovider.provider.ts extending BaseProvider
 *   2. Import and add it to PROVIDER_MAP below
 */
import type { ProviderConfig } from '../types/config.types.js';
import type { ProviderAdapter } from '../types/provider.types.js';
import { StubProvider } from './stub.provider.js';
import {
  VfsGlobalProvider,
  VfsGlobalAutProvider, VfsGlobalBelProvider, VfsGlobalHrvProvider,
  VfsGlobalCzeProvider, VfsGlobalDnkProvider, VfsGlobalEstProvider,
  VfsGlobalFinProvider, VfsGlobalFraProvider, VfsGlobalLvaProvider,
  VfsGlobalLtuProvider, VfsGlobalLuxProvider, VfsGlobalMltProvider,
  VfsGlobalNldProvider, VfsGlobalNorProvider, VfsGlobalPolProvider,
  VfsGlobalSvkProvider, VfsGlobalSvnProvider, VfsGlobalSweProvider,
  VfsGlobalItaProvider,
} from './vfs-global.provider.js';

type ProviderConstructor = new (config: ProviderConfig) => ProviderAdapter;

const PROVIDER_MAP: Record<string, ProviderConstructor> = {
  stub:                  StubProvider,
  'vfs-global-tur-che':  VfsGlobalProvider,
  'vfs-global-tur-aut':  VfsGlobalAutProvider,
  'vfs-global-tur-bel':  VfsGlobalBelProvider,
  'vfs-global-tur-hrv':  VfsGlobalHrvProvider,
  'vfs-global-tur-cze':  VfsGlobalCzeProvider,
  'vfs-global-tur-dnk':  VfsGlobalDnkProvider,
  'vfs-global-tur-est':  VfsGlobalEstProvider,
  'vfs-global-tur-fin':  VfsGlobalFinProvider,
  'vfs-global-tur-fra':  VfsGlobalFraProvider,
  'vfs-global-tur-lva':  VfsGlobalLvaProvider,
  'vfs-global-tur-ltu':  VfsGlobalLtuProvider,
  'vfs-global-tur-lux':  VfsGlobalLuxProvider,
  'vfs-global-tur-mlt':  VfsGlobalMltProvider,
  'vfs-global-tur-nld':  VfsGlobalNldProvider,
  'vfs-global-tur-nor':  VfsGlobalNorProvider,
  'vfs-global-tur-pol':  VfsGlobalPolProvider,
  'vfs-global-tur-svk':  VfsGlobalSvkProvider,
  'vfs-global-tur-svn':  VfsGlobalSvnProvider,
  'vfs-global-tur-swe':  VfsGlobalSweProvider,
  'vfs-global-tur-ita':  VfsGlobalItaProvider,
};

export function createProvider(config: ProviderConfig): ProviderAdapter {
  const Ctor = PROVIDER_MAP[config.id];
  if (!Ctor) {
    throw new Error(
      `No provider adapter registered for id="${config.id}". ` +
      `Available: ${Object.keys(PROVIDER_MAP).join(', ')}`
    );
  }
  return new Ctor(config);
}
