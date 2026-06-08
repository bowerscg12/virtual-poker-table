import { eq, and } from 'drizzle-orm';
import type { LobbyTemplate, CreateTemplateRequest } from '@vct/shared-types';
import type { VariantConfig } from '@vct/shared-types';
import { getDb } from '../db/client.js';
import { lobbyTemplates } from '../db/schema.js';

export const MAX_TEMPLATES_PER_USER = 20;

function rowToTemplate(row: typeof lobbyTemplates.$inferSelect): LobbyTemplate {
  return {
    id:        row.id,
    userId:    row.userId,
    name:      row.name,
    settings:  row.settings as VariantConfig,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getTemplatesForUser(userId: string): Promise<LobbyTemplate[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lobbyTemplates)
    .where(eq(lobbyTemplates.userId, userId))
    .orderBy(lobbyTemplates.createdAt);
  return rows.map(rowToTemplate);
}

export async function createTemplate(
  userId: string,
  req: CreateTemplateRequest,
): Promise<LobbyTemplate> {
  const db = getDb();

  const existing = await db
    .select({ id: lobbyTemplates.id })
    .from(lobbyTemplates)
    .where(eq(lobbyTemplates.userId, userId));

  if (existing.length >= MAX_TEMPLATES_PER_USER) {
    throw new Error(`Template limit reached (max ${MAX_TEMPLATES_PER_USER})`);
  }

  const name = req.name.trim();
  if (!name || name.length > 64) {
    throw new Error('Template name must be 1–64 characters');
  }

  const [row] = await db
    .insert(lobbyTemplates)
    .values({ userId, name, settings: req.settings })
    .returning();
  return rowToTemplate(row);
}

export async function deleteTemplate(userId: string, templateId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(lobbyTemplates)
    .where(and(eq(lobbyTemplates.id, templateId), eq(lobbyTemplates.userId, userId)))
    .returning({ id: lobbyTemplates.id });
  return result.length > 0;
}
