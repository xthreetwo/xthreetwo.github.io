import { createClient } from "@supabase/supabase-js";
import type { TickerItem } from "../shared/types";

const supabaseUrlEnv = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKeyEnv = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrlEnv || !supabaseAnonKeyEnv) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and add your Supabase credentials."
  );
}

export const supabaseUrl = supabaseUrlEnv ?? "https://placeholder.supabase.co";
export const supabaseAnonKey = supabaseAnonKeyEnv ?? "placeholder-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      ticker_items: {
        Row: TickerItem;
        Insert: Omit<TickerItem, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<TickerItem, "id" | "created_at" | "updated_at">>;
      };
      spotify_tokens: {
        Row: {
          user_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
        };
        Update: Partial<{
          access_token: string;
          refresh_token: string;
          expires_at: string;
        }>;
      };
      twitch_tokens: {
        Row: {
          user_id: string;
          broadcaster_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scopes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          broadcaster_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scopes?: string | null;
        };
        Update: Partial<{
          broadcaster_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scopes: string | null;
        }>;
      };
      ticker_alert_settings: {
        Row: {
          user_id: string;
          alert_type: string;
          enabled: boolean;
          template: string;
          sound_url: string;
          duration_ms: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          alert_type: string;
          enabled?: boolean;
          template: string;
          sound_url: string;
          duration_ms?: number;
        };
        Update: Partial<{
          enabled: boolean;
          template: string;
          sound_url: string;
          duration_ms: number;
        }>;
      };
      ticker_alert_events: {
        Row: {
          id: string;
          user_id: string;
          alert_type: string;
          display_text: string;
          sound_url: string;
          duration_ms: number;
          created_at: string;
        };
        Insert: {
          user_id: string;
          alert_type: string;
          display_text: string;
          sound_url: string;
          duration_ms?: number;
        };
        Update: Partial<{
          display_text: string;
          sound_url: string;
          duration_ms: number;
        }>;
      };
      twitch_event_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          subscription_id: string;
          subscription_type: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          subscription_id: string;
          subscription_type: string;
          status?: string;
        };
        Update: Partial<{
          status: string;
        }>;
      };
    };
  };
};
