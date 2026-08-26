import { createClient } from "@supabase/supabase-js";
import type { TickerItem } from "../shared/types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and add your Supabase credentials."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-key"
);

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
    };
  };
};
