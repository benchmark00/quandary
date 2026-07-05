import { createClient } from "@supabase/supabase-js";

// Vite-style env vars. Both values are *public* (the anon key is safe in the
// browser because Row Level Security enforces access). Never put the service
// role key in client code.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
