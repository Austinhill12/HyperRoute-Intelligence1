import { createClient } from "https://esm.sh/@supabase/supabase-js";

const supabaseUrl =
  "https://ygrikxlbfmtkovktwhdp.supabase.co";

const supabaseKey =
  "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);