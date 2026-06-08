import type { VariantConfig } from './variant.js';

export interface LobbyTemplate {
  id: string;
  userId: string;
  name: string;
  settings: VariantConfig;
  createdAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  settings: VariantConfig;
}
