import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: integer("updated_at").notNull(),
});
export const suggestions = sqliteTable("suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }), spotifyId: text("spotify_id").notNull(), uri: text("uri").notNull(), name: text("name").notNull(), artist: text("artist").notNull(), album: text("album").notNull(), imageUrl: text("image_url"), durationMs: integer("duration_ms").notNull(), status: text("status").notNull().default("candidate"), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_suggestions_spotify_id_status").on(table.spotifyId, table.status)]);
export const votes = sqliteTable("votes", {
  id: integer("id").primaryKey({ autoIncrement: true }), suggestionId: integer("suggestion_id").notNull().references(() => suggestions.id, { onDelete: "cascade" }), voterId: text("voter_id").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_votes_suggestion_voter").on(table.suggestionId, table.voterId)]);
